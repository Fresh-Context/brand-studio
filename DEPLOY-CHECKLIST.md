# Studio deploy checklist — status (A1/A2)

A1 is done and verified end to end, including a real Google login
(`charles@freshcontext.ai`, confirmed via oauth2-proxy's own
`[AuthSuccess]` log line, 2026-08-06). A2 is a separate, optional
hardening step still pending.

## Done (2026-08-05, live on studio.freshcontext.ai)

- [x] **Studio deployed** as its own Coolify resource (`brand-studio:main-h6z4e3i9e53yf6tbowrzsu0i`,
      `dockerfile` build pack, watching `Fresh-Context/brand-studio` `main` — auto-deploys
      on push, scoped to this repo only, untouched by Juice/monorepo pushes).
- [x] **Real credentials wired**: `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` (contextListener,
      master key for now — see A2), `OPENAI_API_KEY`, a real `STUDIO_BEARER_TOKEN`
      (rotated once already — see the security note below; current value is in
      Coolify's env vars for this app, retrievable via `coolify app env list
      h6z4e3i9e53yf6tbowrzsu0i -s`, not written anywhere in this repo).
- [x] **Persistent volume** (`studio-data`, mounted at `/app/data`) for
      `STUDIO_GENERATED_DIR`/`STUDIO_REFERENCES_DIR` — there was none before;
      anything generated through this container was ephemeral and lost on
      every restart. `STUDIO_LIBRARY_DIR` still has no real content (see Known
      gaps below) — the defaults already resolve correctly under the mounted
      volume once content exists there, no extra config needed when that day
      comes.
- [x] **oauth2-proxy actually in front of the browser door**, as its own
      Coolify resource (`studio-oauth2-proxy`, `dockerimage` build pack,
      `quay.io/oauth2-proxy/oauth2-proxy:v7.6.0`) rather than converting
      Studio's own resource to docker-compose (safer: an in-place build-pack
      conversion on a live resource isn't something this CLI exposes as a
      tested path; a second resource + a stable Docker network alias
      (`studio-internal`, set on the Studio app) is). `studio.freshcontext.ai`
      now points at oauth2-proxy; Studio itself has no public domain.
      Only `/healthz` skips oauth2-proxy (public liveness probe); everything
      else, including `/api/*`, requires either a Google login or the
      machine door's htpasswd credential — see the "Resolved" section below
      for how that evolved from the original bearer-only design.
- [x] **Reused the existing Juice OAuth client**
      (`942872456019-hhimr6j86rnelte55e5bhd313ghaadrl.apps.googleusercontent.com`)
      rather than creating a new one — this matches the *original* documented
      design ("The OAuth client serves Brand Studio and Juice login only").

## Security note: the token that shipped in this session's chat transcript

The first `STUDIO_BEARER_TOKEN` set here was printed in a chat response before
oauth2-proxy existed, while `/api` had no other protection. It has been
**revoked** (deleted from Coolify, redeployed) and replaced with a fresh one
that was never printed anywhere. If you have any doubt about who's seen the
current value, rotate it again: `coolify app env update
h6z4e3i9e53yf6tbowrzsu0i <env_uuid> --value "$(openssl rand -hex 32)"
--is-literal`, then redeploy.

Also fixed in code (`src/lib/auth.js`, commit `35aa1e2`): `requireBearer` used
to trust an `X-Forwarded-Email` header unconditionally, which is spoofable by
any client when there's no proxy actually stripping it (there wasn't, at the
time). That header is now ignored unless `STUDIO_TRUST_PROXY_AUTH=true` is
explicitly set — now set on the live resource (see the "Resolved" section
below for why).

## Redirect URI — done, verified live (2026-08-06)

`https://studio.freshcontext.ai/oauth2/callback` is registered on the
client above. Confirmed both the redirect completing (no more
`redirect_uri_mismatch`) and a real login succeeding, via oauth2-proxy's
container logs: `[AuthSuccess] Authenticated via OAuth2: Session{email:
charles@freshcontext.ai ...}`.

## Resolved: browser sessions now actually work, not just the login (2026-08-06)

The gap above was real, not theoretical — a real logged-in user (you) hit
"unauthorized" on every page. Fixed by making `/api/*` go through
oauth2-proxy like everything else (`OAUTH2_PROXY_SKIP_AUTH_ROUTES` is now
just `^/healthz`), with `STUDIO_TRUST_PROXY_AUTH=true` set on Studio so it
trusts oauth2-proxy's `X-Forwarded-Email` once a real session is behind it.
The machine/MCP door moved to oauth2-proxy's own htpasswd mechanism (a
`studio-mcp` service account, password = the same `STUDIO_BEARER_TOKEN`)
instead of a route that skipped auth outright — `mcp/server.js` now sends
Basic auth for that door and `X-Studio-Token` for the app's own check (see
commit `762311f`).

Verified via curl (can't click through a real Google login myself):
no-auth → 302 to Google (not a raw 401 anymore); spoofed
`X-Forwarded-Email` alone → still 302 (oauth2-proxy's own session/htpasswd
check gates it now, not just the app); wrong htpasswd password → 302;
correct Basic auth + `X-Studio-Token` → 200 with real data.
**Confirmed live** (2026-08-06, via server logs): `charles@freshcontext.ai`
browsing normally — no pasted token — got real 200s from `/api/taxonomy`,
`/api/tools`, `/api/assets`, `/api/feedback`, `/api/brand`. A real Google
session now genuinely carries through to every API call the UI makes.

## A2 — scope the DB role (separate, optional hardening — unchanged from before)

1. Run `scripts/scoped-role.sql` in the contextListener SQL editor.
2. Run `python3 scripts/mint-scoped-jwt.py`, paste the JWT secret from
   Supabase → Project Settings → API → JWT Settings, copy the printed token.
3. Swap `SUPABASE_SERVICE_KEY` on the `brand-studio:main-h6z4e3i9e53yf6tbowrzsu0i`
   resource to the scoped token (`coolify app env update` + redeploy).
4. Exercise every tab end to end. Fallback pre-decided in the plan: keep the
   service-role key if the scoped JWT fights `supabase-js`.

## Known gaps, unchanged

- `STUDIO_LIBRARY_DIR` has no real `brand-marketing` content anywhere this
  session could find. The Identity tab fails gracefully (see commit `7f8870f`)
  instead of crashing, but stays empty until someone provides that content.
