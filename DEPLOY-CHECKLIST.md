# Studio deploy checklist — manual steps (A1/A2)

Everything in `DEPLOY.md` that's actual configuration (compose, env, volume,
oauth2-proxy) is executable by anyone with Coolify/DNS/Google Workspace admin
access. This file is the concrete, ordered checklist for *this* app-estate
cutover (2026-08-01 plan) — what's already done vs. what still needs a human
with dashboard access, since none of these systems have API credentials
available in this environment.

## Already done (this session)

- [x] `Fresh-Context/brand-studio` repo repurposed as the canonical Studio repo.
      Legacy React app preserved at tag `legacy-react-final`; `main` now holds
      the Express Studio (was `fresh-context/apps/studio`).
- [x] `fresh-context/apps/studio` retired (`DEPRECATED.md`, `.mcp.json` repointed
      at `../brand-studio/mcp/server.js`).
- [x] Local dev repaired: `com.freshcontext.studio` launchd agent now runs from
      `~/Development/fc/brand-studio` directly (was pointing at the deleted
      `fresh-context/apps/studio`). Verified live against the real
      contextListener Supabase project + gpt-image-2 (see commit `60b012a`).
- [x] Download-all (ZIP), per-result download, prev/next viewer, and iteration
      ("use as input") carried over from the Django brand_studio port and
      verified end-to-end through a real browser session.
- [x] `scripts/scoped-role.sql` + `scripts/mint-scoped-jwt.py` prepared for A2
      (NOT applied — see prerequisite note in scoped-role.sql).

## A1 — stand up Studio on Coolify (needs Coolify dashboard access)

1. Create a new Coolify resource (Docker Compose) on the same droplet that
   hosts the Juice, using `docker-compose.yml` at this repo's root as the
   compose file.
2. Set env on the resource (not committed — see `.env.example`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (contextListener project
   `bwtnmqeexwnepkchaewt` — start with the master service key; swap to the
   A2 scoped JWT only after verifying it, see below), `OPENAI_API_KEY`,
   `STUDIO_BEARER_TOKEN` (generate a strong random string — the one in this
   session's local `.env` is dev-only, do not reuse it in prod), and the
   oauth2-proxy client id/secret/cookie secret.
3. Mount a persistent volume for `STUDIO_GENERATED_DIR` /
   `STUDIO_REFERENCES_DIR` (this repo's `data/generated`, `data/references`
   defaults are dev-only, gitignored, and empty on a fresh clone — the real
   asset history currently lives on Sam's machine, see step 5). Mount or
   bind-mount the `brand-marketing` repo/library for `STUDIO_LIBRARY_DIR`.
4. Google OAuth client: create (or reuse an existing Workspace-internal
   client) with redirect URI `https://studio.freshcontext.ai/oauth2/callback`,
   restricted to `@freshcontext.ai`.
5. Seed the asset volume: rsync/scp the current contents of Sam's
   `fresh-context/local-server/studio/{generated,references}` (or wherever
   his authoritative copy now lives post-cutover) to the new volume.
   Coordinate with Sam directly — this session has no access to his machine.
6. DNS: point `studio.freshcontext.ai` at the Coolify proxy, or confirm
   Traefik already routes that host to the new resource rather than the
   Juice's `web` resource (the Django Studio never went live, so there's no
   traffic to cut over — this is a fresh route, not a swap).
7. Enable Coolify auto-deploy-on-push for this resource only, watching
   `Fresh-Context/brand-studio` `main`, with a deploy key/GitHub App grant
   scoped to that single repo.
8. Verify (see the plan's own Verification section): oauth2-proxy login flow,
   `/api/...` with the bearer token, a real generation writes a `studio_jobs`
   row + a file on the volume, and — the actual point of this cutover — a
   push to `brand-studio` redeploys only Studio while `juice.freshcontext.ai`
   and the `fresh-context` monorepo are untouched.

## A2 — scope the DB role (after A1 is verified live)

1. Run `scripts/scoped-role.sql` in the contextListener SQL editor.
2. Run `python3 scripts/mint-scoped-jwt.py`, paste the JWT secret from
   Supabase → Project Settings → API → JWT Settings, copy the printed token.
3. Swap the Coolify resource's `SUPABASE_SERVICE_KEY` to the scoped token.
4. Exercise every tab (gallery, generate incl. iteration, feedback capture,
   voice & tone) end to end. If anything 401s/403s: either `src/db.js`
   reaches a table not granted in `scoped-role.sql`, or a table's actual RLS
   state differs from what the script assumed (`studio_feedback` /
   `studio_brand_rules` have no checked-in migration in this repo's history —
   verify their current grants/RLS directly if the swap fights `supabase-js`).
   Fallback, pre-decided in the plan: keep the service-role key confined to
   the Studio resource env rather than debug this under pressure.
