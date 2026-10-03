import { useEffect, useState } from 'react'
import { Markdown } from './Markdown.tsx'

/** Milliseconds per word: quick, but readable as it arrives. */
const WORD_MS = 18

/**
 * A reply that has just arrived, written out word by word. Without motion
 * (the owner's system setting) it is shown whole at once.
 */
export function TypedMarkdown({ children }: { children: string }) {
  // Words with the spaces and line breaks that follow them, so the Markdown is rebuilt as written.
  const [words] = useState(() => children.match(/\S+\s*|\s+/g) ?? [])
  const [count, setCount] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? words.length : 0,
  )

  useEffect(() => {
    if (count >= words.length) return
    const timer = setTimeout(() => setCount((shown) => shown + 1), WORD_MS)
    return () => clearTimeout(timer)
  }, [count, words.length])

  return <Markdown>{count >= words.length ? children : words.slice(0, count).join('')}</Markdown>
}
