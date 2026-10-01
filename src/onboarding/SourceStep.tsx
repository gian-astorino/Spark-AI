import { useEffect, useRef, useState } from 'react'
import {
  Button,
  ButtonGroup,
  ButtonGroupText,
  FieldDescription,
  FieldTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Stack,
} from '@skyground-media/pipelean-design-system'
import { Globe02Icon, Chatting01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { FallingBooksIcon } from './FallingBooksIcon.tsx'
import { Icon } from './Icon.tsx'
import { SparkMark } from './SparkMark.tsx'
import type { ImportRequest, Source } from './types.ts'

const OPTIONS: { value: Source; title: string; description: string; icon: IconSvgElement; disabled?: boolean }[] = [
  { value: 'website', title: 'Il mio sito', description: 'Importa dal tuo sito', icon: Globe02Icon },
  { value: 'none', title: 'Non ho un sito', description: 'Parti da una breve chat', icon: Chatting01Icon },
]

export function SourceStep({ onContinue }: { onContinue: (request: ImportRequest) => void }) {
  const [source, setSource] = useState<Source>('website')
  const [website, setWebsite] = useState('')
  const inputs = useRef<Partial<Record<Source, HTMLInputElement | null>>>({})

  // The field of the chosen option gets the focus once it starts opening.
  useEffect(() => {
    inputs.current[source]?.focus({ preventScroll: true })
  }, [source])

  // Instagram is set aside for now: the options are the site or a chat.
  const target = source === 'website' && website.trim() ? `https://${website.trim()}` : ''
  const canContinue = source === 'none' || target.length > 0

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (canContinue) onContinue({ source, target })
  }

  /**
   * The address field of an option. Always rendered, and opened or closed by
   * height, so the card grows and shrinks smoothly instead of jumping; while
   * closed it is inert (no focus, not announced).
   */
  function detail(value: Source) {
    if (value === 'none') return null
    const open = value === source
    const field = (
      <ButtonGroup aria-label="Indirizzo del sito">
        <ButtonGroupText>https://</ButtonGroupText>
        <Input
          ref={(element) => {
            inputs.current.website = element
          }}
          aria-label="Indirizzo del sito"
          inputMode="url"
          autoComplete="url"
          placeholder="tuaattivita.it"
          value={website}
          // Pasting a full URL keeps only what comes after the fixed prefix.
          onChange={(event) => setWebsite(event.target.value.replace(/^\s*https?:\/\//i, ''))}
        />
      </ButtonGroup>
    )
    return (
      <div className="reveal" data-open={open} inert={!open}>
        <div className="reveal-inner">{field}</div>
      </div>
    )
  }

  return (
    <div className="welcome">
      <header className="welcome-top">
        <SparkMark withName />
      </header>

      <form className="welcome-body" onSubmit={submit}>
        <Stack gap={8}>
          <Stack gap={4} align="center">
            <FallingBooksIcon size={48} />
            <div className="page-heading">
              <h1>Contesto</h1>
              <p>Lascia che l'AI recuperi le informazioni sulla tua attività e sul tuo catalogo.</p>
            </div>
          </Stack>

          <RadioGroup value={source} onValueChange={(value) => setSource(value as Source)}>
            <Stack gap={3}>
              {OPTIONS.map((option) => (
                // Spark's own choice card: the field sits in the card but outside
                // the label, so typing in it highlights the field, not the card.
                <div
                  key={option.value}
                  className="choice-card"
                  data-selected={option.value === source}
                  data-disabled={option.disabled || undefined}
                >
                  <label className="choice-card-label" htmlFor={`source-${option.value}`}>
                    <span className="source-tile" aria-hidden>
                      <Icon icon={option.icon} size={20} />
                    </span>
                    <span className="choice-card-text">
                      <FieldTitle>{option.title}</FieldTitle>
                      <FieldDescription>{option.description}</FieldDescription>
                    </span>
                    <RadioGroupItem value={option.value} id={`source-${option.value}`} disabled={option.disabled} />
                  </label>
                  {detail(option.value)}
                </div>
              ))}
            </Stack>
          </RadioGroup>

          <div className="stretch">
            <Button type="submit" size="lg" disabled={!canContinue}>
              Continua
            </Button>
          </div>
        </Stack>
      </form>

    </div>
  )
}
