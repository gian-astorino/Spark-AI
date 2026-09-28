import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Inline,
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Progress,
  Spinner,
  Stack,
} from '@skyground-media/pipelean-design-system'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { Icon } from './Icon.tsx'
import { displayUrl, type ImportRequest } from './types.ts'

// Mock only: the real scraping replaces this timer.
const TASKS = ['Reading your pages', 'Finding your products and services', 'Picking up your tone of voice']
const TASK_MS = 1100

export function ImportStep({
  request,
  onDone,
  onSkip,
}: {
  request: ImportRequest
  onDone: () => void
  onSkip: () => void
}) {
  const [done, setDone] = useState(0)

  useEffect(() => {
    if (done === TASKS.length) {
      const timer = setTimeout(onDone, 500)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setDone((n) => n + 1), TASK_MS)
    return () => clearTimeout(timer)
  }, [done, onDone])

  const label = request.source === 'instagram' ? `@${request.target}` : displayUrl(request.target)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importing from {label}</CardTitle>
        <CardDescription>This takes a few seconds. You can skip it and just chat instead.</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={4}>
          <Progress value={(done / TASKS.length) * 100} />
          <ItemGroup>
            {TASKS.map((task, index) => (
              <Item key={task} size="sm">
                <ItemMedia variant="icon">
                  {index < done ? <Icon icon={CheckmarkCircle02Icon} /> : index === done ? <Spinner /> : null}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{task}</ItemTitle>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </Stack>
      </CardContent>
      <CardFooter>
        <Inline justify="end">
          <Button variant="ghost" onClick={onSkip}>
            Skip import
          </Button>
        </Inline>
      </CardFooter>
    </Card>
  )
}
