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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Inline,
  Message,
  MessageContent,
  MessageGroup,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import {
  ArrowLeft02Icon,
  ArrowUp02Icon,
  Attachment02Icon,
  Cancel01Icon,
  Image01Icon,
  Logout03Icon,
  SidebarRightIcon,
} from '@hugeicons/core-free-icons'
import {
  askAgent,
  checkImport,
  checkLogoJob,
  createBusiness,
  loadHistory,
  loadLatestProposal,
  loadProfile,
  requestCreative,
  requestProposal,
  startImport,
  uploadAttachment,
  type AdProposal,
  type AgentTurn,
  type ImportSource,
} from './backend.ts'
import { AdPreview, type CreativeState } from './AdPreview.tsx'
import { Markdown } from './Markdown.tsx'
import { Icon } from './Icon.tsx'
import { ImportMarker, type MarkerStatus } from './ImportMarker.tsx'
import { ProfileEditor, type Editing } from './ProfileEditor.tsx'
import { ProfilePanel, type SectionState } from './ProfilePanel.tsx'
import { ACCEPT, documentIcon, documentKind, isAccepted } from './attachments.ts'
import { hasSection, type Profile, type Section } from './profile.ts'
import { EVENTS, WAITING, findLink } from './script.ts'
import { displayUrl, type ImportRequest } from './types.ts'

/** A file picked in the composer, before or while it is sent. */
interface PickedFile {
  id: number
  file: File
  /** Object URL for the preview; documents show an icon instead. */
  preview: string
}

const MAX_FILES = 6

type Entry =
  | { id: number; from: 'agent'; text: string; quickReplies?: string[] }
  | {
      id: number
      from: 'user'
      text: string
      files?: PickedFile[]
      /** Attachments of a message from an earlier session: their storage paths. */
      sentPaths?: string[]
    }
  | { id: number; from: 'import'; job: string }
  | {
      id: number
      from: 'proposal'
      proposal?: AdProposal
      proposalId?: string
      creativeState?: CreativeState
      failed?: boolean
      /** The generated image: undefined while it is being made, null if it failed. */
      creative?: string | null
    }

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

/**
 * The conversation of a workspace: a new one, started from the source the owner
 * chose (`request`), or an existing one picked up where it was left (`workspaceId`).
 */
