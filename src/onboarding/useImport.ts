import { useEffect, useState } from 'react'
import { SECTIONS, type Section } from './profile.ts'
import type { ImportRequest } from './types.ts'

export type ImportStatus = 'idle' | 'running' | 'done' | 'skipped'

// Mock only: one section lands every SECTION_MS. The real scraping replaces the timer.
const SECTION_MS = 1200

export function useImport(request: ImportRequest) {
  const [status, setStatus] = useState<ImportStatus>(request.source === 'none' ? 'idle' : 'running')
  const [ready, setReady] = useState(0)

  useEffect(() => {
    if (status !== 'running') return
    if (ready === SECTIONS.length) {
      setStatus('done')
      return
    }
    const timer = setTimeout(() => setReady((n) => n + 1), SECTION_MS)
    return () => clearTimeout(timer)
  }, [status, ready])

  const sectionState = (section: Section): 'ready' | 'loading' | 'empty' => {
    const index = SECTIONS.indexOf(section)
    if (index < ready) return 'ready'
    return status === 'running' ? 'loading' : 'empty'
  }

  return { status, ready, sectionState, skip: () => setStatus('skipped') }
}
