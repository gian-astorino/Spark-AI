// Everything the onboarding asks of Supabase.

import { currentUser, supabase } from '../lib/supabase.ts'
import { contentType } from './attachments.ts'
import type { HoursRow, Profile } from './profile.ts'

export type ImportStatus = 'running' | 'done' | 'failed'

/** One source a research touched: a page read, a web or image search, a branding read. */
export interface ImportSource {
  kind: 'page' | 'search' | 'images' | 'branding'
  value: string
}

export interface ImportProgress {
  status: ImportStatus
  pagesRead: number
  pagesTotal: number
  /** What the research is doing right now, e.g. 'Searching "…"'. */
  activity?: string
  /** Once done: the sources used and what is still missing. */
  summary?: string
  sources: ImportSource[]
}

export async function createBusiness(websiteUrl?: string): Promise<string> {
  const user = await currentUser()
  const { data, error } = await supabase
    .from('businesses')
    .insert({ owner_id: user.id, website_url: websiteUrl ?? null })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/** The business's own site without `url`; an extra source to add from with it. */
export async function startImport(businessId: string, url?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('import', {
    body: url ? { business_id: businessId, url } : { business_id: businessId },
  })
  if (error) throw error
  return data.job_id
}

/** Also what moves the import forward: the server has nothing else waking it up. */
export async function checkImport(jobId: string): Promise<ImportProgress> {
  const { data, error } = await supabase.functions.invoke('import', { body: { job_id: jobId } })
  if (error) throw error
  return {
    status: data.status === 'done' ? 'done' : data.status === 'failed' ? 'failed' : 'running',
    pagesRead: data.pages_read ?? 0,
    pagesTotal: data.pages_total ?? 0,
    activity: data.activity ?? undefined,
    summary: data.summary ?? undefined,
    sources: data.sources ?? [],
  }
}

export interface AgentReply {
  reply: string
  choices: string[]
  /** The tools the agent ran this turn. */
  actions: string[]
}

export type AgentTurn = { message: string; attachments?: string[] } | { event: string }

/** One conversation turn: what the owner typed (and attached), or something the app reports. */
export async function askAgent(businessId: string, turn: AgentTurn): Promise<AgentReply> {
  const { data, error } = await supabase.functions.invoke('agent', { body: { business_id: businessId, ...turn } })
  if (error) throw error
  return { reply: data.reply ?? '', choices: data.choices ?? [], actions: data.actions ?? [] }
}

/** Uploads a file the owner attached; returns its id, the storage path the agent's tools take. */
export async function uploadAttachment(businessId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || file.type.split('/')[1] || 'bin'
  const path = `${businessId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from('uploads').upload(path, file, { contentType: contentType(file) })
  if (error) throw error
  return path
}

export const CALENDARS: Record<string, string> = {
  google_calendar: 'Google Calendar',
  outlook: 'Outlook',
  apple_calendar: 'Apple Calendar',
  fresha: 'Fresha',
  treatwell: 'Treatwell',
  paper: 'Agenda cartacea',
}

/** The first campaign, as the strategist decided it over the whole context (see proposal/index.ts). */
export interface AdProposal {
  version: 2
  campaign: {
    product: string
    catalog_item: string | null
    offer: string
    offer_price_eur: number | null
    target: string
    problem: string
    angle: string
    big_idea: string
    headline: string
    promise: string
    cta: string
  }
  /** The promoted catalog item, matched to the catalog, with its list price. */
  item: { name: string; list_price_eur: number | null } | null
  awareness: string
  why: string
  funnel: string
  creative: { format: string; hero_visual: string; hierarchy: string; copy_on_image: string }
  concepts: { concept: string; headline: string; visual: string; copy: string; cta: string }[]
  budget: { daily_eur: number; days: number; total_eur: number; note: string }
  kpis: string[]
  test_rules: { first: string; no_interest: string; leads_no_appointments: string; appointments_no_sales: string }
  confidence: { level: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string }
  missing_data: string[]
  ad: { primary_text: string; headline: string; description: string; cta: string }
  audience: {
    age_min: number
    age_max: number
    genders: 'all' | 'women' | 'men'
    radius_km: number | null
    area: string
    interests: string[]
  }
}

/**
 * The first campaign, reasoned out over the whole context as a background
 * job: started, then checked every few seconds (a few minutes at most).
 */
export async function requestProposal(businessId: string): Promise<{ id: string; proposal: AdProposal }> {
  const started = await supabase.functions.invoke('proposal', { body: { business_id: businessId } })
  if (started.error) throw started.error
  const id: string = started.data.id
  for (let attempt = 0; attempt < 100; attempt++) {
    await wait(4000)
    const { data, error } = await supabase.functions.invoke('proposal', { body: { proposal_id: id, check: true } })
    if (error) throw error
    if (data.status === 'done') return { id, proposal: data.proposal }
    if (data.status === 'failed') throw new Error(data.error ?? 'The campaign could not be prepared')
  }
  throw new Error('The campaign took too long')
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The proposal's image, generated from the branding as a background job:
 * started, then checked every few seconds until it is ready (a few minutes
 * at most). Resolves to its address, or throws if it failed.
 */
export async function requestCreative(proposalId: string): Promise<string> {
  const started = await supabase.functions.invoke('creative', { body: { proposal_id: proposalId } })
  if (started.error) throw started.error
  for (let attempt = 0; attempt < 90; attempt++) {
    await wait(4000)
    const { data, error } = await supabase.functions.invoke('creative', { body: { proposal_id: proposalId, check: true } })
    if (error) throw error
    if (data.status === 'done' && data.url) return data.url
    if (data.status === 'failed') throw new Error(data.error ?? 'The image could not be generated')
  }
  throw new Error('The image took too long')
}

/** Moves the logo recreation on and reports it: 'running', 'done', 'rejected', 'failed' or 'none'. */
export async function checkLogoJob(businessId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('logo', { body: { business_id: businessId, check: true } })
  if (error) throw error
  return data.status
}

export async function loadProfile(businessId: string): Promise<Profile> {
  const [business, locations, brand, colors, catalog, team, calendar, media, calls] = await Promise.all([
    supabase.from('businesses').select('name, description, sector, onboarding_status').eq('id', businessId).single(),
    supabase
      .from('locations')
      .select('id, name, address, position, opening_hours(weekday, opens_at, closes_at)')
      .eq('business_id', businessId)
      .order('position'),
    supabase
      .from('brand_profiles')
      .select('logo_path, logo_source_url, fonts, tone_of_voice, tone_description, logo_job_status, board_path, board_job_status')
      .eq('business_id', businessId)
      .maybeSingle(),
    supabase.from('brand_colors').select('name, hex').eq('business_id', businessId).order('position'),
    supabase
      .from('catalog_items')
      .select('id, name, description, category, price_cents, currency, duration_minutes, position')
      .eq('business_id', businessId)
      .order('position'),
    supabase.from('team_members').select('display_name, position').eq('business_id', businessId).order('position'),
    supabase.from('calendar_setups').select('provider, provider_label').eq('business_id', businessId).maybeSingle(),
    supabase.from('business_media').select('bucket, path, caption, position').eq('business_id', businessId).order('position'),
    supabase
      .from('call_transcripts')
      .select('id, title, call_date, summary, document')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }),
  ])

  const profile: Profile = { status: business.data?.onboarding_status ?? undefined }
  const b = business.data
  if (b) profile.business = { name: b.name ?? undefined, description: b.description ?? undefined, sector: b.sector ?? undefined }

  if (locations.data?.length) {
    profile.locations = locations.data.map((location) => {
      const intervals = (location.opening_hours ?? []).map((row) => ({
        weekday: row.weekday,
        opens_at: row.opens_at.slice(0, 5),
        closes_at: row.closes_at.slice(0, 5),
      }))
      return {
        id: location.id,
        name: location.name ?? undefined,
        address: location.address,
        hours: formatHours(intervals),
        intervals,
      }
    })
  }

  if (brand.data || colors.data?.length) {
    let boardUrl: string | undefined
    if (brand.data?.board_path) {
      const { data } = await supabase.storage.from('logos').createSignedUrl(brand.data.board_path, 60 * 60)
      boardUrl = data?.signedUrl
    }
    const logoPending =
      !!brand.data?.logo_path &&
      !/\/logo-(hd\.png|square\.svg)$/.test(brand.data.logo_path) &&
      !['rejected', 'failed'].includes(brand.data?.logo_job_status ?? '')
    let logoUrl = brand.data?.logo_source_url ?? undefined
    if (brand.data?.logo_path) {
      const { data } = await supabase.storage.from('logos').createSignedUrl(brand.data.logo_path, 60 * 60)
      logoUrl = data?.signedUrl ?? logoUrl
    }
    profile.branding = {
      logoUrl,
      colors: (colors.data ?? []).map((color) => ({ name: color.name ?? '', hex: color.hex })),
      fonts: brand.data?.fonts ?? [],
      tone: brand.data?.tone_of_voice ?? [],
      toneDescription: brand.data?.tone_description ?? undefined,
      logoJob: brand.data?.logo_job_status ?? undefined,
      logoPending,
      boardUrl,
      // Running, or not started yet while the logo it comes with is still on its way.
      boardPending:
        brand.data?.board_job_status === 'running' ||
        (logoPending && !['failed', 'done'].includes(brand.data?.board_job_status ?? '')),
    }
  }

  if (media.data?.length) {
    const signed = await Promise.all(
      media.data.map((item) => supabase.storage.from(item.bucket).createSignedUrl(item.path, 60 * 60)),
    )
    profile.photos = media.data.flatMap((item, index) => {
      const url = signed[index].data?.signedUrl
      return url ? [{ url, caption: item.caption ?? undefined }] : []
    })
  }

  if (catalog.data?.length) {
    profile.catalog = catalog.data.map((item) => ({
      id: item.id,
      priceCents: item.price_cents ?? undefined,
      currency: item.currency,
      durationMinutes: item.duration_minutes ?? undefined,
      name: item.name,
      description: item.description ?? undefined,
      category: item.category ?? undefined,
      price: item.price_cents == null ? undefined : formatPrice(item.price_cents, item.currency),
      duration: item.duration_minutes == null ? undefined : `${item.duration_minutes} min`,
    }))
  }
  if (team.data?.length || calendar.data) {
    profile.calendar = {
      members: team.data?.map((member) => member.display_name),
      tool: calendar.data ? (calendar.data.provider_label ?? CALENDARS[calendar.data.provider] ?? calendar.data.provider) : undefined,
      provider: calendar.data?.provider,
    }
  }
  if (calls.data?.length) {
    profile.conversations = calls.data.map((call) => ({
      id: call.id,
      title: call.title,
      date: call.call_date ?? undefined,
      summary: call.summary,
      document: call.document,
    }))
  }
  return profile
}

const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

/** Opening intervals into rows: "Mon – Fri 09:00–13:00, 14:00–19:00", closed days left out. */
export function formatHours(rows: { weekday: number; opens_at: string; closes_at: string }[]): HoursRow[] {
  const byDay = new Map<number, string[]>()
  for (const row of [...rows].sort((a, b) => a.weekday - b.weekday || a.opens_at.localeCompare(b.opens_at))) {
    byDay.set(row.weekday, [...(byDay.get(row.weekday) ?? []), `${row.opens_at.slice(0, 5)}–${row.closes_at.slice(0, 5)}`])
  }
  const result: { from: number; to: number; time: string }[] = []
  for (const [day, intervals] of byDay) {
    const time = intervals.join(', ')
    const last = result[result.length - 1]
    if (last && last.to === day - 1 && last.time === time) last.to = day
    else result.push({ from: day, to: day, time })
  }
  return result.map(({ from, to, time }) => ({
    days: from === to ? DAYS[from - 1] : `${DAYS[from - 1]} – ${DAYS[to - 1]}`,
    time,
  }))
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/** A workspace is one business: its profile, its chat, its calls and ads. */
export interface Workspace {
  id: string
  name?: string
  sector?: string
  completed: boolean
  websiteUrl?: string
  updatedAt: string
  /** Seen by admins: whose workspace it is. */
  ownerEmail?: string
}

/** Admins see every workspace; everyone else has their own one. */
export async function isAdmin(): Promise<boolean> {
  const user = await currentUser()
  const { data } = await supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle()
  return !!data
}

/** The workspaces the user can reach: their own, or all of them for an admin (with their owners). */
export async function listWorkspaces(withOwners = false): Promise<Workspace[]> {
  const [{ data, error }, owners] = await Promise.all([
    supabase
      .from('businesses')
      .select('id, name, sector, onboarding_status, website_url, updated_at')
      .order('updated_at', { ascending: false }),
    withOwners ? supabase.rpc('workspace_owners') : Promise.resolve({ data: [] }),
  ])
  if (error) throw error
  const emails = new Map(((owners.data ?? []) as { business_id: string; email: string }[]).map((row) => [row.business_id, row.email]))
  return (data ?? []).map((row) => ({
    ownerEmail: emails.get(row.id),
    id: row.id,
    name: row.name ?? undefined,
    sector: row.sector ?? undefined,
    completed: row.onboarding_status === 'completed',
    websiteUrl: row.website_url ?? undefined,
    updatedAt: row.updated_at,
  }))
}

/** One message of a past conversation, as it was shown. */
export type HistoryEntry =
  | { from: 'user'; text: string; attachments: string[] }
  | { from: 'agent'; text: string; choices: string[] }

/** The workspace's conversation so far: what the owner wrote and Spark's replies (the app's own notes are left out). */
export async function loadHistory(businessId: string): Promise<HistoryEntry[]> {
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!conversation) return []
  const { data, error } = await supabase
    .from('messages')
    .select('role, display')
    .eq('conversation_id', conversation.id)
    .not('display', 'is', null)
    .order('created_at')
  if (error) throw error
  return (data ?? []).flatMap((row): HistoryEntry[] => {
    const display = row.display as { text?: string; attachments?: string[]; choices?: string[] }
    if (row.role === 'user') return [{ from: 'user', text: display.text ?? '', attachments: display.attachments ?? [] }]
    return display.text ? [{ from: 'agent', text: display.text, choices: display.choices ?? [] }] : []
  })
}

/** The latest first-ad proposal of a workspace, with its image if it was made. */
export async function loadLatestProposal(
  businessId: string,
): Promise<{ id: string; proposal: AdProposal; creative: string | null } | null> {
  const { data } = await supabase
    .from('ad_proposals')
    .select('id, content, creative_path')
    .eq('business_id', businessId)
    .eq('proposal_status', 'done')
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  let creative: string | null = null
  if (data.creative_path) {
    const { data: signed } = await supabase.storage.from('creatives').createSignedUrl(data.creative_path, 60 * 60)
    creative = signed?.signedUrl ?? null
  }
  return { id: data.id, proposal: data.content as AdProposal, creative }
}
