export type Source = 'website' | 'instagram' | 'none'

export interface ImportRequest {
  source: Source
  /** The URL or Instagram handle. Empty when `source` is `none`. */
  target: string
}

/** `https://www.example.com/` → `example.com`, for display only. */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
}
