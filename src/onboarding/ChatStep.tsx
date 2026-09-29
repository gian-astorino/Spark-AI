import { useEffect, useRef, useState } from 'react'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  Bubble,
  BubbleContent,
  Button,
  Inline,
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import {
  ArrowLeft02Icon,
  ArrowUp02Icon,
  Attachment02Icon,
  Cancel01Icon,
  Pdf01Icon,
  SidebarRightIcon,
} from '@hugeicons/core-free-icons'
import {
  askAgent,
  checkImport,
  createBusiness,
  loadProfile,
  requestProposal,
  startImport,
  uploadAttachment,
  type AdProposal,
  type AgentTurn,
  type ImportSource,
} from './backend.ts'
import { AdPreview } from './AdPreview.tsx'
import { Markdown } from './Markdown.tsx'
import { Icon } from './Icon.tsx'
import { ImportMarker, type MarkerStatus } from './ImportMarker.tsx'
import { ProfileEditor, type Editing } from './ProfileEditor.tsx'
import { ProfilePanel, type SectionState } from './ProfilePanel.tsx'
import { hasSection, type Profile, type Section } from './profile.ts'
import { EVENTS, WAITING, findLink } from './script.ts'
import { SparkMark } from './SparkMark.tsx'
import { displayUrl, type ImportRequest } from './types.ts'

/** A file picked in the composer, before or while it is sent. */
interface PickedFile {
  id: number
  file: File
  /** Object URL for the preview; PDFs show an icon instead. */
  preview: string
}

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf'
const MAX_FILES = 6

type Entry =
  | { id: number; from: 'agent'; text: string; quickReplies?: string[] }
  | { id: number; from: 'user'; text: string; files?: PickedFile[] }
  | { id: number; from: 'import'; job: string }
  | { id: number; from: 'proposal'; proposal?: AdProposal; failed?: boolean }

interface Job {
  label: string
  /** The business's own site, as opposed to an extra link from the chat. */
  primary: boolean
  status: MarkerStatus
  pagesRead: number
  pagesTotal: number
  activity?: string
  sources?: ImportSource[]
}

const POLL_MS = 3000
const AGENT_DOWN = 'Scusa, in questo momento non riesco a rispondere. Riprova tra poco.'
let nextId = 0

const say = (text: string, quickReplies?: string[]): Entry => ({ id: nextId++, from: 'agent', text, quickReplies })

