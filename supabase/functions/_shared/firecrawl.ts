// Minimal Firecrawl v2 client: the calls the import needs.
// https://docs.firecrawl.dev/features/scrape · https://docs.firecrawl.dev/features/crawl

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
    branding: data.branding,
  }
}

/** Starts a crawl that returns every page's markdown. Returns the crawl id. */
export async function startCrawl(options: {
  url: string
  limit: number
  /** 'skip' keeps a crawl of one page of a big site (Treatwell, Fresha) under that page. */
  sitemap?: 'include' | 'skip'
  /** Path regexes not worth a credit (reviews, carts…). */
  excludePaths?: string[]
}): Promise<string> {
  const body = await call('/crawl', {
    method: 'POST',
    body: JSON.stringify({
      url: options.url,
      limit: options.limit,
      sitemap: options.sitemap ?? 'include',
      excludePaths: options.excludePaths ?? [],
      scrapeOptions: {
        formats: ['markdown'],
        // Hours and addresses usually live in the footer: keep the whole page.
        onlyMainContent: false,
      },
    }),
  })
  return body.id
}

export interface CrawledPage {
  url: string
  title?: string
  markdown: string
}

export interface CrawlStatus {
  status: 'scraping' | 'completed' | 'failed'
  total: number
  completed: number
  pages: CrawledPage[]
}

/**
 * The crawl's state. With `withPages`, also every page, following `next`
 * (Firecrawl pages its results in 10 MB chunks).
 */
export async function crawlStatus(id: string, withPages = false): Promise<CrawlStatus> {
  let body = await call(`/crawl/${id}`)
  const status: CrawlStatus = { status: body.status, total: body.total ?? 0, completed: body.completed ?? 0, pages: [] }
  if (!withPages) return status

  for (;;) {
    for (const item of body.data ?? []) {
      const title = item.metadata?.title
      status.pages.push({
        url: item.metadata?.sourceURL ?? '',
        title: Array.isArray(title) ? title[0] : title,
        markdown: item.markdown ?? '',
      })
    }
    if (!body.next) return status
    body = await call(body.next)
  }
}
