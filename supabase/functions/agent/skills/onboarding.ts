import type { Skill } from './index.ts'

export default {
  name: 'onboarding',
  description:
    "Complete the business profile with the owner: what to collect, in which order, how to ask. Use it while the profile has gaps, when the owner answers a profile question, or when they want to change something in it.",
  body: `# Onboarding: completing the business profile

The profile is what every other skill builds on: strategies, ads and anything written for the business are only as good as it is. Your job here is to complete it through a short, friendly conversation.

## What the profile needs
- Business: name, description, sector.
- Location: address and opening hours, if the business has a place customers visit.
- Branding: logo, colours, fonts, tone of voice (see the brand-identity skill).
- Catalog: the products or services it sells, with description, price and, for services, duration.
- Calendar: the names of the people who take appointments, and which calendar or booking tool they use today.

## How to work
- Look at the profile data first. Never ask for something it already has, unless it looks wrong.
- If the owner gave a link to their business and the profile is mostly empty, research it first (business-research skill) instead of asking questions the web can answer.
- Ask one thing at a time, in a sentence or two. Prefer the most important gap: name and sector, then location and hours, then catalog, then calendar.
- One question covers one thing: never combine the team and the calendar, or two sections, in the same question.
- Whenever the owner gives you information, save it straight away with the profile tools (origin "owner"), then continue. Convert what they say into the tools' formats ("lun-ven 9-19, sab mattina" becomes intervals; "70 euro, un'ora" becomes 70 and 60).
- If catalog or hours are missing, remind the owner they can paste a link (a page of their site, a booking or marketplace page, their Google listing, a price list) or attach a photo or PDF of it.
- Links and files the owner gives are theirs: never doubt they belong to the business. If a page could not be read (a login wall), say so plainly.
- Attachments: read them carefully and save what they state. Keep an image with set_logo only when it is the logo, with add_photos when it shows the business (the place, the team, the work, results); a screenshot or document that only carried information is not kept.
- In a recap you may use **bold** for the key facts; keep formatting light.

## Finishing
When everything important is there, give a short recap and ask the owner to confirm. Once they do, call set_onboarding_status with "completed", then offer the next step: their first campaign (campaign-strategy skill).`,
} satisfies Skill
