'use strict';

const express = require('express');
const db = require('../db');
const { embed } = require('../lib/openai');

const r = express.Router();

// GET /api/assets — the gallery endpoint. With ?q= it runs semantic search
// (embed the query → match_studio_assets RPC, filtered by kind/form/source/
// tool_id); without ?q= it browses/filters by recency, keyset-paged: pass
// ?before=<created_at>&before_id=<id> of the last row you have to get the next
// page (response body stays a bare array — both doors unchanged). Browse
// responses carry the filtered total in X-Total-Count.
// ?tool_id= — filter to one shot type (a generated asset's provenance.tool_id;
// resolve name→id via GET /api/tools?kind=image). ?include_hidden=true — also
// return assets an off-brand (negative) verdict removed from the default view.
// This is the SAME endpoint the human UI and the MCP both call — the
// "same shape" contract from the PRD.
r.get('/', async (req, res) => {
  try {
    const { q, form, tag, kind, source, tool_id: toolId } = req.query;
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 60);
    const includeHidden = req.query.include_hidden === 'true';

    if (q && q.trim()) {
      const embedding = await embed(q.trim());
      const filter = {};
      if (kind) filter.kind = kind;
      if (form) filter.form = form;
      if (source) filter.source = source;
      if (toolId) filter.tool_id = toolId;
      if (includeHidden) filter.include_hidden = 'true';
      const hits = await db.matchAssets({ embedding, matchCount: limit, filter });
      return res.json(hits);
    }

    const starred = req.query.starred != null ? req.query.starred === 'true' : null;
    const filters = { form: form || null, tag: tag || null, kind: kind || null, source: source || null, starred, toolId: toolId || null, includeHidden };
    const before = req.query.before ? { created_at: req.query.before, id: req.query.before_id || null } : null;
    const [rows, total] = await Promise.all([
      db.listAssets({ ...filters, limit, before }),
      db.countAssets(filters),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/:id', async (req, res) => {
  try {
    const a = await db.getAsset(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.post('/:id/star', async (req, res) => {
  try { res.json(await db.setAssetStarred(req.params.id, !!req.body.starred)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/assets/:id/hidden {hidden} — manual override of the gallery-visibility
// flag. Auto-set true by negative feedback (below); a human can restore an asset
// immediately from the detail dialog, or /studio-crit can restore one it decides
// wasn't actually off-brand when dismissing that feedback item.
r.post('/:id/hidden', async (req, res) => {
  try { res.json(await db.setAssetHidden(req.params.id, !!req.body.hidden)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/assets/:id/feedback {verdict, note?, tags?} — capture a judgment.
// Deliberately dumb at click time: no routing, no rule edits — the /studio-crit
// triage skill processes the queue later with a review gate. A positive verdict
// stars the asset (curation shortlist); a negative verdict hides it from the
// default gallery view (2026-07-28 / 2026-07-29) — nothing is deleted, and
// ?include_hidden=true or the Feedback tab (unaffected) still shows it.
r.post('/:id/feedback', async (req, res) => {
  try {
    const { verdict, note, tags } = req.body || {};
    if (!['positive', 'negative'].includes(verdict)) {
      return res.status(400).json({ error: "verdict must be 'positive' or 'negative'" });
    }
    const asset = await db.getAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    const fb = await db.createFeedback({
      asset_id: asset.id, verdict,
      note: (note || '').trim() || null,
      critique_tags: Array.isArray(tags) ? tags : [],
    });
    if (verdict === 'positive' && !asset.starred) {
      await db.setAssetStarred(asset.id, true).catch(() => null); // best-effort
    }
    if (verdict === 'negative' && !asset.hidden) {
      await db.setAssetHidden(asset.id, true).catch(() => null); // best-effort
    }
    res.json(fb);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
