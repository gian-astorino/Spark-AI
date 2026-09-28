import ReactMarkdown from 'react-markdown'

/**
 * The agent's replies: bold, italics, lists and line breaks, nothing more.
 * Images and raw HTML are not rendered; links open in a new tab.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        disallowedElements={['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table']}
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
