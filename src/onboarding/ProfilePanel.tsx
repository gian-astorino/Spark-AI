import { useEffect } from 'react'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Inline,
  ItemDescription,
  ItemTitle,
  Progress,
  Skeleton,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import {
  BookOpen01Icon,
  Calendar05Icon,
  Edit03Icon,
  Location06Icon,
  PaintBoardIcon,
  PenTool03Icon,
  PlusSignIcon,
  Store04Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Icon } from './Icon.tsx'
import type { Editing } from './ProfileEditor.tsx'
import { SECTIONS, SECTION_TITLES, type Profile, type Section } from './profile.ts'

export type SectionState = 'ready' | 'loading' | 'empty'

const SECTION_ICONS: Record<Section, IconSvgElement> = {
  business: Store04Icon,
  location: Location06Icon,
  branding: PaintBoardIcon,
  tone: PenTool03Icon,
  catalog: BookOpen01Icon,
  calendar: Calendar05Icon,
}

const EMPTY_HINT: Record<Section, string> = {
  business: 'Nome, di cosa ti occupi e settore.',
  location: 'Indirizzo e orari di apertura.',
  branding: 'Logo, colori, font e foto. Puoi allegarli in chat.',
  tone: 'Come la tua attività parla ai clienti.',
  catalog: 'Trattamenti con descrizione, prezzo e durata.',
  calendar: 'Il tuo team e il calendario che usi. Spark te lo chiederà in chat.',
}

/** What the pencil of each section opens. */
const SECTION_EDIT: Record<Section, (profile: Profile) => Editing> = {
  business: () => ({ kind: 'business' }),
  location: (profile) => ({ kind: 'location', location: profile.locations?.[0] }),
  branding: () => ({ kind: 'branding' }),
  tone: () => ({ kind: 'tone' }),
  catalog: () => ({ kind: 'catalog' }),
  calendar: () => ({ kind: 'calendar' }),
}

