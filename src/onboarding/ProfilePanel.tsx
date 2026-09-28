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
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Location01Icon,
  PaintBoardIcon,
  ShoppingBag01Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Icon } from './Icon.tsx'
import { SECTIONS, SECTION_TITLES, type Profile, type Section } from './profile.ts'

export type SectionState = 'ready' | 'loading' | 'empty'

const SECTION_ICONS: Record<Section, IconSvgElement> = {
  business: Building03Icon,
  location: Location01Icon,
  branding: PaintBoardIcon,
  catalog: ShoppingBag01Icon,
  calendar: Calendar03Icon,
}

const EMPTY_HINT: Record<Section, string> = {
  business: 'Name, what you do and your sector.',
  location: 'Address and opening hours.',
  branding: 'Logo, colours and tone of voice.',
  catalog: 'Treatments with description, price and duration.',
  calendar: "Your team and the calendar you use. Spark will ask in the chat.",
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
              <ItemDescription>{EMPTY_HINT[section]}</ItemDescription>
            )}
          </section>
        )
      })}
    </div>
  )
}

function SectionBody({ section, profile }: { section: Section; profile: Profile }) {
  switch (section) {
    case 'business': {
      const b = profile.business!
      return (
        <Stack gap={2}>
          <Inline gap={2} align="center">
            {b.name && <ItemTitle>{b.name}</ItemTitle>}
            {b.sector && <Badge variant="secondary">{b.sector}</Badge>}
          </Inline>
          {b.description && <ItemDescription>{b.description}</ItemDescription>}
        </Stack>
      )
    }
    case 'location': {
      const l = profile.location!
      return (
        <Stack gap={3}>
          <ItemTitle>{l.address}</ItemTitle>
          {l.hours && <Rows rows={l.hours.map((row) => ({ label: row.days, value: row.time }))} />}
        </Stack>
      )
    }
    case 'branding': {
      const b = profile.branding!
      return (
        <Stack gap={4}>
          <Inline gap={3} align="center">
            {/* The logo and swatches are data: their colours are content, not styling. */}
            <span className="logo" style={{ background: b.logo.background, color: b.logo.foreground }}>
              {b.logo.initials}
            </span>
            <Stack gap={1}>
              <ItemTitle>Logo</ItemTitle>
              <ItemDescription>From your website header</ItemDescription>
            </Stack>
          </Inline>
          <div className="swatches">
            {b.colors.map((color) => (
              <div key={color.hex} className="swatch-card">
                <span className="swatch" style={{ background: color.hex }} />
                <ItemTitle>{color.name}</ItemTitle>
                <ItemDescription>{color.hex}</ItemDescription>
              </div>
            ))}
          </div>
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
    case 'catalog':
      return (
        <Rows
          emphasis
          rows={profile.catalog!.map((t) => ({
            label: t.name,
            detail: t.description,
            value: t.price,
            valueDetail: t.duration,
          }))}
        />
      )
    case 'calendar': {
      const c = profile.calendar!
      return (
        <Stack gap={3}>
          {c.members?.length ? (
            <Stack gap={2}>
              {c.members.map((member) => (
                <Inline key={member} gap={2} align="center">
                  <Avatar size="sm">
                    <AvatarFallback>{member[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <ItemTitle>{member}</ItemTitle>
                </Inline>
              ))}
            </Stack>
          ) : (
            <ItemDescription>Team members not set yet.</ItemDescription>
          )}
          <Rows rows={[{ label: 'Calendar', value: c.tool ?? 'Not set yet' }]} />
        </Stack>
      )
    }
  }
}

interface Row {
  label: string
  detail?: string
  value: string
  valueDetail?: string
}

/** Label on the left, value on the right: the panel's one repeated pattern. */
function Rows({ rows, emphasis = false }: { rows: Row[]; emphasis?: boolean }) {
  return (
    <dl className="rows">
      {rows.map((row) => (
        <div key={row.label} className="row" data-emphasis={emphasis ? '' : undefined}>
          <dt>
            {row.label}
            {row.detail && <small>{row.detail}</small>}
          </dt>
          <dd>
            {row.value}
            {row.valueDetail && <small>{row.valueDetail}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
