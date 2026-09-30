import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PREVIEW_CRAWLER } from './firecrawl.ts'
import { checkImageJob, dataUrl, startImageJob } from './image-jobs.ts'

// Every logo that enters the profile gives the brand its colours and is
// recreated by gpt-image-2.5 as a square, high-resolution version of itself on
// its original background, kept only if the vision model confirms it is still
// the same logo. SVG logos, already sharp at any size, are only centred on a
// square canvas.
//
// The recreation runs as an OpenAI background job, started here and checked by
// the app (checkLogo): no request waits for the image model, and no pixels are
// decoded in the function (its CPU budget is two seconds).

const VISION_MODEL = 'gpt-5.5'
const CANDIDATE_BYTES = 5_000_000

const openai = new OpenAI() // OPENAI_API_KEY from the function's secrets

/**
 * Asks the `logo` function to refresh the business's logo, in a request of
 * its own so it never races the caller's time limit.
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
 * The colours first, from the logo as it is, so they arrive whatever happens
 * next; then, for a raster logo, the recreation job. The original is kept next
 * to it. Failures go to brand_profiles.logo_error.
 */
export async function refreshLogo(db: SupabaseClient, businessId: string) {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('logo_path, logo_source_url')
    .eq('business_id', businessId)
    .maybeSingle()
  if (!brand?.logo_path) return
  // Already a recreated logo: nothing to do.
  if (/\/logo-(hd\.png|square\.svg)$/.test(brand.logo_path)) return

  const failures: string[] = []
  const update: Record<string, unknown> = {}
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

    if (isSvg) {
      update.logo_path = await squareSvgLogo(db, businessId, await file.text())
    } else {
      // 2. A larger copy of a thumbnail when its address leads to one, then the recreation job.
      let source = new Uint8Array(await file.arrayBuffer())
      let type = file.type || 'image/png'
      const larger = brand.logo_source_url ? await fullSize(brand.logo_source_url, imageSize(source)) : null
      if (larger) {
        source = larger.data
        type = larger.type
        update.logo_source_url = larger.url
        await db.storage.from('logos').upload(`${businessId}/source-hd.${larger.extension}`, larger.data, {
          contentType: larger.type,
          upsert: true,
        })
      }
      update.logo_job_id = await startImageJob({
        prompt: REDRAW,
        images: [dataUrl(type, source)],
        action: 'edit',
        background: 'auto',
        inputFidelity: 'high',
      })
      update.logo_job_status = 'running'
    }
  } catch (failure) {
    failures.push(String(failure))
  }
  await db
    .from('brand_profiles')
    .update({ ...update, logo_error: failures.length ? failures.join(' | ').slice(0, 2000) : null })
    .eq('business_id', businessId)
}

/**
 * Where the recreation stands. Once the job is done, the vision model compares
 * the result with the original: the same logo becomes the profile's logo;
 * anything changed and the original stays.
 */
export async function checkLogo(db: SupabaseClient, businessId: string): Promise<string> {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('logo_path, logo_job_id, logo_job_status')
    .eq('business_id', businessId)
    .maybeSingle()
  if (!brand?.logo_job_id || brand.logo_job_status !== 'running') return brand?.logo_job_status ?? 'none'

  const state = await checkImageJob(brand.logo_job_id)
  if (state.status === 'running') return 'running'
  if (state.status === 'failed') {
    await db
      .from('brand_profiles')
      .update({ logo_job_status: 'failed', logo_error: `recreation: ${state.error}` })
      .eq('business_id', businessId)
    return 'failed'
  }

  const { data: original } = await db.storage.from('logos').download(brand.logo_path)
  const same = original ? await sameLogo(new Uint8Array(await original.arrayBuffer()), state.png) : false
  if (!same) {
    await db
      .from('brand_profiles')
      .update({ logo_job_status: 'rejected', logo_error: 'The recreated logo differed from the original: the original is kept' })
      .eq('business_id', businessId)
    return 'rejected'
  }
  const path = `${businessId}/logo-hd.png`
  await db.storage.from('logos').upload(path, state.png, { contentType: 'image/png', upsert: true })
  await db.from('brand_profiles').update({ logo_path: path, logo_job_status: 'done' }).eq('business_id', businessId)
  return 'done'
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

/**
 * Width and height from a PNG or JPEG header, without decoding any pixel.
 * Returns the short side, or 0 when the format is not recognised.
 */
function imageSize(bytes: Uint8Array): number {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return Math.min(view.getUint32(16), view.getUint32(20))
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return 0
      const marker = bytes[i + 1]
      const length = (bytes[i + 2] << 8) | bytes[i + 3]
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6]
        const width = (bytes[i + 7] << 8) | bytes[i + 8]
        return Math.min(width, height)
      }
      i += 2 + length
    }
  }
  return 0
}

/**
 * The same image without the size a CMS put in its address: WordPress
 * thumbnails ("logo-180x180.png" → "logo.png") and resize parameters
 * ("?w=180"). Only the size is removed, so it is the same image; kept only if
 * it really is larger.
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
    for (const headers of [{}, { 'User-Agent': PREVIEW_CRAWLER }] as Record<string, string>[]) {
      try {
        const response = await fetch(candidate, { headers, signal: AbortSignal.timeout(10_000) })
        const type = (response.headers.get('content-type') ?? '').split(';')[0]
        if (!response.ok || !/^image\/(png|jpe?g)$/.test(type)) continue
        const data = new Uint8Array(await response.arrayBuffer())
        if (data.byteLength <= CANDIDATE_BYTES && imageSize(data) > shortSide) {
          return { url: candidate, type, data, extension: type === 'image/png' ? 'png' : 'jpg' }
        }
      } catch {
        // Not there, or not an image: try the next way.
      }
    }
  }
  return null
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
