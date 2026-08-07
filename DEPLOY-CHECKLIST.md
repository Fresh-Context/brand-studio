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
      `STUDIO_GENERATED_DIR`/`STUDIO_REFERENCES_DIR`/`STUDIO_LIBRARY_DIR`.
      On 2026-08-06 the production volume was seeded with
      `library/brand-guideline/whoweare.html` and
      `library/brand-guidelines/*.md`; the Identity and Voice & Tone tabs now
      have their required content after restart. The image also carries a
      checked-in Identity fallback for a fresh volume.
- [x] **oauth2-proxy actually in front of the browser door**, as its own
      Coolify resource (`studio-oauth2-proxy`, `dockerimage` build pack,
      `quay.io/oauth2-proxy/oauth2-proxy:v7.6.0`) rather than converting
      Studio's own resource to docker-compose (safer: an in-place build-pack
      conversion on a live resource isn't something this CLI exposes as a
      tested path; a second resource + a stable Docker network alias
      (`studio-internal`, set on the Studio app) is). `studio.freshcontext.ai`
      now points at oauth2-proxy; Studio itself has no public domain.
- [x] **Route boundary**: `/healthz` is public liveness. The browser UI and `/files/*` stay behind the separate OAuth proxy; `/api/*` and `/mcp` are passed to Studio, which validates its own bearer machine credential. `/mcp` never depends on Google login or forwarded identity headers.
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

## Resolved: browser and machine doors are independent (2026-08-07)

The production topology is now explicit: the OAuth proxy owns the human browser session, while Studio owns the machine boundary. `/api/*` may accept a trusted OAuth-proxy identity for the browser UI when `STUDIO_TRUST_PROXY_AUTH=true`, or `Authorization: Bearer <STUDIO_BEARER_TOKEN>` for API/MCP clients. `POST /mcp` accepts only the bearer credential and does not trust `X-Forwarded-Email`, `X-Auth-Request-Email`, `X-Studio-Token`, or browser cookies.

The hosted MCP contract is `POST https://studio.freshcontext.ai/mcp` with `Authorization: Bearer <machine credential>`. Missing or invalid credentials return HTTP 401 with `WWW-Authenticate: Bearer`; they do not redirect to Google. Signed `/mcp/download/...` links use a short-lived HMAC token and do not embed the bearer credential.

Verified in the no-spend test suite and local hosted smoke:

- no credentials → deterministic 401 and no `Location` header;
- valid bearer → MCP initialize, `tools/list`, read-only tool calls;
- tool output → no bearer, authorization header, or internal absolute filesystem path;
- request IDs → response header, server log, and API `X-Request-ID` correlation.

## A2 — scope the DB role (separate, optional hardening — unchanged from before)

1. Run `scripts/scoped-role.sql` in the contextListener SQL editor.
2. Run `python3 scripts/mint-scoped-jwt.py`, paste the JWT secret from
   Supabase → Project Settings → API → JWT Settings, copy the printed token.
3. Swap `SUPABASE_SERVICE_KEY` on the `brand-studio:main-h6z4e3i9e53yf6tbowrzsu0i`
   resource to the scoped token (`coolify app env update` + redeploy).
4. Exercise every tab end to end. Fallback pre-decided in the plan: keep the
   service-role key if the scoped JWT fights `supabase-js`.

## Current notes

- The initial production library seed covers Identity and Voice & Tone. Keep
  the `studio-data` volume populated when synchronizing additional
  `brand-marketing` assets.
