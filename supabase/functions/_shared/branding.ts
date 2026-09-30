import type { SupabaseClient } from '@supabase/supabase-js'
import type { Branding } from './firecrawl.ts'
import { requestLogoRefresh } from './logo.ts'

// Branding from a business's own home page: logo and fonts. The brand
// colours are then read from the logo (see logo.ts).
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

// Generic families and web-safe fallbacks are not a brand choice.
const NOT_BRAND_FONTS =
  /^(serif|sans-serif|monospace|cursive|system-ui|-apple-system|blinkmacsystemfont|arial|helvetica( neue)?|georgia|times( new roman)?|verdana|tahoma|segoe ui|roboto)$/i

interface Font {
  role: 'heading' | 'body'
  family: string
}

/**
 * The brand's fonts with their role. `typography.fontFamilies` is the page's
 * own choice (`heading`, `primary` = body); the flat `fonts` list also holds
 * fallbacks, so it is only used when the first is missing.
 */
function brandFonts(branding: Branding): Font[] {
  const families = branding.typography?.fontFamilies ?? {}
  const found: Font[] = []
  if (typeof families.heading === 'string') found.push({ role: 'heading', family: families.heading })
  if (typeof families.primary === 'string') found.push({ role: 'body', family: families.primary })
  if (found.length === 0) {
    for (const font of branding.fonts ?? []) {
      if (font.family) found.push({ role: font.role === 'heading' ? 'heading' : 'body', family: font.family })
    }
  }
  const clean = found
    .map((font) => ({ ...font, family: font.family.split(',')[0].trim().replace(/^["']|["']$/g, '') }))
    .filter((font) => font.family && !NOT_BRAND_FONTS.test(font.family))
  // One entry per role, first one wins.
  return clean.filter((font, index) => clean.findIndex((other) => other.role === font.role) === index)
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
          board_path: null,
          board_job_id: null,
          board_job_status: null,
          board_error: null,
        }
      : {}),
    fonts: brandFonts(branding),
    source: 'import',
  })
  // The brand colours come from the logo, not from the site's CSS.
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
