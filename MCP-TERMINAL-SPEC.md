# Studio terminal MCP

**Status:** Implemented 2026-08-07
**Scope:** Claude Code from a terminal, with a path to hosted MCP clients
**Primary product:** static, on-brand image generation through Fresh Context Studio

## 1. Purpose

Make Fresh Context Studio a dependable terminal surface for Claude Code. A user should be able to search the existing brand catalog, select a configured shot type, generate an on-brand image, retrieve the result locally, and record the brand judgment that should inform future work.

The Studio HTTP API remains the source of truth. MCP is an adapter, not a second generation system. The browser UI, local stdio client, and hosted MCP transport must call the same API endpoints and preserve the same tool semantics.

The implementation has two supported connection modes:

1. **Local stdio:** Claude Code launches the MCP client from a Fresh Context checkout. This is the immediate compatibility path.
2. **Hosted Streamable HTTP:** Claude Code or a cloud client connects directly to Studio at the production URL. This closes the gap between the current local adapter and the original remote MCP product requirement.

## 2. Verified baseline before implementation

The following was the verified starting point for this implementation:

- Production Studio was deployed at `https://studio.freshcontext.ai`.
- The production API reported 15 tools, 183 jobs, and 646 assets at the start of the work.
- The production API had completed image generations and served generated PNGs and ZIP archives.
- The pre-existing stdio MCP handshake succeeded against the production API and exposed the ten catalog/feedback tools listed below.
- `brand-studio/mcp/server.js` was a thin client of the API using stdio only.
- `fresh-context/.mcp.json` registered the local server as `node ../brand-studio/mcp/server.js` and required explicit Claude Code project approval.
- Production had no hosted MCP endpoint at `/mcp`, `/api/mcp`, `/sse`, or `/.well-known/mcp.json`.
- `POST /api/generate` was synchronous for image jobs and cataloged generated outputs immediately.
- `GET /api/jobs/:id` and `GET /api/jobs/:id/download` existed but were not exposed as MCP tools.
- The HTTP generation route supported multipart `user_image` iteration input; the first hosted transport preserves the explicit `input_image` contract and allows only local stdio files or allowlisted HTTPS URLs.
- HTML motion and video generation are not part of this specification.

The implementation below adds the shared twelve-tool contract and dispatch layer, `studio_get_job`, `studio_download_job`, signed asset/archive references, and the hosted `/mcp` transport.

## 3. Goals

### G1. Search before spend

Claude must be able to search the existing gallery before generating. The tool description and the `/studio` operating instructions must make this the default workflow, not an optional suggestion.

### G2. Generate from controlled brand recipes

Claude must generate through a persisted Studio tool ID. The server must never accept an arbitrary model prompt as a substitute for the tool's `system_prompt`, configured aspect ratio, variant defaults, or reference exemplars.

The existing generation invariant remains:

```text
tool.system_prompt + user subject + configured reference images
```

### G3. Complete the terminal workflow

A successful generation must be discoverable, inspectable, and retrievable from the terminal. Returning only an opaque job ID or browser-only file URL is insufficient.

### G4. Preserve the feedback loop

Claude must be able to record positive and negative judgments, inspect open feedback before generating, and resolve feedback only through the existing triage disposition model.

### G5. Support both connection modes

The same tool names, input schemas, output fields, and error meanings must work through local stdio and hosted Streamable HTTP wherever the transport can support the operation.

### G6. Keep machine access independent of Google login

The browser door uses Google and `@freshcontext.ai` access. MCP uses machine credentials. A terminal client must not require a browser cookie or an interactive Google login.

## 4. Non-goals

- HTML-motion generation. The historical `generate-motion` contract is parked and must not be represented as implemented.
- Video generation or video repositioning.
- Automatic rule editing from a thumbs-up or thumbs-down.
- Runtime injection of recent feedback into prompts. Feedback continues to flow through `/studio-crit` and reviewed prompt changes.
- Replacing the Studio HTTP API with MCP-specific business logic.
- Committing bearer tokens, proxy passwords, or other credentials to `.mcp.json`, the repository, or generated documentation.
- A full multi-tenant credential-management system in the first transport cutover. The initial release may use a provisioned machine credential, but the credential must be rotatable and must not be embedded in source.

