# Backend

Supabase: Postgres, Auth, Storage (logos), Realtime (the profile panel updates
live) and Edge Functions (import, agent). The frontend stays static on GitHub
Pages and talks to Supabase with the anon key; RLS limits every owner to their
own business.

```
browser ──► supabase-js (anon key, RLS) ──► Postgres ◄── Realtime ──► panel
   │
   └──► Edge Function `import`  ──► scraper ──► scraped_pages
   │                                   └──► (later) LLM: markdown → profile JSON ──► profile tables
   └──► Edge Function `agent`   ──► OpenAI (gpt-5.5) with tools (update_business, set_opening_hours,
                                    add_catalog_item, set_team, set_calendar, …) ──► profile tables
```

## Schema

`migrations/20260928000000_onboarding.sql`. Every profile row carries a
`source` (`import`, `chat`, `manual`): imported data is a draft until the owner
confirms it, and what the owner says wins.

| Section | Tables |
|---|---|
| Business | `businesses` |
| Location | `locations`, `opening_hours` (one row per open interval) |
| Branding | `brand_profiles` (logo, tone of voice), `brand_colors` |
| Catalog | `catalog_items` (price in cents, duration in minutes) |
| Calendar | `team_members`, `calendar_setups` |
| Import | `import_jobs`, `scraped_pages` (kept to re-run extraction) |
| Chat | `conversations`, `messages` (append-only, model content blocks verbatim) |

## Import (`functions/import`)

A Firecrawl crawl with JSON extraction on every page (Firecrawl's own model:
no LLM key of ours). Split in two calls because a crawl can outlast an Edge
Function's wall-clock limit:

- `{ business_id }` starts the business's own site: reads the home page's
  branding (logo, brand colours, heading/body fonts) straight away, then
  crawls up to 25 pages. About 5 credits a page, ~125 for a full site.
- `{ business_id, url }` starts an **extra source** pasted in the chat
  (Treatwell, Fresha, Google Maps, a price list): up to 5 pages under that
  URL, no branding, and it only **adds** to the profile.
- `{ job_id }` checks progress. The client calls it every few seconds; once
  the crawl is done it merges the pages into one profile and writes it.

Pages are kept in `scraped_pages`. A first import replaces only rows it wrote
itself (`source = 'import'`); what the owner said in the chat is never
overwritten.

## Agent (`functions/agent`)

`POST /functions/v1/agent { business_id, message }` for what the owner types,
`{ business_id, event }` for what the app reports (an import finished, no
website). One turn: OpenAI `gpt-5.5` on the Responses API reads the profile
as it stands (passed as data, never as instructions: it contains scraped
text), saves what the owner says through strict function tools
(`update_business`, `set_location`, `save_catalog_items`, `set_team`,
`set_calendar`, `set_tone_of_voice`, …) and answers `{ reply, choices }`.

The conversation continues from `conversations.last_response_id`; `messages`
keeps our own transcript. Links pasted in the chat are read by the app
(an additive import), then reported to the agent as an event.

## Setup

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set FIRECRAWL_API_KEY=... OPENAI_API_KEY=...
supabase functions deploy import agent
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
provided to Edge Functions automatically.
