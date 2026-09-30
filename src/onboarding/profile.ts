// The business profile Spark collects during onboarding, as the panel shows
// it. It lives in the database: the imports and the agent write it there.

export const SECTIONS = ['business', 'location', 'branding', 'tone', 'catalog', 'calendar'] as const
export type Section = (typeof SECTIONS)[number]

export const SECTION_TITLES: Record<Section, string> = {
  business: 'Attività',
  location: 'Sede',
  branding: 'Branding',
  tone: 'Tono di voce',
  catalog: 'Catalogo',
  calendar: 'Calendario',
}

export interface HoursRow {
  days: string
  time: string
}

/** One open interval, as stored: ISO weekday (1 = Monday), 24h times. */
export interface Interval {
  weekday: number
  opens_at: string
  closes_at: string
}

export interface Location {
  id: string
  name?: string
  address: string
  /** For display: days grouped, "Mon – Fri 09:00–19:00". */
  hours: HoursRow[]
  /** For editing. */
  intervals: Interval[]
}

export interface CatalogItem {
  id: string
  name: string
  description?: string
  category?: string
  price?: string
  duration?: string
  priceCents?: number
  currency: string
  durationMinutes?: number
}

export interface Profile {
  /** 'completed' once the owner confirmed the recap and the agent closed the onboarding. */
  status?: string
  business?: { name?: string; description?: string; sector?: string }
  locations?: Location[]
  branding?: {
    logoUrl?: string
    colors: { name: string; hex: string }[]
    fonts: { role: 'heading' | 'body'; family: string }[]
    /** Keywords. */
    tone: string[]
    /** How the business talks, in a few sentences. */
    toneDescription?: string
    /** The logo's recreation: 'running' while gpt-image-2.5 works on it. */
    logoJob?: string
    /**
     * A logo is in, but its recreation is not: the panel shows a loading tile
     * rather than the original. False once recreated, or if it failed or was
     * turned down (then the original is the logo).
     */
    logoPending?: boolean
    /** The brand board: logo, colours, fonts and a pattern in one image. */
    boardUrl?: string
    /** The board is on its way (with the logo, or after it). */
    boardPending?: boolean
  }
  photos?: { url: string; caption?: string }[]
  catalog?: CatalogItem[]
  calendar?: { members?: string[]; tool?: string; provider?: string }
}

export function hasSection(profile: Profile, section: Section) {
  switch (section) {
    case 'business':
      return !!(profile.business?.name || profile.business?.description || profile.business?.sector)
    case 'location':
      return (profile.locations?.length ?? 0) > 0
    case 'branding':
      return !!(
        profile.branding?.logoUrl ||
        profile.branding?.colors.length ||
        profile.branding?.fonts.length ||
        profile.photos?.length
      )
    case 'tone':
      return !!(profile.branding?.toneDescription || profile.branding?.tone.length)
    case 'catalog':
      return (profile.catalog?.length ?? 0) > 0
    case 'calendar':
      return !!(profile.calendar?.members?.length || profile.calendar?.tool)
  }
}
