import { useState } from 'react'
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Progress,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import { Alert02Icon, Cancel01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import type { ImportSource } from './backend.ts'
import { Icon } from './Icon.tsx'

export type MarkerStatus = 'starting' | 'running' | 'done' | 'failed' | 'skipped'

/** An import, shown inline in the conversation like a tool call. */
export function ImportMarker({
  label,
  status,
  pagesRead,
  pagesTotal,
  activity,
  sources = [],
  onSkip,
}: {
  label: string
  status: MarkerStatus
  pagesRead: number
  pagesTotal: number
  /** What the research is doing right now. */
  activity?: string
  /** Pages read and searches made, shown once it is over. */
  sources?: ImportSource[]
  onSkip: () => void
}) {
  const [showSources, setShowSources] = useState(false)
  if (status === 'starting' || status === 'running') {
    const counted = status === 'running' && pagesTotal > 0
    return (
      <Item variant="outline" size="sm">
        <ItemMedia variant="icon">
          <Spinner />
        </ItemMedia>
        <ItemContent>
          <Stack gap={2}>
            <Stack gap={1}>
              <ItemTitle>Sto cercando informazioni su {label}</ItemTitle>
              <ItemDescription>{activity ?? 'Apro il link'}…</ItemDescription>
              <ItemDescription>
                {pagesRead} {pagesRead === 1 ? 'pagina letta' : 'pagine lette'} · può richiedere qualche minuto
              </ItemDescription>
            </Stack>
            <Progress value={counted ? (pagesRead / pagesTotal) * 100 : 0} />
          </Stack>
        </ItemContent>
        <ItemActions>
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Salta
          </Button>
        </ItemActions>
      </Item>
    )
  }

  const view = {
    done: { icon: CheckmarkCircle02Icon, title: `Ricerca su ${label} completata: ${pagesRead} ${pagesRead === 1 ? 'pagina letta' : 'pagine lette'}` },
    failed: { icon: Alert02Icon, title: `Non sono riuscito a leggere ${label}` },
    skipped: { icon: Cancel01Icon, title: `Ricerca su ${label} interrotta` },
  }[status]

  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <Icon icon={view.icon} />
      </ItemMedia>
      <ItemContent>
        <Stack gap={2}>
          <ItemTitle>{view.title}</ItemTitle>
          {sources.length > 0 && (
            <Button variant="link" size="xs" onClick={() => setShowSources((open) => !open)}>
              {showSources ? 'Nascondi le fonti' : `Vedi le fonti (${sources.length})`}
            </Button>
          )}
          {showSources && (
            <ol className="sources">
              {sources.map((source, index) => (
                <li key={index}>
                  <span className="source-kind">{SOURCE_KINDS[source.kind]}</span>{' '}
                  {source.kind === 'page' || source.kind === 'branding' ? (
                    <a href={source.value} target="_blank" rel="noreferrer">
                      {source.value.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  ) : (
                    <span>“{source.value}”</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Stack>
      </ItemContent>
    </Item>
  )
}

const SOURCE_KINDS: Record<ImportSource['kind'], string> = {
  page: 'Pagina',
  search: 'Ricerca web',
  images: 'Ricerca immagini',
  branding: 'Branding',
}
