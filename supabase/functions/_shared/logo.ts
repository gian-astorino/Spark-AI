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
 * Redraws the business's current logo and replaces the brand colours with the
 * logo's. Keeps the original next to it. Never throws: a logo that cannot be
 * redrawn stays as it was.
 */
export async function regenerateLogo(db: SupabaseClient, businessId: string) {
  try {
    const { data: brand } = await db.from('brand_profiles').select('logo_path').eq('business_id', businessId).maybeSingle()
    if (!brand?.logo_path) return
    const { data: file } = await db.storage.from('logos').download(brand.logo_path)
    if (!file) return

    const isSvg = file.type.includes('svg') || brand.logo_path.endsWith('.svg')
    const original = `${businessId}/original.${isSvg ? 'svg' : (brand.logo_path.split('.').pop() ?? 'png')}`
    await db.storage.from('logos').upload(original, file, { contentType: file.type, upsert: true })

    let logoPath: string
    let colors: string[]
    if (isSvg) {
      const svg = await file.text()
      logoPath = `${businessId}/logo-square.svg`
      await db.storage.from('logos').upload(logoPath, new Blob([squareSvg(svg)], { type: 'image/svg+xml' }), {
        contentType: 'image/svg+xml',
        upsert: true,
      })
      colors = svgColors(svg)
    } else {
      const redrawn = await openai.images.edit({
        model: IMAGE_MODEL,
        image: await toFile(file, `logo.${original.split('.').pop()}`, { type: file.type }),
        prompt: REDRAW,
        size: '1024x1024',
        quality: 'high',
        input_fidelity: 'high',
        background: 'transparent',
        output_format: 'png',
      })
      const b64 = redrawn.data?.[0]?.b64_json
      if (!b64) throw new Error('The image model returned no image')
      logoPath = `${businessId}/logo-hd.png`
      const png = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
      await db.storage.from('logos').upload(logoPath, png, { contentType: 'image/png', upsert: true })
      colors = await imageColors(db, logoPath)
    }

    await db.from('brand_profiles').update({ logo_path: logoPath }).eq('business_id', businessId)
    if (colors.length > 0) {
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
  } catch (failure) {
    console.error('Logo regeneration failed', failure)
  }
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

/** The brand colours of a raster logo, as the vision model reads them. */
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
