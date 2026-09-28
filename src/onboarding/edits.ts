// What the owner changes by hand in the profile panel. Written straight to
// the tables (row level security keeps each owner to their own business),
// marked source = 'manual' so imports never overwrite it.

import { supabase } from '../lib/supabase.ts'
import type { Interval } from './profile.ts'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

async function run<T extends { error: { message: string } | null }>(query: PromiseLike<T>): Promise<T> {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result
}

export async function saveBusiness(businessId: string, fields: { name: string; sector: string; description: string }) {
  await run(
    supabase
      .from('businesses')
      .update({
        name: fields.name.trim() || null,
        sector: fields.sector.trim() || null,
        description: fields.description.trim() || null,
        source: 'manual',
      })
      .eq('id', businessId),
  )
}

/** Adds a location when `id` is missing; replaces its opening hours with `intervals`. */
export async function saveLocation(
  businessId: string,
  location: { id?: string; name: string; address: string; intervals: Interval[] },
) {
  let id = location.id
  const fields = { name: location.name.trim() || null, address: location.address.trim(), source: 'manual' as const }
  if (id) {
    await run(supabase.from('locations').update(fields).eq('id', id))
  } else {
    const { data } = await run(
      supabase.from('locations').insert({ business_id: businessId, ...fields }).select('id').single(),
    )
    id = data!.id as string
  }
  await run(supabase.from('opening_hours').delete().eq('location_id', id))
  if (location.intervals.length > 0) {
    await run(supabase.from('opening_hours').insert(location.intervals.map((row) => ({ location_id: id, ...row }))))
  }
}

export async function deleteLocation(id: string) {
  await run(supabase.from('locations').delete().eq('id', id))
}

/**
 * "09:00-13:00, 14:00-19:00" → intervals for that weekday. Empty means closed.
 * Throws with a readable message on anything it cannot read.
 */
export function parseDay(weekday: number, text: string): Interval[] {
  const value = text.trim()
  if (!value || /^(closed|chiuso)$/i.test(value)) return []
  return value.split(/\s*[,;]\s*/).map((range) => {
    const [opens, closes] = range.split(/\s*[-–]\s*/).map((time) => {
      const match = time.match(/^(\d{1,2})(?:[:.](\d{2}))?$/)
      return match ? `${match[1].padStart(2, '0')}:${match[2] ?? '00'}` : time
    })
    if (!TIME.test(opens ?? '') || !TIME.test(closes ?? '') || closes <= opens) {
      throw new Error(`"${range}" non è un orario valido, ad esempio 09:00-19:00`)
    }
    return { weekday, opens_at: opens, closes_at: closes }
  })
}

/** Intervals of one weekday back into the text the editor shows. */
export function formatDay(intervals: Interval[], weekday: number) {
  return intervals
    .filter((row) => row.weekday === weekday)
    .sort((a, b) => a.opens_at.localeCompare(b.opens_at))
    .map((row) => `${row.opens_at}-${row.closes_at}`)
    .join(', ')
}

export interface CatalogFields {
  name: string
  category: string
  description: string
  /** In euro, as typed ("70", "89,90"); empty for none. */
  price: string
  /** In minutes; empty for none. */
  duration: string
}

/** Adds a treatment when `id` is missing. */
export async function saveCatalogItem(businessId: string, id: string | undefined, fields: CatalogFields) {
  const price = fields.price.trim().replace(',', '.')
  const duration = fields.duration.trim()
  if (price && !(Number(price) >= 0)) throw new Error('Il prezzo deve essere un numero, ad esempio 70 o 89,90')
  if (duration && !(Number.isInteger(Number(duration)) && Number(duration) > 0)) {
    throw new Error('La durata deve essere un numero intero di minuti')
  }
  const row = {
    name: fields.name.trim(),
    category: fields.category.trim() || null,
    description: fields.description.trim() || null,
    price_cents: price ? Math.round(Number(price) * 100) : null,
    duration_minutes: duration ? Number(duration) : null,
    source: 'manual' as const,
  }
  if (!row.name) throw new Error('Il trattamento deve avere un nome')
  if (id) {
    await run(supabase.from('catalog_items').update(row).eq('id', id))
  } else {
    const { count } = await supabase.from('catalog_items').select('id', { count: 'exact', head: true }).eq('business_id', businessId)
    await run(supabase.from('catalog_items').insert({ business_id: businessId, ...row, position: count ?? 0 }))
  }
}

export async function deleteCatalogItem(id: string) {
  await run(supabase.from('catalog_items').delete().eq('id', id))
}

export async function saveBranding(
  businessId: string,
  fields: {
    colors: { name: string; hex: string }[]
    headingFont: string
    bodyFont: string
  },
) {
  const colors = fields.colors.filter((color) => /^#[0-9a-f]{6}$/i.test(color.hex))
  await run(supabase.from('brand_colors').delete().eq('business_id', businessId))
  if (colors.length > 0) {
    await run(
      supabase.from('brand_colors').insert(
        colors.map((color, position) => ({
          business_id: businessId,
          name: color.name,
          hex: color.hex.toUpperCase(),
          position,
          source: 'manual',
        })),
      ),
    )
  }
  const fonts = [
    { role: 'heading', family: fields.headingFont.trim() },
    { role: 'body', family: fields.bodyFont.trim() },
  ].filter((font) => font.family)
  await run(
    supabase.from('brand_profiles').upsert({
      business_id: businessId,
      fonts,
      source: 'manual',
    }),
  )
}

export async function saveTone(businessId: string, fields: { description: string; keywords: string }) {
  await run(
    supabase.from('brand_profiles').upsert({
      business_id: businessId,
      tone_description: fields.description.trim() || null,
      tone_of_voice: fields.keywords
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean),
      source: 'manual',
    }),
  )
}

export async function saveCalendar(businessId: string, fields: { members: string; provider: string }) {
  const members = fields.members
    .split(/\n|,/)
    .map((name) => name.trim())
    .filter(Boolean)
  await run(supabase.from('team_members').delete().eq('business_id', businessId))
  if (members.length > 0) {
    await run(
      supabase.from('team_members').insert(
        members.map((display_name, position) => ({ business_id: businessId, display_name, position, source: 'manual' })),
      ),
    )
  }
  if (fields.provider) {
    await run(supabase.from('calendar_setups').upsert({ business_id: businessId, provider: fields.provider, source: 'manual' }))
  } else {
    await run(supabase.from('calendar_setups').delete().eq('business_id', businessId))
  }
}
