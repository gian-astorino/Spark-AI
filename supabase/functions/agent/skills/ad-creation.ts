import type { Skill } from './index.ts'

export default {
  name: 'ad-creation',
  description:
    'Turn a campaign into an ad: save it and generate its image. Use it after campaign-strategy, or when the owner asks directly for an ad, a post image or a creative.',
  body: `# Creating an ad

1. Save the ad with save_ad (ad_id null for a new one): the app shows it as a card in the chat.
2. Generate its image with generate_ad_image. The prompt for the image model, the reference images (brand board, logo, photos of the business, attachments) and the format are yours to decide. The image model writes any text on the image itself: nothing is laid over it later.

The image takes a minute or two and appears on the card by itself: do not wait for it.`,
} satisfies Skill
