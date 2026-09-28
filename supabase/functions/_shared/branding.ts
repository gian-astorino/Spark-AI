import type { SupabaseClient } from '@supabase/supabase-js'
import type { Branding } from './firecrawl.ts'

// Branding from a business's own home page: logo, brand colours, fonts.
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

// Firecrawl names colours by their role on the page. Only the brand ones are
// kept: background, text and link colours say little about the brand.
const BRAND_COLORS: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
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
    logo_path: logo,
    // Inline logos arrive as data: URLs, often tens of KB: the copy in storage is enough.
    logo_source_url: branding.logo?.startsWith('http') ? branding.logo : null,
    fonts: brandFonts(branding),
    source: 'import',
  })

  await db.from('brand_colors').delete().eq('business_id', businessId).eq('source', 'import')
  const colors = Object.entries(branding.colors ?? {}).filter(
    ([role, hex]) => role in BRAND_COLORS && /^#[0-9a-f]{6}$/i.test(hex),
  )
  if (colors.length > 0) {
    await db.from('brand_colors').insert(
      colors.map(([role, hex], position) => ({
        business_id: businessId,
        name: BRAND_COLORS[role],
        hex: hex.toUpperCase(),
        position,
        source: 'import',
      })),
    )
  }
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
