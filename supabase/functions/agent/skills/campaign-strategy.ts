import type { Skill } from './index.ts'

export default {
  name: 'campaign-strategy',
  description:
    'Find the best Meta Ads campaign to acquire new customers for this business, from everything known about it. Use it for the first campaign, or whenever the owner asks for a new campaign or ad idea.',
  body: `# Campaign strategy

Find the best strategy for a campaign that acquires new customers for this business, given its context.

Read whatever context you need first (read_context: profile, calls, notes, ads already made). Ads can only be static images: no video.

Answer the owner in the chat with your strategy. Do not save an ad or generate images: that happens only when the owner asks you to create the ad (ad-creation skill).`,
} satisfies Skill
