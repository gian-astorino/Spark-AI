import { useState } from 'react'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Inline,
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Progress,
  Skeleton,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import {
  AiSpeechIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  AiTranscribeAudioIcon,
  BookOpen01Icon,
  Calendar05Icon,
  Location06Icon,
  PaintBoardIcon,
  PenTool03Icon,
  PlusSignIcon,
  Store04Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Icon } from './Icon.tsx'

const FOLD_KEY = 'spark.contextPanel'
import type { Editing } from './ProfileEditor.tsx'
import { SECTIONS, SECTION_TITLES, sectionProgress, type Profile, type Section } from './profile.ts'

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
  branding: 'Logo, colori e foto. Puoi allegarli in chat.',
  tone: 'Come la tua attività parla ai clienti.',
  catalog: 'Elementi di catalogo con descrizione, prezzo e durata.',
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
  // Only complete sections count: one field in does not make a section done.
  const filled = SECTIONS.filter((section) => {
    const progress = sectionProgress(profile, section)
    return progress.filled === progress.total
  }).length

  // The titled panel (the desktop one) folds up to its heading; the choice is remembered on this device.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(FOLD_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const foldable = titled
  const expanded = !foldable || open
  function toggle() {
    setOpen((current) => {
      try {
        localStorage.setItem(FOLD_KEY, current ? 'closed' : 'open')
      } catch {
        // Not remembered: it still folds for now.
      }
      return !current
    })
  }

  return (
    <div className="profile">
      <div className="profile-head" data-folded={!expanded || undefined}>
        <Stack gap={3}>
          <div className="panel-heading">
            <div>
              {titled && <h2>Contesto dell'attività</h2>}
              <p>
                {filled} di {SECTIONS.length} sezioni · tocca un dato per modificarlo
              </p>
            </div>
            {foldable && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={open ? 'Riduci il contesto' : 'Espandi il contesto'}
                title={open ? 'Riduci il contesto' : 'Espandi il contesto'}
                aria-expanded={open}
                onClick={toggle}
              >
                <Icon icon={open ? ArrowUp01Icon : ArrowDown01Icon} />
              </Button>
            )}
          </div>
          <Progress value={(filled / SECTIONS.length) * 100} />
        </Stack>
      </div>

      {expanded && (
        <>

      {SECTIONS.map((section) => {
        const state = sectionState(section)
        const progress = sectionProgress(profile, section)
        return (
          <section key={section} className="profile-section" data-state={state}>
            <div className="profile-section-head">
              <Inline gap={2} align="center">
                <Icon icon={SECTION_ICONS[section]} />
                <ItemTitle>{SECTION_TITLES[section]}</ItemTitle>
                {state === 'ready' &&
                  (progress.filled === progress.total ? (
                    <span className="badge-imported">
                      {section === 'catalog' && profile.catalog?.length
                        ? `${profile.catalog.length} ${profile.catalog.length === 1 ? 'importato' : 'importati'}`
                        : 'Importato'}
                    </span>
                  ) : (
                    <Badge variant="secondary">
                      {progress.filled} di {progress.total}
                    </Badge>
                  ))}
              </Inline>
              <Inline gap={1} align="center">
                {state === 'loading' && (
                  <Inline gap={1} align="center">
                    <Spinner />
                    <ItemDescription>Sto cercando…</ItemDescription>
                  </Inline>
                )}
                {/* No pencils: every value opens its editor when tapped. The catalog keeps its "+". */}
                {section === 'catalog' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Aggiungi elemento di catalogo"
                    title="Aggiungi elemento"
                    onClick={() => onEdit(SECTION_EDIT[section](profile))}
                  >
                    <Icon icon={PlusSignIcon} />
                  </Button>
                )}
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
              // An empty section opens its editor too, now that there is no pencil.
              <Editable label={`Aggiungi ${SECTION_TITLES[section].toLowerCase()}`} onClick={() => onEdit(SECTION_EDIT[section](profile))}>
                <ItemDescription>{EMPTY_HINT[section]}</ItemDescription>
              </Editable>
            )}
          </section>
        )
      })}

      {/* Not one of the sections that complete the profile: the calls kept so far. */}
      <section className="profile-section">
        <div className="profile-section-head">
          <Inline gap={2} align="center">
            <Icon icon={AiSpeechIcon} />
            <ItemTitle>Conversazioni</ItemTitle>
            {profile.conversations && <Badge variant="secondary">{profile.conversations.length}</Badge>}
          </Inline>
        </div>
        {profile.conversations ? (
          <Stack gap={1}>
            {profile.conversations.map((conversation) => (
              <Item key={conversation.id} asChild size="sm">
                <button type="button" className="conversation-row" onClick={() => onEdit({ kind: 'conversation', conversation })}>
                  <ItemMedia variant="icon">
                    <Icon icon={AiTranscribeAudioIcon} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{conversation.title}</ItemTitle>
                    <ItemDescription>
                      {conversation.date
                        ? new Date(`${conversation.date}T12:00:00`).toLocaleDateString('it-IT', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })
                        : conversation.summary}
                    </ItemDescription>
                  </ItemContent>
                </button>
              </Item>
            ))}
          </Stack>
        ) : (
          <ItemDescription>
            Incolla in chat il transcript di una chiamata con il cliente: Spark aggiorna il profilo e lo salva qui.
          </ItemDescription>
        )}
      </section>
        </>
      )}
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
      const b = profile.branding ?? { colors: [], tone: [] }
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
              <div className="tone-keywords">
                <Inline gap={2}>
                  {b.tone.map((word) => (
                    <Badge key={word} variant="secondary">
                      {word}
                    </Badge>
                  ))}
                </Inline>
              </div>
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
              Aggiungi elemento
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
