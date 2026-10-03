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
  Stack,
} from '@skyground-media/pipelean-design-system'
import {
  ArrowLeft02Icon,
  ArrowUp02Icon,
  Attachment02Icon,
  Cancel01Icon,
  Image01Icon,
  LibraryBigIcon,
  Logout03Icon,
} from '@hugeicons/core-free-icons'
import {
  askAgent,
  checkAdImages,
  checkLogoJob,
  createBusiness,
  hasUnfinishedTurn,
  loadAds,
  loadHistory,
  loadProfile,
  uploadAttachment,
  type Ad,
  type AgentEntry,
  type AgentTurn,
} from './backend.ts'
import { AdCard } from './AdCard.tsx'
// Inline, so its strokes take the text colour (currentColor) and its animations run.
import thinkingLoop from './thinking.svg?raw'
import idleLoop from './idle.svg?raw'
import speakingLoop from './speaking.svg?raw'
import { Markdown } from './Markdown.tsx'
import { TypedMarkdown } from './TypedMarkdown.tsx'
import { Icon } from './Icon.tsx'
import { ProfileEditor, type Editing } from './ProfileEditor.tsx'
import { ProfilePanel, type SectionState } from './ProfilePanel.tsx'
import { ACCEPT, documentIcon, documentKind, isAccepted } from './attachments.ts'
import { hasSection, type Profile, type Section } from './profile.ts'
import { EVENTS, WAITING } from './script.ts'
import type { ImportRequest } from './types.ts'

/** A file picked in the composer, before or while it is sent. */
interface PickedFile {
  id: number
  file: File
  /** Object URL for the preview; documents show an icon instead. */
  preview: string
}

const MAX_FILES = 6

type Entry =
  | { id: number; from: 'agent'; text: string; ads?: string[]; /** Just arrived: written out word by word. */ typed?: boolean }
  | {
      id: number
      from: 'user'
      text: string
      files?: PickedFile[]
      /** Attachments of a message from an earlier session: their storage paths. */
      sentPaths?: string[]
    }

/** How often a turn under way is moved on, and the ad images looked at. */
const RESUME_MS = 1500
const IMAGES_MS = 5000
const AGENT_DOWN = 'Scusa, in questo momento non riesco a rispondere. Riprova tra poco.'
let nextId = 0

const say = (text: string, ads?: string[]): Entry => ({ id: nextId++, from: 'agent', text, ads })

/** A message from the server as the conversation shows it. */
const fromServer = (entry: AgentEntry): Entry =>
  entry.role === 'user'
    ? { id: nextId++, from: 'user', text: entry.text, sentPaths: entry.attachments }
    : say(entry.text, entry.ads?.length ? entry.ads : undefined)

