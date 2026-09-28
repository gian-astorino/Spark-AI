// POST /functions/v1/import  { business_id }
//
// Reads the business's website and writes what it finds into the profile:
// business, locations and hours, branding, catalog. Answers 202 at once with
// the job id; the client follows `import_jobs` and the profile tables over
// Realtime while the work runs in the background.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { extract, pagesAsInput } from '../_shared/llm.ts'
import { scrape, type Branding, type ScrapedPage } from '../_shared/firecrawl.ts'
import { ExtractedProfile, PagePicks } from '../_shared/profile-schema.ts'

// Enough to find treatments, prices, hours and contacts on a small business
// site, and a hard ceiling on Firecrawl credits per import (1 + 6).
const MAX_EXTRA_PAGES = 6

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { business_id } = await request.json().catch(() => ({}))
  if (typeof business_id !== 'string') return json({ error: 'business_id is required' }, 400)

  // Ownership is checked with the caller's own token: RLS answers for us.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
  })
  const { data: business } = await asUser
    .from('businesses')
    .select('id, website_url')
    .eq('id', business_id)
    .maybeSingle()
  if (!business) return json({ error: 'Business not found' }, 404)
  if (!business.website_url) return json({ error: 'The business has no website' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: job, error } = await db
    .from('import_jobs')
    .insert({
      business_id,
      source: 'website',
      target: business.website_url,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) return json({ error: error.message }, 500)

  await db.from('businesses').update({ onboarding_status: 'importing' }).eq('id', business_id)

  EdgeRuntime.waitUntil(
    runImport(db, business_id, job.id, business.website_url).catch(async (failure) => {
      console.error(failure)
      await db
        .from('import_jobs')
        .update({ status: 'failed', error: String(failure), finished_at: new Date().toISOString() })
        .eq('id', job.id)
    }),
  )

  return json({ job_id: job.id }, 202)
})

async function runImport(db: SupabaseClient, businessId: string, jobId: string, url: string) {
  // 1. The home page, with its links and Firecrawl's branding analysis.
  const home = await scrape(url, true)

  // 2. The model picks the pages worth reading from the site's own links.
  const origin = new URL(home.url).origin
  const candidates = [...new Set(home.links)].filter((link) => link.startsWith(origin) && link !== home.url)
  let extra: ScrapedPage[] = []
  if (candidates.length > 0) {
    const picks = await extract({
      name: 'page_picks',
      schema: PagePicks,
      effort: 'low',
      instructions:
        'You choose which pages of a local business website to read. Prefer pages about services or treatments, prices, opening hours, contacts and locations, and the team. Return at most 6 URLs, only from the list given.',
      input: candidates.join('\n'),
    })
    const chosen = picks.urls.filter((link) => candidates.includes(link)).slice(0, MAX_EXTRA_PAGES)
    // A page that fails to load is skipped, not fatal: the rest is still useful.
    const results = await Promise.allSettled(chosen.map((link) => scrape(link)))
    extra = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  }

  const pages = [home, ...extra]
  await db.from('scraped_pages').insert(
    pages.map((page) => ({ job_id: jobId, url: page.url, title: page.title, markdown: page.markdown })),
  )

  // 3. One extraction over every page.
  const profile = await extract({
    name: 'business_profile',
    schema: ExtractedProfile,
    instructions: [
      'You extract a business profile from the pages of its website, for a booking and marketing assistant.',
      'Only use what the pages say. When something is not stated, return null or an empty list: never guess prices, durations or hours.',
      'Keep names and descriptions in the language of the site.',
    ].join(' '),
    input: pagesAsInput(pages),
  })

  // 4. Write section by section, so the panel fills in as each one lands.
  await saveBusiness(db, businessId, profile)
  await markDone(db, jobId, 'business')
  await saveLocations(db, businessId, profile)
  await markDone(db, jobId, 'location')
  await saveBranding(db, businessId, profile, home.branding)
  await markDone(db, jobId, 'branding')
  await saveCatalog(db, businessId, profile)
  await markDone(db, jobId, 'catalog')

  await db.from('import_jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId)
  await db.from('businesses').update({ onboarding_status: 'chatting' }).eq('id', businessId)
}

async function saveBusiness(db: SupabaseClient, businessId: string, profile: ExtractedProfile) {
  const { name, description, sector } = profile.business
  await db.from('businesses').update({ name, description, sector, source: 'import' }).eq('id', businessId)
}

async function saveLocations(db: SupabaseClient, businessId: string, profile: ExtractedProfile) {
  // Re-importing replaces what a previous import wrote, never what the owner said.
  await db.from('locations').delete().eq('business_id', businessId).eq('source', 'import')
  for (const [position, location] of profile.locations.entries()) {
    const { data } = await db
      .from('locations')
      .insert({ business_id: businessId, name: location.name, address: location.address, position, source: 'import' })
      .select('id')
      .single()
    const hours = location.hours.filter((row) => row.closes_at > row.opens_at)
    if (data && hours.length > 0) {
      await db.from('opening_hours').insert(hours.map((row) => ({ location_id: data.id, ...row })))
    }
  }
}

async function saveBranding(
  db: SupabaseClient,
  businessId: string,
  profile: ExtractedProfile,
  branding: Branding | undefined,
) {
  const logo = branding?.logo ? await storeLogo(db, businessId, branding.logo) : null
  await db.from('brand_profiles').upsert({
    business_id: businessId,
    logo_path: logo,
    logo_source_url: branding?.logo ?? null,
    tone_of_voice: profile.tone_of_voice,
    source: 'import',
  })

  await db.from('brand_colors').delete().eq('business_id', businessId).eq('source', 'import')
  const colors = Object.entries(branding?.colors ?? {}).filter(([, hex]) => /^#[0-9a-f]{6}$/i.test(hex))
  if (colors.length > 0) {
    await db.from('brand_colors').insert(
      colors.map(([role, hex], position) => ({ business_id: businessId, name: role, hex, position, source: 'import' })),
    )
  }
}

async function saveCatalog(db: SupabaseClient, businessId: string, profile: ExtractedProfile) {
  await db.from('catalog_items').delete().eq('business_id', businessId).eq('source', 'import')
  if (profile.catalog.length === 0) return
  await db.from('catalog_items').insert(
    profile.catalog.map((item, position) => ({ business_id: businessId, ...item, position, source: 'import' })),
  )
}

/** Copies the logo into our own storage: the site may change or disappear. */
async function storeLogo(db: SupabaseClient, businessId: string, url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const type = response.headers.get('content-type') ?? 'image/png'
    const extension = type.includes('svg') ? 'svg' : type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png'
    const path = `${businessId}/logo.${extension}`
    const { error } = await db.storage
      .from('logos')
      .upload(path, await response.arrayBuffer(), { contentType: type, upsert: true })
    return error ? null : path
  } catch {
    return null
  }
}

async function markDone(db: SupabaseClient, jobId: string, section: string) {
  const { data } = await db.from('import_jobs').select('sections_done').eq('id', jobId).single()
  await db
    .from('import_jobs')
    .update({ sections_done: [...(data?.sections_done ?? []), section] })
    .eq('id', jobId)
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
