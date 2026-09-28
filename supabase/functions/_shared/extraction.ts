// What Firecrawl's model extracts from each page, and how the pages merge
// into one profile. Every field is optional per page: a contacts page knows
// the address, a price list knows the catalog.

export interface PageExtraction {
  business?: { name?: string | null; description?: string | null; sector?: string | null } | null
  locations?: {
    name?: string | null
    address?: string | null
    hours?: { weekday?: number | null; opens_at?: string | null; closes_at?: string | null }[] | null
  }[] | null
  tone_of_voice?: string[] | null
  catalog?: {
    name?: string | null
    description?: string | null
    category?: string | null
    price_eur?: number | null
    duration_minutes?: number | null
  }[] | null
}

const text = (description: string) => ({ type: ['string', 'null'], description })
const number = (description: string) => ({ type: ['number', 'null'], description })

export const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    business: {
      type: 'object',
      properties: {
        name: text('The business name'),
        description: text('What the business does, one or two sentences, in the language of the site'),
        sector: text('Short label, e.g. "Beauty & skincare", "Hair salon", "Nail salon"'),
      },
    },
    locations: {
      type: 'array',
      description: 'Physical locations stated on this page',
      items: {
        type: 'object',
        properties: {
          name: text('Name of the location, if the business has several'),
          address: text('Full street address as written'),
          hours: {
            type: 'array',
            description: 'One entry per open interval; a lunch break means two entries for that day',
            items: {
              type: 'object',
              properties: {
                weekday: number('ISO weekday, 1 = Monday … 7 = Sunday'),
                opens_at: text('24h time, HH:MM'),
                closes_at: text('24h time, HH:MM'),
              },
            },
          },
        },
      },
    },
    tone_of_voice: {
      type: 'array',
      description: 'Three to five adjectives for how the page talks to customers, written in the language of the site',
      items: { type: 'string' },
    },
    catalog: {
      type: 'array',
      description: 'Services, treatments or products offered, as listed on this page',
      items: {
        type: 'object',
        properties: {
          name: text('Name of the treatment or service'),
          description: text('Short description as written'),
          category: text('Category or section it is listed under'),
          price_eur: number('Price in euro as a number, only if stated'),
          duration_minutes: number('Duration in minutes, only if stated'),
        },
      },
    },
  },
}

export const PAGE_PROMPT = [
  'Extract the business profile information stated on this page of a local business website.',
  'Only use what the page says. If something is not on this page, leave it null or empty:',
  'never guess prices, durations, hours or addresses.',
  'Write every value, including the tone-of-voice adjectives, in the language of the site.',
].join(' ')

// ---------------------------------------------------------------------------

export interface MergedProfile {
  business: { name: string | null; description: string | null; sector: string | null }
  locations: { name: string | null; address: string; hours: { weekday: number; opens_at: string; closes_at: string }[] }[]
  tone_of_voice: string[]
  catalog: {
    name: string
    description: string | null
    category: string | null
    price_cents: number | null
    duration_minutes: number | null
  }[]
}

export const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, ' ').trim()
const time = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * The same place written two ways ("Via Castel Cellesi, 6, 51100 Pistoia PT"
 * and "Via Castel Cellesi 6/8 — 51100 Pistoia (PT)") must be one location:
 * street name, first house number and postcode identify it.
 */
export function addressKey(address: string) {
  const plain = key(address)
  const street = plain.split(/\s\d/)[0]
  const number = plain.match(/\s(\d+)/)?.[1] ?? ''
  const postcode = plain.match(/\b(\d{5})\b/)?.[1] ?? ''
  return `${street}|${number}|${postcode}`
}

/**
 * One profile from many pages. The home page comes first, so on a tie its
 * answer wins; lists are de-duplicated and each entry keeps the most complete
 * version seen.
 */
export function mergePages(pages: PageExtraction[]): MergedProfile {
  const first = <T>(values: (T | null | undefined)[]) => values.find((value) => value != null && value !== '') ?? null

  const business = {
    name: first(pages.map((page) => page.business?.name)),
    description: first(pages.map((page) => page.business?.description)),
    sector: first(pages.map((page) => page.business?.sector)),
  }

  // Locations: same address = same place; keep the version with most hours.
  const locations = new Map<string, MergedProfile['locations'][number]>()
  for (const location of pages.flatMap((page) => page.locations ?? [])) {
    if (!location.address) continue
    const hours = (location.hours ?? []).flatMap((row) =>
      row.weekday && row.weekday >= 1 && row.weekday <= 7 && time.test(row.opens_at ?? '') && time.test(row.closes_at ?? '') &&
      row.closes_at! > row.opens_at!
        ? [{ weekday: Math.round(row.weekday), opens_at: row.opens_at!, closes_at: row.closes_at! }]
        : [],
    )
    const id = addressKey(location.address)
    const seen = locations.get(id)
    if (!seen || hours.length > seen.hours.length) {
      locations.set(id, { name: seen?.name ?? location.name ?? null, address: seen?.address ?? location.address, hours })
    }
  }

  // Tone: the adjectives most pages agree on.
  const votes = new Map<string, { word: string; count: number }>()
  for (const word of pages.flatMap((page) => page.tone_of_voice ?? [])) {
    const id = key(word)
    if (!id) continue
    votes.set(id, { word: votes.get(id)?.word ?? word, count: (votes.get(id)?.count ?? 0) + 1 })
  }
  const tone = [...votes.values()].sort((a, b) => b.count - a.count).slice(0, 5).map((vote) => vote.word)

  // Catalog: same name = same item; fill each field from whichever page has it.
  const catalog = new Map<string, MergedProfile['catalog'][number]>()
  for (const item of pages.flatMap((page) => page.catalog ?? [])) {
    if (!item.name) continue
    const id = key(item.name)
    const seen = catalog.get(id)
    const price = item.price_eur != null && item.price_eur >= 0 ? Math.round(item.price_eur * 100) : null
    const duration = item.duration_minutes != null && item.duration_minutes > 0 ? Math.round(item.duration_minutes) : null
    catalog.set(id, {
      name: seen?.name ?? item.name,
      description: seen?.description ?? item.description ?? null,
      category: seen?.category ?? item.category ?? null,
      price_cents: seen?.price_cents ?? price,
      duration_minutes: seen?.duration_minutes ?? duration,
    })
  }

  return { business, locations: [...locations.values()], tone_of_voice: tone, catalog: [...catalog.values()] }
}
