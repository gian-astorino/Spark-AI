import { useCallback, useState } from 'react'
import { Box, Container } from '@skyground-media/pipelean-design-system'
import { ChatStep } from './ChatStep.tsx'
import { ImportStep } from './ImportStep.tsx'
import { SourceStep } from './SourceStep.tsx'
import type { ImportRequest } from './types.ts'

type Step =
  | { name: 'source' }
  | { name: 'importing'; request: ImportRequest }
  | { name: 'chat'; request: ImportRequest }

const NO_IMPORT: ImportRequest = { source: 'none', target: '' }

export function Onboarding() {
  const [step, setStep] = useState<Step>({ name: 'source' })

  const toChat = useCallback((request: ImportRequest) => setStep({ name: 'chat', request }), [])
  const back = useCallback(() => setStep({ name: 'source' }), [])

  if (step.name === 'chat') return <ChatStep request={step.request} onBack={back} />

  return (
    <Container size="sm">
      <Box paddingY={{ base: 6, md: 12 }}>
        {step.name === 'source' ? (
          <SourceStep
            onContinue={(request) =>
              request.source === 'none' ? toChat(request) : setStep({ name: 'importing', request })
            }
          />
        ) : (
          <ImportStep
            request={step.request}
            onDone={() => toChat(step.request)}
            onSkip={() => toChat(NO_IMPORT)}
          />
        )}
      </Box>
    </Container>
  )
}
