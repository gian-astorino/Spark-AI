import Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'
import { jsonSchema } from './profile-schema.ts'

export const MODEL = 'claude-opus-5'

const client = new Anthropic() // ANTHROPIC_API_KEY from the function's secrets

/**
 * One structured call: the answer is JSON matching `schema`, validated again
 * here so a truncated or refused response fails loudly instead of writing junk.
 * `fallbacks: "default"` re-runs a policy decline on Anthropic's recommended
 * fallback model inside the same call.
 */
export async function extract<T extends z.ZodType>(options: {
  schema: T
  system: string
  content: Anthropic.Beta.BetaContentBlockParam[]
  effort?: 'low' | 'medium' | 'high'
}): Promise<z.infer<T>> {
  const response = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: {
        effort: options.effort ?? 'medium',
        format: { type: 'json_schema', schema: jsonSchema(options.schema) },
      },
      system: options.system,
      messages: [{ role: 'user', content: options.content }],
    })
    .finalMessage()

  if (response.stop_reason === 'refusal') throw new Error('Claude declined the extraction')
  if (response.stop_reason === 'max_tokens') throw new Error('Extraction was cut off (max_tokens)')

  const text = response.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') throw new Error('Extraction returned no text')
  return options.schema.parse(JSON.parse(text.text))
}
