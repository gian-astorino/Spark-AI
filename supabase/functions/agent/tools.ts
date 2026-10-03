import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { visualBlock } from '../_shared/claude.ts'
import { dataUrl, startImageJob } from '../_shared/image-jobs.ts'
import { check, ownAttachment, PROFILE_TOOLS, runTool, type ToolDef, type ToolOutput } from '../_shared/profile-tools.ts'
import { RESEARCH_TOOLS, runResearchTool } from '../_shared/research-tools.ts'
import { snapshot } from '../_shared/snapshot.ts'
import type { Skill } from './skills/index.ts'

// The agent's kernel: generic capabilities only. Reading the context, writing
// the profile, reading the web, keeping ads, notes and images. When to use
// which, and to what end, is written in the skills, never here.

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description })

const ORIGIN = {
  type: 'string',
  enum: ['owner', 'research'],
  description: '"owner" for what the owner said or sent, "research" for what you found on the web',
}

const CTAS = ['BOOK_NOW', 'LEARN_MORE', 'SEND_MESSAGE', 'CALL_NOW', 'GET_OFFER', 'SIGN_UP', 'SHOP_NOW', 'CONTACT_US']

const KERNEL: ToolDef[] = [
  {
    name: 'load_skill',
    description: 'Read the full instructions of a skill, before doing what it covers.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The skill name, as listed' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_context',
    description:
      'Read what Spark knows about the business. "profile": the profile as it stands. "ads" / "ad": the ads made (one in full with its images, by id). "calls" / "call": call transcripts (one in full). "notes" / "note": notes kept for later. "photos": photos of the business, with ids.',
    input_schema: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['profile', 'ads', 'ad', 'calls', 'call', 'notes', 'note', 'photos'] },
        id: nullable('string', 'For "ad", "call" and "note": which one'),
      },
      required: ['what', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'view_image',
    description:
      'Look at an image: "logo", "ad_image:<id>", "photo:<id>", or an attachment id of the owner\'s.',
    input_schema: {
      type: 'object',
      properties: { source: { type: 'string' } },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_onboarding_status',
    description: "Set where the business's onboarding stands.",
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['chatting', 'completed'] } },
      required: ['status'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_ad',
    description:
      'Create an ad (ad_id null) or replace the content of an existing one. The app shows it as a card in the chat. Returns its id.',
    input_schema: {
      type: 'object',
      properties: {
        ad_id: nullable('string', 'The ad to update; null for a new one'),
        name: { type: 'string', description: 'Short name, in Italian' },
        status: { type: 'string', enum: ['draft', 'approved', 'archived'] },
        objective: nullable('string', 'What the ad is for'),
        strategy: {
          type: 'array',
          description: 'The decisions behind the ad, as Italian label and text pairs',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, text: { type: 'string' } },
            required: ['label', 'text'],
            additionalProperties: false,
          },
        },
        copy: {
          type: 'object',
          properties: {
            primary_text: { type: 'string' },
            headline: { type: 'string' },
            description: nullable('string', 'Optional link description'),
            cta: { type: 'string', enum: CTAS },
          },
          required: ['primary_text', 'headline', 'description', 'cta'],
          additionalProperties: false,
        },
        creative: {
          type: 'object',
          properties: {
            format: { type: 'string', description: 'e.g. offer ad, before/after, testimonial' },
            brief: { type: 'string', description: 'What the image must show' },
            text_on_image: { type: 'string', description: 'The exact words on the image' },
          },
          required: ['format', 'brief', 'text_on_image'],
          additionalProperties: false,
        },
      },
      required: ['ad_id', 'name', 'status', 'objective', 'strategy', 'copy', 'creative'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_ad_image',
    description:
      'Generate a new image for an ad with the image model, from your prompt. To change an image already made, give it as edit_of. Images go with the prompt only when the owner asked for them (their logo, a photo, an image they sent): give them as include. Runs in the background (a minute or two); the ad card shows it when ready.',
    input_schema: {
      type: 'object',
      properties: {
        ad_id: { type: 'string' },
        prompt: { type: 'string', description: 'In English or Italian; any text to appear on the image quoted exactly' },
        edit_of: nullable('string', 'The id of an image of this ad to change; null for a new image'),
        include: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only what the owner asked to see in the image: "logo", "photo:<id>", attachment ids. Usually empty.',
        },
        size: {
          type: 'string',
          enum: ['2048x2048', '1440x2560', '2560x1440', '1024x1024', '1024x1536', '1536x1024'],
        },
      },
      required: ['ad_id', 'prompt', 'edit_of', 'include', 'size'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_note',
    description: 'Keep a note for later (a strategy, a plan, a memory about the client, a report), or replace one (note_id).',
    input_schema: {
      type: 'object',
      properties: {
        note_id: nullable('string', 'The note to replace; null for a new one'),
        kind: { type: 'string', description: 'e.g. strategy, memory, report' },
        title: { type: 'string', description: 'In Italian' },
        body: { type: 'string', description: 'Markdown, in Italian' },
      },
      required: ['note_id', 'kind', 'title', 'body'],
      additionalProperties: false,
    },
  },
]

