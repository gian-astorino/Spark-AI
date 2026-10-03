import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatform, saveBranding } from './branding.ts'
import { visualBlock } from './claude.ts'
import { previewImage, scrape, searchImages } from './firecrawl.ts'
import { bookingPlatform, PLATFORM_GUIDE, readPlatform } from './platforms.ts'
import type { ToolDef, ToolOutput } from './profile-tools.ts'

// Reading the web beyond what web_search and web_fetch give: pages through
// Firecrawl (JavaScript sites, booking platforms' full listings, preview
// images behind login walls), a site's branding, and image search. Each
// costs a Firecrawl credit, so each counts against the turn's budget.

/** Firecrawl reads per owner's turn. */
export const MAX_READS = 15
/** A page is cut here: a menu fits, a whole blog does not need to. */
const PAGE_CHARS = 40_000

export const RESEARCH_TOOLS: ToolDef[] = [
  {
    name: 'read_page',
    description:
      'Read a web page in full, as markdown, through a real browser: for sites built with JavaScript, booking platforms (Fresha, Treatwell: their complete listing with prices) and social pages (at least their preview image). Prefer it to web_fetch for a business\'s own pages and platforms. Uses the read budget.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The http(s) address to read' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'import_branding_from_site',
    description:
      "Read the logo and the brand colours from the business's own website and save them to the profile. Give its home page. Not for booking platforms, directories or social pages. Uses the read budget.",
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: "The home page of the business's own website" } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_images',
    description: 'Search images on the web, Google Images style; you get to see the results. Uses the read budget.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'e.g. "<business name> <city> logo"' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
]

export interface ResearchContext {
  db: SupabaseClient
  businessId: string
  /** Firecrawl reads so far this turn; the tools add to it. */
  reads: number
  /** What the agent is doing, for the app. */
  activity: (text: string) => void
}

export async function runResearchTool(name: string, input: Record<string, unknown>, ctx: ResearchContext): Promise<ToolOutput> {
  if (ctx.reads >= MAX_READS) return `Read budget for this turn spent (${MAX_READS}). Work with what you have.`
  ctx.reads++
  switch (name) {
    case 'read_page': {
      const url = String(input.url)
      ctx.activity(`Leggo ${shortUrl(url)}`)
      // Fresha and Treatwell: their complete listing, straight from the page's data.
      const page = (await readPlatform(url)) ?? (await readPage(url))
      return bookingPlatform(url) ? `${PLATFORM_GUIDE}\n\n${page}` : page
    }
    case 'import_branding_from_site': {
      const url = String(input.url)
      if (isPlatform(url)) return "Not read: that is a platform or social page, not the business's own website."
      ctx.activity(`Leggo il branding di ${shortUrl(url)}`)
      const home = await scrape(url, true)
      await saveBranding(ctx.db, ctx.businessId, home.branding)
      // The official site found this way becomes the business's website.
      await ctx.db.from('businesses').update({ website_url: home.url }).eq('id', ctx.businessId).is('website_url', null)
      const found = [home.branding?.logo && 'logo', Object.keys(home.branding?.colors ?? {}).length > 0 && 'colours'].filter(Boolean)
      return found.length ? `Saved from ${home.url}: ${found.join(', ')}.` : `No branding found on ${home.url}.`
    }
    case 'search_images':
      ctx.activity(`Cerco immagini: "${String(input.query)}"`)
      return await imageResults(String(input.query))
    default:
      throw new Error(`Unknown tool ${name}`)
  }
}

export const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

/** Any other page, through Firecrawl. Behind a login wall, its preview image at least. */
async function readPage(url: string): Promise<string> {
  try {
    const page = await scrape(url)
    const image = page.image ?? (await previewImage(url))
    return (
      `<page url="${page.url}" title="${page.title ?? ''}"${image ? ` preview_image="${image}"` : ''}>\n` +
      `${page.markdown.slice(0, PAGE_CHARS)}\n</page>`
    )
  } catch (failure) {
    const image = await previewImage(url)
    return image
      ? `The page content could not be read (${String(failure)}), but its preview image is: ${image}`
      : `The page could not be read: ${String(failure)}`
  }
}

/** The largest image shown, and how many results are seen. */
const IMAGE_BYTES = 1_500_000
const IMAGES_SHOWN = 6

/**
 * Image results as the agent sees them: a numbered list of addresses and
 * sources, and the images themselves, downloaded here (one site refusing does
 * not fail the whole call) and handed over through the Files API.
 */
async function imageResults(query: string): Promise<ToolOutput> {
  const results = await searchImages(query)
  if (results.length === 0) return 'No images found.'
  const shown = await Promise.all(
    results.slice(0, IMAGES_SHOWN).map(async (result) => {
      try {
        const response = await fetch(result.imageUrl, { signal: AbortSignal.timeout(8000) })
        const type = (response.headers.get('content-type') ?? '').split(';')[0]
        if (!response.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return null
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength > IMAGE_BYTES) return null
        // Through the Files API: the conversation is replayed, the bytes are not.
        return await visualBlock(bytes, `result.${type.split('/')[1]}`, type)
      } catch {
        return null
      }
    }),
  )
  const items: Exclude<ToolOutput, string> = []
  shown.forEach((image, index) => {
    const result = results[index]
    items.push({
      type: 'text',
      text: `Result ${index + 1}: image ${result.imageUrl} from ${result.pageUrl} ("${result.title}")${image ? '' : ' (could not be shown)'}`,
    })
    if (image) items.push(image as Extract<typeof items[number], { type: 'image' }>)
  })
  return items
}
