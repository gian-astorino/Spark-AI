import OpenAI, { toFile } from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

// Every logo that enters the profile is redrawn as a square, high-resolution
// version of itself, and the brand colours are read from it: a site's CSS
// colours say less about the brand than its mark does.
//
// Raster logos are redrawn by the image model, told to change nothing but
// the canvas. SVG logos are already sharp at any size: they are only centred
// on a square canvas, and their colours are read straight from the markup.

const IMAGE_MODEL = 'gpt-image-2'
const VISION_MODEL = 'gpt-5.5'

const openai = new OpenAI() // OPENAI_API_KEY from the function's secrets

const REDRAW = [
  'Recreate this exact logo as a clean, high-resolution square image.',
  'Keep the design identical: same shapes, same lettering and text, same colours, same proportions.',
  'Do not add, remove, restyle or reinterpret anything.',
  'Centre it on a square canvas with even padding around it, on a transparent background.',
].join(' ')

/**
 * Asks the `logo` function to refresh the business's logo. The work runs
 * there, in a request of its own, so it never races the caller's time limit.
 */
export function requestLogoRefresh(businessId: string) {
  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ business_id: businessId }),
    }).catch((failure) => console.error('Logo refresh request failed', failure)),
  )
}

/**
 * The colours first, from the logo as it is: fast, and they arrive even if
 * the redraw fails. Then the square high-resolution version. The original is
 * kept next to it; any failure is written to brand_profiles.logo_error.
 */
export async function refreshLogo(db: SupabaseClient, businessId: string) {
  const { data: brand } = await db.from('brand_profiles').select('logo_path').eq('business_id', businessId).maybeSingle()
  if (!brand?.logo_path) return
  // Already a redrawn logo: nothing to do.
  if (/\/logo-(hd\.png|square\.svg)$/.test(brand.logo_path)) return

  const failures: string[] = []
  try {
    const { data: file } = await db.storage.from('logos').download(brand.logo_path)
    if (!file) throw new Error(`Logo not found in storage: ${brand.logo_path}`)
    const isSvg = file.type.includes('svg') || brand.logo_path.endsWith('.svg')
    const extension = isSvg ? 'svg' : (brand.logo_path.split('.').pop() ?? 'png')
    const original = `${businessId}/original.${extension}`
    await db.storage.from('logos').upload(original, file, { contentType: file.type, upsert: true })

    // 1. Colours, from the original.
    try {
      const colors = isSvg ? svgColors(await file.text()) : await imageColors(db, original)
      await saveColors(db, businessId, colors)
    } catch (failure) {
      failures.push(`colours: ${String(failure)}`)
    }

    // 2. The square, high-resolution logo.
    try {
      const logoPath = isSvg ? await squareSvgLogo(db, businessId, await file.text()) : await redraw(db, businessId, file, extension)
      await db.from('brand_profiles').update({ logo_path: logoPath }).eq('business_id', businessId)
    } catch (failure) {
      failures.push(`redraw: ${String(failure)}`)
    }
  } catch (failure) {
    failures.push(String(failure))
  }
  await db
    .from('brand_profiles')
    .update({ logo_error: failures.length ? failures.join(' | ').slice(0, 2000) : null })
    .eq('business_id', businessId)
}

async function saveColors(db: SupabaseClient, businessId: string, colors: string[]) {
  if (colors.length === 0) throw new Error('No colours found in the logo')
  await db.from('brand_colors').delete().eq('business_id', businessId)
  await db.from('brand_colors').insert(
    colors.slice(0, 3).map((hex, position) => ({
      business_id: businessId,
      name: ['Primary', 'Secondary', 'Accent'][position],
      hex,
      position,
      source: 'import',
    })),
  )
}

async function squareSvgLogo(db: SupabaseClient, businessId: string, svg: string) {
  const path = `${businessId}/logo-square.svg`
  await db.storage
    .from('logos')
    .upload(path, new Blob([squareSvg(svg)], { type: 'image/svg+xml' }), { contentType: 'image/svg+xml', upsert: true })
  return path
}

