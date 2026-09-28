import type { ImportRequest } from './types.ts'

// Mock conversation. The real agent replaces all of this.

export function openingLine(request: ImportRequest): string {
  if (request.source === 'none') {
    return "Hi, I'm Spark. No website needed: we'll build the picture together. What's your business called, and what do you do?"
  }
  return "Hi, I'm Spark. Give me a moment while I read what you have online."
}

export const AFTER_IMPORT =
  "Done. Everything I found is in the panel on the right. Did I get it right? Correct anything that's off, or add what I missed."

export const AFTER_SKIP =
  "No problem, let's do it by chat. What's your business called, and what do you do?"

export const FOLLOW_UPS = [
  'Got it. Who is your ideal customer? The more specific, the better.',
  'What makes you different from the competition nearby?',
  'Is there a goal for the next three months? More bookings, a new service, a launch?',
  "Thanks, that's plenty to start with. You can keep adding context here any time.",
]
