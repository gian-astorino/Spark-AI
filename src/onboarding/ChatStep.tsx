import { useEffect, useMemo, useRef, useState } from 'react'
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
import { checkImport, createBusiness, loadProfile, startImport } from './backend.ts'
import { Icon } from './Icon.tsx'
import { ImportMarker, type MarkerStatus } from './ImportMarker.tsx'
import { ProfilePanel, type SectionState } from './ProfilePanel.tsx'
import { hasSection, mergeProfile, type Profile, type Section } from './profile.ts'
import {
  AFTER_SCRIPT,
  EXTRA_FAILED,
  NO_WEBSITE,
  SCRIPT,
  SITE_FAILED,
  WAITING,
  afterExtraImport,
  afterSiteImport,
  findLink,
  nextTurn,
} from './script.ts'
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
}

const REPLY_MS = 900
const POLL_MS = 3000
let nextId = 0

const say = (text: string, quickReplies?: string[]): Entry => ({ id: nextId++, from: 'agent', text, quickReplies })

export function ChatStep({ request, onBack }: { request: ImportRequest; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    request.source === 'website' ? [say(WAITING)] : [say(NO_WEBSITE), say(SCRIPT[0].ask)],
  )
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [imported, setImported] = useState<Profile>({})
  const [answers, setAnswers] = useState<Profile>({})
  // The question currently asked; -1 before the first one and once done.
  // A ref: it steers replies but is never rendered.
  const turn = useRef(request.source === 'website' ? -1 : 0)
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const business = useRef<Promise<string> | null>(null)
  const stopped = useRef(new Set<string>())

  // What the imports delivered, overlaid by what the chat has told us.
  const profile = useMemo(() => mergeProfile(imported, answers), [imported, answers])
  // Imports settle minutes after they start: read current state, not the closure's.
  const latest = useRef(profile)
  latest.current = profile
  const latestImported = useRef(imported)
  latestImported.current = imported
  const latestAnswers = useRef(answers)
  latestAnswers.current = answers

  /** The business row, created once, on first need. */
  function businessId() {
    business.current ??= createBusiness(request.source === 'website' ? request.target : undefined)
    return business.current
  }

  /** Starts an import, shows its marker, follows it, and reports when it settles. */
  async function runImport(url: string | undefined, label: string) {
    const primary = url === undefined
    const markerKey = `pending-${nextId}`
    let job = markerKey
    const update = (patch: Partial<Job>) => setJobs((current) => ({ ...current, [job]: { ...current[job], ...patch } }))
    setJobs((current) => ({ ...current, [job]: { label, primary, status: 'starting', pagesRead: 0, pagesTotal: 0 } }))
    setEntries((current) => [...current, { id: nextId++, from: 'import', job }])

    const settle = async (status: 'done' | 'failed', pagesRead: number) => {
      const before = latest.current
      const id = await businessId()
      const after = await loadProfile(id).catch(() => latestImported.current)
      setImported(after)
      const merged = mergeProfile(after, latestAnswers.current)
      let text: string
      if (primary) text = status === 'done' ? afterSiteImport(merged, pagesRead) : SITE_FAILED
      else text = status === 'done' ? afterExtraImport(before, merged, label) : EXTRA_FAILED(label)
      // Then pick the conversation back up where it is needed.
      const next = nextTurn(merged, primary ? 0 : Math.max(turn.current, 0))
      turn.current = next
      setEntries((list) => [...list, say(text), ...(next >= 0 ? [say(SCRIPT[next].ask, SCRIPT[next].quickReplies)] : [])])
    }

    try {
      const id = await businessId()
      const started = await startImport(id, url)
      // Re-key the marker from its placeholder to the real job id.
      setJobs((current) => {
        const { [markerKey]: pending, ...rest } = current
        return { ...rest, [started]: { ...pending, status: 'running' } }
      })
      setEntries((current) => current.map((entry) => (entry.from === 'import' && entry.job === markerKey ? { ...entry, job: started } : entry)))
      if (stopped.current.has(markerKey)) stopped.current.add(started)
      job = started

      while (!stopped.current.has(job)) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        if (stopped.current.has(job)) return
        const progress = await checkImport(job)
        update({ status: progress.status, pagesRead: progress.pagesRead, pagesTotal: progress.pagesTotal })
        if (progress.status !== 'running') return settle(progress.status, progress.pagesRead)
      }
    } catch (error) {
      console.error(error)
      if (stopped.current.has(job)) return
      update({ status: 'failed' })
      return settle('failed', 0)
    }
  }

  function skip(job: string) {
    stopped.current.add(job)
    setJobs((current) => ({ ...current, [job]: { ...current[job], status: 'skipped' } }))
    if (jobs[job]?.primary) {
      const next = nextTurn(latest.current, 0)
      turn.current = next
      if (next >= 0) setEntries((list) => [...list, say(SCRIPT[next].ask, SCRIPT[next].quickReplies)])
    }
  }

  // The business's own site, once.
  const startedSite = useRef(false)
  useEffect(() => {
    if (request.source !== 'website' || startedSite.current) return
    startedSite.current = true
    void runImport(undefined, displayUrl(request.target))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, thinking])

  const sectionState = (section: Section): SectionState => {
    if (hasSection(profile, section)) return 'ready'
    const siteRunning = Object.values(jobs).some((job) => job.primary && (job.status === 'starting' || job.status === 'running'))
    return siteRunning && section !== 'calendar' ? 'loading' : 'empty'
  }

  function send(text: string) {
    const message = text.trim()
    if (!message || thinking) return
    setEntries((current) => [...current, { id: nextId++, from: 'user', text: message }])
    setDraft('')

    // A link is a source to read, not an answer.
    const link = findLink(message)
    if (link) {
      void runImport(link, displayUrl(link))
      return
    }

    const current = turn.current >= 0 ? SCRIPT[turn.current] : undefined
    const patch = current?.apply?.(message, profile)
    if (patch) setAnswers((previous) => mergeProfile(previous, patch))
    const after = patch ? mergeProfile(profile, patch) : profile

    setThinking(true)
    setTimeout(() => {
      const next = turn.current >= 0 ? nextTurn(after, turn.current + 1) : -1
      turn.current = next
      setEntries((list) => [...list, next >= 0 ? say(SCRIPT[next].ask, SCRIPT[next].quickReplies) : say(AFTER_SCRIPT)])
      setThinking(false)
    }, REPLY_MS)
  }

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
