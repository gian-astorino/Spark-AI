# Backend

Supabase: Postgres, Auth, Storage (logos), Realtime (the profile panel updates
live) and Edge Functions (import, agent). The frontend stays static on GitHub
Pages and talks to Supabase with the anon key; RLS limits every owner to their
own business.

```
browser ──► supabase-js (anon key, RLS) ──► Postgres ◄── Realtime ──► panel
   │
   └──► Edge Function `import`  ──► scraper ──► scraped_pages
   │                                   └──► Claude: markdown → profile JSON ──► profile tables
   └──► Edge Function `agent`   ──► Claude with tools (update_business, set_opening_hours,
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

`POST /functions/v1/import { business_id }` with the owner's session. Answers
`202 { job_id }` and keeps working in the background:

1. Firecrawl scrapes the home page: markdown, links and branding (logo, colours).
2. Claude picks up to 6 useful pages from the site's links; Firecrawl scrapes them.
   At most 7 Firecrawl credits per import.
3. Claude (`claude-opus-5`, structured output validated with Zod) extracts
   business, locations and hours, tone of voice and catalog from all pages.
4. Each section is written and appended to `import_jobs.sections_done`; the
   frontend follows both over Realtime. The logo is copied into `logos/`.

A re-import replaces only rows with `source = 'import'`: what the owner said
in the chat is never overwritten.

## Setup

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set ANTHROPIC_API_KEY=... FIRECRAWL_API_KEY=...
supabase functions deploy import
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
provided to Edge Functions automatically.
