import OpenAI from 'openai'

// The one thing Spark still asks of OpenAI: generating images. Each runs as an
// OpenAI background response, started in one request and checked in later
// ones; the response's text model only hands the prompt to the image tool.
// The image model can take minutes, and an Edge Function that waited for it
// would be cut off by its time limit.

export const IMAGE_MODEL = 'gpt-image-2.5-sunburst'
const ORCHESTRATOR = 'gpt-5.5'

const openai = new OpenAI() // OPENAI_API_KEY from the function's secrets

export interface ImageJob {
  prompt: string
  /** Reference images, as data URLs. */
  images?: string[]
  action: 'generate' | 'edit'
  background?: 'transparent' | 'opaque' | 'auto'
  /** WIDTHxHEIGHT, multiples of 16; 1024x1024 when left out. */
  size?: string
  inputFidelity?: 'high' | 'low'
}

/** Starts the generation in the background. Returns the job id to check. */
export async function startImageJob(job: ImageJob): Promise<string> {
  const response = await openai.responses.create({
    model: ORCHESTRATOR,
    background: true,
    reasoning: { effort: 'low' },
    instructions: 'Generate exactly one image with the image_generation tool, following the request word for word.',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: job.prompt },
          ...(job.images ?? []).map((url) => ({ type: 'input_image' as const, image_url: url, detail: 'high' as const })),
        ],
      },
    ],
    tools: [
      {
        type: 'image_generation',
        model: IMAGE_MODEL,
        action: job.action,
        size: job.size ?? '1024x1024',
        quality: 'high',
        output_format: 'png',
        background: job.background ?? 'auto',
        ...(job.inputFidelity ? { input_fidelity: job.inputFidelity } : {}),
      },
    ],
    tool_choice: { type: 'image_generation' },
  })
  return response.id
}

export type ImageJobState =
  | { status: 'running' }
  | { status: 'done'; png: Uint8Array }
  | { status: 'failed'; error: string }

export async function checkImageJob(id: string): Promise<ImageJobState> {
  const response = await openai.responses.retrieve(id)
  if (response.status === 'queued' || response.status === 'in_progress') return { status: 'running' }
  if (response.status !== 'completed') {
    return { status: 'failed', error: `${response.status}: ${response.error?.message ?? response.incomplete_details?.reason ?? ''}` }
  }
  const call = response.output.find((item) => item.type === 'image_generation_call')
  const b64 = call && 'result' in call ? call.result : null
  if (!b64) return { status: 'failed', error: 'The image model returned no image' }
  return { status: 'done', png: Uint8Array.from(atob(b64), (char) => char.charCodeAt(0)) }
}

export function dataUrl(type: string, data: Uint8Array) {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(binary)}`
}
