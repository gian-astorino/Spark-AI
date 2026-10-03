import type { Skill } from './index.ts'

export default {
  name: 'ad-creation',
  description:
    'Create an ad and generate its image. Use it only when the owner explicitly asks to create or generate the ad, a post image or a creative, for an offer they agreed on.',
  body: `# Creating an ad

Only when the owner has asked for it, for an offer they agreed on. If the offer is not settled yet, propose it and ask first. One ad per request, unless they ask for more.

1. Save the ad with save_ad (ad_id null for a new one): the app shows its preview in the chat.
2. Generate its image with generate_ad_image, following the creative-generation skill.

The image takes a minute or two and appears on the preview by itself: do not wait for it.`,
} satisfies Skill
