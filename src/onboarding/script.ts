import type { Profile } from './profile.ts'

// Mock agent. The real one replaces all of this: here each turn is a question,
// optional quick replies, and how the answer lands in the profile.

export interface Turn {
  ask: string
  quickReplies?: string[]
  apply?: (reply: string) => Profile
}

export const WAITING = "Hi, I'm Spark. Give me a moment while I read what you have online."
export const NO_WEBSITE = "Hi, I'm Spark. No website needed: we'll build the picture together."

const splitNames = (reply: string) =>
  reply
    .split(/,|\band\b|\be\b|&/i)
    .map((name) => name.trim().replace(/\.$/, ''))
    .filter(Boolean)

const CALENDAR: Turn[] = [
  {
    ask: "Now your calendar. Who's on the team? Give me the names of everyone who takes appointments.",
    apply: (reply) => ({ calendar: { members: splitNames(reply) } }),
  },
  {
    ask: 'Which calendar do you use for bookings today?',
    quickReplies: ['Google Calendar', 'Fresha', 'Treatwell', 'Paper diary'],
    apply: (reply) => ({ calendar: { tool: reply.replace(/\.$/, '') } }),
  },
  { ask: "Thanks, that's everything I need to get started. You can keep adding context here any time." },
]

export const AFTER_IMPORT: Turn[] = [
  {
    ask: "Done. Everything I found is in the panel on the right. Did I get it right? Correct anything that's off, or add what I missed.",
    quickReplies: ['Looks right', 'Some of this is off'],
  },
  ...CALENDAR,
]

export const FROM_CHAT: Turn[] = [
  {
    ask: "What's your business called, and what do you do?",
    apply: (reply) => {
      const [name, ...rest] = reply.split(/,|—|-/)
      return { business: { name: name.trim(), description: rest.join(',').trim() || undefined } }
    },
  },
  {
    ask: 'Which sector are you in?',
    quickReplies: ['Beauty & skincare', 'Hair salon', 'Wellness & spa', 'Fitness'],
    apply: (reply) => ({ business: { sector: reply.replace(/\.$/, '') } }),
  },
  {
    ask: 'Where are you based, and what are your opening hours?',
    apply: (reply) => ({ location: { address: reply } }),
  },
  ...CALENDAR,
]

export const AFTER_SCRIPT = 'Noted, I have added that to your profile.'
