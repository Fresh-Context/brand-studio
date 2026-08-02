'use strict';

// The feedback queue + audit log (capture happens on the asset:
// POST /api/assets/:id/feedback). This router serves the triage side:
// list the queue (grouped/filtered), and let /studio-crit write back its
// decision record. Rows are never deleted — dismissed/resolved rows with
// their dispositions ARE the changelog.

const express = require('express');
const db = require('../db');

const r = express.Router();

// GET /api/feedback?status=open&asset_id=&verdict=&tool_id=&limit=
// tool_id filters on the embedded asset's provenance (small volumes — in-process).
r.get('/', async (req, res) => {
  try {
    const rows = await db.listFeedback({
      status: req.query.status || null,
      assetId: req.query.asset_id || null,
      verdict: req.query.verdict || null,
      limit: Math.min(500, parseInt(req.query.limit, 10) || 100),
    });
    const toolId = req.query.tool_id;
    res.json(toolId ? rows.filter((f) => f.asset?.provenance?.tool_id === toolId) : rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/feedback/:id {status?, disposition?} — the triage write-back.
// disposition: { level: tool|register|belief|none, decisions: [{action, target,
// detail, at}], session? }. Setting status to resolved/dismissed stamps resolved_at.
r.patch('/:id', async (req, res) => {
  try {
    const { status, disposition } = req.body || {};
    if (status && !['open', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: "status must be open|resolved|dismissed" });
    }
    res.json(await db.updateFeedback(req.params.id, { status: status || null, disposition: disposition ?? null }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = r;
