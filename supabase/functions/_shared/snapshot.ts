import type { SupabaseClient } from '@supabase/supabase-js'

/** The profile as the model reads it: compact, and explicit about gaps. */
export async function snapshot(db: SupabaseClient, businessId: string) {
  const [business, locations, brand, colors, catalog, team, calendar] = await Promise.all([
    db.from('businesses').select('name, description, sector, website_url').eq('id', businessId).single(),
    db.from('locations').select('name, address, opening_hours(weekday, opens_at, closes_at)').eq('business_id', businessId),
    db.from('brand_profiles').select('logo_path, fonts, tone_of_voice').eq('business_id', businessId).maybeSingle(),
    db.from('brand_colors').select('name, hex').eq('business_id', businessId),
    db.from('catalog_items').select('name, category, price_cents, duration_minutes, description').eq('business_id', businessId).order('position'),
    db.from('team_members').select('display_name').eq('business_id', businessId).order('position'),
    db.from('calendar_setups').select('provider, provider_label').eq('business_id', businessId).maybeSingle(),
  ])
  const missing = '(missing)'
  const b = business.data
  const lines = [
    `Website: ${b?.website_url ?? 'none'}`,
    `Business name: ${b?.name ?? missing}`,
    `Description: ${b?.description ?? missing}`,
    `Sector: ${b?.sector ?? missing}`,
    `Locations: ${locations.data?.length ? '' : missing}`,
    ...(locations.data ?? []).map((location) => {
      const hours = (location.opening_hours ?? [])
        .sort((x, y) => x.weekday - y.weekday || x.opens_at.localeCompare(y.opens_at))
        .map((row) => `day ${row.weekday} ${row.opens_at.slice(0, 5)}-${row.closes_at.slice(0, 5)}`)
      return `  - ${location.name ? `${location.name}: ` : ''}${location.address}; hours: ${hours.length ? hours.join(', ') : missing}`
    }),
    `Logo: ${brand.data?.logo_path ? 'yes' : missing}`,
    `Brand colours: ${colors.data?.length ? colors.data.map((c) => `${c.name} ${c.hex}`).join(', ') : missing}`,
    `Fonts: ${(brand.data?.fonts as { role: string; family: string }[] | undefined)?.map((f) => `${f.role} ${f.family}`).join(', ') || missing}`,
    `Tone of voice: ${brand.data?.tone_of_voice?.length ? brand.data.tone_of_voice.join(', ') : missing}`,
    `Catalog (${catalog.data?.length ?? 0} items):${catalog.data?.length ? '' : ` ${missing}`}`,
    ...(catalog.data ?? []).map(
      (item) =>
        `  - ${item.name}${item.category ? ` [${item.category}]` : ''}: price ${item.price_cents == null ? missing : `€${item.price_cents / 100}`}, duration ${item.duration_minutes == null ? missing : `${item.duration_minutes} min`}`,
    ),
    `Team: ${team.data?.length ? team.data.map((member) => member.display_name).join(', ') : missing}`,
    `Calendar: ${calendar.data ? calendar.data.provider_label ?? calendar.data.provider : missing}`,
  ]
  return lines.join('\n')
}