/** The profile tools, each with the origin of what it saves. */
const PROFILE_WITH_ORIGIN: ToolDef[] = PROFILE_TOOLS.map((tool) => ({
  ...tool,
  input_schema: {
    ...tool.input_schema,
    properties: { ...(tool.input_schema.properties as Record<string, unknown>), origin: ORIGIN },
    required: [...(tool.input_schema.required as string[]), 'origin'],
  },
}))

/** Everything the agent can call, in a fixed order (the prompt cache depends on it). */
export const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...[...KERNEL, ...PROFILE_WITH_ORIGIN, ...RESEARCH_TOOLS].map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Anthropic.Beta.BetaTool.InputSchema,
  })),
  { type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'IT' } },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
]

const PROFILE_NAMES = new Set(PROFILE_TOOLS.map((tool) => tool.name))
const RESEARCH_NAMES = new Set(RESEARCH_TOOLS.map((tool) => tool.name))

/** What a turn of the owner's carries from step to step: kept on the conversation. */
export interface TurnState {
  rounds: number
  reads: number
  /** Ads saved or given an image this turn: shown with the reply. */
  ads: string[]
}

export interface AgentContext {
  db: SupabaseClient
  businessId: string
  skills: Skill[]
  turn: TurnState
  /** The owner's latest message, as typed. */
  message?: string
  activity: (text: string) => void
  attachmentText: (id: string) => Promise<string>
}

