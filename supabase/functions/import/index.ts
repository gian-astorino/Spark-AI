// POST /functions/v1/import
//
//   { business_id }        research the business from its website (or its
//                          booking page): branding from the home page straight
//                          away, then a research run on OpenAI.
//   { business_id, url }   research from a link pasted in the chat, to fill
//                          gaps in the existing profile.
//   { job_id }             advance the research one step and report progress.
//                          The client calls this every few seconds.
//
// The research searches the web, reads pages through Firecrawl and saves as it
// goes (see _shared/research.ts). It runs as OpenAI background responses, so
// no call here ever waits for the model.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { scrape, type Branding } from '../_shared/firecrawl.ts'
import { beginResearch, MAX_READS, stepResearch } from '../_shared/research.ts'
import { snapshot } from '../_shared/snapshot.ts'

// A booking platform or directory page is the business's listing, not its
// site: its branding is the platform's.
const PLATFORMS = /(^|\.)(treatwell|fresha|booksy|uala|planity|google|goo\.gl|facebook|instagram|tripadvisor|paginegialle)\./i

// A step that has not finished in this long died with its worker.
const STEP_TIMEOUT_MS = 3 * 60 * 1000

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
      pages_total: MAX_READS,
      activity: 'Opening the link',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  if (!additive) await db.from('businesses').update({ onboarding_status: 'importing' }).eq('id', businessId)

  try {
    if (!additive && !PLATFORMS.test(new URL(target).hostname)) {
      // Branding comes from the business's own home page and needs no model.
      const home = await scrape(target, true)
      await db.from('import_jobs').update({ raw_branding: home.branding ?? null }).eq('id', job.id)
      await saveBranding(db, businessId, home.branding)
      await markDone(db, job.id, 'branding')
    }
    const responseId = await beginResearch(target, await snapshot(db, businessId), additive)
    await db.from('import_jobs').update({ openai_response_id: responseId }).eq('id', job.id)
  } catch (failure) {
    await fail(db, job.id, failure)
  }
  return json({ job_id: job.id }, 202)
}

async function check(asUser: SupabaseClient, db: SupabaseClient, jobId: string) {
  const { data: job } = await asUser
    .from('import_jobs')
    .select('id, business_id, target, status, openai_response_id, rounds, pages_read, pages_total, additive, activity, processing_started_at')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return json({ error: 'Job not found' }, 404)
  if (job.status !== 'running' || !job.openai_response_id) return json(progress(job), 200)

  // One step at a time: a check that finds another one working just reports.
  const staleBefore = new Date(Date.now() - STEP_TIMEOUT_MS).toISOString()
  const { data: claimed } = await db
    .from('import_jobs')
    .update({ processing_started_at: new Date().toISOString() })
    .eq('id', job.id)
    .or(`processing_started_at.is.null,processing_started_at.lt.${staleBefore}`)
    .select('id')
  if (!claimed?.length) return json(progress(job), 200)

  try {
    const step = await stepResearch(db, job)
    if (step.state === 'running') {
      const advanced = step.responseId !== job.openai_response_id
      const update = {
        openai_response_id: step.responseId,
        rounds: job.rounds + (advanced ? 1 : 0),
        pages_read: step.reads,
        activity: step.activity ?? job.activity,
        processing_started_at: null,
      }
      await db.from('import_jobs').update(update).eq('id', job.id)
      return json({ ...progress(job), ...update }, 200)
    }
    if (step.state === 'failed') {
      await fail(db, job.id, step.error)
      return json({ ...progress(job), status: 'failed' }, 200)
    }
    const done = {
      status: 'done',
      summary: step.summary,
      pages_read: step.reads,
      activity: null,
      processing_started_at: null,
      finished_at: new Date().toISOString(),
    }
    await db.from('import_jobs').update(done).eq('id', job.id)
    if (!job.additive) await db.from('businesses').update({ onboarding_status: 'chatting' }).eq('id', job.business_id)
    return json({ ...progress(job), ...done }, 200)
  } catch (failure) {
    await fail(db, job.id, failure)
    return json({ ...progress(job), status: 'failed' }, 200)
  }
}

function progress(job: {
  id: string
  status: string
  pages_read: number
  pages_total: number | null
  activity?: string | null
  summary?: string | null
}) {
  return {
    job_id: job.id,
    status: job.status,
    pages_read: job.pages_read,
    pages_total: job.pages_total,
    activity: job.activity ?? null,
    summary: job.summary ?? null,
  }
}

async function fail(db: SupabaseClient, jobId: string, failure: unknown) {
  console.error(failure)
  await db
    .from('import_jobs')
    .update({ status: 'failed', error: String(failure), processing_started_at: null, finished_at: new Date().toISOString() })
    .eq('id', jobId)
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
