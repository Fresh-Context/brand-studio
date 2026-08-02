'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const image = require('../executors/image');

const r = express.Router();

// POST /api/generate — image generation. Synchronous (fine on an always-on host;
// the old serverless-timeout concern is gone on Coolify). Returns the completed job.
// M2 will additionally write an asset-catalog row per output so new generations
// appear in the gallery without a re-index.
r.post('/', async (req, res) => {
  try {
    const { tool_id, prompt, aspect, variants } = req.body || {};
    if (!tool_id || !prompt) return res.status(400).json({ error: 'tool_id and prompt are required' });

    const tool = await db.getTool(tool_id);
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    if (tool.kind !== 'image') return res.status(400).json({ error: `Tool kind is '${tool.kind}'; use the matching generate endpoint` });

    const jobId = crypto.randomUUID();
    const aspectR = aspect || tool.default_aspect_ratio;
    const nVariants = parseInt(variants, 10) || tool.default_variants;

    await db.createJob({
      id: jobId, tool_id, kind: 'image', prompt, media_type: 'image',
      aspect_ratio: aspectR, variants: nVariants, executor: tool.executor, status: 'generating',
    });

    try {
      const { result_paths } = await image.generate({ tool, prompt, aspect: aspectR, variants: nVariants, jobId });
      const job = await db.completeJob(jobId, { resultPaths: result_paths });
      // Catalog each output immediately (browse/recency) — the indexer enriches it
      // with caption + tags + embedding on its next run (best-effort; don't fail the
      // generation if cataloging hiccups).
      await Promise.all((result_paths || []).map((rp) =>
        db.upsertAsset({
          source: 'generated', kind: 'image', storage_path: rp,
          title: `${tool.name} — ${prompt.slice(0, 40)}`,
          provenance: { tool_id, tool: tool.name, prompt, job_id: jobId, date: job.created_at },
          job_id: jobId, mime: 'image/png',
        }).catch(() => null)
      ));
      res.json(job);
    } catch (err) {
      await db.completeJob(jobId, { resultPaths: [], error: err.message });
      res.status(500).json({ error: err.message, job_id: jobId });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
