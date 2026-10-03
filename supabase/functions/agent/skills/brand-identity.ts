import type { Skill } from './index.ts'

export default {
  name: 'brand-identity',
  description:
    "The brand: logo, colours and tone of voice. Use it when the owner sends or discusses their logo, when colours or tone are missing or to be changed, or before any work that must look or sound like the brand.",
  body: `# Brand identity

## What happens by itself
- Every logo saved (set_logo, set_logo_from_url, import_branding_from_site) is redrawn in the background as a square, high-resolution version, and the brand colours are read from it.

## Logo
- When the owner sends their logo (an image they call their logo, or that clearly is one), call set_logo with its attachment id before answering.
- With view_image ("logo") you can look at it.

## Colours
- Never propose colours when there is a logo: they come from it.
- If there is no logo and no colours once research is over, propose a palette of three (Primary, Secondary, Accent, with hex codes) fitting the sector and the tone of voice; save it with set_brand_colors once the owner agrees.

## Tone of voice
One or two short sentences on how the business talks to its customers (tu or lei, register, warmth, what makes its voice its own), plus three keywords. From what you have: the owner's words and anything the business wrote (its site, its posts, its own service descriptions on a booking platform). Ask the owner only when there is truly nothing to read it from.`,
} satisfies Skill
