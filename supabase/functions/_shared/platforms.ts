// Readers for the booking platforms beauty businesses list on. Their pages
// show a few services on screen and load the rest on click, but the whole
// listing is embedded in the page's data: Fresha in its Next.js state,
// Treatwell as schema.org. Reading that data gives the complete catalog,
// exact prices and durations, hours and address, without a browser.

const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DESCRIPTION_CHARS = 180

interface Service {
  category?: string
  name: string
  price?: string
  minutes?: number
  description?: string
  variants?: { name: string; price?: string; minutes?: number }[]
}

interface Listing {
  platform: string
  url: string
  name?: string
  type?: string
  description?: string
  address?: string
  phone?: string
  hours: string[]
  logo?: string
  team: string[]
  services: Service[]
}

/**
 * The page as a listing the model can save from, when it is a Fresha or
 * Treatwell business page; null for anything else, or when the page does not
 * carry the expected data (then the caller reads it as a normal page).
 */
export async function readPlatform(url: string): Promise<string | null> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const reader = /(^|\.)fresha\.com$/.test(host) ? fresha : /(^|\.)treatwell\.[a-z.]+$/.test(host) ? treatwell : null
  if (!reader) return null
  try {
    const response = await fetch(url, { headers: { 'User-Agent': BROWSER, 'Accept-Language': 'it,en;q=0.8' } })
    if (!response.ok) return null
    const listing = reader(await response.text(), response.url || url)
    return listing && listing.services.length > 0 ? format(listing) : null
  } catch (failure) {
    console.error('Platform reader failed', url, failure)
    return null
  }
}

// ---------------------------------------------------------------------------
// Fresha: the venue's state in __NEXT_DATA__ (props.pageProps.data.location).

// deno-lint-ignore no-explicit-any
type Json = any

function fresha(html: string, url: string): Listing | null {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1]
  const location: Json = raw ? JSON.parse(raw)?.props?.pageProps?.data?.location : null
  if (!location?.services) return null

  // A service shows up under "Featured" and under its real category: keep the latter.
  const services = new Map<string, Service>()
  for (const category of location.services as Json[]) {
    for (const item of (category.items ?? []) as Json[]) {
      const key = String(item.serviceId ?? item.id ?? item.name)
      const seen = services.get(key)
      if (seen && category.name === 'Featured') continue
      const variants = ((item.variants ?? []) as Json[])
        .filter((variant) => variant.name && variant.name !== item.name)
        .map((variant) => ({ name: variant.name, price: variant.formattedRetailPrice, minutes: minutes(variant.caption) }))
      services.set(key, {
        category: category.name === 'Featured' ? seen?.category : category.name,
        name: String(item.name).trim(),
        price: item.formattedRetailPrice,
        minutes: item.minInSeconds ? Math.round(item.minInSeconds / 60) : minutes(item.caption),
        description: short(item.description),
        variants: variants.length ? variants : undefined,
      })
    }
  }

  const address = location.address
  const days = (location.workingTime?.days ?? []) as Json[]
  return {
    platform: 'Fresha',
    url,
    name: location.name,
    type: location.primaryBusinessType?.englishName ?? location.primaryBusinessType?.name,
    description: short(location.description, 400),
    address: address
      ? [address.streetAddress, [address.postalCode, address.cityName].filter(Boolean).join(' '), address.region1]
          .filter(Boolean)
          .join(', ')
      : undefined,
    phone: location.contactNumber ?? undefined,
    hours: days.map((day) =>
      `${day.dayName}: ${day.isClosed ? 'closed' : (day.values ?? []).map((value: Json) => to24h(value.value)).join(', ')}`,
    ),
    logo: location.venueLogo?.url ?? undefined,
    team: ((location.employeeProfiles?.edges ?? []) as Json[]).map((edge) => edge.node?.displayName).filter(Boolean),
    services: [...services.values()],
  }
}

/** "10:00 AM - 7:00 PM" → "10:00-19:00" */
function to24h(range: string) {
  return String(range)
    .split(/\s*-\s*/)
    .map((time) => {
      const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
      if (!match) return time
      let hour = Number(match[1]) % 12
      if (match[3]?.toUpperCase() === 'PM') hour += 12
      if (!match[3]) hour = Number(match[1])
      return `${String(hour).padStart(2, '0')}:${match[2]}`
    })
    .join('-')
}

