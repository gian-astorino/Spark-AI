import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Inline,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Separator,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@skyground-media/pipelean-design-system'
import { SECTIONS, SECTION_TITLES, type Profile, type Section } from './profile.ts'

type SectionState = 'ready' | 'loading' | 'empty'

export function ProfilePanel({
  profile,
  sectionState,
}: {
  profile: Profile
  sectionState: (section: Section) => SectionState
}) {
  return (
    <Stack gap={4}>
      {SECTIONS.map((section) => {
        const state = sectionState(section)
        return (
          <Card key={section} size="sm">
            <CardHeader>
              <CardTitle>{SECTION_TITLES[section]}</CardTitle>
              <CardAction>
                <StateBadge state={state} />
              </CardAction>
            </CardHeader>
            <CardContent>
              {state === 'ready' ? (
                <SectionBody section={section} profile={profile} />
              ) : state === 'loading' ? (
                <Stack gap={2}>
                  <Skeleton width="full" />
                  <Skeleton width="md" />
                  <Skeleton width="sm" />
                </Stack>
              ) : (
                <CardDescription>Spark will fill this in as you chat.</CardDescription>
              )}
            </CardContent>
          </Card>
        )
      })}
    </Stack>
  )
}

function StateBadge({ state }: { state: SectionState }) {
  if (state === 'ready') return <Badge variant="secondary">Imported</Badge>
  if (state === 'loading') return <Badge variant="outline">Importing…</Badge>
  return <Badge variant="outline">Empty</Badge>
}

function SectionBody({ section, profile }: { section: Section; profile: Profile }) {
  switch (section) {
    case 'company': {
      const c = profile.company
      return (
        <Stack gap={3}>
          <Fact label="Name" value={c.name} />
          <Fact label="About" value={c.description} />
          <Fact label="Founded" value={c.founded} />
          <Fact label="Contacts" value={`${c.phone} · ${c.email}`} />
          <Fact label="Source" value={c.source} />
        </Stack>
      )
    }
    case 'branding': {
      const b = profile.branding
      return (
        <Stack gap={3}>
          <Stack gap={2}>
            <ItemDescription>Colors</ItemDescription>
            <Inline gap={3}>
              {b.colors.map((color) => (
                <Inline key={color.hex} gap={2} align="center">
                  {/* A data swatch: the colour is content, not styling. */}
                  <span className="swatch" style={{ background: color.hex }} />
                  <ItemTitle>{color.name}</ItemTitle>
                </Inline>
              ))}
            </Inline>
          </Stack>
          <Fact label="Fonts" value={b.fonts.join(', ')} />
          <Stack gap={2}>
            <ItemDescription>Tone of voice</ItemDescription>
            <Inline gap={2}>
              {b.tone.map((word) => (
                <Badge key={word} variant="secondary">
                  {word}
                </Badge>
              ))}
            </Inline>
          </Stack>
        </Stack>
      )
    }
    case 'locations':
      return (
        <Stack gap={4}>
          {profile.locations.map((location, index) => (
            <Stack key={location.name} gap={2}>
              {index > 0 && <Separator />}
              <Fact label={location.name} value={location.address} />
              <Table>
                <TableBody>
                  {location.hours.map((row) => (
                    <TableRow key={row.days}>
                      <TableCell>{row.days}</TableCell>
                      <TableCell align="end">{row.time}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          ))}
        </Stack>
      )
    case 'catalog':
      return (
        <ItemGroup>
          {profile.catalog.map((product) => (
            <Item key={product.name} size="xs">
              <ItemContent>
                <ItemTitle>{product.name}</ItemTitle>
                <ItemDescription>{product.category}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ItemTitle>{product.price}</ItemTitle>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={1}>
      <ItemDescription>{label}</ItemDescription>
      <ItemTitle>{value}</ItemTitle>
    </Stack>
  )
}
