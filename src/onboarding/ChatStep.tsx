import { useEffect, useRef, useState } from 'react'
import {
  Bubble,
  BubbleContent,
  Button,
  Inline,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
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
import { ArrowLeft02Icon, ArrowUp02Icon, SidebarRightIcon } from '@hugeicons/core-free-icons'
import { askAgent, checkImport, createBusiness, loadProfile, startImport } from './backend.ts'
import { Icon } from './Icon.tsx'
import { ImportMarker, type MarkerStatus } from './ImportMarker.tsx'
import { ProfilePanel, type SectionState } from './ProfilePanel.tsx'
import { hasSection, type Profile, type Section } from './profile.ts'
import { EVENTS, WAITING, findLink } from './script.ts'
import { SparkMark } from './SparkMark.tsx'
import { displayUrl, type ImportRequest } from './types.ts'

type Entry =
  | { id: number; from: 'agent'; text: string; quickReplies?: string[] }
  | { id: number; from: 'user'; text: string }
  | { id: number; from: 'import'; job: string }

interface Job {
  label: string
  /** The business's own site, as opposed to an extra link from the chat. */
  primary: boolean
  status: MarkerStatus
  pagesRead: number
  pagesTotal: number
  activity?: string
}

const POLL_MS = 3000
const AGENT_DOWN = "Sorry, I can't answer right now. Try again in a moment."
let nextId = 0

const say = (text: string, quickReplies?: string[]): Entry => ({ id: nextId++, from: 'agent', text, quickReplies })

export function ChatStep({ request, onBack }: { request: ImportRequest; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>(() => (request.source === 'website' ? [say(WAITING)] : []))
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [profile, setProfile] = useState<Profile>({})
  const [draft, setDraft] = useState('')
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

  /** One agent turn; its reply joins the conversation and the panel catches up. */
  async function agentTurn(turn: { message: string } | { event: string }) {
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

  function send(text: string) {
    const message = text.trim()
    if (!message || pending > 0) return
    setEntries((current) => [...current, { id: nextId++, from: 'user', text: message }])
    setDraft('')

    // A link is a source for the app to read; the agent hears about it after.
    const link = findLink(message)
    if (link) void runImport(link, displayUrl(link))
    else void agentTurn({ message })
  }

  const thinking = pending > 0
  const busy = thinking
  const lastId = entries[entries.length - 1]?.id
  const panel = (titled: boolean) => <ProfilePanel profile={profile} sectionState={sectionState} titled={titled} />

  return (
    <div className="workspace">
      <div className="chat">
        <header className="chat-header">
          <Inline gap={2} align="center">
            <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
              <Icon icon={ArrowLeft02Icon} />
            </Button>
            <SparkMark withName />
          </Inline>
          <Inline gap={3} align="center">
            <span className="step-count">Step 2 of 2</span>
            <span className="profile-toggle">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Icon icon={SidebarRightIcon} />
                    Profile
                  </Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Business profile</SheetTitle>
                    <SheetDescription>What Spark knows so far.</SheetDescription>
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
                    <Bubble align="end">
                      <BubbleContent>{entry.text}</BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              ) : (
                <Message key={entry.id}>
                  <MessageAvatar>
                    <SparkMark />
                  </MessageAvatar>
                  <MessageContent>
                    {entry.from === 'import' ? (
                      <ImportMarker {...jobs[entry.job]} onSkip={() => skip(entry.job)} />
                    ) : (
                      <Stack gap={3}>
                        <Bubble variant="muted">
                          <BubbleContent>{entry.text}</BubbleContent>
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
                      <Spinner aria-label="Spark is typing" />
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            )}
          </MessageGroup>
          <div ref={end} />
        </main>

        <footer className="chat-composer">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <InputGroup>
              <InputGroupTextarea
                placeholder="Reply to Spark…"
                value={draft}
                rows={1}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    send(draft)
                  }
                }}
                autoFocus
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="submit"
                  size="icon-sm"
                  variant="default"
                  aria-label="Send"
                  disabled={!draft.trim() || busy}
                >
                  <Icon icon={ArrowUp02Icon} />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </footer>
      </div>

      <aside className="profile-panel" aria-label="Business profile">
        {panel(true)}
      </aside>
    </div>
  )
}
