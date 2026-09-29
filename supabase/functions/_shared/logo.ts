import OpenAI, { toFile } from 'openai'
import { PREVIEW_CRAWLER, searchImages } from './firecrawl.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// Every logo that enters the profile is made square and high resolution, and
// the brand colours are read from it: a site's CSS colours say less about the
// brand than its mark does.
//
// Raster logos are recreated by gpt-image-2.5 and kept only if the vision
// model confirms they are still the same logo; otherwise they are resampled
// (bicubic) onto a transparent square. SVG logos, already sharp at any size,
// are only centred on a square canvas.

const VISION_MODEL = 'gpt-5.5'
const IMAGE_MODEL = 'gpt-image-2.5-sunburst'
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
      let source: Blob = file
      if (!isSvg) {
        // A small logo is often a thumbnail of one published larger elsewhere.
        const sharper = await sharperLogo(db, businessId, new Uint8Array(await file.arrayBuffer())).catch((failure) => {
          failures.push(`search: ${String(failure)}`)
          return null
        })
        if (sharper) source = sharper
      }
      const logoPath = isSvg ? await squareSvgLogo(db, businessId, await file.text()) : await redraw(db, businessId, source, extension)
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
/**
 * The logo recreated by the image model as a clean, square, high-resolution
 * version of itself. A model redraws rather than copies (gpt-image-2 once
 * changed Blue Zone's letters), so the vision model compares the result with
 * the original and, if anything changed, the faithful resampled square is
 * kept instead.
 */
async function redraw(db: SupabaseClient, businessId: string, file: Blob, extension: string) {
  const original = new Uint8Array(await file.arrayBuffer())
  const path = `${businessId}/logo-hd.png`
  let png: Uint8Array | null = null
  try {
    const result = await openai.images.edit({
      model: IMAGE_MODEL,
      image: await toFile(file, `logo.${extension}`, { type: file.type }),
      prompt: REDRAW,
      size: '1024x1024',
      quality: 'high',
      input_fidelity: 'high',
      // The model keeps the original's own background, whatever it is.
      background: 'auto',
      output_format: 'png',
    })
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      const candidate = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
      if (await sameLogo(original, candidate)) png = candidate
      else console.warn('Recreated logo differs from the original: keeping the resampled one')
    }
  } catch (failure) {
    console.warn('Logo recreation failed, keeping the resampled one:', String(failure))
  }
  png ??= await squareLogo(original)
  await db.storage.from('logos').upload(path, png, { contentType: 'image/png', upsert: true })
  return path
}

const REDRAW = [
  'Recreate this exact logo as a clean, sharp, high-resolution square image.',
  'Keep the design identical: the same shapes, the same lettering letter by letter, the same colours and proportions.',
  'Do not add, remove, restyle or reinterpret anything; no outlines, shadows or effects that are not in the original.',
  "Keep the original's background exactly as it is: the same colour, or transparent if the original is transparent. Extend it to fill the square, with the logo centred and even padding.",
].join(' ')

/** Whether the recreated logo is still the same logo, as the vision model sees it. */
async function sameLogo(original: Uint8Array, candidate: Uint8Array): Promise<boolean> {
  const response = await openai.responses.create({
    model: VISION_MODEL,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Image 1, the original logo:' },
          { type: 'input_image', image_url: dataUrl(original[0] === 0xff ? 'image/jpeg' : 'image/png', original), detail: 'high' },
          { type: 'input_text', text: 'Image 2, a recreation:' },
          { type: 'input_image', image_url: dataUrl('image/png', candidate), detail: 'high' },
          {
            type: 'input_text',
            text: 'Is image 2 the same logo as image 1? It must have the same lettering (every letter), the same shapes, the same colours and the same background colour; only size, sharpness and the amount of empty space around it may differ. An added outline, shadow, changed letter or changed background means no.',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'same_logo',
        strict: true,
        schema: {
          type: 'object',
          properties: { same: { type: 'boolean' }, difference: { type: 'string' } },
          required: ['same', 'difference'],
          additionalProperties: false,
        },
      },
    },
  })
  const verdict = JSON.parse(response.output_text || '{"same":false}') as { same: boolean; difference?: string }
  if (!verdict.same) console.warn('Logo check:', verdict.difference)
  return verdict.same
}

