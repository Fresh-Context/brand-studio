'use strict';

const express = require('express');
const db = require('../db');

const r = express.Router();

r.get('/', async (req, res) => {
  try { res.json(await db.listTools({ kind: req.query.kind || null })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/:id', async (req, res) => {
  try {
    const t = await db.getTool(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.post('/', async (req, res) => {
  try { res.json(await db.createTool(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

r.put('/:id', async (req, res) => {
  try {
    const t = await db.updateTool(req.params.id, req.body);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.delete('/:id', async (req, res) => {
  try { await db.deleteTool(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = r;
