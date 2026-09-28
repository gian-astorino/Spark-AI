// Everything the onboarding asks of Supabase.

import { ensureSession, supabase } from '../lib/supabase.ts'
import type { HoursRow, Profile } from './profile.ts'

export type ImportStatus = 'running' | 'done' | 'failed'

export interface ImportProgress {
  status: ImportStatus
  pagesRead: number
  pagesTotal: number
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
  }
}

export interface AgentReply {
  reply: string
  choices: string[]
}

/** One conversation turn: what the owner typed, or something the app reports. */
export async function askAgent(businessId: string, turn: { message: string } | { event: string }): Promise<AgentReply> {
  const { data, error } = await supabase.functions.invoke('agent', { body: { business_id: businessId, ...turn } })
  if (error) throw error
  return { reply: data.reply ?? '', choices: data.choices ?? [] }
}

const CALENDARS: Record<string, string> = {
  google_calendar: 'Google Calendar',
  outlook: 'Outlook',
  apple_calendar: 'Apple Calendar',
  fresha: 'Fresha',
  treatwell: 'Treatwell',
  paper: 'Paper diary',
}

export async function loadProfile(businessId: string): Promise<Profile> {
  const [business, locations, brand, colors, catalog, team, calendar] = await Promise.all([
    supabase.from('businesses').select('name, description, sector').eq('id', businessId).single(),
    supabase
      .from('locations')
      .select('name, address, position, opening_hours(weekday, opens_at, closes_at)')
      .eq('business_id', businessId)
      .order('position'),
    supabase.from('brand_profiles').select('logo_path, logo_source_url, fonts, tone_of_voice').eq('business_id', businessId).maybeSingle(),
    supabase.from('brand_colors').select('name, hex').eq('business_id', businessId).order('position'),
    supabase
      .from('catalog_items')
      .select('name, description, category, price_cents, currency, duration_minutes, position')
      .eq('business_id', businessId)
      .order('position'),
    supabase.from('team_members').select('display_name, position').eq('business_id', businessId).order('position'),
    supabase.from('calendar_setups').select('provider, provider_label').eq('business_id', businessId).maybeSingle(),
  ])

  const profile: Profile = {}
  const b = business.data
  if (b) profile.business = { name: b.name ?? undefined, description: b.description ?? undefined, sector: b.sector ?? undefined }

  if (locations.data?.length) {
    profile.locations = locations.data.map((location) => ({
      name: location.name ?? undefined,
      address: location.address,
      hours: formatHours(location.opening_hours ?? []),
    }))
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
    }
  }

  if (catalog.data?.length) {
    profile.catalog = catalog.data.map((item) => ({
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
    }
  }
  return profile
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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
