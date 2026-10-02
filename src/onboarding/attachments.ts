import { Doc01Icon, Pdf01Icon, Txt01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'

// What the owner can attach in the chat: images, and documents — a PDF, a
// text file or a Word file (a price list, a call transcript…).

const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']

const DOCUMENTS = {
  pdf: { type: 'application/pdf', icon: Pdf01Icon },
  txt: { type: 'text/plain', icon: Txt01Icon },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', icon: Doc01Icon },
} as const satisfies Record<string, { type: string; icon: IconSvgElement }>

type DocumentKind = keyof typeof DOCUMENTS

/** For the file picker: by type and by extension, as some systems give a .txt or .docx no type. */
export const ACCEPT = [...IMAGES, ...Object.values(DOCUMENTS).map((doc) => doc.type), ...Object.keys(DOCUMENTS).map((ext) => `.${ext}`)].join(',')

/** A document's kind, or null for an image (or anything else). */
export function documentKind(file: File): DocumentKind | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  for (const [kind, doc] of Object.entries(DOCUMENTS) as [DocumentKind, (typeof DOCUMENTS)[DocumentKind]][]) {
    if (file.type === doc.type || extension === kind) return kind
  }
  return null
}

export function isAccepted(file: File) {
  return IMAGES.includes(file.type) || documentKind(file) !== null
}

export function documentIcon(file: File): IconSvgElement {
  return DOCUMENTS[documentKind(file) ?? 'pdf'].icon
}

/** The type to store it with: the browser's, or the one its extension stands for. */
export function contentType(file: File) {
  const kind = documentKind(file)
  return kind ? DOCUMENTS[kind].type : file.type
}
