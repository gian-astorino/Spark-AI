// Everything the onboarding asks of Supabase.

import { ensureSession, supabase } from '../lib/supabase.ts'
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
  const user = await ensureSession()
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
}

export type AgentTurn = { message: string; attachments?: string[] } | { event: string }

/** One conversation turn: what the owner typed (and attached), or something the app reports. */
export async function askAgent(businessId: string, turn: AgentTurn): Promise<AgentReply> {
  const { data, error } = await supabase.functions.invoke('agent', { body: { business_id: businessId, ...turn } })
  if (error) throw error
  return { reply: data.reply ?? '', choices: data.choices ?? [] }
}

/** Uploads a file the owner attached; returns its id, the storage path the agent's tools take. */
export async function uploadAttachment(businessId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || file.type.split('/')[1] || 'bin'
  const path = `${businessId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from('uploads').upload(path, file, { contentType: file.type })
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

export interface AdProposal {
  treatment: { name: string; category?: string; duration_minutes?: number; list_price_eur: number; why: string }
  offer: { discounted_price_eur: number; discount_percent: number; conditions: string; duration_days: number }
  ad: { primary_text: string; headline: string; description: string; cta: string }
  visual: { concept: string; overlay_text: string }
  audience: { radius_km: number; age_min: number; age_max: number; genders: 'all' | 'women' | 'men'; interests: string[] }
  budget: { daily_eur: number; days: number; total_eur: number }
  rationale: string
}

/** The model's first-ad proposal for a business with a complete profile. */
export async function requestProposal(businessId: string): Promise<{ id: string; proposal: AdProposal }> {
  const { data, error } = await supabase.functions.invoke('proposal', { body: { business_id: businessId } })
  if (error) throw error
  return { id: data.id, proposal: data.proposal }
}

/** The proposal's image, generated from the branding. Takes up to a minute or two. */
export async function requestCreative(proposalId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('creative', { body: { proposal_id: proposalId } })
  if (error) throw error
  return data.url
}

export async function loadProfile(businessId: string): Promise<Profile> {
  const [business, locations, brand, colors, catalog, team, calendar, media] = await Promise.all([
    supabase.from('businesses').select('name, description, sector, onboarding_status').eq('id', businessId).single(),
    supabase
      .from('locations')
      .select('id, name, address, position, opening_hours(weekday, opens_at, closes_at)')
      .eq('business_id', businessId)
      .order('position'),
    supabase
      .from('brand_profiles')
      .select('logo_path, logo_source_url, fonts, tone_of_voice, tone_description')
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
