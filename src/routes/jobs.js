'use strict';

const express = require('express');
const db = require('../db');
const { buildJobArchive, getJobDownloadMetadata } = require('../lib/downloads');
const { createDownloadUrl, signingSecretFromEnv } = require('../lib/signed-links');

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

// GET /api/jobs/:id/download-metadata — no binary payload; used by MCP to
// validate availability and return archive metadata alongside a signed link.
r.get('/:id/download-metadata', async (req, res) => {
  try {
    const metadata = await getJobDownloadMetadata(req.params.id);
    if (!metadata) return res.status(404).json({ error: 'Not found' });
    if (!metadata.available) return res.json({ id: req.params.id, available: false, filename: null, content_type: 'application/zip', byte_size: null, output_count: 0 });
    res.json({
      id: req.params.id,
      available: true,
      filename: metadata.filename,
      content_type: metadata.content_type,
      byte_size: metadata.byte_size,
      output_count: metadata.output_count,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/jobs/:id/download — authenticated direct API archive for clients
// that already have the bearer token. MCP prefers the signed /mcp/download URL.
r.get('/:id/download', async (req, res) => {
  try {
    const archive = await buildJobArchive(req.params.id);
    if (!archive) return res.status(404).json({ error: 'Not found' });
    if (!archive.available) return res.status(404).json({ error: 'No result files available' });
    res.set({
      'Content-Type': archive.content_type,
      'Content-Disposition': `attachment; filename="${archive.filename}"`,
      'Content-Length': String(archive.buffer.length),
    });
    res.send(archive.buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Machine clients may use this endpoint to obtain a short-lived archive link
// without knowing the signing secret. The MCP adapter currently signs locally
// with the same provisioned secret, but this endpoint keeps the service contract
// available to future hosted clients.
r.get('/:id/download-link', async (req, res) => {
  try {
    const metadata = await getJobDownloadMetadata(req.params.id);
    if (!metadata) return res.status(404).json({ error: 'Not found' });
    if (!metadata.available) return res.status(404).json({ error: 'No result files available' });
    const secret = signingSecretFromEnv();
    if (!secret) return res.status(503).json({ error: 'Signed downloads are not configured' });
    const link = createDownloadUrl({ baseUrl: `${req.protocol}://${req.get('host')}`, kind: 'job', id: req.params.id, secret, ttlSeconds: 300 });
    res.json({ ...link, filename: metadata.filename, content_type: metadata.content_type, byte_size: metadata.byte_size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
