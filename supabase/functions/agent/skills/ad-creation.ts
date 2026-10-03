import type { Skill } from './index.ts'

export default {
  name: 'ad-creation',
  description:
    'Turn a campaign decision into an ad: save it (strategy, copy, creative brief) and generate its image with the brand as the style reference. Use it after campaign-strategy, or when the owner asks directly for an ad, a post image or a creative.',
  body: `# Creating an ad

## 1. Save it
save_ad with ad_id null creates it (the app shows it as a card in the chat). Fill:
- name: short, in Italian, what it promotes.
- objective: what it is for.
- strategy: the decisions behind it as label/text pairs (product, offer, target, problem, angle, expected CPL, awareness…), Italian labels.
- copy: primary_text (first line under 125 characters), headline (under 40 characters), description (optional), cta (one of BOOK_NOW, LEARN_MORE, SEND_MESSAGE, CALL_NOW, GET_OFFER, SIGN_UP, SHOP_NOW, CONTACT_US).
- creative: format, brief (what the image must show), text_on_image (the exact words on the image, short).

## 2. The image
generate_ad_image takes the prompt you write and reference images. The image model writes all the text on the image itself: nothing is laid over it later.
- Keep the prompt short and concrete. The image model decides the rest. A good shape:
  "Create a simple, clean square ad for Instagram and Facebook for <business name>.
  Offer: "<product>: <offer> (<price>)"
  Visual: <the brief>
  Text on the image, exactly: "<text_on_image>"
  Use the attachments to influence the visual style of the final image."
- References: "brand_board" when there is one (it carries logo, colours, fonts and style), otherwise "logo". Add a photo of the business ("photo:<id>", see read_context "photos") when the ad should show the real place, team or work.
- Size: 2048x2048 for feed by default; 1440x2560 for stories and reels.
- Prices in Italian format ("49 €", "48,50 €").
The image takes a minute or two; the card in the chat shows it when ready. Say so, and do not wait for it.

## 3. Afterwards
Status "approved" when the owner approves the ad, "archived" when they drop it. Changes go through the ad-editing skill.`,
} satisfies Skill
