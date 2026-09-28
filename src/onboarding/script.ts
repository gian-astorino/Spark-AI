// The few lines the app says itself, and how it tells the agent what happened.
// Everything else in the conversation comes from the agent.

export const WAITING = "Hi, I'm Spark. Give me a moment while I read your website."

export const EVENTS = {
  noWebsite: "The owner has no website. Greet them and start collecting the profile by chat.",
  siteDone: (summary: string) =>
    `The research on the business finished; results are in the profile. Its notes: ${summary} Tell the owner briefly what you found and where, then ask for the most important thing still missing.`,
  siteFailed: "The website could not be read. Tell the owner, and start collecting the profile by chat.",
  siteSkipped: 'The owner skipped the website import. Start collecting the profile by chat.',
  extraDone: (url: string, summary: string) =>
    `The owner pasted ${url} and the research on it finished; anything new is in the profile. Its notes: ${summary} Tell them what it added, then continue.`,
  extraFailed: (url: string) => `The owner pasted ${url} but it could not be read. Tell them, and continue.`,
}

/** The first http(s) link or bare domain in a message. */
export function findLink(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s]+|(?<![@\w.])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i)
  if (!match) return null
  const link = match[0].replace(/[.,;)]+$/, '')
  return link.startsWith('http') ? link : `https://${link}`
}
