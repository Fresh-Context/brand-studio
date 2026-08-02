# Studio → Coolify deploy (M6)

Target: `https://studio.freshcontext.ai`. Topology: **one Coolify docker-compose resource, two containers** - `oauth2-proxy` owns the domain (the human door, Google `@freshcontext.ai` only); the `studio` app is internal-only, with `/api/*` passed through OAuth-free because the app enforces its own bearer (the machine/MCP door). TLS is automatic via Coolify's proxy once DNS resolves.

Auth lives in three places - know which is which:
- **I. Google Cloud Console** - the OAuth client (identity provider side).
- **II. Coolify env vars** - the oauth2-proxy config (client id/secret, cookie secret, domain restriction) + the app secrets.
- **III. Already in code** - `requireBearer` on `/api/*` (`src/lib/auth.js`); oauth2-proxy skips those routes so machines never touch Google.

## Phase 0 - VPS + DNS (you)

1. Provision a VPS (4 GB RAM is plenty; Hetzner/DO). Note its IP.
2. Install Coolify on it: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`, then open the dashboard on port 8000 and create the admin account.
3. DNS at the `freshcontext.ai` registrar: **A record `studio` → VPS IP**. (Optionally `coolify` → same IP for the dashboard.)

## Phase I - Google OAuth client (you)

In [console.cloud.google.com](https://console.cloud.google.com) under the Workspace org:

1. APIs & Services → OAuth consent screen → **Internal** (Workspace-only; this alone blocks non-org accounts - the proxy's `EMAIL_DOMAINS` is belt-and-suspenders).
2. APIs & Services → Credentials → Create Credentials → **OAuth client ID** → type **Web application**.
3. Authorized redirect URI: `https://studio.freshcontext.ai/oauth2/callback` (exact).
4. Keep the **client ID + client secret** for Phase III.

## Phase II - Coolify resource

1. New Project → Add Resource → **Docker Compose** → Git source `Fresh-Context/fresh-context` (install the Coolify GitHub App or add a deploy key).
2. **Branch:** wherever this file lives when you deploy (currently `research/context-infrastructure`; repoint to `main` after merge).
3. **Base directory:** `/apps/studio` · **Compose file:** `docker-compose.yml`.
4. **Domain:** attach `https://studio.freshcontext.ai` to the **oauth2-proxy** service, port **4180**. Do not expose `studio` publicly.

## Phase III - Environment variables (Coolify UI → the resource)

| Var | Value |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | same values as `apps/studio/.env` (contextListener) |
| `OPENAI_API_KEY` | same as local |
| `STUDIO_BEARER_TOKEN` | **generate a NEW production token** - `openssl rand -hex 32`. Do not reuse the dev token. |
| `OAUTH2_PROXY_CLIENT_ID` / `OAUTH2_PROXY_CLIENT_SECRET` | from Phase I |
| `OAUTH2_PROXY_COOKIE_SECRET` | `openssl rand -base64 32 | tr -- '+/' '-_'` |

Then **Deploy**. First build takes a few minutes; the identity tab stays empty until Phase IV.

## Phase IV - Populate the volume (one-time upload)

The compose mounts one persistent volume at `/data` (`generated/`, `references/`, `library/`). From your laptop:

```sh
# find the volume's host path (run on the VPS)
docker volume inspect <stack>_studio-data --format '{{.Mountpoint}}'

# then from the laptop (repo root):
rsync -av --progress brand-marketing/            root@VPS:<mountpoint>/library/
rsync -av --progress local-server/studio/generated/  root@VPS:<mountpoint>/generated/
rsync -av --progress local-server/studio/references/ root@VPS:<mountpoint>/references/
```

The library sync includes `brand-guidelines/*.md` (the Voice & Tone visual docs) and `brand-guideline/whoweare.html` (the identity embed source). **Restart the studio service** after the first sync so the identity embed builds.

## Phase V - Verify (in order)

1. `curl https://studio.freshcontext.ai/healthz` → `{ok:true}` (no auth - proves DNS + TLS + skip-route).
2. Browser → `https://studio.freshcontext.ai` → Google login → Identity page. Incognito with a non-`@freshcontext.ai` account must be refused.
3. `curl -H "Authorization: Bearer $PROD_TOKEN" https://studio.freshcontext.ai/api/status` → counts. Without the header → **401**.
4. `curl -H "Authorization: Bearer $PROD_TOKEN" https://studio.freshcontext.ai/api/brand/ambient` → the 19-rule fragment (the cloud-agent door).
5. Generate one image via the UI → confirm it lands in the gallery (proves volume writes + OpenAI).

## Phase VI - Repoint the consumers

- **`.mcp.json`** (`fresh-context-studio` server env): `STUDIO_API_URL=https://studio.freshcontext.ai` + the prod bearer. *Choice:* keep local sessions on `localhost:3440` for dev and use the prod URL only where localhost is unreachable (claude.ai cloud) - or cut everything over. Lean: cut over; localhost stays a dev override.
- **`/studio` skill** (`.claude/skills/studio.md`): repoint base URL the same way.
- **`/brand-sync`**: no change (it reads `STUDIO_API_URL` from `apps/studio/.env` - update that when cutting over).

## Known caveats

- `/files/*` sits behind Google - correct for humans; MCP-returned file URLs open fine in a logged-in browser but are not headlessly fetchable. If that ever bites, add bearer-accept on `/files`.
- oauth2-proxy pinned `v7.6.0`; bump deliberately.
- The old deploy sketch in `STUDIO-IMAGE-BACKLOG.md` Tier 2 is history; this file is the procedure.