## 5. User workflows

### 5.1 Search and generate

```text
1. studio_search_assets(query, filters)
2. studio_list_tools(kind="image")
3. studio_list_feedback(status="open", tool_id=<selected tool>)
4. studio_generate_image(tool_id, prompt, aspect?, variants?)
5. studio_get_job(job_id)
6. studio_download_job(job_id) or use returned signed output links
7. studio_record_feedback(asset_id, verdict, note?, tags?)
```

The agent should explain when it is about to spend image-generation credit. Default variants remain the persisted tool default, currently normally two, and the MCP schema must enforce the documented upper bound.

### 5.2 Existing asset reuse

If search returns a suitable asset, Claude should return the asset ID and retrievable URL rather than generating a duplicate. The search response must include enough metadata to make that decision: title or caption, form, tags, provenance, asset ID, and a usable file reference.

### 5.3 Feedback triage

Claude may capture a judgment immediately. It may not silently rewrite a shot type, guideline, or vault belief. `studio_resolve_feedback` remains the write-back point after human-approved triage.

### 5.4 Local image iteration

The HTTP API already accepts a multipart `user_image`. Exposing this through MCP is not required for the first hosted transport release, but the contract must reserve an explicit input-image field rather than inventing an undocumented local-path convention.

Recommended future shape:

```json
{
  "input_image": {
    "type": "local_file | https_url",
    "value": "..."
  }
}
```

A local stdio implementation may read a local file. A hosted implementation must not read arbitrary server-local paths and should accept an uploaded blob or an allowlisted HTTPS URL.

## 6. Architecture

### 6.1 Source of truth

Keep all domain behavior in the existing Studio API and persistence layer:

- `brand-studio/src/routes/assets.js`
- `brand-studio/src/routes/tools.js`
- `brand-studio/src/routes/generate.js`
- `brand-studio/src/routes/jobs.js`
- `brand-studio/src/routes/feedback.js`
- `brand-studio/src/routes/brand.js`
- `brand-studio/src/executors/image.js`
- Supabase `studio_*` tables and RPCs

MCP adapters must not duplicate prompt composition, asset cataloging, feedback state transitions, or authorization decisions.

### 6.2 Shared MCP core

Refactor the current `brand-studio/mcp/server.js` into three layers:

1. **Contract layer**
   - Tool names, descriptions, JSON schemas, and output types.
2. **Client/dispatch layer**
   - Authenticated calls to the Studio HTTP API.
   - Error normalization.
   - URL and job-result shaping.
3. **Transport adapters**
   - Stdio entry point for local Claude Code.
   - Streamable HTTP entry point for hosted MCP.

Both transports must import the same contract and dispatch layer. A tool added to one transport but not the other is a release failure unless the limitation is explicitly documented by the MCP protocol.

### 6.3 Local stdio entry point

The current entry point remains supported:

```text
node brand-studio/mcp/server.js
```

Required behavior:

- Load configuration from environment or the standalone `brand-studio/.env`.
- Default to `http://localhost:3440` only when no production target is configured.
- Log the selected API URL to stderr, never the credential.
- Fail clearly when the API is unreachable or when a required credential is missing.
- Never place a production token directly in the checked-in `.mcp.json`.

The checked-in project registration should use an environment reference or documented secret-loading mechanism for:

```text
STUDIO_API_URL
STUDIO_BEARER_TOKEN
```

The exact Claude Code configuration syntax must be validated against the supported CLI version before changing the shared config.

### 6.4 Hosted Streamable HTTP entry point

Add a hosted MCP endpoint at:

```text
POST https://studio.freshcontext.ai/mcp
```

Use the installed official MCP SDK. Do not hand-roll JSON-RPC framing.

The endpoint must:

