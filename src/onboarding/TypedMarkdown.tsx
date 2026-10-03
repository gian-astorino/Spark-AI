import { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from './Markdown.tsx'

/** Milliseconds between one word and the next. */
const WORD_MS = 25
/** How long a word takes to fade in (as .typed-word in app.css). */
const FADE_MS = 300

/** A node of the rendered tree, as much of it as the plugin touches. */
interface TreeNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: TreeNode[]
}

/** Elements that are whole without any text in them. */
const VOID = new Set(['br', 'hr', 'img'])

/**
 * The rendered reply up to its `shown`-th word: each word a span that fades
 * in as it arrives, and whatever holds no word yet (a paragraph, a list item
 * and its bullet) left out until its first word does. The words already on
 * screen stay as they are, so only the new one fades.
 */
function upToWord(shown: number, total: { current: number }) {
  return () => (tree: TreeNode) => {
    let index = 0
    const walk = (node: TreeNode): boolean => {
      if (!node.children) return node.type !== 'element' || VOID.has(node.tagName ?? '')
      node.children = node.children.flatMap((child): TreeNode[] => {
        if (child.type === 'text' && child.value) {
          return child.value
            .split(/(\s+)/)
            .filter(Boolean)
            .flatMap((part): TreeNode[] => {
              if (/^\s+$/.test(part)) return [{ type: 'text', value: part }]
              const visible = index < shown
              index++
              return visible
                ? [{ type: 'element', tagName: 'span', properties: { className: ['typed-word'] }, children: [{ type: 'text', value: part }] }]
                : []
            })
        }
        if (!walk(child)) return []
        // A list item fades in with its first word, so its bullet never shows alone.
        if (child.type === 'element' && child.tagName === 'li') {
          const classes = (child.properties?.className as string[] | undefined) ?? []
          child.properties = { ...child.properties, className: [...classes, 'typed-word'] }
        }
        return [child]
      })
      // An element is kept once it holds a word (whitespace alone does not count).
      return node.children.some((child) => child.type === 'element' || (child.type === 'text' && !!child.value?.trim()))
    }
    walk(tree)
    total.current = index
  }
}

/**
 * A reply that has just arrived, growing word by word, each one fading in.
 * Without motion (the owner's system setting) it shows whole at once.
 */
export function TypedMarkdown({ children, onDone }: { children: string; /** Once the last word is in. */ onDone?: () => void }) {
  const total = useRef(Number.POSITIVE_INFINITY)
  const [shown, setShown] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? Number.POSITIVE_INFINITY : 1,
  )
  const plugins = useMemo(() => [upToWord(shown, total)], [shown])

  useEffect(() => {
    if (shown >= total.current) {
      const timer = setTimeout(() => onDone?.(), Number.isFinite(shown) ? FADE_MS : 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setShown((count) => count + 1), WORD_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone is called once, when the last word is in
  }, [shown])

  return <Markdown rehypePlugins={plugins}>{children}</Markdown>
}