/** Runs one tool call. */
export async function runAgentTool(name: string, input: Record<string, unknown>, ctx: AgentContext): Promise<ToolOutput> {
  const { db, businessId } = ctx
  if (PROFILE_NAMES.has(name)) {
    ctx.activity('Aggiorno il profilo')
    const { origin, ...rest } = input
    return await runTool(name, rest, {
      db,
      businessId,
      source: origin === 'research' ? 'import' : 'chat',
      message: ctx.message,
      attachmentText: ctx.attachmentText,
    })
  }
  if (RESEARCH_NAMES.has(name)) {
    const research = { db, businessId, reads: ctx.turn.reads, activity: ctx.activity }
    try {
      return await runResearchTool(name, input, research)
    } finally {
      ctx.turn.reads = research.reads
    }
  }

  switch (name) {
    case 'load_skill': {
      const skill = ctx.skills.find((candidate) => candidate.name === String(input.name))
      if (!skill) return `No skill named "${input.name}". Available: ${ctx.skills.map((s) => s.name).join(', ')}.`
      ctx.activity('Mi preparo')
      return skill.body
    }

    case 'read_context':
      return await readContext(db, businessId, String(input.what), typeof input.id === 'string' ? input.id : null)

    case 'view_image': {
      const image = await resolveImage(db, businessId, String(input.source))
      if (!image) return `No image for "${input.source}".`
      if (image.type.includes('svg')) return 'That image is an SVG: it cannot be shown.'
      return [
        { type: 'text', text: `${input.source}:` },
        (await visualBlock(image.bytes, image.name, image.type)) as Anthropic.Beta.BetaImageBlockParam,
      ]
    }

    case 'set_onboarding_status':
      await check(db.from('businesses').update({ onboarding_status: input.status }).eq('id', businessId))
      return 'Saved.'

    case 'save_ad': {
      const content = { objective: input.objective ?? null, strategy: input.strategy, copy: input.copy, creative: input.creative }
      const fields = { name: String(input.name), status: String(input.status), content, updated_at: new Date().toISOString() }
      let id = typeof input.ad_id === 'string' && input.ad_id ? input.ad_id : null
      if (id) {
        const { data } = await check(db.from('ads').update(fields).eq('id', id).eq('business_id', businessId).select('id'))
        if (!data?.length) return `No ad with id ${id}.`
      } else {
        const { data } = await check(db.from('ads').insert({ business_id: businessId, ...fields }).select('id').single())
        id = data!.id as string
      }
      if (!ctx.turn.ads.includes(id)) ctx.turn.ads.push(id)
      return `Ad saved, id ${id}.`
    }

    case 'generate_ad_image': {
      const adId = String(input.ad_id)
      const { data: ad } = await db.from('ads').select('id').eq('id', adId).eq('business_id', businessId).maybeSingle()
      if (!ad) return `No ad with id ${adId}.`
      // The prompt, the ad's own image when it is a change to it, and what the owner asked to include.
      const references: string[] = []
      if (typeof input.edit_of === 'string' && input.edit_of) {
        const { data: own } = await db.from('ad_images').select('id').eq('id', input.edit_of).eq('ad_id', adId).maybeSingle()
        const image = own ? await resolveImage(db, businessId, `ad_image:${own.id}`) : null
        if (!image) return `No finished image ${input.edit_of} on this ad to change.`
        references.push(dataUrl(image.type, image.bytes))
      }
      const missing: string[] = []
      for (const source of Array.isArray(input.include) ? (input.include as string[]) : []) {
        const image = source.startsWith('ad_image:') ? null : await resolveImage(db, businessId, source)
        if (image && !image.type.includes('svg')) references.push(dataUrl(image.type, image.bytes))
        else missing.push(source)
      }
      ctx.activity("Avvio l'immagine")
      const size = String(input.size)
      const jobId = await startImageJob({
        prompt: String(input.prompt),
        images: references,
        action: references.length ? 'edit' : 'generate',
        size,
      })
      const { data: image } = await check(
        db
          .from('ad_images')
          .insert({ ad_id: adId, business_id: businessId, prompt: String(input.prompt), size, job_id: jobId })
          .select('id')
          .single(),
      )
      if (!ctx.turn.ads.includes(adId)) ctx.turn.ads.push(adId)
      return `Image ${image!.id} started; it will appear on the ad card in a minute or two.${missing.length ? ` Not found or not usable, left out: ${missing.join(', ')}.` : ''}`
    }

    case 'save_note': {
      const fields = { kind: String(input.kind), title: String(input.title), body: String(input.body), updated_at: new Date().toISOString() }
      if (typeof input.note_id === 'string' && input.note_id) {
        const { data } = await check(
          db.from('agent_notes').update(fields).eq('id', input.note_id).eq('business_id', businessId).select('id'),
        )
        return data?.length ? 'Note saved.' : `No note with id ${input.note_id}.`
      }
      const { data } = await check(db.from('agent_notes').insert({ business_id: businessId, ...fields }).select('id').single())
      return `Note saved, id ${data!.id}.`
    }

    default:
      throw new Error(`Unknown tool ${name}`)
  }
}

