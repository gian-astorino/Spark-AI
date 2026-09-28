import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod'

export const MODEL = 'gpt-5.5'

const client = new OpenAI() // OPENAI_API_KEY from the function's secrets

export interface Page {
  url: string
  title?: string
  markdown: string
}

/**
 * One structured call: the answer is parsed against `schema` by the SDK, and a
 * refusal or an unparseable answer fails loudly instead of writing junk.
 */
export async function extract<T extends z.ZodType>(options: {
  name: string
  schema: T
  instructions: string
  input: string
  effort?: 'low' | 'medium' | 'high'
}): Promise<z.infer<T>> {
  const response = await client.responses.parse({
    model: MODEL,
    instructions: options.instructions,
    input: options.input,
    reasoning: { effort: options.effort ?? 'medium' },
    text: { format: zodTextFormat(options.schema, options.name) },
  })

  if (response.status === 'incomplete') {
    throw new Error(`Extraction incomplete: ${response.incomplete_details?.reason ?? 'unknown reason'}`)
  }
  if (!response.output_parsed) throw new Error('Extraction returned nothing parseable (refusal?)')
  return response.output_parsed as z.infer<T>
}

/** Pages as one delimited text block: each page says where it came from. */
export function pagesAsInput(pages: Page[]) {
  return pages
    .map((page) => `<page url="${page.url}" title="${page.title ?? ''}">\n${page.markdown}\n</page>`)
    .join('\n\n')
}
