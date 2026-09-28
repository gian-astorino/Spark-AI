import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bubble,
  BubbleContent,
  BubbleGroup,
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
import { SparkMark } from './SparkMark.tsx'
import { ImportMarker } from './ImportMarker.tsx'
import { ProfilePanel } from './ProfilePanel.tsx'
import { mockProfile } from './profile.ts'
import { AFTER_IMPORT, AFTER_SKIP, FOLLOW_UPS, openingLine } from './script.ts'
import { displayUrl, type ImportRequest } from './types.ts'
import { useImport } from './useImport.ts'

type Entry =
  | { id: number; from: 'agent' | 'user'; text: string; quickReplies?: boolean }
  | { id: number; from: 'import' }

const REPLY_MS = 900
let nextId = 0

export function ChatStep({ request, onBack }: { request: ImportRequest; onBack: () => void }) {
  const importing = useImport(request)
  const profile = useMemo(() => mockProfile(request), [request])
  const [entries, setEntries] = useState<Entry[]>(() => [
    { id: nextId++, from: 'agent', text: openingLine(request) },
    ...(request.source === 'none' ? [] : [{ id: nextId++, from: 'import' as const }]),
  ])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const followUp = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  // The agent speaks once the import settles, either way.
  useEffect(() => {
    if (importing.status === 'done' || importing.status === 'skipped') {
      const text = importing.status === 'done' ? AFTER_IMPORT : AFTER_SKIP
      const quickReplies = importing.status === 'done'
      setEntries((current) => [...current, { id: nextId++, from: 'agent', text, quickReplies }])
    }
  }, [importing.status])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, thinking])

  function send(text: string) {
    const message = text.trim()
    if (!message || thinking) return
    setEntries((current) => [...current, { id: nextId++, from: 'user', text: message }])
    setDraft('')
    setThinking(true)
    setTimeout(() => {
      const reply = FOLLOW_UPS[Math.min(followUp.current, FOLLOW_UPS.length - 1)]
      followUp.current += 1
      setEntries((current) => [...current, { id: nextId++, from: 'agent', text: reply }])
      setThinking(false)
    }, REPLY_MS)
  }

  const label = request.source === 'instagram' ? `@${request.target}` : displayUrl(request.target)
  const busy = thinking || importing.status === 'running'
  const answered = entries.some((entry) => entry.from === 'user')
  const panel = <ProfilePanel profile={profile} sectionState={importing.sectionState} />

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
                    <BubbleGroup>
                      <Bubble align="end">
                        <BubbleContent>{entry.text}</BubbleContent>
                      </Bubble>
                    </BubbleGroup>
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
                        {entry.quickReplies && !answered && (
                          <Inline gap={2}>
                            <Button variant="outline" size="sm" onClick={() => send('Looks right.')}>
                              Looks right
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => send('Some of this is off, let me fix it.')}
                            >
                              Some of this is off
                            </Button>
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