/** Below this many pixels on its short side, a logo is worth a search for a larger copy. */
const SHARP_ENOUGH = 600
const CANDIDATES = 5
const CANDIDATE_BYTES = 5_000_000

/**
 * Looks for the same logo at a higher resolution: first the original behind a
 * thumbnail's address, then an image search where the vision model picks a
 * result only if it is exactly the same logo. Returns the larger image, or
 * null to keep the one we have.
 */
async function sharperLogo(db: SupabaseClient, businessId: string, bytes: Uint8Array): Promise<Blob | null> {
  const current = await decodeImage(bytes).catch(() => null)
  const shortSide = current ? Math.min(current.width, current.height) : 0
  if (current && shortSide >= SHARP_ENOUGH) return null

  // 1. Free and certain: the address of a thumbnail often leads to its original.
  const { data: brand } = await db.from('brand_profiles').select('logo_source_url').eq('business_id', businessId).single()
  const original = brand?.logo_source_url ? await fullSize(brand.logo_source_url, shortSide) : null
  if (original) {
    await db.storage.from('logos').upload(`${businessId}/source-hd.${original.extension}`, original.data, {
      contentType: original.type,
      upsert: true,
    })
    await db.from('brand_profiles').update({ logo_source_url: original.url }).eq('business_id', businessId)
    return new Blob([original.data], { type: original.type })
  }

  // 2. An image search, checked by eye.
  const [{ data: business }, { data: location }] = await Promise.all([
    db.from('businesses').select('name, website_url').eq('id', businessId).single(),
    db.from('locations').select('address').eq('business_id', businessId).order('position').limit(1).maybeSingle(),
  ])
  if (!business?.name) return null
  // "Via Castel Cellesi, 6, 51100 Pistoia PT" → "Pistoia"
  const town = location?.address.match(/\b\d{5}\s+([A-Za-zÀ-ÿ' ]+?)(?:\s+\(?[A-Z]{2}\)?)?\s*$/)?.[1] ?? ''
  const results = await searchImages(`${business.name} ${town} logo`.replace(/\s+/g, ' ').trim(), 10)
  const minimum = Math.max(shortSide * 1.5, 400)
  // Sizes are often missing from search results: those are measured once downloaded.
  const bigger = results
    .filter((result) => !result.width || !result.height || Math.min(result.width, result.height) > minimum)
    .slice(0, CANDIDATES + 3)

  const downloads = await Promise.all(
    bigger.map(async (result) => {
      const data = await downloadImage(result.imageUrl)
      if (!data) return null
      const size = await decodeImage(data.bytes).catch(() => null)
      return size && Math.min(size.width, size.height) > minimum ? { result, type: data.type, data: data.bytes } : null
    }),
  )
  const candidates = downloads.filter((entry) => entry !== null).slice(0, CANDIDATES)
  if (candidates.length === 0) return null

  const content: OpenAI.Responses.ResponseInputContent[] = [
    {
      type: 'input_text',
      text: 'This is the business logo we have, at low resolution:',
    },
    { type: 'input_image', image_url: dataUrl(bytes[0] === 0xff ? 'image/jpeg' : 'image/png', bytes), detail: 'low' },
    {
      type: 'input_text',
      text: 'Which of the following images shows the same logo (same design, same lettering, same colours), only larger? It may sit on a different background or be cropped to a square or a circle, as on a Facebook or Instagram profile photo. A redesign, a variant, or another business with a similar name does not count. Answer with its number, or null if none qualifies.',
    },
  ]
  candidates.forEach((candidate, index) => {
    content.push({ type: 'input_text', text: `Image ${index + 1}` })
    content.push({ type: 'input_image', image_url: dataUrl(candidate.type, candidate.data), detail: 'low' })
  })
  const response = await openai.responses.create({
    model: VISION_MODEL,
    reasoning: { effort: 'low' },
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'logo_match',
        strict: true,
        schema: {
          type: 'object',
          properties: { match: { type: ['integer', 'null'] } },
          required: ['match'],
          additionalProperties: false,
        },
      },
    },
  })
  const { match } = JSON.parse(response.output_text || '{"match":null}') as { match: number | null }
  const chosen = match ? candidates[match - 1] : undefined
  if (!chosen) return null

  const extension = chosen.type === 'image/png' ? 'png' : 'jpg'
  await db.storage.from('logos').upload(`${businessId}/source-hd.${extension}`, chosen.data, { contentType: chosen.type, upsert: true })
  await db.from('brand_profiles').update({ logo_source_url: chosen.result.imageUrl }).eq('business_id', businessId)
  return new Blob([chosen.data as Uint8Array<ArrayBuffer>], { type: chosen.type })
}

/**
 * The same image without the size a CMS put in its address: WordPress thumbnails
 * ("logo-180x180.png" → "logo.png") and resize parameters ("?w=180"). Only the
 * size is removed, so it is the same image; kept only if it really is larger.
 */
async function fullSize(url: string, shortSide: number) {
  const candidates = new Set<string>()
  const wordpress = url.replace(/-\d{2,4}x\d{2,4}(\.(png|jpe?g|webp))(\?.*)?$/i, '$1')
  if (wordpress !== url) candidates.add(wordpress)
  try {
    const parsed = new URL(url)
    const sized = ['w', 'h', 'width', 'height', 'resize', 'size', 'fit']
    if (sized.some((name) => parsed.searchParams.has(name))) {
      for (const name of sized) parsed.searchParams.delete(name)
      candidates.add(parsed.toString())
    }
  } catch {
    return null
  }
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(10_000) })
      const type = (response.headers.get('content-type') ?? '').split(';')[0]
      if (!response.ok || !/^image\/(png|jpe?g)$/.test(type)) continue
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength > CANDIDATE_BYTES) continue
      const image = await decodeImage(data)
      if (Math.min(image.width, image.height) > shortSide) {
        return { url: candidate, type, data, extension: type === 'image/png' ? 'png' : 'jpg' }
      }
    } catch {
      // Not there, not an image, or not decodable: try the next one.
    }
  }
  return null
}

