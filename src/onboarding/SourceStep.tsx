import { useState } from 'react'
import {
  Button,
  ButtonGroup,
  ButtonGroupText,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyMedia,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
  Inline,
  Input,
  RadioGroup,
  RadioGroupItem,
  Stack,
} from '@skyground-media/pipelean-design-system'
import { Globe02Icon, InstagramIcon, Store01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Icon } from './Icon.tsx'
import type { ImportRequest, Source } from './types.ts'

const OPTIONS: { value: Source; title: string; description: string; icon: IconSvgElement }[] = [
  {
    value: 'website',
    title: 'My website',
    description: 'We read your pages to learn what you sell and how you talk about it.',
    icon: Globe02Icon,
  },
  {
    value: 'instagram',
    title: 'Instagram',
    description: 'We look at your profile and recent posts to pick up your style.',
    icon: InstagramIcon,
  },
  {
    value: 'none',
    title: "I don't have a website",
    description: 'No problem: tell Spark about your business in a quick chat.',
    icon: Store01Icon,
  },
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
        <ButtonGroup aria-label="Website address">
          <ButtonGroupText>https://</ButtonGroupText>
          <Input
            aria-label="Website address"
            inputMode="url"
            autoComplete="url"
            placeholder="yourbusiness.com"
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
        <ButtonGroup aria-label="Instagram profile">
          <ButtonGroupText>@</ButtonGroupText>
          <Input
            aria-label="Instagram profile"
            placeholder="yourbusiness"
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
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Let's get to know your business</CardTitle>
          <CardDescription>
            Spark can start from what you already have online. Where should we import from?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={source} onValueChange={(value) => setSource(value as Source)}>
            <Stack gap={3}>
              {OPTIONS.map((option) => (
                <FieldLabel key={option.value} htmlFor={`source-${option.value}`}>
                  <Field orientation="horizontal">
                    {/* EmptyMedia borrowed for its grey tile: the DS has no media container for this yet. */}
                    <EmptyMedia variant="icon">
                      <Icon icon={option.icon} size={20} />
                    </EmptyMedia>
                    <FieldContent>
                      <FieldTitle>{option.title}</FieldTitle>
                      <FieldDescription>{option.description}</FieldDescription>
                      {detail(option.value)}
                    </FieldContent>
                    <RadioGroupItem value={option.value} id={`source-${option.value}`} />
                  </Field>
                </FieldLabel>
              ))}
            </Stack>
          </RadioGroup>
        </CardContent>
        <CardFooter>
          <Inline justify="end">
            <Button type="submit" disabled={!canContinue}>
              Continue
            </Button>
          </Inline>
        </CardFooter>
      </Card>
    </form>
  )
}
