'use strict';

// Fresh Context Studio — standalone API service (deployable; see STUDIO-PRD.md).
// Runs locally on :3440 alongside the local-server (:3430) during the transition;
// deploys to Coolify at studio.freshcontext.ai. NO vault/JSONL deps — Supabase +
// OpenAI + image files only, so it is cloud-portable (unlike the local-server
// monolith).

require('dotenv').config();

const path = require('path');
const express = require('express');
const { mountApi } = require('./src/routes');
const { dirs } = require('./src/lib/storage');

const PORT = parseInt(process.env.PORT, 10) || 3440;
const app = express();
app.use(express.json({ limit: '12mb' }));

// Liveness — unauthenticated (for Coolify health checks).
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'studio', ts: new Date().toISOString() }));

// API (bearer-gated inside mountApi).
mountApi(app);

// Static asset files. In prod these sit behind oauth2-proxy for the browser;
// the API is separately bearer-gated. Library is read-only.
const d = dirs();
app.use('/files/generated', express.static(d.generated));
app.use('/files/references', express.static(d.references));
app.use('/files/library', express.static(d.library));

// The web UI (single-page app). In prod the browser reaches this through
// oauth2-proxy (Google @freshcontext.ai); the UI then calls /api same-origin.
app.use('/', express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Fresh Context Studio API → http://localhost:${PORT}`);
  console.log(`  health:  GET /healthz`);
  console.log(`  api:     GET /api/status  ·  /api/tools  ·  /api/assets  ·  /api/jobs  ·  POST /api/generate`);
  console.log(`  files:   /files/{generated,references,library}/*`);
});