/**
 * The conversation of a workspace: a new one, started from the source the owner
 * chose (`request`), or an existing one picked up where it was left (`workspaceId`).
 * Spark is one agent on the server: the app sends what the owner says, moves
 * the agent's turn on while it works and shows what it writes.
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
  const [profile, setProfile] = useState<Profile>({})
  const [ads, setAds] = useState<Record<string, Ad>>({})
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  // A turn of the agent's in flight: the typing indicator shows what it is doing.
  const [working, setWorking] = useState(false)
  const [activity, setActivity] = useState<string>()
  /** Replies being written out word by word: Spark is speaking while there are any. */
  const [speaking, setSpeaking] = useState<number[]>([])
  const end = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLElement>(null)
  /** Whether the owner is at the bottom of the conversation: it then stays there as things load. */
  const atBottom = useRef(true)
  /** The first time there is something to show, it is shown from the bottom at once. */
  const arrived = useRef(false)
  const business = useRef<Promise<string> | null>(null)
  /** The last server message on screen: the agent sends what comes after it. */
  const seen = useRef(0)

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

  /** An existing workspace: its conversation so far, its profile, and a turn left under way. */
  async function resume() {
    try {
      const id = await businessId()
      const [history, all, unfinished] = await Promise.all([loadHistory(id), loadAds(id), hasUnfinishedTurn(id)])
      seen.current = history[history.length - 1]?.id ?? 0
      setAds(Object.fromEntries(all.map((ad) => [ad.id, ad])))
      const restored = history.map(fromServer)
      setEntries(restored.length ? restored : [say('Ciao di nuovo! Da dove riprendiamo?')])
      if (unfinished) void follow({ resume: true })
    } catch (error) {
      console.error(error)
      setEntries([say(AGENT_DOWN)])
    }
    await refreshProfile()
  }

  /** The panel reads the database: the agent writes there. */
  async function refreshProfile() {
    try {
      setProfile(await loadProfile(await businessId()))
    } catch (error) {
      console.error(error)
    }
  }

  /** The ads the conversation shows, read again. */
  async function refreshAds(ids: string[]) {
    if (ids.length === 0) return
    try {
      const fresh = await loadAds(await businessId(), ids)
      setAds((current) => ({ ...current, ...Object.fromEntries(fresh.map((ad) => [ad.id, ad])) }))
    } catch (error) {
      console.error(error)
    }
  }

  // While the logo is waiting for its recreation (its job may not even have
  // started yet), move it on and look again until it is in.
  const imagesPending = !!profile.branding?.logoPending
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

  // The same for ad images: each moves only when someone looks.
  const adImagesPending = Object.values(ads).some((ad) => ad.images.some((image) => image.status === 'running'))
  useEffect(() => {
    if (!adImagesPending) return
    const timer = setInterval(async () => {
      try {
        await checkAdImages(await businessId())
      } catch (error) {
        console.error(error)
      }
      void refreshAds(Object.values(ads).filter((ad) => ad.images.some((image) => image.status === 'running')).map((ad) => ad.id))
    }, IMAGES_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows whether an image is pending only
  }, [adImagesPending])

  /**
   * One turn of the agent's: started with what the owner said (or the app
   * reports), then moved on until it is over. Its messages join the
   * conversation as they come; the owner's own are already on screen.
   */
  async function follow(turn: AgentTurn) {
    setWorking(true)
    try {
      let next: AgentTurn = turn
      for (;;) {
        const state = await askAgent(await businessId(), next, seen.current)
        const fresh = state.entries.filter((entry) => entry.id > seen.current)
        if (fresh.length) {
          seen.current = fresh[fresh.length - 1].id
          const shown = fresh
            .filter((entry) => entry.role === 'assistant')
            .map((entry): Entry => ({ ...fromServer(entry), typed: true }) as Entry)
          if (shown.length) {
            setEntries((list) => [...list, ...shown])
            setSpeaking((ids) => [...ids, ...shown.map((entry) => entry.id)])
          }
          await Promise.all([refreshProfile(), refreshAds(fresh.flatMap((entry) => entry.ads ?? []))])
        }
        setActivity(state.activity)
        if (state.error) console.error('Agent turn failed:', state.error)
        if (state.status !== 'running') {
          if (state.error && state.entries.length === 0) setEntries((list) => [...list, say(AGENT_DOWN)])
          break
        }
        await new Promise((resolve) => setTimeout(resolve, RESUME_MS))
        next = { resume: true }
      }
    } catch (error) {
      console.error(error)
      setEntries((list) => [...list, say(AGENT_DOWN)])
    } finally {
      setWorking(false)
      setActivity(undefined)
      void refreshProfile()
    }
  }

  // Opening: the agent reads the site, or greets an owner without one. Once.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (workspaceId) void resume()
    else if (request?.source === 'website') void follow({ event: EVENTS.website(request.target) })
    else void follow({ event: EVENTS.noWebsite })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [])

  useEffect(() => {
    if (entries.length === 0) return
    end.current?.scrollIntoView({ behavior: arrived.current ? 'smooth' : 'auto', block: 'end' })
    arrived.current = true
    atBottom.current = true
  }, [entries, working])

  // Images and ad cards grow after they load: whoever is at the bottom stays there.
  useEffect(() => {
    const element = log.current
    const content = element?.firstElementChild
    if (!element || !content) return
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const sectionState = (section: Section): SectionState => {
    if (hasSection(profile, section)) return 'ready'
    return working && section !== 'calendar' && !profile.business?.name ? 'loading' : 'empty'
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
    if ((!message && files.length === 0) || working) return
    const attached = files
    setEntries((current) => [...current, { id: nextId++, from: 'user', text: message, files: attached }])
    setDraft('')
    if (composer.current) composer.current.style.height = ''
    setFiles([])

    if (attached.length === 0) {
      void follow({ message })
      return
    }
    void (async () => {
      setWorking(true)
      setActivity('Carico i file')
      try {
        const id = await businessId()
        const paths = await Promise.all(attached.map((item) => uploadAttachment(id, item.file)))
        await follow({ message, attachments: paths })
      } catch (error) {
        console.error(error)
        setEntries((list) => [...list, say('Non sono riuscito a caricare i file. Riprova, magari con file più leggeri.')])
        setWorking(false)
        setActivity(undefined)
      }
    })()
  }

  const thinking = working
  const lastId = entries[entries.length - 1]?.id
  const busy = working
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
            <span className="profile-toggle">
              {/* On a phone the profile comes up from the bottom. */}
              <Drawer>
                <DrawerTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Icon icon={LibraryBigIcon} />
                    Contesto
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>Contesto dell'attività</DrawerTitle>
                    <DrawerDescription>Quello che Spark sa finora.</DrawerDescription>
                  </DrawerHeader>
                  <div className="sheet-body">{panel(false)}</div>
                </DrawerContent>
              </Drawer>
            </span>
          </Inline>
        </header>

        <div className="chat-body">
          <main
            className="chat-log"
            ref={log}
            onScroll={(event) => {
              const element = event.currentTarget
              atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
            }}
          >
            {/* The design system's MessageGroup keeps its messages 8px apart: a Stack spaces them more. */}
            <Stack gap={6}>
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
                      <Stack gap={3}>
                        {!thinking && entry.id === lastId && <SparkAvatar svg={speaking.length ? speakingLoop : idleLoop} inline />}
                        <Bubble variant="ghost">
                          <BubbleContent>
                            {entry.typed ? (
                              <TypedMarkdown onDone={() => setSpeaking((ids) => ids.filter((id) => id !== entry.id))}>
                                {entry.text}
                              </TypedMarkdown>
                            ) : (
                              <Markdown>{entry.text}</Markdown>
                            )}
                          </BubbleContent>
                        </Bubble>
                        {entry.ads && entry.ads.some((id) => ads[id]) && (
                          // One or more ads on one row, scrolled sideways.
                          <div className="ad-carousel">
                            {entry.ads.map((id) => (ads[id] ? <AdCard key={id} ad={ads[id]} profile={profile} /> : null))}
                          </div>
                        )}
                      </Stack>
                    </MessageContent>
                  </Message>
                ),
              )}
              {thinking && (
                <Message>
                  <MessageContent>
                    <SparkAvatar svg={thinkingLoop} inline />
                    <Bubble variant="ghost">
                      <BubbleContent>
                        <span className="agent-activity">{activity ?? 'Sto pensando'}…</span>
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              )}
            </Stack>
            <div ref={end} />
          </main>
          {/* Spark beside the conversation, at its bottom: the messages scroll, it stays. Thinking while it works, idle otherwise. */}
          {thinking ? (
            <SparkAvatar svg={thinkingLoop} label="Spark sta lavorando" />
          ) : (
            <SparkAvatar svg={speaking.length ? speakingLoop : idleLoop} />
          )}
        </div>

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

      <aside className="profile-panel" aria-label="Contesto dell'attività">
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

/**
 * Spark's avatar, an animation inline so it takes the text colour and moves.
 * Beside the conversation on wider screens; `inline`, above its last reply,
 * on a phone (each shows only where it belongs).
 */
function SparkAvatar({ svg, label, inline = false }: { svg: string; label?: string; inline?: boolean }) {
  const className = inline ? 'spark-avatar spark-avatar-inline' : 'spark-avatar'
  return label && !inline ? (
    <span className={className} role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <span className={className} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
  )
}
