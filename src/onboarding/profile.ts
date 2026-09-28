// The business profile Spark collects during onboarding: from the website
// crawl, from any extra link the owner pastes in the chat, and from the chat.

export const SECTIONS = ['business', 'location', 'branding', 'catalog', 'calendar'] as const
export type Section = (typeof SECTIONS)[number]

export const SECTION_TITLES: Record<Section, string> = {
  business: 'Business',
  location: 'Location',
  branding: 'Branding',
  catalog: 'Catalog',
  calendar: 'Calendar',
}

export interface HoursRow {
  days: string
  time: string
}

export interface Profile {
  business?: { name?: string; description?: string; sector?: string }
  locations?: { name?: string; address: string; hours: HoursRow[] }[]
  branding?: {
    logoUrl?: string
    colors: { name: string; hex: string }[]
    fonts: { role: 'heading' | 'body'; family: string }[]
    tone: string[]
  }
  catalog?: { name: string; description?: string; category?: string; price?: string; duration?: string }[]
  calendar?: { members?: string[]; tool?: string }
}

export function hasSection(profile: Profile, section: Section) {
  switch (section) {
    case 'business':
      return !!(profile.business?.name || profile.business?.description || profile.business?.sector)
    case 'location':
      return (profile.locations?.length ?? 0) > 0
    case 'branding':
      return !!(profile.branding?.logoUrl || profile.branding?.colors.length || profile.branding?.fonts.length)
    case 'catalog':
      return (profile.catalog?.length ?? 0) > 0
    case 'calendar':
      return !!(profile.calendar?.members?.length || profile.calendar?.tool)
  }
}

/** What is still missing, in words the agent can say. */
export function missing(profile: Profile): string[] {
  const gaps: string[] = []
  if (!profile.business?.name) gaps.push('your business name')
  if (!profile.business?.sector) gaps.push('your sector')
  if (!profile.locations?.length) gaps.push('your address')
  else if (!profile.locations.some((location) => location.hours.length > 0)) gaps.push('your opening hours')
  if (!profile.catalog?.length) gaps.push('your treatments')
  else if (!profile.catalog.some((item) => item.price)) gaps.push('your prices')
  else if (!profile.catalog.some((item) => item.duration)) gaps.push('treatment durations')
  return gaps
}

/** Later wins, field by field inside business and calendar; lists are replaced whole. */
export function mergeProfile(base: Profile, patch: Profile): Profile {
  const merged: Profile = { ...base, ...patch }
  if (patch.business) merged.business = { ...base.business, ...patch.business }
  if (patch.calendar) merged.calendar = { ...base.calendar, ...patch.calendar }
  return merged
}

/** "a, b and c" */
export function listing(items: string[]) {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
