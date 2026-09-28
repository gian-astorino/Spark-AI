import { useState } from 'react'
import {
  Button,
  ButtonGroup,
  ButtonGroupText,
  EmptyMedia,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Stack,
} from '@skyground-media/pipelean-design-system'
import { Globe02Icon, InstagramIcon, Message01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Icon } from './Icon.tsx'
import { SparkMark } from './SparkMark.tsx'
import type { ImportRequest, Source } from './types.ts'

const OPTIONS: { value: Source; title: string; description: string; icon: IconSvgElement; disabled?: boolean }[] = [
  { value: 'website', title: 'Il mio sito', description: 'Importa dal tuo sito', icon: Globe02Icon },
  { value: 'instagram', title: 'Instagram', description: 'Presto disponibile', icon: InstagramIcon, disabled: true },
  { value: 'none', title: 'Non ho un sito', description: 'Parti da una breve chat', icon: Message01Icon },
]

export function SourceStep({ onContinue }: { onContinue: (request: ImportRequest) => void }) {
  const [source, setSource] = useState<Source>('website')
  const [website, setWebsite] = useState('')
  const [handle, setHandle] = useState('')

  const target =
    source === 'website' && website.trim()
      ? `https://${website.trim()}`
      : source === 'instagram'
        ? handle.trim()
        : ''
  const canContinue = source === 'none' || target.length > 0

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (canContinue) onContinue({ source, target })
  }

  function detail(value: Source) {
    if (value !== source) return null
    if (value === 'website') {
      return (
        <ButtonGroup aria-label="Indirizzo del sito">
          <ButtonGroupText>https://</ButtonGroupText>
          <Input
            aria-label="Indirizzo del sito"
            inputMode="url"
            autoComplete="url"
            placeholder="tuaattivita.it"
            value={website}
            // Pasting a full URL keeps only what comes after the fixed prefix.
            onChange={(event) => setWebsite(event.target.value.replace(/^\s*https?:\/\//i, ''))}
            autoFocus
          />
        </ButtonGroup>
      )
    }
    if (value === 'instagram') {
      return (
        <ButtonGroup aria-label="Profilo Instagram">
          <ButtonGroupText>@</ButtonGroupText>
          <Input
            aria-label="Profilo Instagram"
            placeholder="tuaattivita"
            value={handle}
            onChange={(event) => setHandle(event.target.value.replace(/^\s*@/, ''))}
            autoFocus
          />
        </ButtonGroup>
      )
    }
    return null
  }

  return (
    <div className="welcome">
      <header className="welcome-top">
        <SparkMark withName />
        <span className="step-count">Passo 1 di 2</span>
      </header>

      <form className="welcome-body" onSubmit={submit}>
        <Stack gap={8}>
          <div className="page-heading">
            <h1>Conosciamo la tua attività</h1>
            <p>Spark impara da quello che hai già online. Scegli da dove partire.</p>
          </div>

          <RadioGroup value={source} onValueChange={(value) => setSource(value as Source)}>
            <Stack gap={3}>
              {OPTIONS.map((option) => (
                <FieldLabel key={option.value} htmlFor={`source-${option.value}`}>
                  <Field orientation="horizontal" data-disabled={option.disabled}>
                    {/* EmptyMedia borrowed for its grey tile: the DS has no media container for this yet. */}
                    <EmptyMedia variant="icon">
                      <Icon icon={option.icon} size={20} />
                    </EmptyMedia>
                    <FieldContent>
                      <FieldTitle>{option.title}</FieldTitle>
                      <FieldDescription>{option.description}</FieldDescription>
                      {detail(option.value)}
                    </FieldContent>
                    <RadioGroupItem value={option.value} id={`source-${option.value}`} disabled={option.disabled} />
                  </Field>
                </FieldLabel>
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

      <footer className="welcome-note">Potrai modificare tutto in seguito.</footer>
    </div>
  )
}
