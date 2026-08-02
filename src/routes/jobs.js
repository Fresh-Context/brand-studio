'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { dirs } = require('../lib/storage');
const { buildStoredZip } = require('../lib/zip');

const r = express.Router();

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'studio';
}

// Resolve a job result path (e.g. "generated/<jobId>_0.png") against the
// generated root with the same containment guarantee /files/generated
// (express.static) gives — a path escaping the root is rejected rather than
// read.
function resolveGeneratedResult(relpath) {
  const root = dirs().generated;
  const rest = relpath.startsWith('generated/') ? relpath.slice('generated/'.length) : relpath;
  const abs = path.resolve(root, rest);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

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

// GET /api/jobs/:id/download — stream a job's results as one .zip attachment.
// Complements /files/generated (one file, inline): the UI's "Download all"
// hits this so a multi-variant job is one click instead of N. Every result
// path is re-validated through resolveGeneratedResult exactly as /files/generated
// is, so a path escaping the generated root — or one missing on disk — is
// skipped rather than served; a job with no readable results is a 404. The
// archive is built in memory: fine for the <= 10 variants a job ever holds.
r.get('/:id/download', async (req, res) => {
  try {
    const job = await db.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });

    const tool = job.tool_id ? await db.getTool(job.tool_id).catch(() => null) : null;
    const slug = slugify(tool && tool.name);

    const entries = [];
    (job.result_paths || []).forEach((relpath, index) => {
      const abs = resolveGeneratedResult(relpath);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
      const ext = path.extname(abs) || '.png';
      entries.push({ name: `${slug}-${index + 1}${ext}`, data: fs.readFileSync(abs) });
    });

    if (entries.length === 0) return res.status(404).json({ error: 'No result files available' });

    const zipBuffer = buildStoredZip(entries);
    const filename = `${slug}-${String(job.id).slice(0, 8)}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zipBuffer.length),
    });
    res.send(zipBuffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
