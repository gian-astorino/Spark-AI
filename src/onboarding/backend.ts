// Everything the onboarding asks of Supabase.

import { currentUser, supabase } from '../lib/supabase.ts'
import { contentType } from './attachments.ts'
import type { HoursRow, Profile } from './profile.ts'

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

/** One message of the conversation, as it is shown. */
export interface AgentEntry {
  /** The message's id: later calls ask for what comes after it. */
  id: number
  role: 'user' | 'assistant'
  text: string
  /** The owner's files: their storage paths. */
  attachments?: string[]
  /** Ads saved or given an image in that turn, shown as cards. */
  ads?: string[]
}

export interface AgentState {
  status: 'running' | 'idle'
  /** What Spark is doing right now, e.g. "Leggo example.com". */
  activity?: string
  /** Why the turn stopped, when it failed: it is tried again on the next request. */
  error?: string
  entries: AgentEntry[]
}

export type AgentTurn = { message: string; attachments?: string[] } | { event: string } | { resume: true }

/**
 * One request to the agent: a new turn (what the owner typed, or something
 * the app reports) or, with `resume`, the next steps of the turn under way.
 * Returns the messages after `after` and whether the turn goes on.
 */
export async function askAgent(businessId: string, turn: AgentTurn, after: number): Promise<AgentState> {
  const { data, error } = await supabase.functions.invoke('agent', { body: { business_id: businessId, after, ...turn } })
  if (error) throw error
  return {
    status: data.status === 'running' ? 'running' : 'idle',
    activity: data.activity ?? undefined,
    error: data.error ?? undefined,
    entries: data.entries ?? [],
  }
}

/**
 * Whether the agent has a turn left unfinished (it stopped mid-way, or failed
 * and will try again): only then does opening a workspace need to call it.
 */
export async function hasUnfinishedTurn(businessId: string): Promise<boolean> {
  const { data } = await supabase
    .from('conversations')
    .select('status, turn')
    .eq('business_id', businessId)
    .eq('engine', 'claude')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return !!data && (data.status === 'running' || !!(data.turn as { error?: string } | null)?.error)
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

/** An ad as the agent saved it (see the save_ad tool), with its images. */
export interface Ad {
  id: string
  name: string
  status: string
  content: {
    objective?: string | null
    strategy?: { label: string; text: string }[]
    copy?: { primary_text?: string; headline?: string; description?: string | null; cta?: string }
    creative?: { format?: string; brief?: string; text_on_image?: string }
  }
  /** Oldest first; an edit is a new image. */
  images: { id: string; status: 'running' | 'done' | 'failed'; url?: string; size?: string }[]
}

/** The business's ads, newest first, or only the ones asked for. */
export async function loadAds(businessId: string, ids?: string[]): Promise<Ad[]> {
  let query = supabase
    .from('ads')
    .select('id, name, status, content, updated_at, ad_images(id, status, path, size, created_at)')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false })
  if (ids) query = query.in('id', ids)
  const { data, error } = await query
  if (error) throw error
  return await Promise.all(
    (data ?? []).map(async (row) => {
      const images = [...((row.ad_images ?? []) as { id: string; status: string; path: string | null; size: string | null; created_at: string }[])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        content: row.content ?? {},
        images: await Promise.all(
          images.map(async (image) => {
            let url: string | undefined
            if (image.path) url = (await supabase.storage.from('creatives').createSignedUrl(image.path, 60 * 60)).data?.signedUrl
            return { id: image.id, status: image.status as Ad['images'][number]['status'], url, size: image.size ?? undefined }
          }),
        ),
      }
    }),
  )
}

/** Moves the ad images being made; returns how many still are. */
export async function checkAdImages(businessId: string): Promise<number> {
  const { data, error } = await supabase.functions.invoke('ads', { body: { business_id: businessId } })
  if (error) throw error
  return data.running ?? 0
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
      .select('logo_path, logo_source_url, tone_of_voice, tone_description, logo_job_status')
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
      tone: brand.data?.tone_of_voice ?? [],
      toneDescription: brand.data?.tone_description ?? undefined,
      logoJob: brand.data?.logo_job_status ?? undefined,
      logoPending,
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

/**
 * The workspace's conversation so far, across its conversations (the ones
 * from before Spark moved to Claude are shown, not continued): what the
 * owner wrote and Spark's replies. The app's own notes are left out.
 */
export async function loadHistory(businessId: string): Promise<AgentEntry[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, display, conversations!inner(business_id)')
    .eq('conversations.business_id', businessId)
    .not('display', 'is', null)
    .order('id')
  if (error) throw error
  return (data ?? []).flatMap((row): AgentEntry[] => {
    const display = row.display as Omit<AgentEntry, 'id' | 'role'>
    if (row.role === 'assistant' && !display.text) return []
    return [{ id: row.id, role: row.role, text: display.text ?? '', attachments: display.attachments, ads: display.ads }]
  })
}
