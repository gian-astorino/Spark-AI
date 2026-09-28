import { displayUrl, type ImportRequest } from './types.ts'

// Mock conversation. The real agent replaces all of this.

export interface Finding {
  label: string
  value: string
}

export function mockFindings(request: ImportRequest): Finding[] {
  return [
    { label: 'Business', value: 'Independent skincare studio in Milan' },
    { label: 'Offer', value: 'Facial treatments, peels, seasonal packages' },
    { label: 'Audience', value: 'Women 28–50, local, repeat clients' },
    {
      label: 'Tone',
      value: request.source === 'instagram' ? 'Warm, visual, lots of before/after' : 'Warm, expert, reassuring',
    },
  ]
}

export function openingLines(request: ImportRequest): string[] {
  if (request.source === 'none' || !request.target) {
    return [
      "Hi, I'm Spark. No website needed: we'll build the picture together.",
      "Let's start simple: what's your business called, and what do you do?",
    ]
  }
  const where = request.source === 'instagram' ? `@${request.target} on Instagram` : displayUrl(request.target)
  return [`Hi, I'm Spark. I went through ${where}. Here's what I picked up:`]
}

export const AFTER_FINDINGS = 'Did I get it right? Correct anything that is off, or add what I missed.'

export const FOLLOW_UPS = [
  'Got it. Who is your ideal customer? The more specific, the better.',
  'What makes you different from the competition nearby?',
  'Is there a goal for the next three months? More bookings, a new service, a launch?',
  "Thanks, that's plenty to start with. You can keep adding context here any time.",
]
