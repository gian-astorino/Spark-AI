import type { SupabaseClient } from '@supabase/supabase-js'
import type { Branding } from './firecrawl.ts'
import { requestLogoRefresh } from './logo.ts'

// Branding from a business's own home page: logo and the site's colours.
// The brand colours are then read from the logo and completed with the
// site's (see logo.ts).
// Used by the import (from the link it starts with) and by the research
// (from the official site it finds).

// A booking platform or directory page is the business's listing, not its
// site: its branding is the platform's.
const PLATFORMS = /(^|\.)(treatwell|fresha|booksy|uala|planity|google|goo\.gl|facebook|instagram|tripadvisor|paginegialle)\./i

export function isPlatform(url: string) {
  try {
    return PLATFORMS.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The site's colours by their role, hex only. */
export function siteColors(branding: Branding | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(branding?.colors ?? {})
      .filter(([, value]) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      .map(([role, value]) => [role, value.toUpperCase()]),
  )
}

export async function saveBranding(db: SupabaseClient, businessId: string, branding: Branding | undefined) {
  if (!branding) return
  const logo = branding.logo ? await storeLogo(db, businessId, branding.logo) : null
  await db.from('brand_profiles').upsert({
    business_id: businessId,
    // A site without a readable logo leaves any logo already in the profile.
    ...(logo
      ? {
          logo_path: logo,
          // Inline logos arrive as data: URLs, often tens of KB: the copy in storage is enough.
          logo_source_url: branding.logo?.startsWith('http') ? branding.logo : null,
          // A new logo starts over: no job, no error from the previous one.
          logo_job_id: null,
          logo_job_status: null,
          logo_error: null,
        }
      : {}),
    site_colors: siteColors(branding),
    source: 'import',
  })
  // The brand colours come from the logo first, completed by the site's.
  if (logo) requestLogoRefresh(businessId)
}

/** Copies the logo into our own storage: the site may change or disappear. */
async function storeLogo(db: SupabaseClient, businessId: string, url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const type = response.headers.get('content-type') ?? 'image/png'
    const extension = type.includes('svg') ? 'svg' : type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png'
    const path = `${businessId}/logo.${extension}`
    const { error } = await db.storage
      .from('logos')
      .upload(path, await response.arrayBuffer(), { contentType: type, upsert: true })
    return error ? null : path
  } catch {
    return null
  }
}
