import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PREVIEW_CRAWLER } from './firecrawl.ts'
import { requestLogoRefresh } from './logo.ts'
import { addressKey, key } from './matching.ts'

// The hands of both models, the chat agent and the import research: every
// tool writes one part of the profile, marked with the caller's source.
// Strict schemas, so inputs always match what is declared.

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description })

const HOURS = {
  type: 'array',
  description: 'One entry per open interval (a lunch break is two entries for that day). Empty if unknown.',
  items: {
    type: 'object',
    properties: {
      weekday: { type: 'integer', description: 'ISO weekday, 1 = Monday … 7 = Sunday' },
      opens_at: { type: 'string', description: '24h time, HH:MM' },
      closes_at: { type: 'string', description: '24h time, HH:MM' },
    },
    required: ['weekday', 'opens_at', 'closes_at'],
    additionalProperties: false,
  },
}

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export const DEFS: ToolDef[] = [
  {
    name: 'update_business',
    description: 'Set the business name, description or sector. Pass null for anything that should stay as it is.',
    input_schema: {
      type: 'object',
      properties: {
        name: nullable('string', 'Business name'),
        description: nullable('string', 'What the business does, one or two sentences'),
        sector: nullable('string', 'Short label in Italian, e.g. "Centro estetico", "Parrucchiere"'),
      },
      required: ['name', 'description', 'sector'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_location',
    description:
      'Add a location or update one already in the profile (matched by address). When hours are given they replace that location\'s hours.',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Full street address' },
        name: nullable('string', 'Name of the location, if the business has several'),
        hours: HOURS,
      },
      required: ['address', 'name', 'hours'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_catalog_items',
    description:
      'Add treatments or services, or update ones already in the catalog (matched by name). Null leaves a field as it is.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: nullable('string', 'Short description'),
              category: nullable('string', 'e.g. "Viso", "Corpo"'),
              price_eur: nullable('number', 'Price in euro'),
              duration_minutes: nullable('integer', 'Duration in minutes'),
            },
            required: ['name', 'description', 'category', 'price_eur', 'duration_minutes'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_catalog_item',
    description: 'Remove a treatment the owner says they do not offer.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_team',
    description: 'Replace the list of people who take appointments.',
    input_schema: {
      type: 'object',
      properties: { members: { type: 'array', items: { type: 'string' } } },
      required: ['members'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_calendar',
    description: 'Record which calendar or booking tool the business uses today.',
    input_schema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['google_calendar', 'outlook', 'apple_calendar', 'fresha', 'treatwell', 'paper', 'other'],
        },
        label: nullable('string', 'The tool\'s name when provider is "other"'),
      },
      required: ['provider', 'label'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_tone_of_voice',
    description:
      'Describe how the business talks to its clients, so that texts written for it sound like it. Replaces the current tone of voice.',
    input_schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            'Three to five sentences, in the language of the business: how it addresses clients (tu or lei, first names), register and warmth, typical vocabulary and phrases, sentence length, use of emoji and exclamation marks, what it avoids. Concrete enough to write a post or a reminder in that voice.',
        },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Three to five adjectives summing it up' },
      },
      required: ['description', 'keywords'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_logo',
    description: 'Use an attached image as the business logo. Only when the owner says it is their logo, or it clearly is.',
    input_schema: {
      type: 'object',
      properties: { attachment: { type: 'string', description: 'The attachment id, as listed with the message' } },
      required: ['attachment'],
      additionalProperties: false,
    },
  },
  {
    name: 'view_logo',
    description: 'Look at the logo currently in the profile, e.g. to propose brand colours that match it.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'set_brand_colors',
    description:
      'Replace the brand colours: Primary, Secondary and Accent. Normally they are read from the logo automatically: use this only when there is no logo, or the owner asks to change them, and after they agree.',
    input_schema: {
      type: 'object',
      properties: {
        colors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', enum: ['Primary', 'Secondary', 'Accent'] },
              hex: { type: 'string', description: '#RRGGBB' },
            },
            required: ['name', 'hex'],
            additionalProperties: false,
          },
        },
      },
      required: ['colors'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_fonts',
    description:
      'Replace the brand fonts: one for headings, one for body text, both families available on Google Fonts. Only after the owner has agreed to them.',
    input_schema: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Google Fonts family for headings' },
        body: { type: 'string', description: 'Google Fonts family for body text' },
      },
      required: ['heading', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_logo_from_url',
    description:
      "Use an image found on the web as the business logo, e.g. the profile photo (preview image) of the business's own Facebook or Instagram page.",
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The image address' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_photos',
    description:
      'Keep attached images as photos of the business (the place, the team, treatments, results) for its profile and marketing. Not for screenshots or documents that only carried information.',
    input_schema: {
      type: 'object',
      properties: {
        attachments: { type: 'array', items: { type: 'string' }, description: 'Attachment ids' },
        caption: nullable('string', 'What the photos show, in the owner\'s language'),
      },
      required: ['attachments', 'caption'],
      additionalProperties: false,
    },
  },
  {
    name: 'offer_choices',
    description:
      'Show up to four short answers the owner can tap instead of typing, under your next message. Use it for questions with a few likely answers.',
    input_schema: {
      type: 'object',
      properties: { options: { type: 'array', items: { type: 'string' } } },
      required: ['options'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_onboarding',
    description: 'Call once the profile has everything needed and the owner has confirmed it.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
]

/** As OpenAI function tools, in strict mode: inputs always match the schema. */
export const asFunctionTool = (tool: ToolDef): OpenAI.Responses.FunctionTool => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.input_schema,
  strict: true,
})

export const TOOLS: OpenAI.Responses.FunctionTool[] = DEFS.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.input_schema,
  strict: true,
}))

