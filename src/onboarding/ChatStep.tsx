import { useEffect, useRef, useState } from 'react'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Bubble,
  BubbleContent,
  BubbleGroup,
  Button,
  Inline,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import { ArrowLeft02Icon, ArrowUp02Icon } from '@hugeicons/core-free-icons'
import { Icon } from './Icon.tsx'
import { AFTER_FINDINGS, FOLLOW_UPS, mockFindings, openingLines, type Finding } from './script.ts'
import type { ImportRequest } from './types.ts'

type Entry =
  | { id: number; from: 'agent'; text: string }
  | { id: number; from: 'agent'; findings: Finding[] }
  | { id: number; from: 'user'; text: string }

const REPLY_MS = 900
let nextId = 0

function initialEntries(request: ImportRequest): Entry[] {
  const entries: Entry[] = openingLines(request).map((text) => ({ id: nextId++, from: 'agent', text }))
  if (request.source !== 'none' && request.target) {
    entries.push({ id: nextId++, from: 'agent', findings: mockFindings(request) })
    entries.push({ id: nextId++, from: 'agent', text: AFTER_FINDINGS })
  }
  return entries
}

export function ChatStep({ request, onBack }: { request: ImportRequest; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>(() => initialEntries(request))
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const followUp = useRef(0)
  const end = useRef<HTMLDivElement>(null)

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

  const imported = request.source !== 'none' && request.target
  const showQuickReplies = imported && !entries.some((entry) => entry.from === 'user')

  return (
    <div className="chat">
      <header className="chat-header">
        <Inline gap={2} align="center">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
            <Icon icon={ArrowLeft02Icon} />
          </Button>
          <Avatar size="sm">
            <AvatarFallback>S</AvatarFallback>
          </Avatar>
          <ItemTitle>Spark</ItemTitle>
          <Badge variant="secondary">Onboarding</Badge>
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
                  <Avatar size="sm">
                    <AvatarFallback>S</AvatarFallback>
                  </Avatar>
                </MessageAvatar>
                <MessageContent>
                  {'findings' in entry ? (
                    <ItemGroup>
                      {entry.findings.map((finding) => (
                        <Item key={finding.label} variant="outline" size="sm">
                          <ItemContent>
                            <ItemDescription>{finding.label}</ItemDescription>
                            <ItemTitle>{finding.value}</ItemTitle>
                          </ItemContent>
                        </Item>
                      ))}
                    </ItemGroup>
                  ) : (
                    <Bubble variant="muted">
                      <BubbleContent>{entry.text}</BubbleContent>
                    </Bubble>
                  )}
                </MessageContent>
              </Message>
            ),
          )}
          {thinking && (
            <Message>
              <MessageAvatar>
                <Avatar size="sm">
                  <AvatarFallback>S</AvatarFallback>
                </Avatar>
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
        <Stack gap={3}>
          {showQuickReplies && (
            <Inline gap={2}>
              <Button variant="outline" size="sm" onClick={() => send('Looks right.')}>
                Looks right
              </Button>
              <Button variant="outline" size="sm" onClick={() => send("Some of this is off, let me fix it.")}>
                Some of this is off
              </Button>
            </Inline>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <InputGroup>
              <InputGroupTextarea
                placeholder="Tell Spark more about your business…"
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
                    disabled={!draft.trim() || thinking}
                  >
                    <Icon icon={ArrowUp02Icon} />
                  </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </Stack>
      </footer>
    </div>
  )
}
