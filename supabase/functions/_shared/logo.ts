import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatform, siteColors } from './branding.ts'
import { PREVIEW_CRAWLER, scrape } from './firecrawl.ts'
import { flattenForModels, isFlat } from './flatten.ts'
import { checkImageJob, dataUrl, startImageJob } from './image-jobs.ts'

// Every logo that enters the profile gives the brand its colours and is
// recreated by gpt-image-2.5 as a square, high-resolution version of itself on
// its original background, kept only if the vision model confirms it is still
// the same logo. SVG logos, already sharp at any size, are only centred on a
// square canvas.
//
// Next to the recreation, from the same logo, a brand board: one wide image
// with the logo, the colours, the fonts and a pattern (startBoard, checkBoard).
//
// The recreation runs as an OpenAI background job, started here and checked by
// the app (checkLogo): no request waits for the image model, and no pixels are
// decoded in the function (its CPU budget is two seconds).

const VISION_MODEL = 'gpt-5.5'
// A 1024px recreation smaller than this is a flat, empty square.
const BLANK_BYTES = 8_000
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
    .select('logo_path, logo_source_url, site_colors')
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

    // 1. Colours, from the original (a transparent one laid on a solid background first).
    let colors: string[] = []
    try {
      if (isSvg) {
        colors = svgColors(await file.text())
      } else {
        const flat = await flattenForModels(new Uint8Array(await file.arrayBuffer()), file.type || 'image/png')
        colors = await imageColors(dataUrl(flat.type, flat.bytes), flat.background)
      }
      // A logo of one or two colours (a black wordmark) leaves room: the site's colours complete the palette.
      colors = withSiteColors(colors, (brand.site_colors as Record<string, string> | null) ?? (await readSiteColors(db, businessId)))
      await saveColors(db, businessId, colors)
    } catch (failure) {
      failures.push(`colours: ${String(failure)}`)
    }

    if (isSvg) {
      update.logo_path = await squareSvgLogo(db, businessId, await file.text())
      // The image model takes no SVG: without a picture of the logo, no board.
      update.board_job_status = 'failed'
      update.board_error = 'SVG logo: the image model takes no SVG as a reference'
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
      // What the models see: on a solid background if the logo is transparent.
      const flat = await flattenForModels(source, type)
      const seen = dataUrl(flat.type, flat.bytes)
      update.logo_job_id = await startImageJob({
        prompt: REDRAW,
        images: [seen],
        action: 'edit',
        // No inputFidelity: gpt-image-2.5 rejects it; the prompt and the check keep it faithful.
        // Opaque: a transparent result lost its alpha on the way and came back a black square.
        background: 'opaque',
      })
      update.logo_job_status = 'running'

      // 3. The brand board, from the same picture of the logo.
      try {
        update.board_job_id = await startBoard(db, businessId, seen, colors)
        update.board_job_status = 'running'
        update.board_error = null
      } catch (failure) {
        update.board_job_status = 'failed'
        update.board_error = String(failure).slice(0, 2000)
      }
    }
  } catch (failure) {
    failures.push(String(failure))
    // No recreation coming: the app stops waiting and shows the original.
    update.logo_job_status = 'failed'
    if (!update.board_job_status) {
      update.board_job_status = 'failed'
      update.board_error = String(failure).slice(0, 2000)
    }
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
  const verdict =
    state.png.byteLength < BLANK_BYTES || (await isFlat(state.png))
      ? { same: false, difference: 'the recreation is a blank image of one colour' }
      : original
        ? await sameLogo((await flattenForModels(new Uint8Array(await original.arrayBuffer()), original.type || 'image/png')).bytes, state.png)
        : { same: false, difference: 'the original could not be read' }
  if (!verdict.same) {
    // Kept for a look: what the model made, and why it was turned down.
    await db.storage.from('logos').upload(`${businessId}/logo-rejected.png`, state.png, { contentType: 'image/png', upsert: true })
    await db
      .from('brand_profiles')
      .update({ logo_job_status: 'rejected', logo_error: `Recreation turned down, original kept: ${verdict.difference}`.slice(0, 2000) })
      .eq('business_id', businessId)
    return 'rejected'
  }
  const path = `${businessId}/logo-hd.png`
  await db.storage.from('logos').upload(path, state.png, { contentType: 'image/png', upsert: true })
  await db.from('brand_profiles').update({ logo_path: path, logo_job_status: 'done' }).eq('business_id', businessId)
  return 'done'
}

/** Starts the brand board: the logo as the reference, the sector and colours in the prompt. */
async function startBoard(db: SupabaseClient, businessId: string, logo: string, colors: string[]) {
  const { data: business } = await db.from('businesses').select('name, sector').eq('id', businessId).maybeSingle()
  const prompt = [
    `Design a brand board for ${business?.name ? `"${business.name}", ` : ''}a business${business?.sector ? ` in the ${business.sector} sector` : ''} in Italy, built around the attached logo.`,
    'The board contains only these four elements, laid out cleanly on a calm background with generous white space:',
    '1. The logo, exactly as attached: the same shapes, lettering and colours, never redrawn or restyled.',
    `2. The colour palette as swatches${colors.length ? `: exactly these colours, ${colors.join(', ')}, each with its hex code written under it` : ', taken from the logo, each with its hex code written under it'}.`,
    '3. Fonts, preferably sans-serif.',
    '4. A simple complementary pattern / brand texture.',
    'Nothing else: no photographs, mockups, products, people, taglines, slogans, extra words or watermarks. Flat, sharp, professional, like a page of a brand guidelines book.',
  ].join('\n')
  return await startImageJob({ prompt, images: [logo], action: 'edit', size: BOARD_SIZE, background: 'opaque' })
}

