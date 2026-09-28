// Minimal Firecrawl v2 client: the two calls the import needs.
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

export async function scrape(url: string, withBranding = false): Promise<ScrapedPage> {
  const formats = withBranding ? ['markdown', 'links', 'branding'] : ['markdown']
  const response = await fetch(`${API}/scrape`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('FIRECRAWL_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats }),
  })
  const body = await response.json()
  if (!response.ok || !body.success) {
    throw new Error(`Firecrawl ${response.status} on ${url}: ${body.error ?? 'unknown error'}`)
  }
  const data = body.data
  return {
    url: data.metadata?.sourceURL ?? url,
    title: data.metadata?.title,
    markdown: data.markdown ?? '',
    links: data.links ?? [],
    branding: data.branding,
  }
}
