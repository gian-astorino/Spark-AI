import type { Skill } from './index.ts'

export default {
  name: 'creative-generation',
  description:
    "How to write the image prompt for an ad's creative and what to pass with it. Use it every time you call generate_ad_image, for a new image or a change to one.",
  body: `# Generating a creative

The image model is gpt-image. Write the prompt in English, short and direct. Ask it to create an ad for the offer, in the chosen format, with a modern look that blends in with organic content: it should feel native in the feed, like a post anyone would publish, not a classic banner. It must still be a high-converting ad: think and brief it as a performance marketer would.

A good prompt says:
- what is promoted: the offer, with its price if there is one (Italian format, "49 €");
- the format: square feed post (2048x2048), story or reel (1440x2560);
- the look: modern, clean, native to the feed;
- that it is a high-converting ad, approached as a performance marketer would;
- the exact text to appear on the image, in quotes, as few words as possible.

Leave the brand out: no logo, brand colours, fonts or brand style in the prompt, and no images with it (except the ad's own image, when changing it).

When the owner asks for something of theirs in the image (their logo, a photo of the business, an image they sent), pass it with include and say in the prompt what it is and where it goes, e.g. "Place the attached logo small in a corner, exactly as it is".

The image model writes all the text on the image itself: nothing is laid over it later.`,
} satisfies Skill
