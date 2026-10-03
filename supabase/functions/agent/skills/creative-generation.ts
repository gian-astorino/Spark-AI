import type { Skill } from './index.ts'

export default {
  name: 'creative-generation',
  description:
    "How to write the image prompt for an ad's creative and what to pass with it. Use it every time you call generate_ad_image, for a new image or a change to one.",
  body: `# Generating a creative

The image model is gpt-image. Write the prompt in English, short and direct. Ask it to create an ad for the offer, in the chosen format, with a modern look that blends in with organic content: it should feel native in the feed, like a post the brand would publish, not a classic banner.

A good prompt says:
- what is promoted: the offer, with its price if there is one (Italian format, "49 €");
- the format: square feed post (2048x2048), story or reel (1440x2560);
- the look: modern, clean, native to the feed, in the brand's style;
- the exact text to appear on the image, in quotes, as few words as possible;
- that the attached image is the brand's: keep its logo, colours and identity exactly as they are.

Always pass the brand's image as a reference ("logo" in references). Add a photo of the business ("photo:<id>") when the ad should show the real place, team or work.

The image model writes all the text on the image itself: nothing is laid over it later.`,
} satisfies Skill
