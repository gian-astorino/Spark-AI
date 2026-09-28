// The business profile Spark collects during onboarding, as the panel shows
// it. It lives in the database: the imports and the agent write it there.

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
