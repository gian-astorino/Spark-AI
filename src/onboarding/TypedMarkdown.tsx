import { useEffect, useMemo, useRef } from 'react'
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

/**
 * A reply that has just arrived, its words fading in one after the other.
 * The whole text is laid out at once, invisible, so nothing moves while it
 * appears. Without motion (the owner's system setting) it shows at once.
 */
export function TypedMarkdown({ children, onDone }: { children: string; /** Once the last word is in. */ onDone?: () => void }) {
  const words = useRef(0)
  // Every word of the text becomes a span that fades in after the one before it.
  const plugins = useMemo(
    () => [
      () => (tree: TreeNode) => {
        let index = 0
        const walk = (node: TreeNode) => {
          if (!node.children) return
          node.children = node.children.flatMap((child): TreeNode[] => {
            if (child.type !== 'text' || !child.value) {
              // A list item fades in with its first word, so its bullet never shows alone.
              if (child.type === 'element' && child.tagName === 'li') {
                const classes = (child.properties?.className as string[] | undefined) ?? []
                child.properties = {
                  ...child.properties,
                  className: [...classes, 'typed-word'],
                  style: `animation-delay: ${index * WORD_MS}ms`,
                }
              }
              walk(child)
              return [child]
            }
            return child.value
              .split(/(\s+)/)
              .filter(Boolean)
              .map((part) =>
                /^\s+$/.test(part)
                  ? { type: 'text', value: part }
                  : {
                      type: 'element',
                      tagName: 'span',
                      properties: { className: ['typed-word'], style: `animation-delay: ${index++ * WORD_MS}ms` },
                      children: [{ type: 'text', value: part }],
                    },
              )
          })
        }
        walk(tree)
        words.current = index
      },
    ],
    [],
  )

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => onDone?.(), still ? 0 : words.current * WORD_MS + FADE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the text it was given
  }, [])

  return <Markdown rehypePlugins={plugins}>{children}</Markdown>
}