async function readContext(db: SupabaseClient, businessId: string, what: string, id: string | null): Promise<string> {
  const need = () => {
    if (!id) throw new Error(`"${what}" needs an id`)
    return id
  }
  switch (what) {
    case 'profile':
      return `<profile_data>\n${await snapshot(db, businessId)}\n</profile_data>`

    case 'ads': {
      const { data } = await db
        .from('ads')
        .select('id, name, status, content, updated_at, ad_images(status)')
        .eq('business_id', businessId)
        .order('updated_at', { ascending: false })
      if (!data?.length) return 'No ads yet.'
      return data
        .map((ad) => {
          const images = (ad.ad_images ?? []) as { status: string }[]
          return `- ${ad.id}: "${ad.name}" (${ad.status}, updated ${ad.updated_at.slice(0, 10)}, ${images.length} image(s)) — ${(ad.content as { objective?: string }).objective ?? ''}`
        })
        .join('\n')
    }

    case 'ad': {
      const { data: ad } = await db
        .from('ads')
        .select('id, name, status, content, created_at, updated_at')
        .eq('id', need())
        .eq('business_id', businessId)
        .maybeSingle()
      if (!ad) return `No ad with id ${id}.`
      const { data: images } = await db
        .from('ad_images')
        .select('id, prompt, size, status, error, created_at')
        .eq('ad_id', ad.id)
        .order('created_at')
      return JSON.stringify({ ...ad, images: images ?? [] }, null, 2)
    }

    case 'calls': {
      const { data } = await db
        .from('call_transcripts')
        .select('id, title, call_date, summary')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
      if (!data?.length) return 'No calls recorded.'
      return data.map((call) => `- ${call.id}: ${call.title}${call.call_date ? ` (${call.call_date})` : ''} — ${call.summary}`).join('\n')
    }

    case 'call': {
      const { data } = await db
        .from('call_transcripts')
        .select('document')
        .eq('id', need())
        .eq('business_id', businessId)
        .maybeSingle()
      return data ? `<call>\n${data.document}\n</call>` : `No call with id ${id}.`
    }

    case 'notes': {
      const { data } = await db
        .from('agent_notes')
        .select('id, kind, title, updated_at')
        .eq('business_id', businessId)
        .order('updated_at', { ascending: false })
      if (!data?.length) return 'No notes yet.'
      return data.map((note) => `- ${note.id}: [${note.kind}] ${note.title} (${note.updated_at.slice(0, 10)})`).join('\n')
    }

    case 'note': {
      const { data } = await db
        .from('agent_notes')
        .select('kind, title, body, updated_at')
        .eq('id', need())
        .eq('business_id', businessId)
        .maybeSingle()
      return data ? `# ${data.title} [${data.kind}, ${data.updated_at.slice(0, 10)}]\n\n${data.body}` : `No note with id ${id}.`
    }

    case 'photos': {
      const { data } = await db.from('business_media').select('id, caption').eq('business_id', businessId).order('position')
      if (!data?.length) return 'No photos kept.'
      return data.map((photo) => `- photo:${photo.id}${photo.caption ? ` — ${photo.caption}` : ''}`).join('\n')
    }

    default:
      return `Unknown context "${what}".`
  }
}

/** An image by the names the tools use, read from storage. */
async function resolveImage(
  db: SupabaseClient,
  businessId: string,
  source: string,
): Promise<{ bytes: Uint8Array; type: string; name: string } | null> {
  let bucket: string
  let path: string | null | undefined
  if (source === 'logo') {
    const { data } = await db.from('brand_profiles').select('logo_path').eq('business_id', businessId).maybeSingle()
    bucket = 'logos'
    path = data?.logo_path
  } else if (source.startsWith('ad_image:')) {
    const { data } = await db
      .from('ad_images')
      .select('path')
      .eq('id', source.slice('ad_image:'.length))
      .eq('business_id', businessId)
      .maybeSingle()
    bucket = 'creatives'
    path = data?.path
  } else if (source.startsWith('photo:')) {
    const { data } = await db
      .from('business_media')
      .select('bucket, path')
      .eq('id', source.slice('photo:'.length))
      .eq('business_id', businessId)
      .maybeSingle()
    bucket = data?.bucket ?? 'uploads'
    path = data?.path
  } else {
    bucket = 'uploads'
    try {
      path = ownAttachment(source, businessId)
    } catch {
      return null
    }
  }
  if (!path) return null
  const { data: file } = await db.storage.from(bucket).download(path)
  if (!file) return null
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type || 'image/png', name: path.split('/').pop() ?? 'image' }
}
