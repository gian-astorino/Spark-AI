import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Spinner,
} from '@skyground-media/pipelean-design-system'
import { Alert02Icon, Cancel01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { Icon } from './Icon.tsx'
import type { ImportStatus } from './useImport.ts'

/** The crawl, shown inline in the conversation like a tool call. */
export function ImportMarker({
  label,
  status,
  pagesRead,
  onSkip,
}: {
  label: string
  status: ImportStatus
  pagesRead: number
  onSkip: () => void
}) {
  const view = {
    running: { icon: null, title: `Reading ${label}`, detail: 'Pages, logo, colours and fonts. This takes up to a minute.' },
    done: { icon: CheckmarkCircle02Icon, title: `Read ${pagesRead} ${pagesRead === 1 ? 'page' : 'pages'} from ${label}`, detail: 'Logo, colours and fonts saved' },
    failed: { icon: Alert02Icon, title: `Couldn't read ${label}`, detail: 'The site did not answer, or blocked us' },
    skipped: { icon: Cancel01Icon, title: `Import from ${label} skipped`, detail: undefined },
    idle: { icon: null, title: '', detail: undefined },
  }[status]

  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">{view.icon ? <Icon icon={view.icon} /> : <Spinner />}</ItemMedia>
      <ItemContent>
        <ItemTitle>{view.title}</ItemTitle>
        {view.detail && <ItemDescription>{view.detail}</ItemDescription>}
      </ItemContent>
      {status === 'running' && (
        <ItemActions>
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
        </ItemActions>
      )}
    </Item>
  )
}
