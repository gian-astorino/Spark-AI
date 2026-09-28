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
