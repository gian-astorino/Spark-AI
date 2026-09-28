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
import { Icon } from './Icon.tsx'

export type MarkerStatus = 'starting' | 'running' | 'done' | 'failed' | 'skipped'

/** An import, shown inline in the conversation like a tool call. */
export function ImportMarker({
  label,
  status,
  pagesRead,
  pagesTotal,
  activity,
  onSkip,
}: {
  label: string
  status: MarkerStatus
  pagesRead: number
  pagesTotal: number
  /** What the research is doing right now. */
  activity?: string
  onSkip: () => void
}) {
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
        <ItemTitle>{view.title}</ItemTitle>
      </ItemContent>
    </Item>
  )
}
