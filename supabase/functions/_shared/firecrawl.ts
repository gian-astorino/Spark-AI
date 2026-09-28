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
