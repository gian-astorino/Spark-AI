import { useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
  Inline,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  ItemMedia,
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

  const target = source === 'website' ? website.trim() : source === 'instagram' ? handle.trim() : ''
  const canContinue = source === 'none' || target.length > 0

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (canContinue) onContinue({ source, target })
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
          <Stack gap={4}>
            <RadioGroup value={source} onValueChange={(value) => setSource(value as Source)}>
              <Stack gap={3}>
                {OPTIONS.map((option) => (
                  <FieldLabel key={option.value} htmlFor={`source-${option.value}`}>
                    <Field orientation="horizontal">
                      <ItemMedia variant="icon">
                        <Icon icon={option.icon} />
                      </ItemMedia>
                      <FieldContent>
                        <FieldTitle>{option.title}</FieldTitle>
                        <FieldDescription>{option.description}</FieldDescription>
                      </FieldContent>
                      <RadioGroupItem value={option.value} id={`source-${option.value}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </Stack>
            </RadioGroup>

            {source === 'website' && (
              <Field>
                <FieldLabel htmlFor="website-url">Website address</FieldLabel>
                <Input
                  id="website-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://yourbusiness.com"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  autoFocus
                />
              </Field>
            )}

            {source === 'instagram' && (
              <Field>
                <FieldLabel htmlFor="instagram-handle">Instagram profile</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>@</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="instagram-handle"
                    placeholder="yourbusiness"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value.replace(/^@/, ''))}
                    autoFocus
                  />
                </InputGroup>
              </Field>
            )}
          </Stack>
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
