import type { Skill } from './index.ts'

export default {
  name: 'ad-editing',
  description:
    "Change an existing ad: its copy, offer, target or angle, or its image (a new version, an edit of the current one, another format). Use it when the owner asks to modify, fix, adapt or vary an ad they already have.",
  body: `# Editing an ad

1. Find it: read_context "ads" lists them (newest first); "ad" with its id gives everything, including its images. When the owner says "l'ultima" or "questa", it is the one discussed most recently.
2. Look before you touch the image: view_image "ad_image:<id>" shows the current one.
3. Copy or strategy: save_ad with its ad_id and the whole content as it should now be (what you leave out is cleared, so carry over what stays). Keep what the owner did not ask to change.
4. Image: every change is a new image (creative-generation skill); the previous ones stay.
   - To adjust the current image (a word, a colour, the price), call generate_ad_image with the current image as a reference ("ad_image:<id>") and a prompt that says exactly what to change and that everything else stays the same.
   - To redo it, start over as for a new ad, with the new brief.
   - Another format of the same ad (story, square): the current image as a reference and the new size.
5. A different ad altogether (another offer or target) is a new ad: save_ad with ad_id null, so both can be compared.
6. Say in one or two sentences what changed.`,
} satisfies Skill