/**
 * The image model redraws the logo. Transparent background and high input
 * fidelity are asked for; a model that refuses either gets the plain request.
 */
async function redraw(db: SupabaseClient, businessId: string, file: Blob, extension: string) {
  const image = await toFile(file, `logo.${extension}`, { type: file.type })
  const base = { model: IMAGE_MODEL, image, prompt: REDRAW, size: '1024x1024', quality: 'high', output_format: 'png' } as const
  let result: OpenAI.Images.ImagesResponse
  try {
    result = await openai.images.edit({ ...base, background: 'transparent', input_fidelity: 'high' })
  } catch (failure) {
    if (!(failure instanceof OpenAI.BadRequestError)) throw failure
    console.warn('Redraw without transparent background / input fidelity:', failure.message)
    result = await openai.images.edit({ ...base, image: await toFile(file, `logo.${extension}`, { type: file.type }) })
  }
  const b64 = result.data?.[0]?.b64_json
  if (!b64) throw new Error('The image model returned no image')
  const path = `${businessId}/logo-hd.png`
  const png = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
  await db.storage.from('logos').upload(path, png, { contentType: 'image/png', upsert: true })
  return path
}

/** The SVG centred on a square canvas, with 10% padding. */
function squareSvg(svg: string): string {
  const box = svg.match(/viewBox=["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  const width = box ? Number(box[3]) : Number(svg.match(/\swidth=["']([\d.]+)/i)?.[1])
  const height = box ? Number(box[4]) : Number(svg.match(/\sheight=["']([\d.]+)/i)?.[1])
  if (!width || !height) return svg
  const side = Math.max(width, height) * 1.2
  const x = (side - width) / 2
  const y = (side - height) / 2
  const inner = btoa(unescape(encodeURIComponent(svg)))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="1024" height="1024">` +
    `<image href="data:image/svg+xml;base64,${inner}" x="${x}" y="${y}" width="${width}" height="${height}"/></svg>`
  )
}

/** The colours an SVG draws with, most used first, without near-white and repeats. */
function svgColors(svg: string): string[] {
  const counts = new Map<string, number>()
  const add = (hex: string) => counts.set(hex, (counts.get(hex) ?? 0) + 1)
  for (const [, value] of svg.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    add(value.length === 3 ? `#${[...value].map((c) => c + c).join('')}`.toUpperCase() : `#${value}`.toUpperCase())
  }
  for (const [, r, g, b] of svg.matchAll(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi)) {
    add(`#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase())
  }
  const picked: string[] = []
  for (const hex of [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    if (r > 240 && g > 240 && b > 240) continue // the page, not the brand
    const close = picked.some((other) => {
      const [or, og, ob] = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16))
      return Math.abs(r - or) + Math.abs(g - og) + Math.abs(b - ob) < 40
    })
    if (!close) picked.push(hex)
  }
  return picked
}

/** The brand colours of a raster logo, as the vision model reads them. SVG and HEIC are not readable. */
async function imageColors(db: SupabaseClient, path: string): Promise<string[]> {
  const { data } = await db.storage.from('logos').createSignedUrl(path, 10 * 60)
  if (!data) return []
  const response = await openai.responses.create({
    model: VISION_MODEL,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'List the brand colours of this logo, most prominent first, as #RRGGBB: at most three, ignoring the background and plain white. If the logo is a single colour, return one.',
          },
          { type: 'input_image', image_url: data.signedUrl, detail: 'high' },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'logo_colors',
        strict: true,
        schema: {
          type: 'object',
          properties: { colors: { type: 'array', items: { type: 'string' } } },
          required: ['colors'],
          additionalProperties: false,
        },
      },
    },
  })
  const parsed = JSON.parse(response.output_text || '{"colors":[]}') as { colors: string[] }
  return parsed.colors.filter((hex) => /^#[0-9a-f]{6}$/i.test(hex)).map((hex) => hex.toUpperCase())
}
