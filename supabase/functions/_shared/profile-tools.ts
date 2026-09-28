import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
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
        sector: nullable('string', 'Short label, e.g. "Beauty & skincare"'),
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
    description: 'Replace the adjectives describing how the business talks to customers.',
    input_schema: {
      type: 'object',
      properties: { adjectives: { type: 'array', items: { type: 'string' } } },
      required: ['adjectives'],
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

/** Runs one tool call. Returns what the model reads back as the result. */
export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<string> {
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
        db.from('brand_profiles').upsert({ business_id: businessId, tone_of_voice: input.adjectives, source: ctx.source }),
      )
      return 'Saved.'

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

/** Supabase returns errors instead of throwing; the loop wants them thrown. */
async function check<T extends { error: { message: string } | null }>(query: PromiseLike<T>): Promise<T> {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result
}