export function ProfilePanel({
  profile,
  sectionState,
  onEdit,
  titled = true,
}: {
  profile: Profile
  sectionState: (section: Section) => SectionState
  /** Opens the editor: a pencil or any value in the panel. */
  onEdit: (editing: Editing) => void
  /** False inside the sheet, whose own header already names the panel. */
  titled?: boolean
}) {
  const filled = SECTIONS.filter((section) => sectionState(section) === 'ready').length

  return (
    <div className="profile">
      <div className="profile-head">
        <Stack gap={3}>
          <div className="panel-heading">
            {titled && <h2>Profilo dell'attività</h2>}
            <p>
              {filled} di {SECTIONS.length} sezioni · tocca un dato per modificarlo
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
                {state === 'ready' && <span className="badge-imported">Importato</span>}
              </Inline>
              <Inline gap={1} align="center">
                {state === 'loading' && <Spinner />}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Modifica ${SECTION_TITLES[section].toLowerCase()}`}
                  title="Modifica"
                  onClick={() => onEdit(SECTION_EDIT[section](profile))}
                >
                  <Icon icon={section === 'catalog' ? PlusSignIcon : Edit03Icon} />
                </Button>
              </Inline>
            </div>
            {state === 'ready' ? (
              <SectionBody section={section} profile={profile} onEdit={onEdit} />
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

/** A value in the panel that opens its editor when tapped. */
function Editable({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="editable" aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}

function SectionBody({ section, profile, onEdit }: { section: Section; profile: Profile; onEdit: (editing: Editing) => void }) {
  switch (section) {
    case 'business': {
      const b = profile.business!
      return (
        <Editable label="Modifica attività" onClick={() => onEdit({ kind: 'business' })}>
          <Stack gap={2}>
            <Inline gap={2} align="center">
              {b.name && <ItemTitle>{b.name}</ItemTitle>}
              {b.sector && <Badge variant="secondary">{b.sector}</Badge>}
            </Inline>
            {b.description && <ItemDescription>{b.description}</ItemDescription>}
          </Stack>
        </Editable>
      )
    }
    case 'location':
      return (
        <Stack gap={3}>
          {profile.locations!.map((location) => (
            <Editable key={location.id} label={`Modifica ${location.address}`} onClick={() => onEdit({ kind: 'location', location })}>
              <Stack gap={3}>
                <Stack gap={1}>
                  {location.name && <ItemTitle>{location.name}</ItemTitle>}
                  <ItemTitle>{location.address}</ItemTitle>
                </Stack>
                {location.hours.length > 0 ? (
                  <Rows rows={location.hours.map((row) => ({ label: row.days, value: row.time }))} />
                ) : (
                  <ItemDescription>Orari non ancora trovati.</ItemDescription>
                )}
              </Stack>
            </Editable>
          ))}
          <Inline>
            <Button variant="outline" size="sm" onClick={() => onEdit({ kind: 'location' })}>
              <Icon icon={PlusSignIcon} />
              Aggiungi sede
            </Button>
          </Inline>
        </Stack>
      )
    case 'branding': {
      // Photos alone make the section ready, without any branding from a site.
      const b = profile.branding ?? { colors: [], fonts: [], tone: [] }
      const edit = () => onEdit({ kind: 'branding' })
      return (
        <Stack gap={4}>
          {b.logoPending ? (
            <Inline gap={3} align="center">
              {/* Not the original: the recreated logo takes its place in a minute or two. */}
              <span className="logo logo-loading" aria-hidden>
                <Spinner />
              </span>
              <Stack gap={1}>
                <ItemTitle>Logo</ItemTitle>
                <ItemDescription>Sto ottimizzando il logo…</ItemDescription>
              </Stack>
            </Inline>
          ) : (
            b.logoUrl && (
              <Inline gap={3} align="center">
                <button type="button" className="logo-button" aria-label="Vedi il logo" onClick={() => onEdit({ kind: 'logo' })}>
                  <img className="logo" src={b.logoUrl} alt="Logo" />
                </button>
                <Stack gap={1}>
                  <ItemTitle>Logo</ItemTitle>
                  <ItemDescription>Tocca per vederlo</ItemDescription>
                </Stack>
              </Inline>
            )
          )}
          {b.boardPending ? (
            <Stack gap={2}>
              <ItemDescription>Branding</ItemDescription>
              <span className="board board-loading">
                <Spinner />
                <ItemDescription>Sto creando il branding…</ItemDescription>
              </span>
            </Stack>
          ) : (
            b.boardUrl && (
              <Stack gap={2}>
                <ItemDescription>Branding</ItemDescription>
                <button type="button" className="logo-button" aria-label="Vedi il branding" onClick={() => onEdit({ kind: 'board' })}>
                  <img className="board" src={b.boardUrl} alt="Branding" />
                </button>
              </Stack>
            )
          )}
          <Editable label="Modifica branding" onClick={edit}>
            <Stack gap={4}>
              {b.colors.length > 0 && (
                <div className="swatches">
                  {b.colors.map((color) => (
                    <div key={color.hex + color.name} className="swatch-card">
                      {/* A data swatch: the colour is content, not styling. */}
                      <span className="swatch" style={{ background: color.hex }} />
                      <ItemTitle>{color.name}</ItemTitle>
                      <ItemDescription>{color.hex}</ItemDescription>
                    </div>
                  ))}
                </div>
              )}
              {b.fonts.length > 0 && (
                <Stack gap={2}>
                  <ItemDescription>Font</ItemDescription>
                  {b.fonts.map((font) => (
                    <FontSample key={font.role} role={font.role} family={font.family} />
                  ))}
                </Stack>
              )}
            </Stack>
          </Editable>
          {profile.photos && profile.photos.length > 0 && (
            <Stack gap={2}>
              <ItemDescription>Foto</ItemDescription>
              <div className="photos">
                {profile.photos.map((photo) => (
                  <img key={photo.url} src={photo.url} alt={photo.caption ?? "Foto dell'attività"} title={photo.caption} />
                ))}
              </div>
            </Stack>
          )}
        </Stack>
      )
    }
    case 'tone': {
      const b = profile.branding!
      return (
        <Editable label="Modifica tono di voce" onClick={() => onEdit({ kind: 'tone' })}>
          <Stack gap={2}>
            {b.toneDescription && <p className="tone">{b.toneDescription}</p>}
            {b.tone.length > 0 && (
              <Inline gap={2}>
                {b.tone.map((word) => (
                  <Badge key={word} variant="secondary">
                    {word}
                  </Badge>
                ))}
              </Inline>
            )}
          </Stack>
        </Editable>
      )
    }
    case 'catalog':
      return (
        <Stack gap={3}>
          <div className="rows">
            {profile.catalog!.map((item) => (
              <Editable key={item.id} label={`Modifica ${item.name}`} onClick={() => onEdit({ kind: 'catalog', item })}>
                <span className="row" data-emphasis="">
                  <span className="row-label">
                    {item.name}
                    {item.category && <small>{item.category}</small>}
                  </span>
                  <span className="row-value">
                    {item.price ?? '—'}
                    {item.duration && <small>{item.duration}</small>}
                  </span>
                </span>
              </Editable>
            ))}
          </div>
          <Inline>
            <Button variant="outline" size="sm" onClick={() => onEdit({ kind: 'catalog' })}>
              <Icon icon={PlusSignIcon} />
              Aggiungi trattamento
            </Button>
          </Inline>
        </Stack>
      )
    case 'calendar': {
      const c = profile.calendar!
      return (
        <Editable label="Modifica calendario" onClick={() => onEdit({ kind: 'calendar' })}>
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
              <ItemDescription>Team non ancora indicato.</ItemDescription>
            )}
            <Rows rows={[{ label: 'Calendario', value: c.tool ?? 'Non ancora indicato' }]} />
          </Stack>
        </Editable>
      )
    }
  }
}

/**
 * The font's name written in the font itself. Loaded from Google Fonts, where
 * most site fonts live; when it is not there the name falls back to the
 * system font and still reads fine.
 */
function FontSample({ role, family }: { role: 'heading' | 'body'; family: string }) {
  useEffect(() => {
    const id = `font-${family.replace(/\W+/g, '-')}`
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`
    document.head.append(link)
  }, [family])

  return (
    <div className="font-sample">
      {/* The family is content: the sample shows the brand's font, not ours. */}
      <span className="font-sample-name" style={{ fontFamily: `"${family}", var(--font-sans)` }}>
        {family}
      </span>
      <ItemDescription>{role === 'heading' ? 'Titoli' : 'Testo'}</ItemDescription>
    </div>
  )
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
