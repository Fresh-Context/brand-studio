# Studio production deploy

Target: `https://studio.freshcontext.ai`.

Production is two Coolify resources on one private network:

1. **Studio** — the standalone `brand-studio` Node service, persistent generated/reference storage, internal-only upstream on port 3440.
2. **OAuth proxy** — a separate `oauth2-proxy` resource owning the public domain and Google `@freshcontext.ai` browser door.

The proxy passes `/healthz`, `/api/*`, and `/mcp*` to Studio. Studio enforces machine bearer authentication for the API and hosted MCP. `/mcp` never uses Google auth. UI and `/files/*` remain behind the browser OAuth policy. Set the proxy upstream timeout to at least 180 seconds so synchronous image generation is not killed by a shorter hop.

## Required environment

Set these in the Coolify environment/secret manager. Never commit them or place them in `.mcp.json`:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Studio persistence (`contextListener`) |
| `OPENAI_API_KEY` | gpt-image-2 generation and catalog indexing |
| `STUDIO_BEARER_TOKEN` | Rotatable machine credential for `/api` and `/mcp` |
| `STUDIO_DOWNLOAD_SIGNING_SECRET` | Optional dedicated HMAC secret; defaults to the bearer token when omitted |
| `STUDIO_API_URL` | `https://studio.freshcontext.ai` |
| `STUDIO_MCP_REQUEST_TIMEOUT_MS` | `180000` or longer |
| `STUDIO_GENERATED_DIR` | `/data/generated` |
| `STUDIO_REFERENCES_DIR` | `/data/references` |
| `STUDIO_LIBRARY_DIR` | `/data/library` |
| `OAUTH2_PROXY_CLIENT_ID` / `OAUTH2_PROXY_CLIENT_SECRET` | Google OAuth client |
| `OAUTH2_PROXY_COOKIE_SECRET` | Rotated proxy session secret |

Generate a fresh machine credential and signing secret with the team's approved secret workflow. Rotate both together when the machine credential is replaced; existing signed links then expire effectively.

## Studio resource

1. Create a Coolify Docker resource from `Fresh-Context/brand-studio`.
2. Use the checked-in `Dockerfile` and expose the container internally on port `3440`.
3. Mount a persistent volume at `/data` for `generated/` and `references/`; mount the read-only brand library at `/data/library`.
4. Configure the environment table above and deploy.
5. Confirm the container health check reaches `GET /healthz`.

The app starts from the checked-in Identity embed if the library is initially empty. After seeding the library, restart once so the embed can be rebuilt from `whoweare.html`.

## OAuth proxy resource

Run `quay.io/oauth2-proxy/oauth2-proxy:v7.6.0` (or a deliberately reviewed newer version) with:

```text
OAUTH2_PROXY_PROVIDER=google
OAUTH2_PROXY_EMAIL_DOMAINS=freshcontext.ai
OAUTH2_PROXY_UPSTREAMS=http://studio-internal:3440
OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180
OAUTH2_PROXY_REDIRECT_URL=https://studio.freshcontext.ai/oauth2/callback
OAUTH2_PROXY_SKIP_AUTH_ROUTES=^/(?:api/|mcp(?:/|$)|healthz$)
OAUTH2_PROXY_UPSTREAM_TIMEOUT=180s
OAUTH2_PROXY_REVERSE_PROXY=true
OAUTH2_PROXY_COOKIE_SECURE=true
```

`studio-internal` is the private-network alias for the Studio resource. Attach `https://studio.freshcontext.ai` only to the OAuth proxy resource on port `4180`; do not expose Studio directly.

The skip list is intentional: the app, not Google, validates the bearer on `/api` and `/mcp`. The `/mcp` handler ignores forwarded-email headers and browser cookies.

## Seed persistent storage

Copy the existing library and approved references/generated outputs into the mounted volume using the Coolify/VPS operator workflow. Do not put production output or credentials in git. Restart Studio after the first library sync.

## Verification order

```bash
curl -fsS https://studio.freshcontext.ai/healthz
curl -i https://studio.freshcontext.ai/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"auth-check","version":"1"}}}'
```

The first command is `200`. The second is deterministic `401` with `WWW-Authenticate: Bearer` and no `Location` header.

With the provisioned credential, run:

```bash
curl -fsS -H "Authorization: Bearer ${STUDIO_BEARER_TOKEN}" https://studio.freshcontext.ai/api/status
STUDIO_API_URL=https://studio.freshcontext.ai npm run mcp:hosted-smoke
```

The hosted smoke is read-only. It verifies initialize, `tools/list`, image-tool resolution, asset search, brand context, asset retrieval, invalid-auth behavior, no Google redirect, no bearer leakage, and no internal filesystem paths. Run the paid generation canary separately and manually only after this passes.

## Consumer setup

Local Claude Code uses `brand-studio/mcp/server.js` over stdio with environment references. Hosted Claude Code or another MCP client uses `POST https://studio.freshcontext.ai/mcp` with `Authorization: Bearer ${STUDIO_BEARER_TOKEN}`. Both expose the same twelve tool names and schemas.

The default test suite is mocked/no-spend. `npm run mcp:smoke` and `npm run mcp:hosted-smoke` are explicit read-only checks; neither calls `studio_generate_image`.
