// The business profile Spark collects during onboarding. For now the website
// crawl fills branding (logo, colours, fonts); everything else comes from the chat.

export const SECTIONS = ['business', 'location', 'branding', 'catalog', 'calendar'] as const
export type Section = (typeof SECTIONS)[number]

export const IMPORTABLE: readonly Section[] = ['branding']

export const SECTION_TITLES: Record<Section, string> = {
  business: 'Business',
  location: 'Location',
  branding: 'Branding',
  catalog: 'Catalog',
  calendar: 'Calendar',
}

export interface Profile {
  business?: { name?: string; description?: string; sector?: string }
  location?: { address: string; hours?: { days: string; time: string }[] }
  branding?: {
    logoUrl?: string
    colors: { name: string; hex: string }[]
    fonts: { role: 'heading' | 'body'; family: string }[]
    tone: string[]
  }
  catalog?: { name: string; description: string; price: string; duration: string }[]
  calendar?: { members?: string[]; tool?: string }
}

export function hasSection(profile: Profile, section: Section) {
  if (section === 'catalog') return (profile.catalog?.length ?? 0) > 0
  if (section === 'calendar') return !!(profile.calendar?.members?.length || profile.calendar?.tool)
  if (section === 'branding') return !!(profile.branding?.logoUrl || profile.branding?.colors.length)
  return !!profile[section]
}

/** Later wins, field by field inside each section; lists are replaced whole. */
export function mergeProfile(base: Profile, patch: Profile): Profile {
  const merged: Profile = { ...base, ...patch }
  if (patch.business) merged.business = { ...base.business, ...patch.business }
  if (patch.location) merged.location = { ...base.location, ...patch.location }
  if (patch.calendar) merged.calendar = { ...base.calendar, ...patch.calendar }
  return merged
}
