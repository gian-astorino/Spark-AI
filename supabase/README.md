# Backend

Supabase: Postgres, Auth, Storage (logos), Realtime (the profile panel updates
live) and Edge Functions (import, agent). The frontend stays static on GitHub
Pages and talks to Supabase with the anon key; RLS limits every owner to their
own business.

```
browser ──► supabase-js (anon key, RLS) ──► Postgres ◄── Realtime ──► panel
   │
   └──► Edge Function `import`  ──► OpenAI research: web search + Firecrawl pages ──► profile tables
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

## Import (`functions/import`): research on OpenAI

The import is a research run, not a fixed crawl. `gpt-5.5` starts from the
link, reads it, **searches the web** for other sources about the same business
(its site, Treatwell/Fresha/Booksy pages, Google Maps listing, socials), reads
the promising ones through Firecrawl and saves what it finds with the same
profile tools the chat agent uses (`source = 'import'`). It checks a source is
the same business (name and city) before using it, and never guesses.

- `{ business_id }` researches from the business's link. For its own site,
  branding (logo, brand colours, fonts) is read from the home page first;
  for a booking platform or directory link it is skipped (it would be the
  platform's).
- `{ business_id, url }` researches from a link pasted in the chat, to fill
  gaps in the existing profile.
- `{ job_id }` advances the run by one step. It runs as OpenAI **background**
  responses: each check retrieves the current one and, when it asks for tools,
  runs them (pages in parallel) and starts the next. The client calls this
  every few seconds; `import_jobs.activity` says what it is doing for the
  marker, `summary` holds its closing notes.

Budget: at most 12 pages read (1 Firecrawl credit each) and 16 model turns
per run, plus OpenAI tokens and web searches.

## Agent (`functions/agent`)

`POST /functions/v1/agent { business_id, message }` for what the owner types,
`{ business_id, event }` for what the app reports (an import finished, no
website). One turn: OpenAI `gpt-5.5` on the Responses API reads the profile
as it stands (passed as data, never as instructions: it contains scraped
text), saves what the owner says through strict function tools
(`update_business`, `set_location`, `save_catalog_items`, `set_team`,
`set_calendar`, `set_tone_of_voice`, …) and answers `{ reply, choices }`.

The owner can attach images and PDFs (price lists, a sign with the hours,
their logo, photos). They are uploaded to the private `uploads` bucket, one
folder per business, and passed to the model through short-lived signed URLs.
The model extracts what they state with the usual tools, and can keep an
image with `set_logo` (copied into `logos/`) or `add_photos` (`business_media`).

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
