import type { SupabaseClient } from '@supabase/supabase-js'
import { unzipSync, strFromU8 } from 'fflate'

// The text of a document the owner attached: a .txt as it is, a .docx from its
// XML, a PDF from its text layer. Images have none.

export type DocumentKind = 'pdf' | 'txt' | 'docx'

export function documentKind(path: string): DocumentKind | null {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension === 'pdf' || extension === 'txt' || extension === 'docx' ? extension : null
}

export async function documentText(db: SupabaseClient, path: string): Promise<string> {
  const kind = documentKind(path)
  if (!kind) throw new Error(`Not a document: ${path}`)
  const { data, error } = await db.storage.from('uploads').download(path)
  if (error || !data) throw new Error(`Attachment not found: ${path}`)
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (kind === 'txt') return new TextDecoder().decode(bytes).trim()
  if (kind === 'docx') return docxText(bytes)
  // Loaded only for PDFs: it is the heavy one.
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true })
  const result = String(text).trim()
  if (!result) throw new Error('This PDF has no text layer (a scan?): paste the text in the chat instead.')
  return result
}

/** The paragraphs of a Word file, one per line. */
function docxText(bytes: Uint8Array) {
  const files = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' })
  const xml = files['word/document.xml']
  if (!xml) throw new Error('Not a readable Word file')
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
