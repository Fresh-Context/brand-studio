# Fresh Context Studio

Fresh Context Studio is the API-first brand operating surface for catalog search, controlled static-image generation, output retrieval, and brand feedback. The browser UI, local stdio MCP client, and hosted Streamable HTTP MCP transport call the same Studio HTTP API.

This is a standalone repository and deployable service. Production runs at `https://studio.freshcontext.ai`; it does not depend on the vault checkout or companion app.

## Run locally

```bash
cd brand-studio
cp .env.example .env
# Fill SUPABASE_*, OPENAI_API_KEY, and STUDIO_BEARER_TOKEN from the approved secret manager.
npm install
npm run dev                         # http://localhost:3440
```

`npm run build` / `predev` / `prestart` rebuild the native Identity embed when the library mount contains `whoweare.html`; checked-in bundled assets keep a fresh deployment usable before the library volume is seeded.

Storage defaults to `data/generated`, `data/references`, and `data/library` inside this checkout. Production mounts those paths below `/data` on persistent storage. `STUDIO_DOWNLOAD_SIGNING_SECRET` is optional; when omitted, the provisioned bearer token signs short-lived MCP output links.

## MCP connection modes

### Local stdio

A sibling Fresh Context checkout can register the local adapter in its project-scoped `.mcp.json` without storing a credential in source:

```json
{
  "mcpServers": {
    "fresh-context-studio": {
      "command": "node",
      "args": ["../brand-studio/mcp/server.js"],
      "env": {
        "STUDIO_API_URL": "${STUDIO_API_URL}",
        "STUDIO_BEARER_TOKEN": "${STUDIO_BEARER_TOKEN}"
      }
    }
  }
}
```

Set those variables in the untracked `brand-studio/.env` or the approved machine secret manager. For a production-targeted local client, use `STUDIO_API_URL=https://studio.freshcontext.ai`; the adapter normalizes trailing slashes and emits production file references. Do not put a token, proxy password, or literal secret in `.mcp.json`.

Claude Code requires explicit approval for a project-scoped registration. From the Fresh Context checkout, verify and approve it with the supported CLI, then run the read-only smoke:

```bash
claude mcp list
claude mcp get fresh-context-studio
cd ../brand-studio
npm run mcp:smoke
```

The smoke covers initialize, `tools/list`, tool resolution, asset search, brand context, and asset retrieval. It never calls `studio_generate_image`.

### Hosted Streamable HTTP

The hosted endpoint is:

```text
POST https://studio.freshcontext.ai/mcp
```

It accepts `Authorization: Bearer <machine credential>` and never redirects to Google. Register it at user or project scope only after setting the credential through the approved secret manager; the variable reference keeps the value out of shell history:

```bash
claude mcp add --transport http fresh-context-studio https://studio.freshcontext.ai/mcp \
  --header "Authorization: Bearer ${STUDIO_BEARER_TOKEN}"
```

Verify without spending generation credit:

```bash
cd brand-studio
STUDIO_API_URL=https://studio.freshcontext.ai npm run mcp:hosted-smoke
```

The hosted smoke checks missing-credential 401 behavior, no Google redirect, initialize, `tools/list`, image-tool resolution, asset search, brand context, and asset retrieval. It also rejects responses that contain the bearer credential or internal filesystem paths.

## HTTP surface

- `GET /healthz` — public liveness only.
- `GET /api/status` — counts and configuration (machine bearer).
- `GET /api/tools` — persisted shot types and reference configuration.
- `GET /api/assets?q=&form=&tag=&kind=&source=` — catalog browse/search.
- `GET /api/assets/:id` and `POST /api/assets/:id/feedback` — asset metadata and judgment capture.
- `GET /api/jobs/:id` — persisted job status and result paths.
- `GET /api/jobs/:id/download` — authenticated direct archive for API clients.
- `GET /api/jobs/:id/download-metadata` — archive availability and metadata.
- `POST /api/generate` — persisted image-tool generation; accepts the existing multipart `user_image` iteration field.
- `POST /mcp` — hosted stateless Streamable HTTP MCP, independently machine-authenticated.
- `GET /mcp/download/{asset,job}/...` — short-lived signed asset/archive delivery; no browser cookie or bearer in the URL.
- `/files/{generated,references,library}/*` — browser/static file paths; these remain behind the human browser policy in production.

HTML motion and video are not represented as implemented Studio MCP features.

## Generation invariant

`studio_generate_image` accepts a persisted `tool_id` plus the user subject. Studio's API and image executor compose:

```text
tool.system_prompt + user subject + configured reference images
```

The MCP adapter does not accept an arbitrary system prompt, reference list, or model selector. Search existing assets and inspect open feedback before explaining the paid credit spend and generating. The MCP schema enforces one to four variants; omitted variants remain the persisted tool default.

## Auth and deployment

- `/healthz` is public liveness only.
- `/api/*` uses the Studio machine bearer policy (and may also honor the explicitly configured browser proxy identity for the human UI).
- `/mcp` accepts only `Authorization: Bearer`; it never trusts `X-Forwarded-Email`, `X-Studio-Token`, or a browser cookie.
- UI and direct `/files/*` continue through Google OAuth for `@freshcontext.ai` users.
- The production topology is a standalone Studio Coolify resource plus a separate OAuth proxy resource, persistent generated/reference storage, and the machine-authenticated `/mcp` path. See [`DEPLOY.md`](DEPLOY.md) and [`DEPLOY-CHECKLIST.md`](DEPLOY-CHECKLIST.md).

All machine credentials are rotatable environment values. They must not be committed to source, `.mcp.json`, fixtures, screenshots, or documentation.

## Tests and builds

```bash
npm test                # no-network contract, transport, shaping, and embed tests
npm run build           # production asset build
npm run mcp:smoke       # opt-in local read-only API smoke
npm run mcp:hosted-smoke # opt-in deployed read-only smoke
```

The default test suite never invokes OpenAI generation and does not require network access.
