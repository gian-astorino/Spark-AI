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
import { Cancel01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { Icon } from './Icon.tsx'
import { IMPORTABLE, SECTION_TITLES } from './profile.ts'
import type { ImportStatus } from './useImport.ts'

/** The import, shown inline in the conversation like a tool call. */
export function ImportMarker({
  label,
  status,
  ready,
  onSkip,
}: {
  label: string
  status: ImportStatus
  ready: number
  onSkip: () => void
}) {
  if (status !== 'running') {
    const done = status === 'done'
    return (
      <Item variant="outline" size="sm">
        <ItemMedia variant="icon">
          <Icon icon={done ? CheckmarkCircle02Icon : Cancel01Icon} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{done ? `Imported from ${label}` : `Import from ${label} skipped`}</ItemTitle>
          {done && <ItemDescription>{IMPORTABLE.map((s) => SECTION_TITLES[s]).join(' · ')}</ItemDescription>}
        </ItemContent>
      </Item>
    )
  }

  const current = IMPORTABLE[Math.min(ready, IMPORTABLE.length - 1)]
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <Spinner />
      </ItemMedia>
      <ItemContent>
        <Stack gap={2}>
          <Stack gap={1}>
            <ItemTitle>Importing from {label}</ItemTitle>
            <ItemDescription>
              Reading {SECTION_TITLES[current].toLowerCase()}… {ready} of {IMPORTABLE.length}
            </ItemDescription>
          </Stack>
          <Progress value={(ready / IMPORTABLE.length) * 100} />
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