/**
 * An image from the web we can square afterwards (PNG or JPEG). Facebook and
 * Instagram serve their images only to link-preview crawlers, so that is tried
 * when a plain request is refused.
 */
async function downloadImage(url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const attempts: Record<string, string>[] = [{}, { 'User-Agent': PREVIEW_CRAWLER }]
  for (const headers of attempts) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
      const type = (response.headers.get('content-type') ?? '').split(';')[0]
      if (!response.ok || !/^image\/(png|jpe?g)$/.test(type)) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength <= CANDIDATE_BYTES) return { bytes, type }
    } catch {
      // Try the next way, or give up on this one.
    }
  }
  return null
}

function dataUrl(type: string, data: Uint8Array) {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(binary)}`
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

/** The corners' colour when all four are opaque and alike; null for a transparent logo. */
function cornerColour(img: Pixels): [number, number, number, number] | null {
  const at = (x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))
  const corners = [at(0, 0), at(img.width - 1, 0), at(0, img.height - 1), at(img.width - 1, img.height - 1)]
  if (corners.some((corner) => corner[3] < 250)) return null
  const [first] = corners
  const alike = corners.every((corner) => Math.abs(corner[0] - first[0]) + Math.abs(corner[1] - first[1]) + Math.abs(corner[2] - first[2]) < 30)
  return alike ? [first[0], first[1], first[2], 255] : null
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
  // The original's own background: the colour of its corners when they are
  // opaque (a white or coloured square logo), transparent otherwise.
  const out = new Uint8Array(LOGO_SIZE * LOGO_SIZE * 4)
  const background = cornerColour(src)
  if (background) {
    for (let i = 0; i < out.length; i += 4) out.set(background, i)
  }
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
      // Composited over the background, so soft edges blend into it.
      const under = background ?? [0, 0, 0, 0]
      out[i] = Math.round(channel(r) * alpha + under[0] * (1 - alpha))
      out[i + 1] = Math.round(channel(g) * alpha + under[1] * (1 - alpha))
      out[i + 2] = Math.round(channel(b) * alpha + under[2] * (1 - alpha))
      out[i + 3] = background ? 255 : Math.round(alpha * 255)
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
            text: 'List the brand colours of this logo, most prominent first, as #RRGGBB, at most three. A solid coloured background is part of the brand and counts; ignore only a plain white or transparent background.',
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
