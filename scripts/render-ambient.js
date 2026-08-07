#!/usr/bin/env node
'use strict';

// Render the committed ambient brand fragment from the published canon.
// Part of /brand-sync (see .claude/skills/brand-sync.md): after a publish,
// this fetches GET /api/brand/ambient (the same render the endpoint serves
// live) and writes it to <repo>/brand/ambient.md, which CLAUDE.md @-imports.
//
// Usage: node brand-studio/scripts/render-ambient.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const API = (process.env.STUDIO_API_URL || 'http://localhost:3440').replace(/\/$/, '');
const TOKEN = process.env.STUDIO_BEARER_TOKEN || '';
const OUT = path.resolve(__dirname, '..', '..', '..', 'brand', 'ambient.md');

async function main() {
  const r = await fetch(API + '/api/brand/ambient', { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
  if (!r.ok) throw new Error(`GET /api/brand/ambient → ${r.status} ${(await r.text()).slice(0, 200)}`);
  const md = await r.text();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, 'utf8');
  console.log(`wrote ${OUT} (${md.split('\n').length} lines)`);
}
main().catch((e) => { console.error('[render-ambient] fatal:', e.message); process.exit(1); });
