// POST /functions/v1/import
//
//   { business_id }  start: reads the home page's branding straight away and
//                    starts a Firecrawl crawl (up to MAX_PAGES pages) that
//                    extracts the profile from every page. Answers { job_id }.
//   { business_id, url }
//                    start an additional source (a Treatwell or Fresha page,
//                    a price list…): crawls that page and what sits under it
//                    (up to EXTRA_PAGES), no branding, and adds to the profile
//                    instead of replacing what earlier imports found.
//   { job_id }       check: reports the crawl's progress; once it has finished,
//                    merges the pages into one profile and writes it. The
//                    client calls this every few seconds while it waits.
//
// Split in two because a crawl with extraction can outlast an Edge Function's
// wall-clock limit: nothing here waits for Firecrawl.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  addressKey,
  key,
  mergePages,
  PAGE_PROMPT,
  PAGE_SCHEMA,
  type MergedProfile,
  type PageExtraction,
} from '../_shared/extraction.ts'
import { crawlStatus, scrape, startCrawl, type Branding } from '../_shared/firecrawl.ts'

// 1 credit per page crawled + 4 for its JSON extraction: at most ~125 per site,
// ~25 per additional source.
const MAX_PAGES = 25
const EXTRA_PAGES = 5

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await request.json().catch(() => ({}))

  // Ownership is checked with the caller's own token: RLS answers for us.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
  })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    if (typeof body.job_id === 'string') return await check(asUser, db, body.job_id)
    if (typeof body.business_id === 'string') return await start(asUser, db, body.business_id, body.url)
    return json({ error: 'business_id or job_id is required' }, 400)
  } catch (failure) {
    console.error(failure)
    return json({ error: String(failure) }, 500)
  }
})

