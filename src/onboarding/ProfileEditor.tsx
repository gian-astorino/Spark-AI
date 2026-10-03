import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Inline,
  Input,
  NativeSelect,
  NativeSelectOption,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@skyground-media/pipelean-design-system'
import { CALENDARS } from './backend.ts'
import {
  deleteCatalogItem,
  deleteLocation,
  formatDay,
  parseDay,
  saveBranding,
  saveBusiness,
  saveCalendar,
  saveCatalogItem,
  saveLocation,
  saveTone,
} from './edits.ts'
import { Markdown } from './Markdown.tsx'
import type { CatalogItem, Conversation, Location, Profile } from './profile.ts'

/** What is being edited: a section, one location or catalog item, or the logo to look at. */
export type Editing =
  | { kind: 'business' }
  | { kind: 'location'; location?: Location }
  | { kind: 'branding' }
  | { kind: 'tone' }
  | { kind: 'catalog'; item?: CatalogItem }
  | { kind: 'calendar' }
  | { kind: 'logo' }
  | { kind: 'conversation'; conversation: Conversation }

const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
const BRAND_COLOR_NAMES = ['Primary', 'Secondary', 'Accent']

export function ProfileEditor({
  editing,
  profile,
  businessId,
  onClose,
  onSaved,
}: {
  editing: Editing | null
  profile: Profile
  businessId: () => Promise<string>
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      {editing && (
        <DialogContent>
          {editing.kind === 'logo' ? (
            <LogoView url={profile.branding?.logoUrl} />
          ) : editing.kind === 'conversation' ? (
            <ConversationView conversation={editing.conversation} />
          ) : (
            <Form key={formKey(editing)} editing={editing} profile={profile} businessId={businessId} onDone={onSaved} />
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}

function formKey(editing: Editing) {
  if (editing.kind === 'location') return `location-${editing.location?.id ?? 'new'}`
  if (editing.kind === 'catalog') return `catalog-${editing.item?.id ?? 'new'}`
  return editing.kind
}

function LogoView({ url }: { url?: string }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Logo</DialogTitle>
        <DialogDescription>Per cambiarlo, allega il nuovo logo in chat.</DialogDescription>
      </DialogHeader>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" title="Apri a piena risoluzione">
          <img className="image-large logo-large" src={url} alt="Logo" />
        </a>
      )}
    </>
  )
}

/** A call transcript, as the document it was kept as: the AI's recap in one tab, the transcript in the other. */
function ConversationView({ conversation }: { conversation: Conversation }) {
  // The document opens with its own title: the dialog's title names it, so it is not repeated.
  const body = conversation.document.replace(/^# .*\n+/, '')
  const cut = body.indexOf('## Trascrizione')
  const recap = cut === -1 ? body : body.slice(0, cut).trim()
  const transcript = cut === -1 ? '' : body.slice(cut).replace(/^## Trascrizione\n+/, '')
  return (
    <>
      <DialogHeader>
        <DialogTitle>{conversation.title}</DialogTitle>
        <DialogDescription>Trascrizione di una chiamata, con sintesi e prossimi passi.</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="recap">
        <TabsList>
          <TabsTrigger value="recap">Riepilogo</TabsTrigger>
          <TabsTrigger value="transcript" disabled={!transcript}>
            Trascrizione
          </TabsTrigger>
        </TabsList>
        <TabsContent value="recap">
          <div className="conversation-document">
            <Markdown document>{recap}</Markdown>
          </div>
        </TabsContent>
        <TabsContent value="transcript">
          <div className="conversation-document">
            <Markdown document>{transcript}</Markdown>
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}

/** One form per kind; each keeps its own draft and saves or deletes as a whole. */
function Form({
  editing,
  profile,
  businessId,
  onDone,
}: {
  editing: Exclude<Editing, { kind: 'logo' } | { kind: 'conversation' }>
  profile: Profile
  businessId: () => Promise<string>
  onDone: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function act(action: (id: string) => Promise<void>) {
    setSaving(true)
    setError(null)
    try {
      await action(await businessId())
      onDone()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }

  const footer = (onSave: () => void, onDelete?: () => void) => (
    <DialogFooter>
      {error && <FieldError>{error}</FieldError>}
      <Inline gap={2} justify="end">
        {onDelete && (
          <Button variant="ghost" onClick={onDelete} disabled={saving}>
            Elimina
          </Button>
        )}
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Salvataggio…' : 'Salva'}
        </Button>
      </Inline>
    </DialogFooter>
  )

  switch (editing.kind) {
    case 'business':
      return <BusinessForm profile={profile} footer={(values) => footer(() => act((id) => saveBusiness(id, values)))} />
    case 'location':
      return (
        <LocationForm
          location={editing.location}
          footer={(read) =>
            footer(
              () => act((id) => saveLocation(id, read())),
              editing.location ? () => act(() => deleteLocation(editing.location!.id)) : undefined,
            )
          }
        />
      )
    case 'branding':
      return <BrandingForm profile={profile} footer={(values) => footer(() => act((id) => saveBranding(id, values)))} />
    case 'tone':
      return <ToneForm profile={profile} footer={(values) => footer(() => act((id) => saveTone(id, values)))} />
    case 'catalog':
      return (
        <CatalogForm
          item={editing.item}
          footer={(values) =>
            footer(
              () => act((id) => saveCatalogItem(id, editing.item?.id, values)),
              editing.item ? () => act(() => deleteCatalogItem(editing.item!.id)) : undefined,
            )
          }
        />
      )
    case 'calendar':
      return <CalendarForm profile={profile} footer={(values) => footer(() => act((id) => saveCalendar(id, values)))} />
  }
}

function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  hint?: string
}) {
  const id = `field-${props.label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      {props.multiline ? (
        <Textarea
          id={id}
          rows={4}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <Input id={id} value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {props.hint && <FieldDescription>{props.hint}</FieldDescription>}
    </Field>
  )
}

function BusinessForm({
  profile,
  footer,
}: {
  profile: Profile
  footer: (values: { name: string; sector: string; description: string }) => React.ReactNode
}) {
  const [name, setName] = useState(profile.business?.name ?? '')
  const [sector, setSector] = useState(profile.business?.sector ?? '')
  const [description, setDescription] = useState(profile.business?.description ?? '')
  return (
    <>
      <DialogHeader>
        <DialogTitle>Attività</DialogTitle>
      </DialogHeader>
      <Stack gap={4}>
        <TextField label="Nome" value={name} onChange={setName} />
        <TextField label="Settore" value={sector} onChange={setSector} placeholder="Di cosa si occupa l'attività" />
        <TextField label="Descrizione" value={description} onChange={setDescription} multiline />
      </Stack>
      {footer({ name, sector, description })}
    </>
  )
}

function LocationForm({
  location,
  footer,
}: {
  location?: Location
  footer: (read: () => { id?: string; name: string; address: string; intervals: Location['intervals'] }) => React.ReactNode
}) {
  const [name, setName] = useState(location?.name ?? '')
  const [address, setAddress] = useState(location?.address ?? '')
  const [days, setDays] = useState(WEEKDAYS.map((_, index) => formatDay(location?.intervals ?? [], index + 1)))
  const read = () => {
    if (!address.trim()) throw new Error('Serve un indirizzo')
    return { id: location?.id, name, address, intervals: days.flatMap((text, index) => parseDay(index + 1, text)) }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{location ? 'Sede' : 'Nuova sede'}</DialogTitle>
        <DialogDescription>Orari come 09:00-19:00, oppure 09:00-13:00, 14:00-19:00 con la pausa. Vuoto vuol dire chiuso.</DialogDescription>
      </DialogHeader>
      <Stack gap={4}>
        <TextField label="Indirizzo" value={address} onChange={setAddress} />
        <TextField label="Nome (se hai più sedi)" value={name} onChange={setName} />
        <div className="hours-grid">
          {WEEKDAYS.map((day, index) => (
            <TextField
              key={day}
              label={day}
              value={days[index]}
              placeholder="Chiuso"
              onChange={(value) => setDays((current) => current.map((text, i) => (i === index ? value : text)))}
            />
          ))}
        </div>
      </Stack>
      {footer(read)}
    </>
  )
}

function BrandingForm({
  profile,
  footer,
}: {
  profile: Profile
  footer: (values: Parameters<typeof saveBranding>[1]) => React.ReactNode
}) {
  const brand = profile.branding
  const [colors, setColors] = useState(
    BRAND_COLOR_NAMES.map((name, index) => ({ name, hex: brand?.colors[index]?.hex ?? '' })),
  )
  return (
    <>
      <DialogHeader>
        <DialogTitle>Branding</DialogTitle>
        <DialogDescription>Per cambiare il logo, allegalo in chat.</DialogDescription>
      </DialogHeader>
      <Stack gap={4}>
        <Stack gap={2}>
          {colors.map((color, index) => (
            <Inline key={color.name} gap={2} align="center">
              {/* The picker is a plain input: the DS has no colour control yet. */}
              <input
                className="color-input"
                type="color"
                aria-label={`Colore ${color.name}`}
                value={/^#[0-9a-f]{6}$/i.test(color.hex) ? color.hex : '#000000'}
                onChange={(event) =>
                  setColors((current) => current.map((c, i) => (i === index ? { ...c, hex: event.target.value.toUpperCase() } : c)))
                }
              />
              <TextField
                label={color.name}
                value={color.hex}
                placeholder="#RRGGBB"
                onChange={(value) => setColors((current) => current.map((c, i) => (i === index ? { ...c, hex: value } : c)))}
              />
            </Inline>
          ))}
        </Stack>
      </Stack>
      {footer({ colors })}
    </>
  )
}

function ToneForm({
  profile,
  footer,
}: {
  profile: Profile
  footer: (values: { description: string; keywords: string }) => React.ReactNode
}) {
  const [description, setDescription] = useState(profile.branding?.toneDescription ?? '')
  const [keywords, setKeywords] = useState((profile.branding?.tone ?? []).join(', '))
  return (
    <>
      <DialogHeader>
        <DialogTitle>Tono di voce</DialogTitle>
      </DialogHeader>
      <Stack gap={4}>
        <TextField
          label="Come parli ai clienti"
          value={description}
          onChange={setDescription}
          multiline
          hint="Tu o lei, caldo o formale, le parole che usi, emoji sì o no, cosa eviti."
        />
        <TextField label="Parole chiave" value={keywords} onChange={setKeywords} placeholder="Caloroso, esperto, rassicurante" />
      </Stack>
      {footer({ description, keywords })}
    </>
  )
}

function CatalogForm({
  item,
  footer,
}: {
  item?: CatalogItem
  footer: (values: Parameters<typeof saveCatalogItem>[2]) => React.ReactNode
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState(item?.category ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item?.priceCents != null ? String(item.priceCents / 100) : '')
  const [duration, setDuration] = useState(item?.durationMinutes != null ? String(item.durationMinutes) : '')
  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? 'Elemento di catalogo' : 'Nuovo elemento di catalogo'}</DialogTitle>
      </DialogHeader>
      <Stack gap={4}>
        <TextField label="Nome" value={name} onChange={setName} />
        <TextField label="Categoria" value={category} onChange={setCategory} />
        <Inline gap={3}>
          <TextField label="Prezzo (€)" value={price} onChange={setPrice} placeholder="70" />
          <TextField label="Durata (min)" value={duration} onChange={setDuration} placeholder="60" />
        </Inline>
        <TextField label="Descrizione" value={description} onChange={setDescription} multiline />
      </Stack>
      {footer({ name, category, description, price, duration })}
    </>
  )
}

function CalendarForm({
  profile,
  footer,
}: {
  profile: Profile
  footer: (values: { members: string; provider: string }) => React.ReactNode
}) {
  const [members, setMembers] = useState((profile.calendar?.members ?? []).join('\n'))
  const [provider, setProvider] = useState(profile.calendar?.provider ?? '')
  return (
    <>
      <DialogHeader>
        <DialogTitle>Calendario</DialogTitle>
      </DialogHeader>
      <Stack gap={4}>
        <TextField label="Team" value={members} onChange={setMembers} multiline hint="Un nome per riga." />
        <Field>
          <FieldLabel htmlFor="calendar-provider">Calendario che usi</FieldLabel>
          <NativeSelect id="calendar-provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
            <NativeSelectOption value="">Non indicato</NativeSelectOption>
            {Object.entries({ ...CALENDARS, other: 'Altro' }).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </Stack>
      {footer({ members, provider })}
    </>
  )
}
