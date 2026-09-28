// The business profile Spark collects during onboarding. Import fills the
// first four sections; the calendar only comes from the conversation.

export const SECTIONS = ['business', 'location', 'branding', 'catalog', 'calendar'] as const
export type Section = (typeof SECTIONS)[number]

export const IMPORTABLE: readonly Section[] = ['business', 'location', 'branding', 'catalog']

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
    logo: { initials: string; background: string; foreground: string }
    colors: { name: string; hex: string }[]
    tone: string[]
  }
  catalog?: { name: string; description: string; price: string; duration: string }[]
  calendar?: { members?: string[]; tool?: string }
}

// Mock only: what the scraping would return.
export const MOCK_IMPORT: Required<Pick<Profile, 'business' | 'location' | 'branding' | 'catalog'>> = {
  business: {
    name: 'Studio Bellezza',
    description: 'Independent skincare studio focused on facial treatments and personalised routines.',
    sector: 'Beauty & skincare',
  },
  location: {
    address: 'Via Tortona 12, 20144 Milano',
    hours: [
      { days: 'Mon – Fri', time: '09:00 – 19:00' },
      { days: 'Sat', time: '09:00 – 14:00' },
      { days: 'Sun', time: 'Closed' },
    ],
  },
  branding: {
    logo: { initials: 'SB', background: '#2B2D42', foreground: '#EED6C4' },
    colors: [
      { name: 'Blush', hex: '#E8B4B8' },
      { name: 'Sand', hex: '#EED6C4' },
      { name: 'Ink', hex: '#2B2D42' },
    ],
    tone: ['Warm', 'Expert', 'Reassuring'],
  },
  catalog: [
    {
      name: 'Hydrating facial',
      description: 'Deep cleanse, exfoliation and a hyaluronic mask.',
      price: '€70',
      duration: '60 min',
    },
    { name: 'Chemical peel', description: 'Gentle AHA peel for tone and texture.', price: '€90', duration: '45 min' },
    { name: 'LED therapy', description: 'Red-light session to calm and repair.', price: '€50', duration: '30 min' },
    {
      name: 'Autumn reset package',
      description: 'Three facials over six weeks, with a home routine.',
      price: '€240',
      duration: '3 × 60 min',
    },
  ],
}

export function hasSection(profile: Profile, section: Section) {
  if (section === 'catalog') return (profile.catalog?.length ?? 0) > 0
  if (section === 'calendar') return !!(profile.calendar?.members?.length || profile.calendar?.tool)
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
