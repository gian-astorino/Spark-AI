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
  onSkip,
}: {
  label: string
  status: MarkerStatus
  pagesRead: number
  pagesTotal: number
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
              <ItemTitle>Reading {label}</ItemTitle>
              <ItemDescription>
                {counted ? `${pagesRead} of ${pagesTotal} pages` : 'Opening the site…'} · this can take a couple of
                minutes
              </ItemDescription>
            </Stack>
            <Progress value={counted ? (pagesRead / pagesTotal) * 100 : 0} />
          </Stack>
        </ItemContent>
        <ItemActions>
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
        </ItemActions>
      </Item>
    )
  }

  const view = {
    done: { icon: CheckmarkCircle02Icon, title: `Read ${pagesRead} ${pagesRead === 1 ? 'page' : 'pages'} from ${label}` },
    failed: { icon: Alert02Icon, title: `Couldn't read ${label}` },
    skipped: { icon: Cancel01Icon, title: `Stopped reading ${label}` },
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
