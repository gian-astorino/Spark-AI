import OpenAI from 'openai'
import { EXTRACTION_INSTRUCTIONS, PROFILE_SCHEMA, type PageExtraction } from './extraction.ts'

const MODEL = 'gpt-5.5'

const openai = new OpenAI() // OPENAI_API_KEY from the function's secrets

export interface Page {
  url: string
  title?: string
  markdown: string
}

/** One structured call over every page. Throws on a refusal or a cut-off answer. */
export async function extractProfile(pages: Page[]): Promise<PageExtraction> {
  const response = await openai.responses.create({
    model: MODEL,
    instructions: EXTRACTION_INSTRUCTIONS,
    input: pages
      .map((page) => `<page url="${page.url}" title="${page.title ?? ''}">\n${page.markdown}\n</page>`)
      .join('\n\n'),
    reasoning: { effort: 'low' },
    text: { format: { type: 'json_schema', name: 'business_profile', schema: PROFILE_SCHEMA, strict: true } },
  })
  if (response.status === 'incomplete') {
    throw new Error(`Extraction incomplete: ${response.incomplete_details?.reason ?? 'unknown reason'}`)
  }
  if (!response.output_text) throw new Error('Extraction returned no text (refusal?)')
  return JSON.parse(response.output_text) as PageExtraction
}
