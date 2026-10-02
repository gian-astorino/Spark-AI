import ReactMarkdown from 'react-markdown'

/**
 * The agent's replies: bold, italics, lists and line breaks, nothing more.
 * A document (a call transcript) keeps its headings too. Images and raw HTML
 * are never rendered; links open in a new tab.
 */
export function Markdown({ children, document = false }: { children: string; document?: boolean }) {
  return (
    <div className={document ? 'markdown markdown-document' : 'markdown'}>
      <ReactMarkdown
        skipHtml
        disallowedElements={document ? ['img', 'pre'] : ['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table']}
        unwrapDisallowed
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
