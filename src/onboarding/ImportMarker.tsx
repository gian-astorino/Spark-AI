import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Spinner,
} from '@skyground-media/pipelean-design-system'
import { Cancel01Icon, CheckmarkCircle02Icon, MinusSignCircleIcon } from '@hugeicons/core-free-icons'
import { Icon } from './Icon.tsx'
import { SECTIONS, SECTION_TITLES, type Section } from './profile.ts'
import type { ImportStatus } from './useImport.ts'

/** The import, shown inline in the conversation like a tool call. */
export function ImportMarker({
  label,
  status,
  sectionState,
  onSkip,
}: {
  label: string
  status: ImportStatus
  sectionState: (section: Section) => 'ready' | 'loading' | 'empty'
  onSkip: () => void
}) {
  const title =
    status === 'running' ? `Importing from ${label}` : status === 'done' ? `Imported from ${label}` : `Import from ${label} skipped`

  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        {status === 'running' ? <Spinner /> : <Icon icon={status === 'done' ? CheckmarkCircle02Icon : Cancel01Icon} />}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemGroup>
          {SECTIONS.map((section) => {
            const state = sectionState(section)
            return (
              <Item key={section} size="xs">
                <ItemMedia variant="icon">
                  {state === 'ready' ? (
                    <Icon icon={CheckmarkCircle02Icon} />
                  ) : state === 'loading' ? (
                    <Spinner />
                  ) : (
                    <Icon icon={MinusSignCircleIcon} />
                  )}
                </ItemMedia>
                <ItemContent>
                  <ItemDescription>{SECTION_TITLES[section]}</ItemDescription>
                </ItemContent>
              </Item>
            )
          })}
        </ItemGroup>
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
