import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

// Every logo that enters the profile is made square and high resolution, and
// the brand colours are read from it: a site's CSS colours say less about the
// brand than its mark does.
//
// No generative model touches the logo: it would redraw it, and a redrawn
// logo is a different logo. Raster logos are resampled (bicubic) onto a
// transparent square; SVG logos, already sharp at any size, are only centred
// on a square canvas.

const VISION_MODEL = 'gpt-5.5'
const LOGO_SIZE = 1024
const LOGO_PADDING = 0.1

const openai = new OpenAI() // OPENAI_API_KEY from the function's secrets

/**
 * Asks the `logo` function to refresh the business's logo. The work runs
 * there, in a request of its own, so it never races the caller's time limit.
 */
export function requestLogoRefresh(businessId: string) {
  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/logo`, {
      method: 'POST',
      // A token of its own: the gateway's handling of API keys in Authorization
      // varies with the key format, a custom header is never touched.
      headers: { 'x-logo-token': Deno.env.get('LOGO_TRIGGER_TOKEN') ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId }),
    }).catch((failure) => console.error('Logo refresh request failed', failure)),
  )
}

/**
 * The colours first, from the logo as it is, so they arrive even if the
 * square version fails. Then the square high-resolution version. The original is
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

    // 2. The square, high-resolution logo, identical to the original.
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

/** The raster logo, resampled onto a transparent square. */
async function redraw(db: SupabaseClient, businessId: string, file: Blob, _extension: string) {
  const png = await squareLogo(new Uint8Array(await file.arrayBuffer()))
  const path = `${businessId}/logo-hd.png`
  await db.storage.from('logos').upload(path, png, { contentType: 'image/png', upsert: true })
  return path
}

/** Catmull-Rom weights: sharp enough for logos, without visible ringing. */
function cubic(t: number) {
  const a = Math.abs(t)
  if (a < 1) return 1.5 * a ** 3 - 2.5 * a ** 2 + 1
  if (a < 2) return -0.5 * a ** 3 + 2.5 * a ** 2 - 4 * a + 2
  return 0
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Plain RGBA pixels, row by row. */
interface Pixels {
  width: number
  height: number
  data: Uint8Array
}

/**
 * PNG and JPEG, decoded by pure JavaScript libraries: the Edge runtime has no
 * native image codecs. Loaded on use only, so a module that fails to load
 * never takes down the functions importing this file.
 */
async function decodeImage(bytes: Uint8Array): Promise<Pixels> {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const UPNG = (await import('upng-js')).default
    const png = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    return { width: png.width, height: png.height, data: new Uint8Array(UPNG.toRGBA8(png)[0]) }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpeg = (await import('jpeg-js')).default
    const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    return { width: image.width, height: image.height, data: new Uint8Array(image.data) }
  }
  throw new Error('Only PNG and JPEG logos can be squared; the original is kept')
}

/** The box around what is drawn: neither transparent nor near-white. */
function inkBox(img: Pixels): Box {
  let x0 = img.width
  let y0 = img.height
  let x1 = -1
  let y1 = -1
  const d = img.data
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const ink = d[i + 3] > 16 && !(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)
      if (ink) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: img.width, h: img.height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * The logo centred on a transparent square, filling it with even padding.
 * Bicubic resample of the drawn area, in premultiplied alpha.
 */
export async function squareLogo(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await decodeImage(bytes)
  const box = inkBox(src)
  const room = LOGO_SIZE * (1 - 2 * LOGO_PADDING)
  const scale = Math.min(room / box.w, room / box.h)
  const w = Math.max(1, Math.round(box.w * scale))
  const h = Math.max(1, Math.round(box.h * scale))
  const left = Math.round((LOGO_SIZE - w) / 2)
  const top = Math.round((LOGO_SIZE - h) / 2)
  const out = new Uint8Array(LOGO_SIZE * LOGO_SIZE * 4) // transparent
  const px = (x: number, y: number, c: number) => {
    const cx = Math.min(Math.max(x, 0), src.width - 1)
    const cy = Math.min(Math.max(y, 0), src.height - 1)
    return src.data[(cy * src.width + cx) * 4 + c]
  }
  for (let y = 0; y < h; y++) {
    const fy = box.y + ((y + 0.5) * box.h) / h - 0.5
    const iy = Math.floor(fy)
    for (let x = 0; x < w; x++) {
      const fx = box.x + ((x + 0.5) * box.w) / w - 0.5
      const ix = Math.floor(fx)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let sum = 0
      for (let m = -1; m <= 2; m++) {
        const wy = cubic(fy - (iy + m))
        for (let n = -1; n <= 2; n++) {
          const weight = wy * cubic(fx - (ix + n))
          const alpha = px(ix + n, iy + m, 3) / 255
          r += px(ix + n, iy + m, 0) * alpha * weight
          g += px(ix + n, iy + m, 1) * alpha * weight
          b += px(ix + n, iy + m, 2) * alpha * weight
          a += alpha * weight
          sum += weight
        }
      }
      const i = ((top + y) * LOGO_SIZE + left + x) * 4
      const alpha = Math.min(Math.max(a / sum, 0), 1)
      const channel = (value: number) => (alpha ? Math.min(255, Math.max(0, Math.round(value / sum / alpha))) : 0)
      out[i] = channel(r)
      out[i + 1] = channel(g)
      out[i + 2] = channel(b)
      out[i + 3] = Math.round(alpha * 255)
    }
  }
  const UPNG = (await import('upng-js')).default
  return new Uint8Array(UPNG.encode([out.buffer], LOGO_SIZE, LOGO_SIZE, 0))
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