async function start(asUser: SupabaseClient, db: SupabaseClient, businessId: string, extraUrl?: unknown) {
  const { data: business } = await asUser
    .from('businesses')
    .select('id, website_url')
    .eq('id', businessId)
    .maybeSingle()
  if (!business) return json({ error: 'Business not found' }, 404)

  const additive = extraUrl !== undefined
  if (additive && (typeof extraUrl !== 'string' || !/^https?:\/\/[^\s]+\.[^\s]+/.test(extraUrl))) {
    return json({ error: 'url must be an http(s) address' }, 400)
  }
  const target = additive ? (extraUrl as string) : business.website_url
  if (!target) return json({ error: 'The business has no website' }, 400)

  const { data: job, error } = await db
    .from('import_jobs')
    .insert({
      business_id: businessId,
      source: 'website',
      target,
      additive,
      status: 'running',
      pages_total: additive ? EXTRA_PAGES : MAX_PAGES,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  if (!additive) await db.from('businesses').update({ onboarding_status: 'importing' }).eq('id', businessId)

  try {
    let url = target
    if (!additive) {
      // Branding comes from the business's own home page and needs no extraction.
      const home = await scrape(target, true)
      await db.from('import_jobs').update({ raw_branding: home.branding ?? null }).eq('id', job.id)
      await saveBranding(db, businessId, home.branding)
      await markDone(db, job.id, 'branding')
      url = home.url
    }
    const crawlId = await startCrawl({
      url,
      limit: additive ? EXTRA_PAGES : MAX_PAGES,
      sitemap: additive ? 'skip' : 'include',
      schema: PAGE_SCHEMA,
      prompt: PAGE_PROMPT,
    })
    await db.from('import_jobs').update({ firecrawl_id: crawlId }).eq('id', job.id)
  } catch (failure) {
    await fail(db, job.id, failure)
  }
  return json({ job_id: job.id }, 202)
}

async function check(asUser: SupabaseClient, db: SupabaseClient, jobId: string) {
  const { data: job } = await asUser
    .from('import_jobs')
    .select('id, business_id, status, firecrawl_id, pages_read, pages_total, additive')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return json({ error: 'Job not found' }, 404)
  if (job.status !== 'running' || !job.firecrawl_id) return json(progress(job), 200)

  const crawl = await crawlStatus<PageExtraction>(job.firecrawl_id)
  if (crawl.status === 'failed') {
    await fail(db, job.id, 'Firecrawl crawl failed')
    return json({ ...progress(job), status: 'failed' }, 200)
  }
  if (crawl.status === 'scraping') {
    const update = { pages_read: crawl.completed, pages_total: Math.max(crawl.total, crawl.completed) }
    await db.from('import_jobs').update(update).eq('id', job.id)
    return json({ ...progress(job), ...update }, 200)
  }

  // Completed. Only the check that claims the job processes it.
  const { data: claimed } = await db
    .from('import_jobs')
    .update({ processing_started_at: new Date().toISOString() })
    .eq('id', job.id)
    .is('processing_started_at', null)
    .select('id')
  if (!claimed?.length) return json(progress(job), 200)

  try {
    const finished = await crawlStatus<PageExtraction>(job.firecrawl_id, true)
    // The home page first: on a tie its answer wins.
    const pages = [...finished.pages].sort((a, b) => a.url.length - b.url.length)
    await db.from('scraped_pages').insert(
      pages.map((page) => ({ job_id: job.id, url: page.url, title: page.title, markdown: page.markdown })),
    )
    const profile = mergePages(pages.map((page) => page.json ?? {}))
    await (job.additive ? addToProfile : saveProfile)(db, job.business_id, job.id, profile)

    const done = { status: 'done', pages_read: pages.length, pages_total: pages.length, finished_at: new Date().toISOString() }
    await db.from('import_jobs').update(done).eq('id', job.id)
    if (!job.additive) await db.from('businesses').update({ onboarding_status: 'chatting' }).eq('id', job.business_id)
    return json({ ...progress(job), ...done }, 200)
  } catch (failure) {
    await fail(db, job.id, failure)
    return json({ ...progress(job), status: 'failed' }, 200)
  }
}

function progress(job: { id: string; status: string; pages_read: number; pages_total: number | null }) {
  return { job_id: job.id, status: job.status, pages_read: job.pages_read, pages_total: job.pages_total }
}

async function fail(db: SupabaseClient, jobId: string, failure: unknown) {
  console.error(failure)
  await db
    .from('import_jobs')
    .update({ status: 'failed', error: String(failure), finished_at: new Date().toISOString() })
    .eq('id', jobId)
}

// ---------------------------------------------------------------------------
// Writing the profile. A re-import replaces only rows it wrote itself
// (source = 'import'): what the owner said in the chat is never overwritten.
// ---------------------------------------------------------------------------

async function saveProfile(db: SupabaseClient, businessId: string, jobId: string, profile: MergedProfile) {
  const { name, description, sector } = profile.business
  if (name || description || sector) {
    await db.from('businesses').update({ name, description, sector, source: 'import' }).eq('id', businessId)
  }
  await markDone(db, jobId, 'business')

  await db.from('locations').delete().eq('business_id', businessId).eq('source', 'import')
  for (const [position, location] of profile.locations.entries()) {
    const { data } = await db
      .from('locations')
      .insert({ business_id: businessId, name: location.name, address: location.address, position, source: 'import' })
      .select('id')
      .single()
    if (data && location.hours.length > 0) {
      await db.from('opening_hours').insert(location.hours.map((row) => ({ location_id: data.id, ...row })))
    }
  }
  await markDone(db, jobId, 'location')

  if (profile.tone_of_voice.length > 0) {
    // Upsert: a site without branding has no row yet. Only these columns change.
    await db.from('brand_profiles').upsert({ business_id: businessId, tone_of_voice: profile.tone_of_voice, source: 'import' })
  }

  await db.from('catalog_items').delete().eq('business_id', businessId).eq('source', 'import')
  if (profile.catalog.length > 0) {
    await db.from('catalog_items').insert(
      profile.catalog.map((item, position) => ({ business_id: businessId, ...item, position, source: 'import' })),
    )
  }
  await markDone(db, jobId, 'catalog')
}

/**
 * An additional source only fills gaps: empty business fields, locations and
 * treatments not seen yet, hours for a location that had none, and the price
 * or duration a known treatment was missing. It never removes anything.
 */
async function addToProfile(db: SupabaseClient, businessId: string, jobId: string, profile: MergedProfile) {
  const { data: business } = await db.from('businesses').select('name, description, sector').eq('id', businessId).single()
  const fill = Object.fromEntries(
    (['name', 'description', 'sector'] as const)
      .filter((field) => !business?.[field] && profile.business[field])
      .map((field) => [field, profile.business[field]]),
  )
  if (Object.keys(fill).length > 0) await db.from('businesses').update(fill).eq('id', businessId)
  await markDone(db, jobId, 'business')

  const { data: known } = await db
    .from('locations')
    .select('id, address, opening_hours(id)')
    .eq('business_id', businessId)
  const byAddress = new Map((known ?? []).map((location) => [addressKey(location.address), location]))
  for (const location of profile.locations) {
    const existing = byAddress.get(addressKey(location.address))
    let locationId = existing?.id
    if (!existing) {
      const { data } = await db
        .from('locations')
        .insert({ business_id: businessId, name: location.name, address: location.address, position: byAddress.size, source: 'import' })
        .select('id')
        .single()
      locationId = data?.id
    }
    const hasHours = (existing?.opening_hours?.length ?? 0) > 0
    if (locationId && !hasHours && location.hours.length > 0) {
      await db.from('opening_hours').insert(location.hours.map((row) => ({ location_id: locationId, ...row })))
    }
  }
  await markDone(db, jobId, 'location')

  const { data: items } = await db
    .from('catalog_items')
    .select('id, name, description, category, price_cents, duration_minutes')
    .eq('business_id', businessId)
  const byName = new Map((items ?? []).map((item) => [key(item.name), item]))
  const fresh = []
  for (const item of profile.catalog) {
    const existing = byName.get(key(item.name))
    if (!existing) {
      fresh.push(item)
      continue
    }
    const patch = Object.fromEntries(
      (['description', 'category', 'price_cents', 'duration_minutes'] as const)
        .filter((field) => existing[field] == null && item[field] != null)
        .map((field) => [field, item[field]]),
    )
    if (Object.keys(patch).length > 0) await db.from('catalog_items').update(patch).eq('id', existing.id)
  }
  if (fresh.length > 0) {
    await db.from('catalog_items').insert(
      fresh.map((item, index) => ({ business_id: businessId, ...item, position: byName.size + index, source: 'import' })),
    )
  }
  await markDone(db, jobId, 'catalog')
}

// Firecrawl names colours by their role on the page. Only the brand ones are
// kept: background, text and link colours say little about the brand.
const BRAND_COLORS: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
}

// Generic families and web-safe fallbacks are not a brand choice.
const NOT_BRAND_FONTS =
  /^(serif|sans-serif|monospace|cursive|system-ui|-apple-system|blinkmacsystemfont|arial|helvetica( neue)?|georgia|times( new roman)?|verdana|tahoma|segoe ui|roboto)$/i

interface Font {
  role: 'heading' | 'body'
  family: string
}

/**
 * The brand's fonts with their role. `typography.fontFamilies` is the page's
 * own choice (`heading`, `primary` = body); the flat `fonts` list also holds
 * fallbacks, so it is only used when the first is missing.
 */
function brandFonts(branding: Branding): Font[] {
  const families = branding.typography?.fontFamilies ?? {}
  const found: Font[] = []
  if (typeof families.heading === 'string') found.push({ role: 'heading', family: families.heading })
  if (typeof families.primary === 'string') found.push({ role: 'body', family: families.primary })
  if (found.length === 0) {
    for (const font of branding.fonts ?? []) {
      if (font.family) found.push({ role: font.role === 'heading' ? 'heading' : 'body', family: font.family })
    }
  }
  const clean = found
    .map((font) => ({ ...font, family: font.family.split(',')[0].trim().replace(/^["']|["']$/g, '') }))
    .filter((font) => font.family && !NOT_BRAND_FONTS.test(font.family))
  // One entry per role, first one wins.
  return clean.filter((font, index) => clean.findIndex((other) => other.role === font.role) === index)
}

async function saveBranding(db: SupabaseClient, businessId: string, branding: Branding | undefined) {
  if (!branding) return
  const logo = branding.logo ? await storeLogo(db, businessId, branding.logo) : null
  await db.from('brand_profiles').upsert({
    business_id: businessId,
    logo_path: logo,
    // Inline logos arrive as data: URLs, often tens of KB: the copy in storage is enough.
    logo_source_url: branding.logo?.startsWith('http') ? branding.logo : null,
    fonts: brandFonts(branding),
    source: 'import',
  })

  await db.from('brand_colors').delete().eq('business_id', businessId).eq('source', 'import')
  const colors = Object.entries(branding.colors ?? {}).filter(
    ([role, hex]) => role in BRAND_COLORS && /^#[0-9a-f]{6}$/i.test(hex),
  )
  if (colors.length > 0) {
    await db.from('brand_colors').insert(
      colors.map(([role, hex], position) => ({
        business_id: businessId,
        name: BRAND_COLORS[role],
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
