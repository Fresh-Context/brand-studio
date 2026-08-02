'use strict';

const express = require('express');
const db = require('../db');

const r = express.Router();

r.get('/', async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
    res.json(await db.listJobs({ toolId: req.query.tool_id || null, kind: req.query.kind || null, limit }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/:id', async (req, res) => {
  try {
    const j = await db.getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'Not found' });
    res.json(j);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.post('/:id/star', async (req, res) => {
  try { res.json(await db.setJobStarred(req.params.id, !!req.body.starred)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = r;
