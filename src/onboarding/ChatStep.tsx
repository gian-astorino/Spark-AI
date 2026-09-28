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
import { Icon } from './Icon.tsx'
import { ImportMarker } from './ImportMarker.tsx'
import { ProfilePanel, type SectionState } from './ProfilePanel.tsx'
import { IMPORTABLE, MOCK_IMPORT, hasSection, mergeProfile, type Profile, type Section } from './profile.ts'
import { AFTER_IMPORT, AFTER_SCRIPT, FROM_CHAT, NO_WEBSITE, WAITING, type Turn } from './script.ts'
import { SparkMark } from './SparkMark.tsx'
import { displayUrl, type ImportRequest } from './types.ts'
import { useImport } from './useImport.ts'

type Entry =
  | { id: number; from: 'agent'; text: string; quickReplies?: string[] }
  | { id: number; from: 'user'; text: string }
  | { id: number; from: 'import' }

const REPLY_MS = 900
let nextId = 0

const agent = (turn: Turn): Entry => ({ id: nextId++, from: 'agent', text: turn.ask, quickReplies: turn.quickReplies })

export function ChatStep({ request, onBack }: { request: ImportRequest; onBack: () => void }) {
  const importing = useImport(request)
  const [entries, setEntries] = useState<Entry[]>(() =>
    request.source === 'none'
      ? [{ id: nextId++, from: 'agent', text: NO_WEBSITE }, agent(FROM_CHAT[0])]
      : [
          { id: nextId++, from: 'agent', text: WAITING },
          { id: nextId++, from: 'import' },
        ],
  )
  // The questions still to go through, and the one currently asked.
  const [script, setScript] = useState<Turn[]>(request.source === 'none' ? FROM_CHAT : [])
  const [turn, setTurn] = useState(0)
  const [answers, setAnswers] = useState<Profile>({})
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  // Once the import settles, either way, the agent takes over.
  useEffect(() => {
    if (importing.status !== 'done' && importing.status !== 'skipped') return
    const next = importing.status === 'done' ? AFTER_IMPORT : FROM_CHAT
    setScript(next)
    setTurn(0)
    setEntries((current) => [...current, agent(next[0])])
  }, [importing.status])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, thinking])

  // What the import has delivered so far, overlaid by what the chat has told us.
  const profile = useMemo(() => {
    let imported: Profile = {}
    if (importing.status !== 'skipped') {
      for (const section of IMPORTABLE.slice(0, importing.ready)) {
        imported = { ...imported, [section]: MOCK_IMPORT[section as keyof typeof MOCK_IMPORT] }
      }
    }
    return mergeProfile(imported, answers)
  }, [importing.status, importing.ready, answers])

  const sectionState = (section: Section): SectionState => {
    if (hasSection(profile, section)) return 'ready'
    return importing.status === 'running' && IMPORTABLE.includes(section) ? 'loading' : 'empty'
  }

  function send(text: string) {
    const message = text.trim()
    if (!message || thinking) return
    setEntries((current) => [...current, { id: nextId++, from: 'user', text: message }])
    setDraft('')

    const current = script[turn]
    if (current?.apply) {
      const patch = current.apply(message)
      setAnswers((previous) => mergeProfile(previous, patch))
    }

    setThinking(true)
    setTimeout(() => {
      const next = script[turn + 1]
      setEntries((list) => [...list, next ? agent(next) : { id: nextId++, from: 'agent', text: AFTER_SCRIPT }])
      if (next) setTurn(turn + 1)
      setThinking(false)
    }, REPLY_MS)
  }

  const label = request.source === 'instagram' ? `@${request.target}` : displayUrl(request.target)
  const busy = thinking || importing.status === 'running'
  const lastId = entries[entries.length - 1]?.id
  const panel = <ProfilePanel profile={profile} sectionState={sectionState} />

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
                  <div className="sheet-body">{panel}</div>
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
                      <ImportMarker
                        label={label}
                        status={importing.status}
                        ready={importing.ready}
                        onSkip={importing.skip}
                      />
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
        {panel}
      </aside>
    </div>
  )
}
