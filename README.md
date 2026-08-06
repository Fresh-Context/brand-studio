# Fresh Context Studio

The brand operating surface — asset gallery + search + generation, API-first, reached two ways (human UI + Claude via MCP) over the **same** endpoints. Full spec: [`STUDIO-PRD.md`](../../STUDIO-PRD.md) at the repo root.

Standalone app in the monorepo (its own package + deploy). Depends only on Supabase (`contextListener`) + OpenAI + the image files — **no vault/JSONL deps**, so it deploys cleanly (the `local-server` monolith cannot). Deploys to `studio.freshcontext.ai` on Coolify.

## Run locally

```bash
cd brand-studio
cp .env.example .env      # fill in SUPABASE_*, OPENAI_API_KEY, a STUDIO_BEARER_TOKEN
npm install
npm run dev               # http://localhost:3440
```

`npm run build` / `predev` / `prestart` rebuild the native Identity embed from
`STUDIO_LIBRARY_DIR/brand-guideline/whoweare.html` when that library is
available. The checked-in `public/identity-embed.*` assets are used on a fresh
deployment until the library volume is seeded.

Storage defaults to `data/generated`, `data/references`, and `data/library`
inside this checkout. Production mounts those paths under `/app/data`.

## Surface

- `GET /healthz` — liveness (unauthenticated)
- `GET /api/status` — counts + config (bearer)
- `GET /api/tools` · `GET/POST/PUT/DELETE` — tool defs (shot types, motion presets)
- `GET /api/assets?q=&form=&tag=&kind=&source=` — gallery browse/search (semantic `q` lands in M2)
- `GET /api/jobs` · `GET /api/jobs/:id` · `POST /api/jobs/:id/star`
- `POST /api/generate` — image generation → job
- `POST /api/generate-motion` — HTML motion (M3)
- `/files/{generated,references,library}/*` — asset files

## Auth

- `/api/*` → **bearer token** (`STUDIO_BEARER_TOKEN`) — the machine/MCP door.
- Browser UI → **oauth2-proxy** (Google, `@freshcontext.ai`) at the Coolify/Traefik layer (prod only).

## Data model

`studio_tools` → `studio_jobs` → `studio_assets` (+ `studio_taxonomy`, `studio_asset_embeddings`) in Supabase. See the migrations under `local-server/supabase/migrations/2026071*_studio_*.sql`.