export function ChatStep({ request, onBack }: { request: ImportRequest; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>(() => (request.source === 'website' ? [say(WAITING)] : []))
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [profile, setProfile] = useState<Profile>({})
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [proposing, setProposing] = useState(false)
  const proposed = useRef(false)
  const picker = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  // Agent turns in flight: the typing indicator shows while any is.
  const [pending, setPending] = useState(0)
  const end = useRef<HTMLDivElement>(null)
  const business = useRef<Promise<string> | null>(null)
  const stopped = useRef(new Set<string>())

  /** The business row, created once, on first need. */
  function businessId() {
    business.current ??= createBusiness(request.source === 'website' ? request.target : undefined)
    return business.current
  }

  /** The panel reads the database: imports and the agent both write there. */
  async function refreshProfile() {
    try {
      setProfile(await loadProfile(await businessId()))
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * The first-ad proposal, as a message of Spark's. Replaces the one on screen
   * when asked again, so "Rigenera" does not stack proposals.
   */
  async function propose() {
    if (proposing) return
    proposed.current = true
    setProposing(true)
    const id = nextId++
    setEntries((list) => [...list.filter((entry) => entry.from !== 'proposal'), { id, from: 'proposal' }])
    try {
      const proposal = await requestProposal(await businessId())
      setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, proposal } : entry)))
    } catch (error) {
      console.error(error)
      setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, failed: true } : entry)))
    } finally {
      setProposing(false)
    }
  }

  // Once the owner confirms the profile, Spark proposes their first ad by itself.
  useEffect(() => {
    if (profile.status === 'completed' && !proposed.current) void propose()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on completion
  }, [profile.status])

  /** One agent turn; its reply joins the conversation and the panel catches up. */
  async function agentTurn(turn: AgentTurn) {
    setPending((count) => count + 1)
    try {
      const { reply, choices } = await askAgent(await businessId(), turn)
      if (reply) setEntries((list) => [...list, say(reply, choices.length ? choices : undefined)])
      await refreshProfile()
    } catch (error) {
      console.error(error)
      setEntries((list) => [...list, say(AGENT_DOWN)])
    } finally {
      setPending((count) => count - 1)
    }
  }

  /** Starts an import, shows its marker, follows it, then lets the agent report. */
  async function runImport(url: string | undefined, label: string) {
    const primary = url === undefined
    const markerKey = `pending-${nextId}`
    let job = markerKey
    const update = (patch: Partial<Job>) => setJobs((current) => ({ ...current, [job]: { ...current[job], ...patch } }))
    setJobs((current) => ({ ...current, [job]: { label, primary, status: 'starting', pagesRead: 0, pagesTotal: 0 } }))
    setEntries((current) => [...current, { id: nextId++, from: 'import', job }])

    const settle = async (status: 'done' | 'failed', summary = '') => {
      await refreshProfile()
      if (primary) await agentTurn({ event: status === 'done' ? EVENTS.siteDone(summary) : EVENTS.siteFailed })
      else await agentTurn({ event: status === 'done' ? EVENTS.extraDone(url, summary) : EVENTS.extraFailed(url) })
    }

    try {
      const started = await startImport(await businessId(), url)
      // Re-key the marker from its placeholder to the real job id.
      setJobs((current) => {
        const { [markerKey]: placeholder, ...rest } = current
        return { ...rest, [started]: { ...placeholder, status: 'running' } }
      })
      setEntries((current) =>
        current.map((entry) => (entry.from === 'import' && entry.job === markerKey ? { ...entry, job: started } : entry)),
      )
      if (stopped.current.has(markerKey)) stopped.current.add(started)
      job = started

      while (!stopped.current.has(job)) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        if (stopped.current.has(job)) return
        const progress = await checkImport(job)
        update({
          status: progress.status,
          pagesRead: progress.pagesRead,
          pagesTotal: progress.pagesTotal,
          activity: progress.activity,
          sources: progress.sources,
        })
        if (progress.status !== 'running') return settle(progress.status, progress.summary)
      }
    } catch (error) {
      console.error(error)
      if (stopped.current.has(job)) return
      update({ status: 'failed' })
      return settle('failed')
    }
  }

  function skip(job: string) {
    stopped.current.add(job)
    setJobs((current) => ({ ...current, [job]: { ...current[job], status: 'skipped' } }))
    if (jobs[job]?.primary) void refreshProfile().then(() => agentTurn({ event: EVENTS.siteSkipped }))
  }

  // Opening: read the site, or let the agent greet an owner without one. Once.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (request.source === 'website') void runImport(undefined, displayUrl(request.target))
    else void agentTurn({ event: EVENTS.noWebsite })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, pending])

  const sectionState = (section: Section): SectionState => {
    if (hasSection(profile, section)) return 'ready'
    const siteRunning = Object.values(jobs).some((job) => job.primary && (job.status === 'starting' || job.status === 'running'))
    return siteRunning && section !== 'calendar' ? 'loading' : 'empty'
  }

  function pick(list: FileList | File[] | null) {
    const accepted = [...(list ?? [])].filter((file) => ACCEPTED.split(',').includes(file.type))
    setFiles((current) =>
      [...current, ...accepted.map((file) => ({ id: nextId++, file, preview: URL.createObjectURL(file) }))].slice(0, MAX_FILES),
    )
  }

  function unpick(id: number) {
    setFiles((current) => current.filter((item) => item.id !== id))
  }

  function send(text: string) {
    const message = text.trim()
    if ((!message && files.length === 0) || pending > 0) return
    const attached = files
    setEntries((current) => [...current, { id: nextId++, from: 'user', text: message, files: attached }])
    setDraft('')
    if (composer.current) composer.current.style.height = ''
    setFiles([])

    // Files go to the agent, whatever the text says.
    if (attached.length > 0) {
      void (async () => {
        setPending((count) => count + 1)
        try {
          const id = await businessId()
          const paths = await Promise.all(attached.map((item) => uploadAttachment(id, item.file)))
          await agentTurn({ message, attachments: paths })
        } catch (error) {
          console.error(error)
          setEntries((list) => [...list, say('Non sono riuscito a caricare i file. Riprova, magari con file più leggeri.')])
        } finally {
          setPending((count) => count - 1)
        }
      })()
      return
    }

    // A link is a source for the app to read; the agent hears about it after.
    const link = findLink(message)
    if (link) void runImport(link, displayUrl(link))
    else void agentTurn({ message })
  }

  const thinking = pending > 0
  const busy = thinking
  const lastId = entries[entries.length - 1]?.id
  const panel = (titled: boolean) => (
    <ProfilePanel profile={profile} sectionState={sectionState} onEdit={setEditing} titled={titled} />
  )

  return (
    <div className="workspace">
      <div className="chat">
        <header className="chat-header">
          <Inline gap={2} align="center">
            <Button variant="ghost" size="icon-sm" aria-label="Indietro" onClick={onBack}>
              <Icon icon={ArrowLeft02Icon} />
            </Button>
            <SparkMark withName />
          </Inline>
          <Inline gap={3} align="center">
            {profile.catalog?.some((item) => item.priceCents) && (
              <Button variant="outline" size="sm" onClick={() => void propose()} disabled={proposing}>
                Prima inserzione
              </Button>
            )}
            <span className="step-count">Passo 2 di 2</span>
            <span className="profile-toggle">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Icon icon={SidebarRightIcon} />
                    Profilo
                  </Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Profilo dell'attività</SheetTitle>
                    <SheetDescription>Quello che Spark sa finora.</SheetDescription>
                  </SheetHeader>
                  <div className="sheet-body">{panel(false)}</div>
                </SheetContent>
              </Sheet>
            </span>
          </Inline>
        </header>

        <main className="chat-log">
          <MessageGroup>
            {entries.map((entry) =>
              entry.from === 'user' ? (
                <Message key={entry.id} align="end">
                  <MessageContent>
                    {entry.files && entry.files.length > 0 && <SentFiles files={entry.files} />}
                    {entry.text && (
                      <Bubble align="end">
                        <BubbleContent>{entry.text}</BubbleContent>
                      </Bubble>
                    )}
                  </MessageContent>
                </Message>
              ) : (
                <Message key={entry.id}>
                  <MessageAvatar>
                    <SparkMark />
                  </MessageAvatar>
                  <MessageContent>
                    {entry.from === 'proposal' ? (
                      entry.proposal ? (
                        <Stack gap={3}>
                          <Bubble variant="muted">
                            <BubbleContent>
                              Ecco una proposta per la tua prima inserzione, costruita sul tuo listino. Se non ti convince,
                              rigenerala.
                            </BubbleContent>
                          </Bubble>
                          <AdPreview
                            proposal={entry.proposal}
                            profile={profile}
                            onRegenerate={() => void propose()}
                            regenerating={proposing}
                          />
                        </Stack>
                      ) : (
                        <Bubble variant="muted">
                          <BubbleContent>
                            {entry.failed ? (
                              'Non sono riuscito a preparare la proposta. Riprova con “Prima inserzione”.'
                            ) : (
                              <Inline gap={2} align="center">
                                <Spinner />
                                Sto pensando alla tua prima inserzione…
                              </Inline>
                            )}
                          </BubbleContent>
                        </Bubble>
                      )
                    ) : entry.from === 'import' ? (
                      <ImportMarker {...jobs[entry.job]} onSkip={() => skip(entry.job)} />
                    ) : (
                      <Stack gap={3}>
                        <Bubble variant="muted">
                          <BubbleContent>
                            <Markdown>{entry.text}</Markdown>
                          </BubbleContent>
                        </Bubble>
                        {entry.quickReplies && entry.id === lastId && !thinking && (
                          <Inline gap={2}>
                            {entry.quickReplies.map((reply) => (
                              <Button key={reply} variant="outline" size="sm" onClick={() => send(reply)}>
                                {reply}
                              </Button>
                            ))}
                          </Inline>
                        )}
                      </Stack>
                    )}
                  </MessageContent>
                </Message>
              ),
            )}
            {thinking && (
              <Message>
                <MessageAvatar>
                  <SparkMark />
                </MessageAvatar>
                <MessageContent>
                  <Bubble variant="muted">
                    <BubbleContent>
                      <Spinner aria-label="Spark sta scrivendo" />
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            )}
          </MessageGroup>
          <div ref={end} />
        </main>

        <footer
          className="chat-composer"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            pick(event.dataTransfer.files)
          }}
        >
          <Stack gap={2}>
            {files.length > 0 && (
              <AttachmentGroup>
                {files.map((item) => (
                  <Attachment key={item.id} size="sm">
                    <AttachmentMedia variant={item.file.type === 'application/pdf' ? 'icon' : 'image'}>
                      {item.file.type === 'application/pdf' ? <Icon icon={Pdf01Icon} /> : <img src={item.preview} alt="" />}
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{item.file.name}</AttachmentTitle>
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction aria-label={`Rimuovi ${item.file.name}`} onClick={() => unpick(item.id)}>
                        <Icon icon={Cancel01Icon} />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                ))}
              </AttachmentGroup>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                send(draft)
              }}
            >
              <input
                ref={picker}
                type="file"
                accept={ACCEPTED}
                multiple
                hidden
                onChange={(event) => {
                  pick(event.target.files)
                  event.target.value = ''
                }}
              />
              {/* Spark's composer: a raised card on one line, the DS buttons at its ends. */}
              <div className="composer">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Allega immagini o PDF"
                  title="Allega immagini o PDF: un listino, il logo, delle foto"
                  onClick={() => picker.current?.click()}
                  disabled={files.length >= MAX_FILES}
                >
                  <Icon icon={Attachment02Icon} />
                </Button>
                <textarea
                  className="composer-input"
                  aria-label="Messaggio per Spark"
                  placeholder="Rispondi a Spark, oppure allega un listino, il logo, delle foto…"
                  value={draft}
                  rows={1}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    grow(event.target)
                  }}
                  onPaste={(event) => {
                    if (event.clipboardData.files.length > 0) {
                      event.preventDefault()
                      pick(event.clipboardData.files)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      send(draft)
                    }
                  }}
                  ref={composer}
                  autoFocus
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="icon"
                  aria-label="Invia"
                  disabled={(!draft.trim() && files.length === 0) || busy}
                >
                  <Icon icon={ArrowUp02Icon} />
                </Button>
              </div>
            </form>
          </Stack>
        </footer>
      </div>

      <aside className="profile-panel" aria-label="Profilo dell'attività">
        {panel(true)}
      </aside>

      <ProfileEditor
        editing={editing}
        profile={profile}
        businessId={businessId}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void refreshProfile()
        }}
      />
    </div>
  )
}

/** What the owner attached, on their sent message: images as thumbnails, PDFs by name. */
function SentFiles({ files }: { files: PickedFile[] }) {
  const images = files.filter((item) => item.file.type !== 'application/pdf')
  const documents = files.filter((item) => item.file.type === 'application/pdf')
  return (
    <>
      {images.length > 0 && (
        <div className="sent-images">
          {images.map((item) => (
            <img key={item.id} src={item.preview} alt={item.file.name} />
          ))}
        </div>
      )}
      {documents.length > 0 && (
        <AttachmentGroup>
          {documents.map((item) => (
            <Attachment key={item.id} size="sm">
              <AttachmentMedia variant="icon">
                <Icon icon={Pdf01Icon} />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{item.file.name}</AttachmentTitle>
              </AttachmentContent>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
    </>
  )
}

/** One line to start with, growing with the text up to five, then scrolling. */
function grow(textarea: HTMLTextAreaElement) {
  textarea.style.height = ''
  textarea.style.height = `${Math.min(textarea.scrollHeight, 5 * 24)}px`
}
