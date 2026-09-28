import { useCallback, useState } from 'react'
import { ChatStep } from './ChatStep.tsx'
import { SourceStep } from './SourceStep.tsx'
import type { ImportRequest } from './types.ts'

type Step = { name: 'source' } | { name: 'chat'; request: ImportRequest }

export function Onboarding() {
  const [step, setStep] = useState<Step>({ name: 'source' })

  const toChat = useCallback((request: ImportRequest) => setStep({ name: 'chat', request }), [])
  const back = useCallback(() => setStep({ name: 'source' }), [])

  return step.name === 'chat' ? <ChatStep request={step.request} onBack={back} /> : <SourceStep onContinue={toChat} />
}
