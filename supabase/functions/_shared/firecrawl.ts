// Minimal Firecrawl v2 client: reading one page.
// https://docs.firecrawl.dev/features/scrape

const API = 'https://api.firecrawl.dev/v2'

export interface Branding {
  logo?: string
  colors?: Record<string, string>
  fonts?: { role?: string; family?: string }[]
  typography?: { fontFamilies?: Record<string, unknown> }
}

export interface ScrapedPage {
  url: string
  title?: string
  markdown: string
  links: string[]
  /** The page's preview image (og:image): on a Facebook or Instagram page, its profile photo. */
  image?: string
  branding?: Branding
}

async function call(path: string, init?: RequestInit) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${Deno.env.get('FIRECRAWL_API_KEY')}`,
      'Content-Type': 'application/json',
    },
  })
  const body = await response.json()
  if (!response.ok || body.success === false) {
    throw new Error(`Firecrawl ${response.status} on ${path}: ${body.error ?? 'unknown error'}`)
  }
  return body
}

export async function scrape(url: string, withBranding = false): Promise<ScrapedPage> {
  const formats = withBranding ? ['markdown', 'links', 'branding'] : ['markdown']
  const { data } = await call('/scrape', { method: 'POST', body: JSON.stringify({ url, formats }) })
  return {
    url: data.metadata?.sourceURL ?? url,
    title: data.metadata?.title,
    markdown: data.markdown ?? '',
    links: data.links ?? [],
    image: data.metadata?.ogImage ?? data.metadata?.['og:image'] ?? undefined,
    branding: data.branding,
  }
}

/**
 * The preview image of a page, read the way link previews are built. Works on
 * pages whose content sits behind a login wall (Facebook, Instagram), which
 * still publish their preview for sharing.
 */
export const PREVIEW_CRAWLER = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

export async function previewImage(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': PREVIEW_CRAWLER },
      redirect: 'follow',
    })
    const html = (await response.text()).slice(0, 300_000)
    const tag = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i)?.[0]
    const content = tag?.match(/content=["']([^"']+)["']/i)?.[1]
    return content?.replace(/&amp;/g, '&')
  } catch {
    return undefined
  }
}

export interface ImageResult {
  imageUrl: string
  /** The page the image comes from. */
  pageUrl: string
  title: string
  width?: number
  height?: number
}

/** An image search, Google Images style, through Firecrawl's search. */
export async function searchImages(query: string, limit = 8): Promise<ImageResult[]> {
  const body = await call('/search', {
    method: 'POST',
    body: JSON.stringify({ query, limit, sources: [{ type: 'images' }], country: 'IT' }),
  })
  return (body.data?.images ?? []).map((image: Record<string, unknown>) => ({
    imageUrl: String(image.imageUrl ?? ''),
    pageUrl: String(image.url ?? ''),
    title: String(image.title ?? ''),
    width: typeof image.imageWidth === 'number' ? image.imageWidth : undefined,
    height: typeof image.imageHeight === 'number' ? image.imageHeight : undefined,
  })).filter((image: ImageResult) => image.imageUrl.startsWith('https://'))
}