- Support MCP `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
- Use the shared contract and dispatch layer.
- Be stateless unless a stateful session is required by the selected SDK transport. Current Studio tools carry no conversational server state, so stateless operation is preferred.
- Return MCP tool errors without leaking bearer tokens, internal filesystem paths, OpenAI credentials, or full infrastructure traces.
- Preserve request correlation IDs in server logs.
- Enforce a request timeout appropriate for the synchronous image endpoint. Generation calls must not be killed by a shorter proxy timeout than the API request itself.

### 6.5 Proxy and authentication boundary

The hosted machine route must be independently authenticated from the browser route:

- `/healthz` remains public liveness only.
- `/mcp` is machine-authenticated and must not redirect to Google.
- UI and `/files/*` continue to use the browser authentication policy unless a separate signed-download mechanism is introduced.
- Clients should present one documented machine credential. The client-facing contract should be `Authorization: Bearer <token>`; any internal proxy translation must remain an infrastructure detail.
- Do not trust `X-Forwarded-Email` or similar headers on the machine route.
- Wrong, missing, or expired credentials return an MCP-compatible authorization failure and an HTTP 401 at the transport boundary.

The first rollout may use the existing provisioned Studio machine credential. Before broad team rollout, replace the shared credential with per-user or per-client credentials with rotation and revocation.

## 7. MCP tool contract

Existing tool names are stable. Existing input fields remain backward compatible. New output fields may be added; removing or renaming an existing field requires a versioned migration.

### 7.1 Existing tools

| Tool | API | Mutating | Required behavior |
|---|---|---:|---|
| `studio_search_assets` | `GET /api/assets` | No | Semantic search and filters; exclude hidden assets by default. |
| `studio_brand_context` | `GET /api/brand/rules` | No | Return published rules with scope, kind, guidance, and provenance. |
| `studio_get_asset` | `GET /api/assets/:id` | No | Return metadata, provenance, and retrievable output reference. |
| `studio_set_asset_hidden` | `POST /api/assets/:id/hidden` | Yes | Explicitly show or hide an asset. |
| `studio_list_tools` | `GET /api/tools` | No | Resolve a human request to a persisted shot type ID. |
| `studio_list_taxonomy` | `GET /api/taxonomy` | No | Return controlled forms, tags, and critique vocabulary. |
| `studio_generate_image` | `POST /api/generate` | Yes, paid | Generate through an image tool and return a structured completed job. |
| `studio_record_feedback` | `POST /api/assets/:id/feedback` | Yes | Capture a judgment without editing upstream rules. |
| `studio_list_feedback` | `GET /api/feedback` | No | Inspect open feedback before generation and support triage. |
| `studio_resolve_feedback` | `PATCH /api/feedback/:id` | Yes | Persist a reviewed resolution or dismissal disposition. |

### 7.2 New required tools

#### `studio_get_job`

Input:

```json
{
  "id": "uuid"
}
```

API:

```text
GET /api/jobs/:id
```

Output must include, when present:

```json
{
  "id": "uuid",
  "status": "generating | complete | failed",
  "tool_id": "uuid",
  "prompt": "string",
  "result_paths": ["generated/...png"],
  "asset_ids": ["uuid"],
  "error": null
}
```

The MCP text response may remain human-readable, but it must also expose machine-readable structured content where supported by the negotiated MCP protocol.

#### `studio_download_job`

Input:

```json
{
  "id": "uuid"
}
```

API or service contract:

- Return a single archive reference for all available job outputs.
- Include filename, content type, byte size when known, and expiration when the reference is signed.
- Do not return a browser-only URL that requires an unrelated Google cookie.
- Do not put bearer credentials in a URL.

Recommended implementation: add a short-lived signed download URL for a job archive, backed by `GET /api/jobs/:id/download`. The existing authenticated endpoint remains available for direct API clients.

For local stdio, an optional `output_path` convenience may download the archive to the caller's filesystem. The hosted transport must return a resource or signed URL instead of assuming access to the caller's filesystem.

### 7.3 `studio_generate_image` output

The current text-only response:

```text
Generated job <id> (<status>).
<file URL>
```

must be extended to a structured result containing:

```json
{
  "job_id": "uuid",
  "status": "complete | failed",
  "tool_id": "uuid",
  "assets": [
    {
      "asset_id": "uuid",
      "file_url": "https://...",
      "mime": "image/png",
      "storage_path": "generated/...png"
    }
  ],
  "download_url": "https://.../download",
  "error": null
}
```

The human-readable text should remain concise and include the job ID, status, asset IDs, and download reference.

## 8. API and URL requirements

### 8.1 Production URL correctness

When the MCP client targets production:

- Returned file references must use `https://studio.freshcontext.ai`, never `http://localhost:3440`.
- The API URL must be normalized without a trailing slash.
- Storage paths must be URL-encoded segment by segment.
- Internal absolute filesystem paths must never appear in MCP output.

### 8.2 Download authorization

The current `/files/*` path is suitable for the browser door but is not a complete headless delivery contract. Choose one of these before declaring terminal delivery complete:

1. Short-lived signed URLs for generated assets and job archives. **Recommended.**
2. An MCP resource response that carries the binary result. Use only for small files because base64 increases payload size and context pressure.
3. A local stdio-only download helper plus a separately documented authenticated API command. This is acceptable as an interim local-only solution, not for hosted MCP.

### 8.3 Error normalization

MCP errors must preserve an actionable category:

- `AUTH_REQUIRED`
- `API_UNREACHABLE`
- `INVALID_TOOL`
- `INVALID_INPUT`
- `GENERATION_FAILED`
- `JOB_NOT_FOUND`
- `OUTPUT_UNAVAILABLE`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`

Messages may include the upstream status and a bounded safe detail. They must not include tokens, authorization headers, or raw OpenAI responses containing sensitive request data.

## 9. Configuration and onboarding

### 9.1 Canonical local configuration

The standalone repository is `brand-studio`. Documentation must not refer to the retired monorepo Studio path for new setup.

Required local variables:

```text
STUDIO_API_URL=http://localhost:3440
STUDIO_BEARER_TOKEN=<local or provisioned machine credential>
```

A production-targeted local MCP client uses:

```text
STUDIO_API_URL=https://studio.freshcontext.ai
STUDIO_BEARER_TOKEN=<provisioned machine credential>
```

Secrets must come from the team's approved secret manager or an untracked local environment file. They must not be copied into `.mcp.json`, shell history, screenshots, test fixtures, or documentation.

### 9.2 Claude Code registration

Document both supported registrations:

- Project-scoped stdio registration from `fresh-context/.mcp.json`.
- User-scoped or project-scoped hosted HTTP registration once `/mcp` exists.

The setup guide must include the approval step and a read-only verification command. A new user should be able to confirm `tools/list`, asset search, and brand-context retrieval without spending generation credit.

### 9.3 Documentation cleanup

Update or explicitly supersede stale claims in:

- `fresh-context/STUDIO-PRD.md`
- `fresh-context/.claude/skills/studio/SKILL.md`
- `fresh-context/ONBOARDING.md`
- `brand-studio/README.md`
- `brand-studio/DEPLOY.md`
- `brand-studio/docker-compose.yml` comments
- `brand-studio/mcp/server.js` comments

The deployment documentation must describe the actual production topology: standalone Studio plus the separate OAuth proxy resource, persistent storage, and the machine-authenticated MCP path.

## 10. Testing strategy

### 10.1 No-spend unit tests

Required tests must run without OpenAI credentials and without network access:

- Tool schemas contain all required fields and bounds.
- Both transports register the same tool names.
- `studio_generate_image` maps arguments to `POST /api/generate`.
- The shot-type system prompt is not dropped.
- Reference-image configuration is not dropped.
- API errors normalize to stable MCP error categories.
- Production-targeted URL shaping never emits localhost URLs.
- Job output shaping includes asset IDs and download metadata.
- Credentials are not present in logs or returned tool content.

### 10.2 Local integration smoke

The default smoke test must remain read-only and must verify:

1. MCP initialize.
2. `tools/list`.
3. `studio_list_tools`.
4. `studio_search_assets`.
5. `studio_brand_context`.
6. `studio_get_asset` for a known fixture or catalog result.

It must not call `studio_generate_image` by default.

### 10.3 Hosted transport smoke

Against a deployed environment with a non-production or approved read-only credential:

- `POST /mcp` initialize succeeds.
- `tools/list` matches local stdio.
- Asset search result shape matches the REST API and local stdio adapter.
- Missing and invalid credentials fail before tool execution.
- No request redirects to Google.
- No response includes internal filesystem paths or credentials.

### 10.4 Paid generation canary

A paid canary is opt-in and must be run manually, never in the default CI suite. It must:

1. Resolve a known low-cost image tool.
2. Request one variant.
3. Verify a completed job.
4. Verify an asset row and retrievable output.
5. Verify the archive download.
6. Record the job ID and cost-sensitive evidence without storing the image in git.

## 11. Rollout plan

### Phase 0 - contract and documentation alignment

- Land this specification.
- Correct stale paths and deployment claims.
- Decide the secret-loading mechanism for local Claude Code users.
- Add no-spend schema and output-shaping tests.

### Phase 1 - local stdio hardening

- Extract shared MCP contract and dispatch code.
- Add `studio_get_job`.
- Add output/download shaping.
- Make local setup work against either localhost or production without editing source.
- Verify Claude Code approval and read-only smoke from a clean checkout.

### Phase 2 - hosted MCP

- Add the Streamable HTTP transport.
- Route `/mcp` through machine authentication without Google redirects.
- Deploy and verify parity with stdio.
- Add signed asset/archive delivery if direct file URLs remain browser-gated.

### Phase 3 - terminal delivery and team rollout

- Add the download helper or signed URL workflow.
- Provision and document machine credentials.
- Run the paid canary.
- Publish the canonical onboarding path.

### Phase 4 - optional extensions

- Expose image iteration input through a transport-safe upload contract.
- Revisit HTML motion as a separate spec.
- Do not add video or repositioning to this implementation by implication.

## 12. Acceptance criteria

The terminal MCP feature is complete when all of the following are true:

- A clean Fresh Context checkout can approve and launch the local Studio MCP without editing server source.
- A clean checkout can target production without emitting localhost URLs.
- Local stdio and hosted HTTP expose the same required tool set and schemas.
- Hosted MCP initialize, list, search, brand-context, asset retrieval, and feedback calls work without Google login.
- Authentication failures are deterministic 401/MCP authorization failures and do not redirect to Google.
- A generation call uses a persisted Studio tool and preserves its system prompt and reference images.
- A successful generation returns a job ID, asset IDs, output references, and an archive reference.
- A terminal client can retrieve the generated output without relying on a browser cookie.
- A failed generation returns a stable error category and a persisted failed job where the API supports it.
- The default test suite performs no paid generation and still covers the generation contract with mocks.
- An opt-in paid canary proves one end-to-end production generation before broad rollout.
- No tracked configuration or documentation contains a production token.
- Product and deployment documentation no longer claims that HTML motion or hosted MCP exists before it actually does.

## 13. Recommended decisions

| Decision | Recommendation |
|---|---|
| Hosted transport | Streamable HTTP at `/mcp` using the installed official MCP SDK. |
| Business logic location | Existing Studio HTTP API and Supabase layer. |
| Tool contract sharing | One transport-independent MCP contract and dispatch module. |
| Client-facing auth | `Authorization: Bearer` machine credential; proxy translation is internal. |
| Initial credential rollout | Provisioned machine token with rotation; move to per-user credentials before broad external use. |
| Output delivery | Short-lived signed URLs for assets and job archives. |
| Generation tests | Mocked by default; one manually approved paid canary. |
| Motion/video | Separate future work, not hidden behind the static image contract. |
