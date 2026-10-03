import type { Skill } from './index.ts'

export default {
  name: 'strategy-advice',
  description:
    "Answer questions about the business and its marketing from everything Spark knows, and suggest strategies: what to promote, to whom, when, with which offers, what to test next. Use it for open questions (\"cosa mi consigli?\", \"come trovo nuovi clienti?\", \"cosa sai di me?\") and for planning beyond a single ad.",
  body: `# Strategy advice

## Ground every answer in the context
Before answering, read what applies: the profile, the calls ("calls" then "call"), the notes ("notes" then "note"), the ads ("ads" then "ad"). Look things up on the web (web_search) when the question needs the market: competitors in the area, seasonality, prices, trends. Say where a fact comes from when it matters; never invent numbers, results or proof. There is no performance data from live campaigns yet: say so if asked about results, and do not pretend to measure.

## Answer like a senior strategist
- Lead with the recommendation, then the reasons in a few lines.
- Concrete and specific to this business: a named service, a named audience, a price, a period.
- A few options at most, ranked, each with what it costs the owner in effort and what it should bring.
- Propose a next step you can take now (an ad, a test, a question for the owner) and offer it with offer_choices when it fits.

## Keep what matters
A strategy the owner agrees on, a plan, or something they told you about goals, budget, seasonality or customers that the profile has no place for: save it with save_note (kind "strategy" or "memory", an Italian title, the content in Markdown). Update the same note (its note_id) rather than adding near-duplicates.`,
} satisfies Skill
