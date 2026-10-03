# Backend

Supabase: Postgres, Auth, Storage (logos), Realtime (the profile panel updates
live) and Edge Functions (agent, ads, logo). The frontend stays static on GitHub
Pages and talks to Supabase with the anon key; RLS limits every owner to their
own business.

```
browser ──► supabase-js (anon key, RLS) ──► Postgres ◄── Realtime ──► panel
   │
   └──► Edge Function `agent` ──► Claude (claude-opus-5-5): skills + a kernel of generic tools
   │                               (profile, web research, ads, notes) ──► Postgres, Storage
   │                                         └──► OpenAI, images only (ad images, logo, brand board)
   └──► Edge Functions `ads`, `logo` ──► move the image jobs on
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
| Import (OpenAI era, no longer written) | `import_jobs`, `scraped_pages` |
| Chat | `conversations`, `messages` (append-only, model content blocks verbatim) |
| Ads | `ads`, `ad_images` (`ad_proposals`: the OpenAI-era proposals, copied into `ads`) |
| Agent | `agent_notes` (strategies, memories, reports), `agent_skills` (skills edited live) |

## Agent (`functions/agent`)

Spark is one Claude agent. It has no flows written in code: everything it
knows how to do is a **skill** (`functions/agent/skills/*.ts`: onboarding,
business research, brand identity, call transcripts, campaign strategy, ad
creation, ad editing, strategy advice). The system prompt lists each skill's
name and description; the agent loads the whole skill with `load_skill` when
a request calls for it. A row in `agent_skills` adds a skill, or replaces the
shipped one with the same name, without a deploy (`enabled = false` turns it
off). A new capability (reports, for one) is a new skill, plus a kernel tool
only if it needs data the kernel cannot reach yet.

The kernel (`functions/agent/tools.ts`) is generic: `read_context` (profile,
ads, calls, notes, photos), `view_image`, the profile tools
(`_shared/profile-tools.ts`, each with the origin of what it saves), web
research (Claude's `web_search` and `web_fetch`, plus `read_page`,
`import_branding_from_site`, `search_images` through Firecrawl, at most 15
reads per turn), `save_ad`, `generate_ad_image`, `save_note`,
`offer_choices`, `set_onboarding_status`, `refresh_brand_board`.

`POST /functions/v1/agent { business_id, message, attachments?, after }` for
what the owner types, `{ business_id, event, after }` for what the app reports
(a new workspace and its link), `{ business_id, resume: true, after }` to move
a turn on. A turn is a loop of steps (a model call, then its tools); each
request runs steps for about a minute and answers `{ status, activity,
entries }`; while `status` is `running` the app calls again with `resume`.
One worker per conversation (`conversations.processing_started_at`).
`messages.content` holds Claude's content blocks verbatim and is replayed as
it is (append-only); server-side compaction keeps long conversations within
the context window. Attachments and images reach Claude through the Files API,
so the replayed history never holds an expired link. Conversations from the
OpenAI era (`engine = 'openai'`) are shown, not continued.

Ads (`ads`, `ad_images`): the agent decides their content; every image is a
new row (an edit keeps the old ones), generated as an OpenAI background job
and moved on by the agent's steps and by `functions/ads`, which the app calls
while a card waits for its image.

## Setup

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set ANTHROPIC_API_KEY=... OPENAI_API_KEY=... FIRECRAWL_API_KEY=...
supabase functions deploy agent ads logo
supabase functions delete import proposal creative
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
provided to Edge Functions automatically.
