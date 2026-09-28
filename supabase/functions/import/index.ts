// POST /functions/v1/import  { business_id }
//
// Crawls the business's website: the home page plus the pages most likely to
// hold treatments, prices, hours and contacts, stored in `scraped_pages` for
// the extraction step that comes later. Logo and colours arrive already
// structured from Firecrawl, so those go straight into the profile. Answers
// 202 at once with the job id; the client follows `import_jobs` over Realtime.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { scrape, type Branding, type ScrapedPage } from '../_shared/firecrawl.ts'

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

// Path fragments, Italian and English, of the pages worth reading. Earlier
// entries rank higher when a site has more candidates than MAX_EXTRA_PAGES.
const USEFUL_PATHS = [
  /tratt|servi|treatment|service|listino|prezz|price|menu/i,
  /orari|hours|contatt|contact|dove|location|sede|sedi/i,
  /chi-?siamo|about|team|staff|studio/i,
]

function pickPages(home: ScrapedPage): string[] {
  // "example.com" often redirects to "www.example.com": both count as the site.
  const host = (link: string) => new URL(link).hostname.replace(/^www\./, '')
  const site = host(home.url)
  const links = [...new Set(home.links.map((link) => link.split('#')[0]))].filter((link) => {
    try {
      return host(link) === site && new URL(link).pathname !== new URL(home.url).pathname
    } catch {
      return false // relative or malformed links are not worth a credit
    }
  }).filter((link) => !/\.(pdf|jpe?g|png|webp|svg)$/i.test(link))
  const rank = (link: string) => {
    const path = new URL(link).pathname
    const index = USEFUL_PATHS.findIndex((pattern) => pattern.test(path))
    return index === -1 ? Infinity : index
  }
  return links
    .filter((link) => rank(link) !== Infinity)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_EXTRA_PAGES)
}

async function runImport(db: SupabaseClient, businessId: string, jobId: string, url: string) {
  // 1. The home page, with its links and Firecrawl's branding analysis.
  const home = await scrape(url, true)

  // 2. The pages that look useful from their address. One that fails to load
  //    is skipped, not fatal: the rest is still worth keeping.
  const results = await Promise.allSettled(pickPages(home).map((link) => scrape(link)))
  const pages = [home, ...results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))]

  await db.from('scraped_pages').insert(
    pages.map((page) => ({ job_id: jobId, url: page.url, title: page.title, markdown: page.markdown })),
  )
  await db.from('import_jobs').update({ pages_read: pages.length }).eq('id', jobId)

  // 3. Branding needs no extraction: Firecrawl already returns it structured.
  await saveBranding(db, businessId, home.branding)
  await markDone(db, jobId, 'branding')

  await db.from('import_jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId)
  await db.from('businesses').update({ onboarding_status: 'chatting' }).eq('id', businessId)
}

// Firecrawl names colours by their role on the page.
const COLOR_ROLES: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
  background: 'Background',
  textPrimary: 'Text',
  textSecondary: 'Secondary text',
  link: 'Link',
}

async function saveBranding(db: SupabaseClient, businessId: string, branding: Branding | undefined) {
  if (!branding) return
  const logo = branding.logo ? await storeLogo(db, businessId, branding.logo) : null
  await db.from('brand_profiles').upsert({
    business_id: businessId,
    logo_path: logo,
    // Inline logos arrive as data: URLs, often tens of KB: the copy in storage is enough.
    logo_source_url: branding.logo?.startsWith('http') ? branding.logo : null,
    source: 'import',
  })

  await db.from('brand_colors').delete().eq('business_id', businessId).eq('source', 'import')
  const colors = Object.entries(branding.colors ?? {}).filter(([, hex]) => /^#[0-9a-f]{6}$/i.test(hex))
  if (colors.length > 0) {
    await db.from('brand_colors').insert(
      colors.map(([role, hex], position) => ({
        business_id: businessId,
        name: COLOR_ROLES[role] ?? role,
        hex: hex.toUpperCase(),
        position,
        source: 'import',
      })),
    )
  }
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
