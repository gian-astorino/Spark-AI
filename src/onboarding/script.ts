import { listing, missing, type Profile } from './profile.ts'

// Mock agent, until a real one reads the conversation. Each turn is a
// question, optional quick replies, when it is still worth asking, and how
// the answer lands in the profile.

export interface Turn {
  ask: string
  quickReplies?: string[]
  /** Skip the question when the profile already answers it. */
  needed?: (profile: Profile) => boolean
  apply?: (reply: string, profile: Profile) => Profile
}

export const WAITING = "Hi, I'm Spark. Give me a moment while I read your website."
export const NO_WEBSITE =
  "Hi, I'm Spark. No website needed: we'll build the picture together. If you're on Treatwell, Fresha or Google Maps, you can also paste that link and I'll read it."

const splitNames = (reply: string) =>
  reply
    .split(/,|\band\b|\be\b|&/i)
    .map((name) => name.trim().replace(/\.$/, ''))
    .filter(Boolean)

export const SCRIPT: Turn[] = [
  {
    ask: "What's your business called, and what do you do?",
    needed: (profile) => !profile.business?.name,
    apply: (reply) => {
      const [name, ...rest] = reply.split(/,|—|-/)
      return { business: { name: name.trim(), description: rest.join(',').trim() || undefined } }
    },
  },
  {
    ask: 'Which sector are you in?',
    quickReplies: ['Beauty & skincare', 'Hair salon', 'Wellness & spa', 'Nails'],
    needed: (profile) => !profile.business?.sector,
    apply: (reply) => ({ business: { sector: reply.replace(/\.$/, '') } }),
  },
  {
    ask: 'Where are you based, and what are your opening hours?',
    needed: (profile) => !profile.locations?.length,
    apply: (reply) => ({ locations: [{ address: reply, hours: [] }] }),
  },
  {
    ask: 'What are your opening hours?',
    needed: (profile) => !!profile.locations?.length && !profile.locations.some((location) => location.hours.length > 0),
    // Kept as written until an agent turns it into intervals.
    apply: (reply, profile) => ({
      locations: profile.locations!.map((location, index) =>
        index === 0 ? { ...location, hours: [{ days: 'Hours', time: reply }] } : location,
      ),
    }),
  },
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

/** The first turn at or after `from` still worth asking; -1 when none is. */
export function nextTurn(profile: Profile, from: number) {
  for (let index = from; index < SCRIPT.length; index++) {
    if (SCRIPT[index].needed?.(profile) ?? true) return index
  }
  return -1
}

const LINK_HINT =
  "If they're on another page (Treatwell, Fresha, Google Maps, a price list), paste the link and I'll read it. Or just tell me."

export function afterSiteImport(profile: Profile, pagesRead: number) {
  const gaps = missing(profile)
  const read = `I read ${pagesRead} ${pagesRead === 1 ? 'page' : 'pages'} of your site. Everything I found is in the panel.`
  return gaps.length === 0 ? `${read} I found all I need for now.` : `${read} I couldn't find ${listing(gaps)}. ${LINK_HINT}`
}

export const SITE_FAILED = `I couldn't read your site, so let's do it by chat. ${LINK_HINT}`

/** What an extra source added, compared with the profile before it. */
export function afterExtraImport(before: Profile, after: Profile, label: string) {
  const added: string[] = []
  if (!before.business?.name && after.business?.name) added.push('your business name')
  if (!before.business?.sector && after.business?.sector) added.push('your sector')
  const hours = (profile: Profile) => profile.locations?.some((location) => location.hours.length > 0)
  if ((after.locations?.length ?? 0) > (before.locations?.length ?? 0)) added.push('your address')
  if (!hours(before) && hours(after)) added.push('your opening hours')
  const newItems = (after.catalog?.length ?? 0) - (before.catalog?.length ?? 0)
  if (newItems > 0) added.push(`${newItems} ${newItems === 1 ? 'treatment' : 'treatments'}`)
  const priced = (profile: Profile) => profile.catalog?.filter((item) => item.price).length ?? 0
  if (priced(after) > priced(before) && newItems <= 0) added.push('prices')

  if (added.length === 0) return `I read ${label} but found nothing new there.`
  const gaps = missing(after)
  return `From ${label} I added ${listing(added)}.${gaps.length ? ` Still missing: ${listing(gaps)}.` : ''}`
}

export const EXTRA_FAILED = (label: string) => `I couldn't read ${label}. Check the link, or just tell me.`

export const AFTER_SCRIPT = 'Noted, I have added that to your profile.'

/** The first http(s) link or bare domain in a message. */
export function findLink(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s]+|(?<![@\w.])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i)
  if (!match) return null
  const link = match[0].replace(/[.,;)]+$/, '')
  return link.startsWith('http') ? link : `https://${link}`
}
