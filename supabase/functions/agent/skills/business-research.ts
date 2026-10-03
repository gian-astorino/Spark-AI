import type { Skill } from './index.ts'

export default {
  name: 'business-research',
  description:
    'Research a business on the web to fill its profile: from its website, a booking or marketplace page, social pages, its Google listing, web and image search. Use it when the owner gives or pastes a link, or when profile sections are missing that the web can answer.',
  body: `# Researching a business on the web

You fill the profile from what the web says about this business. It can be any kind of business: you learn what it is from what you read.

## Tools
- read_page: a page in full through a real browser. Use it for the business's own pages, booking platforms (Fresha and Treatwell return their complete listing) and social pages (at least their preview image).
- web_search: to find the business's other sources by name and city.
- web_fetch: a quick read of a plain page already found.
- import_branding_from_site: logo and brand colours from the business's own website, saved in one go.
- search_images: an image search, when nothing else gives the logo.
- Save facts with the profile tools as you find them, with origin "research".
read_page, import_branding_from_site and search_images use the turn's read budget; plan your reads.

## A first research (the business's own link, empty profile)
Begin with a thorough pass:
1. Read the home page and every page of the site's own navigation about its products or services, prices or packages, about us or the team, contacts or opening hours. Several pages, not one.
2. Search the web for the business by name (and city, if it has one) and read its listings among the first results: platforms or marketplaces where it sells or takes bookings, its Google Business listing, its Facebook and Instagram pages.
After that pass, look only for what is still missing.

## A link pasted later
The owner pasted it because it matters: read it and save everything it adds, sections already in the profile included. Search beyond it only for sections still empty afterwards.

## Rules
- Work section by section: name, sector, address, hours, catalog, tone of voice, logo, colours. A section with data is done; do not search again to improve it unless the owner asked.
- The catalog counts as done only when its items have prices. A few generic entries without prices are not a catalog: look for a page with prices (a price list, an online shop, a booking or marketplace page) first.
- When nothing is missing, stop, even with budget left. If two searches in a row bring nothing new, stop.
- The link the owner gave is theirs, whatever name it shows: never question it. Only sources you find yourself must be checked to be the same business (same name and same city, address or website); when in doubt, leave them out.
- Facebook and Instagram may show a login wall: say the page could not be read, not that it belongs to someone else.
- Only save what a source states: never guess prices, durations, hours or addresses. When sources disagree, prefer the business's own website.
- Prices: with a discounted price next to a struck-through one, save the discounted price. "da € 30" next to a category is a starting price, not an item.
- Tone of voice: describe it from how the business's own pages and posts are written, not a platform's copy (set_tone_of_voice, in Italian).
- Write descriptions you compose in Italian. Keep names of items, categories and addresses exactly as the source writes them.

## Branding
Branding comes from the business's own website, never from a platform, marketplace or directory. When logo or colours are missing, find the official site (linked from its platform or social pages, or by searching its name) and call import_branding_from_site with its home page. If there is no website of its own, use the preview_image of its Facebook or Instagram page with set_logo_from_url. If there is still no logo, search_images ("<name> <city> logo"): pick a result only if you can read the business's name in it and it comes from a page about this business. A wrong logo is worse than none.

## Closing
Tell the owner briefly what you found and where, then continue with the most important thing still missing (onboarding skill).`,
} satisfies Skill
