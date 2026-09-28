import { useEffect, useState } from 'react'
import { IMPORTABLE } from './profile.ts'
import type { ImportRequest } from './types.ts'

export type ImportStatus = 'idle' | 'running' | 'done' | 'skipped'

// Mock only: one section lands every SECTION_MS. The real scraping replaces the timer.
const SECTION_MS = 1200

export function useImport(request: ImportRequest) {
  const [status, setStatus] = useState<ImportStatus>(request.source === 'none' ? 'idle' : 'running')
  const [ready, setReady] = useState(0)

  useEffect(() => {
    if (status !== 'running') return
    if (ready === IMPORTABLE.length) {
      setStatus('done')
      return
    }
    const timer = setTimeout(() => setReady((n) => n + 1), SECTION_MS)
    return () => clearTimeout(timer)
  }, [status, ready])

  return { status, ready, skip: () => setStatus('skipped') }
}