/** "1 hr, 20 min" → 80 */
function minutes(caption: unknown): number | undefined {
  if (typeof caption !== 'string') return undefined
  const hours = Number(caption.match(/(\d+)\s*h/)?.[1] ?? 0)
  const mins = Number(caption.match(/(\d+)\s*min/)?.[1] ?? 0)
  return hours || mins ? hours * 60 + mins : undefined
}

// ---------------------------------------------------------------------------
// Treatwell: schema.org in ld+json, a business node with hasOfferCatalog.

function treatwell(html: string, url: string): Listing | null {
  const nodes: Json[] = []
  for (const [, raw] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(raw)
      nodes.push(...(data['@graph'] ?? (Array.isArray(data) ? data : [data])))
    } catch {
      // A malformed block: skip it.
    }
  }
  const business = nodes.find((node) => node?.hasOfferCatalog)
  if (!business) return null

  const services: Service[] = []
  const walk = (catalog: Json, category?: string) => {
    for (const element of (catalog?.itemListElement ?? []) as Json[]) {
      if (element['@type'] === 'OfferCatalog') walk(element, element.name)
      else if (element['@type'] === 'Offer' && element.itemOffered?.name) {
        const duration = (element.itemOffered.additionalProperty ?? []) as Json
        const property = Array.isArray(duration) ? duration.find((p: Json) => p.name === 'Duration') : duration
        services.push({
          category,
          name: String(element.itemOffered.name).trim(),
          price: element.price ? `€${Number(element.price).toString()}` : undefined,
          minutes: isoMinutes(property?.value),
          // Treatwell's descriptions are its own copy per treatment type, often
          // in English, not the salon's words: left out.
        })
      }
    }
  }
  walk(business.hasOfferCatalog)

  const address = business.address
  const hours: string[] = []
  for (const spec of (business.openingHoursSpecification ?? []) as Json[]) {
    for (const day of [spec.dayOfWeek].flat()) {
      const name = String(day).replace(/^https?:\/\/schema\.org\//, '')
      hours.push(`${name}: ${spec.opens && spec.closes ? `${spec.opens}-${spec.closes}` : 'closed'}`)
    }
  }
  hours.sort((a, b) => DAYS.indexOf(a.split(':')[0]) - DAYS.indexOf(b.split(':')[0]))

  return {
    platform: 'Treatwell',
    url,
    name: business.name,
    description: short(business.description, 400),
    address: address
      ? [address.streetAddress?.trim(), [address.postalCode, address.addressLocality].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ')
      : undefined,
    phone: business.telephone ?? undefined,
    hours,
    logo: typeof business.logo === 'string' ? business.logo : business.logo?.url,
    team: [],
    services,
  }
}

/** "PT1H30M" → 90 */
function isoMinutes(value: unknown): number | undefined {
  const match = typeof value === 'string' ? value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/) : null
  if (!match) return undefined
  const total = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
  return total || undefined
}

// ---------------------------------------------------------------------------

function short(text: unknown, length = DESCRIPTION_CHARS): string | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > length ? `${plain.slice(0, length - 1)}…` : plain
}

function format(listing: Listing): string {
  const line = (label: string, value?: string) => (value ? `${label}: ${value}` : null)
  const services = listing.services.map((service) => {
    const facts = [service.price, service.minutes ? `${service.minutes} min` : null].filter(Boolean).join(', ')
    const head = `- ${service.category ? `[${service.category}] ` : ''}${service.name}${facts ? ` (${facts})` : ''}`
    const variants = (service.variants ?? []).map(
      (variant) =>
        `    · ${variant.name}${variant.price || variant.minutes ? ` (${[variant.price, variant.minutes ? `${variant.minutes} min` : null].filter(Boolean).join(', ')})` : ''}`,
    )
    return [head, service.description ? `    ${service.description}` : null, ...variants].filter(Boolean).join('\n')
  })
  return [
    `<platform_listing source="${listing.platform}" url="${listing.url}">`,
    `This is the business's complete listing on ${listing.platform}, read from the page's data: every service is here, not only those shown on screen. Save the whole catalog in one save_catalog_items call.`,
    line('Business', listing.name),
    line('Type', listing.type),
    line('Description', listing.description),
    line('Address', listing.address),
    line('Phone', listing.phone),
    listing.hours.length ? `Opening hours:\n${listing.hours.map((hour) => `- ${hour}`).join('\n')}` : null,
    line('Logo image', listing.logo),
    listing.team.length ? line('Team', listing.team.join(', ')) : null,
    `Services (${listing.services.length}):\n${services.join('\n')}`,
    '</platform_listing>',
  ]
    .filter(Boolean)
    .join('\n')
}
