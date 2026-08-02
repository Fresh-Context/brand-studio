# Legacy Studio teardown checklist (Phase C1)

The `Fresh-Context/brand-studio` GitHub repo itself is **not** archived — A0
repurposed it as the live Studio repo; the old React/Vite/Supabase/n8n app is
preserved at tag `legacy-react-final`, not deleted. What's actually left to
tear down are the *external* systems that old app talked to. This session has
no dashboard credentials for GitHub Actions secrets aside, Vercel, Supabase,
or n8n, so none of this could be executed here — it's a plain checklist for
whoever has that access. Every item is idempotent/a no-op if already gone
(liveness was never verified — see the plan's own assumptions section).

## 1. Old Vercel project

- Find the Vercel project that served the legacy React SPA (check
  `legacy-react-final:vercel.json` for hints, or the Vercel dashboard's
  project list for one still pointed at `Fresh-Context/brand-studio` — it
  will look stale now that `main` no longer builds a Vite app).
- Delete the project (Vercel dashboard → Project → Settings → Delete), or at
  minimum disable its Git integration so it stops trying to build `main`
  against the now-incompatible (Express) repo contents.

## 2. Old dedicated Supabase project

- **Not** contextListener (`bwtnmqeexwnepkchaewt`, Studio's real DB now) and
  **not** freshContext (the website's project). Look for the third project —
  schema `profiles` / `shot_types` / `generations` + a `generation-assets`
  storage bucket (see `legacy-react-final:supabase/migrations/001_initial_schema.sql`
  and `002_storage_bucket.sql` for the exact shape to match against the
  Supabase org's project list).
- Confirm no other consumer reads it (the plan's ground truth found none —
  the Django port's importer was one-off and already ran) before deleting the
  project.

## 3. n8n workflows + credential

- Two workflows imported from `legacy-react-final:n8n/`:
  `Image- 4 references with optional 5th user upload-OpenAI 1.0.json` and
  `Video - First+Last Interpolation Veo3.1 v10.json`.
- In the n8n instance those were imported into (base URL was
  `N8N_WEBHOOK_BASE` in the old `.env`, never committed — check 1Password /
  whoever set it up): disable or delete both workflows, and remove the
  `BRAND_STUDIO_PASSPHRASE` / `GOOGLE_AI_API_KEY` / `CALLBACK_URL` n8n
  Settings → Variables entries if nothing else in that n8n instance uses them.

## Not in scope here

`fresh-context/apps/juice` stays as-is (already marked deprecated, excluded
from Vercel upload, holds the only copy of the legacy two-screen workshop
routes) — no action needed, per the plan's C2.