// The largest size gpt-image-2.5 makes without going experimental (above 2560x1440).
const BOARD_SIZE = '2560x1440'

/** Where the brand board stands; once its job is done, stores it next to the logo. */
export async function checkBoard(db: SupabaseClient, businessId: string): Promise<string> {
  const { data: brand } = await db
    .from('brand_profiles')
    .select('board_job_id, board_job_status')
    .eq('business_id', businessId)
    .maybeSingle()
  if (!brand?.board_job_id || brand.board_job_status !== 'running') return brand?.board_job_status ?? 'none'
  const state = await checkImageJob(brand.board_job_id)
  if (state.status === 'running') return 'running'
  if (state.status === 'failed') {
    await db
      .from('brand_profiles')
      .update({ board_job_status: 'failed', board_error: state.error.slice(0, 2000) })
      .eq('business_id', businessId)
    return 'failed'
  }
  const path = `${businessId}/branding.png`
  await db.storage.from('logos').upload(path, state.png, { contentType: 'image/png', upsert: true })
  await db.from('brand_profiles').update({ board_path: path, board_job_status: 'done' }).eq('business_id', businessId)
  return 'done'
}

/**
 * The logo's colours, completed up to three with the site's: its primary,
 * accent and secondary colours first, then the rest; never a colour close to
 * one already in, nor the page's white or near-white background.
 */
function withSiteColors(logo: string[], site: Record<string, string> | null): string[] {
  if (!site || logo.length >= 3) return logo
  const order = ['primary', 'accent', 'secondary', 'link']
  const candidates = [
    ...order.map((role) => site[role]).filter(Boolean),
    ...Object.entries(site)
      .filter(([role]) => !order.includes(role) && !/background|text/i.test(role))
      .map(([, hex]) => hex),
  ]
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const palette = [...logo]
  for (const hex of candidates) {
    if (palette.length >= 3) break
    const [r, g, b] = rgb(hex)
    if (r > 240 && g > 240 && b > 240) continue
    const close = palette.some((other) => {
      const [or, og, ob] = rgb(other)
      return Math.abs(r - or) + Math.abs(g - og) + Math.abs(b - ob) < 60
    })
    if (!close) palette.push(hex.toUpperCase())
  }
  return palette
}

/** For a profile from before the site's colours were kept: read them once from its home page. */
async function readSiteColors(db: SupabaseClient, businessId: string): Promise<Record<string, string> | null> {
  const { data: business } = await db.from('businesses').select('website_url').eq('id', businessId).maybeSingle()
  if (!business?.website_url || isPlatform(business.website_url)) return null
  try {
    const colors = siteColors((await scrape(business.website_url, true)).branding)
    await db.from('brand_profiles').update({ site_colors: colors }).eq('business_id', businessId)
    return colors
  } catch (failure) {
    console.error('Could not read the site colours', failure)
    return null
  }
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
  "Keep the background exactly as it is in the image: the same solid colour. Extend it to fill the square, with the logo centred and even padding.",
].join(' ')

/** Whether the recreated logo is still the same logo, as the vision model sees it. */
async function sameLogo(original: Uint8Array, candidate: Uint8Array): Promise<{ same: boolean; difference: string }> {
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
            text: 'Is image 2 the same logo as image 1, faithfully recreated? It must read the same words spelled the same, keep the same symbol or mark, the same colours and the same background colour. Differences that come with a recreation are fine: sharper edges, slightly different line weight or letter spacing, more or less empty space around it. Answer no only if it is a different logo: a changed or misspelled word, a different or missing symbol, different colours, a different background, or added outlines, shadows or decorations.',
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
  return JSON.parse(response.output_text || '{"same":false,"difference":"no answer"}') as { same: boolean; difference: string }
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

/**
 * The brand colours of a raster logo, as the vision model reads them. SVG and
 * HEIC are not readable. `background` is the one laid under a transparent
 * logo: not a brand colour.
 */
async function imageColors(image: string, background?: string): Promise<string[]> {
  const response = await openai.responses.create({
    model: VISION_MODEL,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: background
              ? `List the brand colours of this logo, most prominent first, as #RRGGBB, at most three. The logo has a transparent background, shown here on ${background}: that background is not a brand colour.`
              : 'List the brand colours of this logo, most prominent first, as #RRGGBB, at most three. A solid coloured background is part of the brand and counts; ignore only a plain white or transparent background.',
          },
          { type: 'input_image', image_url: image, detail: 'high' },
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
