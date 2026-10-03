import Anthropic from '@anthropic-ai/sdk'

// Claude, for everything that reads, reasons or writes. OpenAI is left with
// one job: generating images (see image-jobs.ts).

export const MODEL = 'claude-opus-5-5'

export const anthropic = new Anthropic() // ANTHROPIC_API_KEY from the function's secrets

/** Server-side refusal fallback: a request a safety classifier declines is re-run on the default fallback model. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** A file Claude can look at in this and every later request (a signed URL would expire in the history). */
export async function uploadForClaude(bytes: Uint8Array | Blob, name: string, type: string) {
  const file = await anthropic.files.upload({
    file: new File([bytes as BlobPart], name, { type }),
  })
  return file.id
}

export type VisualBlock = Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaRequestDocumentBlock

/** An image or a PDF as a content block, through the Files API. */
export async function visualBlock(bytes: Uint8Array | Blob, name: string, type: string): Promise<VisualBlock> {
  const file_id = await uploadForClaude(bytes, name, type)
  return type === 'application/pdf'
    ? { type: 'document', source: { type: 'file', file_id }, title: name }
    : { type: 'image', source: { type: 'file', file_id } }
}

/**
 * One structured answer about some images: a single request, its JSON
 * constrained by the schema. For the small judgements of the pipelines
 * (a logo's colours, whether a recreation is the same logo).
 */
export async function judge<T>(
  content: Anthropic.Beta.BetaContentBlockParam[],
  schema: Record<string, unknown>,
): Promise<T> {
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  })
  const text = response.content.find((block) => block.type === 'text')
  if (response.stop_reason === 'refusal' || !text || text.type !== 'text') throw new Error(`No answer (${response.stop_reason})`)
  return JSON.parse(text.text) as T
}

/** Base64 from bytes, in chunks (a spread of a large array overflows the stack). */
export function base64(data: Uint8Array) {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}
