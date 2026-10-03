// The few lines the app says itself, and how it tells the agent what happened.
// Everything else in the conversation comes from the agent.

export const WAITING = 'Ciao, sono Spark. Dammi un momento mentre leggo il tuo sito.'

export const EVENTS = {
  website: (url: string) => `A new workspace. The owner gave this link as their business: ${url}`,
  noWebsite: 'A new workspace. The owner has no website.',
}
