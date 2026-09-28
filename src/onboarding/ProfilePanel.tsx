import {
  Avatar,
  AvatarFallback,
  Badge,
  Inline,
  ItemDescription,
  ItemTitle,
  Progress,
  Skeleton,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import {
  Building03Icon,
  CheckmarkCircle02Icon,
  Location01Icon,
  PaintBoardIcon,
  ShoppingBag01Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Icon } from './Icon.tsx'
import { SECTIONS, SECTION_TITLES, type Profile, type Section } from './profile.ts'

type SectionState = 'ready' | 'loading' | 'empty'

const SECTION_ICONS: Record<Section, IconSvgElement> = {
  company: Building03Icon,
  branding: PaintBoardIcon,
  locations: Location01Icon,
  catalog: ShoppingBag01Icon,
}

export function ProfilePanel({
  profile,
  sectionState,
}: {
  profile: Profile
  sectionState: (section: Section) => SectionState
}) {
  const filled = SECTIONS.filter((section) => sectionState(section) === 'ready').length

  return (
    <div className="profile">
      <div className="profile-head">
        <Stack gap={3}>
          <div className="panel-heading">
            <h2>Business profile</h2>
            <p>
              {filled} of {SECTIONS.length} sections
            </p>
          </div>
          <Progress value={(filled / SECTIONS.length) * 100} />
        </Stack>
      </div>

      {SECTIONS.map((section) => {
        const state = sectionState(section)
        return (
          <section key={section} className="profile-section" data-state={state}>
            <div className="profile-section-head">
              <Inline gap={2} align="center">
                <Icon icon={SECTION_ICONS[section]} />
                <ItemTitle>{SECTION_TITLES[section]}</ItemTitle>
              </Inline>
              {state === 'ready' ? <Icon icon={CheckmarkCircle02Icon} /> : state === 'loading' ? <Spinner /> : null}
            </div>
            {state === 'ready' ? (
              <SectionBody section={section} profile={profile} />
            ) : state === 'loading' ? (
              <Stack gap={2}>
                <Skeleton width="full" />
                <Skeleton width="md" />
              </Stack>
            ) : (
              <ItemDescription>Spark will fill this in as you chat.</ItemDescription>
            )}
          </section>
        )
      })}
    </div>
  )
}

function SectionBody({ section, profile }: { section: Section; profile: Profile }) {
  switch (section) {
    case 'company': {
      const c = profile.company
      return (
        <Stack gap={4}>
          <Inline gap={3} align="center">
            <Avatar size="lg">
              <AvatarFallback>{initials(c.name)}</AvatarFallback>
            </Avatar>
            <Stack gap={1}>
              <ItemTitle>{c.name}</ItemTitle>
              <ItemDescription>Since {c.founded}</ItemDescription>
            </Stack>
          </Inline>
          <ItemDescription>{c.description}</ItemDescription>
          <Rows
            rows={[
              ['Phone', c.phone],
              ['Email', c.email],
              ['Source', c.source],
            ]}
          />
        </Stack>
      )
    }
    case 'branding': {
      const b = profile.branding
      return (
        <Stack gap={4}>
          <div className="swatches">
            {b.colors.map((color) => (
              <div key={color.hex} className="swatch-card">
                {/* A data swatch: the colour is content, not styling. */}
                <span className="swatch" style={{ background: color.hex }} />
                <ItemTitle>{color.name}</ItemTitle>
                <ItemDescription>{color.hex}</ItemDescription>
              </div>
            ))}
          </div>
          <Rows rows={[['Fonts', b.fonts.join(' · ')]]} />
          <Inline gap={2}>
            {b.tone.map((word) => (
              <Badge key={word} variant="secondary">
                {word}
              </Badge>
            ))}
          </Inline>
        </Stack>
      )
    }
    case 'locations':
      return (
        <Stack gap={4}>
          {profile.locations.map((location) => (
            <Stack key={location.name} gap={2}>
              <Stack gap={1}>
                <ItemTitle>{location.name}</ItemTitle>
                <ItemDescription>{location.address}</ItemDescription>
              </Stack>
              <Rows rows={location.hours.map((row) => [row.days, row.time])} />
            </Stack>
          ))}
        </Stack>
      )
    case 'catalog':
      return (
        <Rows
          rows={profile.catalog.map((product) => [product.name, product.price])}
          details={profile.catalog.map((product) => product.category)}
        />
      )
  }
}

/** Label on the left, value on the right: the panel's one repeated pattern. */
function Rows({ rows, details }: { rows: [string, string][]; details?: string[] }) {
  return (
    <dl className="rows">
      {rows.map(([label, value], index) => (
        <div key={label} className="row" data-emphasis={details ? '' : undefined}>
          <dt>
            {label}
            {details && <small>{details[index]}</small>}
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
}