const LOGO_SAVED =
  'Logo saved. A square high-resolution version is being made in the background, and the brand colours will be taken from it.'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export interface ToolContext {
  db: SupabaseClient
  businessId: string
  /** 'chat' for what the owner said, 'import' for what research found. */
  source: 'chat' | 'import'
  /** Filled by offer_choices, read by the caller after the turn. */
  choices: string[]
}

type Input = Record<string, unknown>

/** Runs one tool call. Returns what the model reads back: text, or content such as an image. */
export async function runTool(
  name: string,
  input: Input,
  ctx: ToolContext,
): Promise<string | OpenAI.Responses.ResponseFunctionCallOutputItemList> {
  const { db, businessId } = ctx
  switch (name) {
    case 'update_business': {
      const patch = Object.fromEntries(
        ['name', 'description', 'sector'].filter((field) => typeof input[field] === 'string').map((field) => [field, input[field]]),
      )
      if (Object.keys(patch).length === 0) return 'Nothing to change.'
      await check(db.from('businesses').update(patch).eq('id', businessId))
      return 'Saved.'
    }

    case 'set_location': {
      const address = String(input.address)
      const hours = (input.hours as { weekday: number; opens_at: string; closes_at: string }[]).filter(
        (row) => row.weekday >= 1 && row.weekday <= 7 && TIME.test(row.opens_at) && TIME.test(row.closes_at) && row.closes_at > row.opens_at,
      )
      const { data: known } = await db.from('locations').select('id, address').eq('business_id', businessId)
      let id = known?.find((location) => addressKey(location.address) === addressKey(address))?.id
      if (id) {
        await check(db.from('locations').update({ address, ...(input.name ? { name: input.name } : {}) }).eq('id', id))
      } else {
        const { data } = await check(
          db
            .from('locations')
            .insert({ business_id: businessId, address, name: input.name ?? null, position: known?.length ?? 0, source: ctx.source })
            .select('id')
            .single(),
        )
        if (!data) throw new Error('The location was not saved')
        id = data.id
      }
      if (hours.length > 0) {
        await check(db.from('opening_hours').delete().eq('location_id', id))
        await check(db.from('opening_hours').insert(hours.map((row) => ({ location_id: id, ...row }))))
      }
      const dropped = (input.hours as unknown[]).length - hours.length
      return dropped > 0 ? `Saved. ${dropped} interval(s) were invalid and skipped.` : 'Saved.'
    }

    case 'save_catalog_items': {
      const items = input.items as {
        name: string
        description: string | null
        category: string | null
        price_eur: number | null
        duration_minutes: number | null
      }[]
      const { data: existing } = await db.from('catalog_items').select('id, name').eq('business_id', businessId)
      const byName = new Map((existing ?? []).map((item) => [key(item.name), item.id]))
      let added = 0
      for (const item of items) {
        const fields = {
          ...(item.description != null ? { description: item.description } : {}),
          ...(item.category != null ? { category: item.category } : {}),
          ...(item.price_eur != null && item.price_eur >= 0 ? { price_cents: Math.round(item.price_eur * 100) } : {}),
          ...(item.duration_minutes != null && item.duration_minutes > 0 ? { duration_minutes: item.duration_minutes } : {}),
        }
        const id = byName.get(key(item.name))
        if (id) {
          if (Object.keys(fields).length > 0) await check(db.from('catalog_items').update(fields).eq('id', id))
        } else {
          await check(
            db.from('catalog_items').insert({
              business_id: businessId,
              name: item.name,
              ...fields,
              position: byName.size + added,
              source: ctx.source,
            }),
          )
          added++
        }
      }
      return `Saved: ${added} added, ${items.length - added} updated.`
    }

    case 'remove_catalog_item': {
      const { data: existing } = await db.from('catalog_items').select('id, name').eq('business_id', businessId)
      const match = existing?.find((item) => key(item.name) === key(String(input.name)))
      if (!match) return 'No treatment with that name.'
      await check(db.from('catalog_items').delete().eq('id', match.id))
      return 'Removed.'
    }

    case 'set_team': {
      const members = (input.members as string[]).map((name) => name.trim()).filter(Boolean)
      await check(db.from('team_members').delete().eq('business_id', businessId))
      if (members.length > 0) {
        await check(
          db.from('team_members').insert(
            members.map((display_name, position) => ({ business_id: businessId, display_name, position, source: ctx.source })),
          ),
        )
      }
      return 'Saved.'
    }

    case 'set_calendar':
      await check(
        db.from('calendar_setups').upsert({
          business_id: businessId,
          provider: input.provider,
          provider_label: input.label ?? null,
          source: ctx.source,
        }),
      )
      return 'Saved.'

    case 'set_tone_of_voice':
      await check(
        db.from('brand_profiles').upsert({
          business_id: businessId,
          tone_description: String(input.description).trim(),
          tone_of_voice: input.keywords,
          source: ctx.source,
        }),
      )
      return 'Saved.'

    case 'set_logo': {
      const path = ownAttachment(String(input.attachment), businessId)
      const { data: file, error } = await db.storage.from('uploads').download(path)
      if (error || !file) throw new Error(`Attachment not found: ${input.attachment}`)
      const extension = path.split('.').pop() ?? 'png'
      const logoPath = `${businessId}/logo.${extension}`
      await check(db.storage.from('logos').upload(logoPath, file, { contentType: file.type, upsert: true }))
      await check(
        db.from('brand_profiles').upsert({
          business_id: businessId,
          logo_path: logoPath,
          // A new logo starts over: no job, no error from the previous one.
          logo_job_id: null,
          logo_job_status: null,
          logo_error: null,
          board_path: null,
          board_job_id: null,
          board_job_status: null,
          board_error: null,
          source: ctx.source,
        }),
      )
      requestLogoRefresh(businessId)
      return LOGO_SAVED
    }

    case 'view_logo': {
      const { data: brand } = await db.from('brand_profiles').select('logo_path').eq('business_id', businessId).maybeSingle()
      if (!brand?.logo_path) return 'There is no logo in the profile.'
      const { data } = await db.storage.from('logos').createSignedUrl(brand.logo_path, 10 * 60)
      if (!data) return 'The logo could not be opened.'
      return [
        { type: 'input_text', text: 'The current logo:' },
        { type: 'input_image', image_url: data.signedUrl, detail: 'high' },
      ]
    }

    case 'set_brand_colors': {
      const colors = (input.colors as { name: string; hex: string }[]).filter((color) => /^#[0-9a-f]{6}$/i.test(color.hex))
      if (colors.length === 0) return 'Not saved: no valid #RRGGBB colour.'
      await check(db.from('brand_colors').delete().eq('business_id', businessId))
      await check(
        db.from('brand_colors').insert(
          colors.map((color, position) => ({
            business_id: businessId,
            name: color.name,
            hex: color.hex.toUpperCase(),
            position,
            source: ctx.source,
          })),
        ),
      )
      return 'Saved.'
    }

    case 'set_fonts': {
      const fonts = [
        { role: 'heading', family: String(input.heading).trim() },
        { role: 'body', family: String(input.body).trim() },
      ]
      await check(db.from('brand_profiles').upsert({ business_id: businessId, fonts, source: ctx.source }))
      return 'Saved.'
    }

    case 'set_logo_from_url': {
      const url = String(input.url)
      if (!/^https:\/\//.test(url)) return 'Not saved: the address must start with https://'
      // Facebook serves its preview images only to link-preview crawlers;
      // other hosts may refuse that crawler, so a plain request is the fallback.
      let response = await fetch(url, { headers: { 'User-Agent': PREVIEW_CRAWLER } })
      if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) response = await fetch(url)
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || !type.startsWith('image/')) return `Not saved: that address is not an image (${response.status} ${type})`
      const image = await response.arrayBuffer()
      if (image.byteLength > 5_000_000) return 'Not saved: the image is larger than 5 MB'
      const extension = type.includes('svg') ? 'svg' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
      const logoPath = `${businessId}/logo.${extension}`
      await check(db.storage.from('logos').upload(logoPath, image, { contentType: type, upsert: true }))
      await check(
        db.from('brand_profiles').upsert({
          business_id: businessId,
          logo_path: logoPath,
          logo_source_url: url,
          logo_job_id: null,
          logo_job_status: null,
          logo_error: null,
          board_path: null,
          board_job_id: null,
          board_job_status: null,
          board_error: null,
          source: ctx.source,
        }),
      )
      requestLogoRefresh(businessId)
      return LOGO_SAVED
    }

    case 'add_photos': {
      const paths = (input.attachments as string[]).map((attachment) => ownAttachment(attachment, businessId))
      const { count } = await db.from('business_media').select('id', { count: 'exact', head: true }).eq('business_id', businessId)
      await check(
        db.from('business_media').insert(
          paths.map((path, index) => ({
            business_id: businessId,
            bucket: 'uploads',
            path,
            caption: input.caption ?? null,
            position: (count ?? 0) + index,
            source: ctx.source,
          })),
        ),
      )
      return `${paths.length} photo(s) saved.`
    }

    case 'offer_choices':
      ctx.choices = (input.options as string[]).slice(0, 4)
      return 'The options will be shown under your next message.'

    case 'complete_onboarding':
      await check(db.from('businesses').update({ onboarding_status: 'completed' }).eq('id', businessId))
      return 'Onboarding marked as complete.'

    default:
      return `Unknown tool ${name}.`
  }
}

/** An attachment id is its storage path; it must sit in this business's folder. */
function ownAttachment(id: string, businessId: string) {
  if (!id.startsWith(`${businessId}/`) || id.includes('..')) throw new Error(`Unknown attachment: ${id}`)
  return id
}

/** Supabase returns errors instead of throwing; the loop wants them thrown. */
async function check<T extends { error: { message: string } | null }>(query: PromiseLike<T>): Promise<T> {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result
}