export function ChatStep({
  request,
  workspaceId,
  onBack,
  onSignOut,
  onCreated,
}: {
  request?: ImportRequest
  workspaceId?: string
  /** A new workspace, once it exists: its address can then point at it. */
  onCreated?: (workspaceId: string) => void
  /** Back to the workspaces: admins only. */
  onBack?: () => void
  /** For a user, whose only place is their workspace. */
  onSignOut?: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>(() => (request?.source === 'website' ? [say(WAITING)] : []))
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
    business.current ??= workspaceId
      ? Promise.resolve(workspaceId)
      : createBusiness(request?.source === 'website' ? request.target : undefined).then((id) => {
          onCreated?.(id)
          return id
        })
    return business.current
  }

  /** An existing workspace: its conversation so far, its profile and its latest ad. */
  async function resume() {
    try {
      const [history, latest] = await Promise.all([loadHistory(await businessId()), loadLatestProposal(await businessId())])
      const restored: Entry[] = history.map((item) =>
        item.from === 'user'
          ? { id: nextId++, from: 'user', text: item.text, sentPaths: item.attachments }
          : say(item.text, item.choices.length ? item.choices : undefined),
      )
      // The ad was already proposed: shown again, never proposed by itself a second time.
      proposed.current = !!latest
      if (latest) {
        restored.push({
          id: nextId++,
          from: 'proposal',
          proposal: latest.proposal,
          proposalId: latest.id,
          creative: latest.creative,
          creativeState: latest.creative ? 'done' : 'idle',
        })
      }
      setEntries(restored.length ? restored : [say('Ciao di nuovo! Da dove riprendiamo?')])
    } catch (error) {
      console.error(error)
      setEntries([say(AGENT_DOWN)])
    }
    await refreshProfile()
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
      const { id: proposalId, proposal } = await requestProposal(await businessId())
      // The image waits for the owner's approval of the campaign.
      setEntries((list) =>
        list.map((entry) => (entry.id === id ? { ...entry, proposal, proposalId, creativeState: 'idle' } : entry)),
      )
    } catch (error) {
      console.error(error)
      setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, failed: true } : entry)))
    } finally {
      setProposing(false)
    }
  }

  /** The owner approved the campaign: its image is made now. */
  async function approve(entryId: number, proposalId: string) {
    const update = (patch: Partial<Extract<Entry, { from: 'proposal' }>>) =>
      setEntries((list) => list.map((entry) => (entry.id === entryId && entry.from === 'proposal' ? { ...entry, ...patch } : entry)))
    update({ creativeState: 'making' })
    try {
      update({ creative: await requestCreative(proposalId), creativeState: 'done' })
    } catch (error) {
      console.error(error)
      update({ creativeState: 'failed' })
    }
  }

  // While the logo is waiting for its recreation (its job may not even have
  // started yet) or the brand board for its image, move them on and look
  // again until both are in.
  const imagesPending = !!profile.branding?.logoPending || !!profile.branding?.boardPending
  useEffect(() => {
    if (!imagesPending) return
    const timer = setInterval(async () => {
      try {
        await checkLogoJob(await businessId())
      } catch (error) {
        console.error(error)
      }
      void refreshProfile()
    }, 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows whether an image is pending only
  }, [imagesPending])

  // Once the owner confirms the profile, Spark proposes their first ad by itself.
  useEffect(() => {
    if (profile.status === 'completed' && !proposed.current) void propose()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on completion
  }, [profile.status])

  /** One agent turn; its reply joins the conversation and the panel catches up. */
  async function agentTurn(turn: AgentTurn) {
    setPending((count) => count + 1)
    try {
      const { reply, choices, actions } = await askAgent(await businessId(), turn)
      if (reply) setEntries((list) => [...list, say(reply, choices.length ? choices : undefined)])
      await refreshProfile()
      // A new logo starts its recreation a few seconds later, in another
      // function: look again then, so the panel picks the job up and follows it.
      if (actions.some((action) => action.startsWith('set_logo'))) setTimeout(() => void refreshProfile(), 8000)
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
    if (workspaceId) void resume()
    else if (request?.source === 'website') void runImport(undefined, displayUrl(request.target))
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
    const accepted = [...(list ?? [])].filter(isAccepted)
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
          {onBack ? (
            <Button variant="ghost" size="icon-sm" aria-label="Workspace" title="Workspace" onClick={onBack}>
              <Icon icon={ArrowLeft02Icon} />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              <Icon icon={Logout03Icon} />
              Esci
            </Button>
          )}
          <Inline gap={3} align="center">
            {profile.business?.name && (
              <Button variant="outline" size="sm" onClick={() => void propose()} disabled={proposing}>
                Prima inserzione
              </Button>
            )}
            <span className="profile-toggle">
              {/* On a phone the profile comes up from the bottom. */}
              <Drawer>
                <DrawerTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Icon icon={SidebarRightIcon} />
                    Profilo
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>Profilo dell'attività</DrawerTitle>
                    <DrawerDescription>Quello che Spark sa finora.</DrawerDescription>
                  </DrawerHeader>
                  <div className="sheet-body">{panel(false)}</div>
                </DrawerContent>
              </Drawer>
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
                    {entry.sentPaths && entry.sentPaths.length > 0 && <SentPaths paths={entry.sentPaths} />}
                    {entry.text && (
                      <Bubble variant="tinted" align="end">
                        <BubbleContent>{entry.text}</BubbleContent>
                      </Bubble>
                    )}
                  </MessageContent>
                </Message>
              ) : (
                <Message key={entry.id}>
                  <MessageContent>
                    {entry.from === 'proposal' ? (
                      entry.proposal ? (
                        <Stack gap={3}>
                          <Bubble variant="ghost">
                            <BubbleContent>
                              Ecco la campagna che ti propongo per acquisire nuovi clienti, pensata su tutto quello che so della
                              tua attività. Se ti convince approvala e creo l'immagine; se no, rigenerala.
                            </BubbleContent>
                          </Bubble>
                          <AdPreview
                            proposal={entry.proposal}
                            creative={entry.creative}
                            creativeState={entry.creativeState ?? 'idle'}
                            profile={profile}
                            onApprove={() => entry.proposalId && void approve(entry.id, entry.proposalId)}
                            onRegenerate={() => void propose()}
                            regenerating={proposing}
                          />
                        </Stack>
                      ) : (
                        <Bubble variant="ghost">
                          <BubbleContent>
                            {entry.failed ? (
                              'Non sono riuscito a preparare la proposta. Riprova con “Prima inserzione”.'
                            ) : (
                              <Inline gap={2} align="center">
                                <Spinner />
                                Sto studiando la tua prima campagna: ci vuole qualche minuto…
                              </Inline>
                            )}
                          </BubbleContent>
                        </Bubble>
                      )
                    ) : entry.from === 'import' ? (
                      <ImportMarker {...jobs[entry.job]} onSkip={() => skip(entry.job)} />
                    ) : (
                      <Stack gap={3}>
                        <Bubble variant="ghost">
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
                <MessageContent>
                  <Bubble variant="ghost">
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
                    <AttachmentMedia variant={documentKind(item.file) ? 'icon' : 'image'}>
                      {documentKind(item.file) ? <Icon icon={documentIcon(item.file)} /> : <img src={item.preview} alt="" />}
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
                accept={ACCEPT}
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
                  aria-label="Allega immagini o documenti"
                  title="Allega immagini o documenti (PDF, TXT, DOCX): un listino, il logo, delle foto, il transcript di una chiamata"
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

/** What the owner attached, on their sent message: images as thumbnails, documents by name. */
function SentFiles({ files }: { files: PickedFile[] }) {
  const images = files.filter((item) => !documentKind(item.file))
  const documents = files.filter((item) => documentKind(item.file))
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
                <Icon icon={documentIcon(item.file)} />
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

/** Attachments of a message from an earlier session, by name. */
function SentPaths({ paths }: { paths: string[] }) {
  return (
    <AttachmentGroup>
      {paths.map((path) => {
        const file = new File([], path.split('/').pop() ?? path)
        const document = documentKind(file)
        return (
          <Attachment key={path} size="sm">
            <AttachmentMedia variant="icon">
              <Icon icon={document ? documentIcon(file) : Image01Icon} />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{document ? `Documento ${document.toUpperCase()}` : 'Immagine'}</AttachmentTitle>
            </AttachmentContent>
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}

/** One line to start with, growing with the text up to five, then scrolling. */
function grow(textarea: HTMLTextAreaElement) {
  textarea.style.height = ''
  textarea.style.height = `${Math.min(textarea.scrollHeight, 5 * 24)}px`
}
