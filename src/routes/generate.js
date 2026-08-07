'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const image = require('../executors/image');
const { dirs } = require('../lib/storage');

const r = express.Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(_req, file, cb) {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}.`));
    }
    cb(null, true);
  },
});

// multer only engages for multipart/form-data requests (the iteration path —
// "use this result as input" — posting a `user_image` file alongside the
// same tool_id/prompt/aspect/variants fields); plain JSON bodies (MCP's
// studio_generate_image) pass straight through untouched.
function acceptUpload(req, res, next) {
  upload.single('user_image')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 10 MB limit.' : err.message;
    res.status(400).json({ error: message });
  });
}

// POST /api/generate — image generation. Synchronous (fine on an always-on host;
// the old serverless-timeout concern is gone on Coolify). Returns the completed job.
// M2 will additionally write an asset-catalog row per output so new generations
// appear in the gallery without a re-index.
r.post('/', acceptUpload, async (req, res) => {
  try {
    const { tool_id, prompt, aspect, variants } = req.body || {};
    if (!tool_id || !prompt) return res.status(400).json({ error: 'tool_id and prompt are required' });

    const tool = await db.getTool(tool_id);
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    if (tool.kind !== 'image') return res.status(400).json({ error: `Tool kind is '${tool.kind}'; use the matching generate endpoint` });

    const jobId = crypto.randomUUID();
    const aspectR = aspect || tool.default_aspect_ratio;
    const nVariants = parseInt(variants, 10) || tool.default_variants;

    // Iteration input ("use this result as input"): persist alongside the
    // generated dir (not references/ — this is a one-off per-job input, not a
    // shot-type exemplar) and pass its absolute path through so the image
    // executor's `path.isAbsolute(rel) ? rel : …` branch reads it directly.
    let userImageRelPath = null;
    let userImageAbsPath = null;
    if (req.file) {
      const { generated: generatedDir } = dirs();
      fs.mkdirSync(generatedDir, { recursive: true });
      const filename = `${jobId}_input${EXT_BY_MIME[req.file.mimetype]}`;
      userImageAbsPath = path.join(generatedDir, filename);
      fs.writeFileSync(userImageAbsPath, req.file.buffer);
      userImageRelPath = `generated/${filename}`;
    }

    await db.createJob({
      id: jobId, tool_id, kind: 'image', prompt, media_type: 'image',
      aspect_ratio: aspectR, variants: nVariants, executor: tool.executor, status: 'generating',
      user_image_path: userImageRelPath,
    });

    try {
      const { result_paths } = await image.generate({
        tool, prompt, aspect: aspectR, variants: nVariants, jobId, userImagePath: userImageAbsPath,
      });
      // Catalog each output immediately (browse/recency). Keep the generated
      // asset IDs on the persisted job so both MCP transports can return a
      // retrievable structured result without guessing from a path.
      const cataloged = await Promise.all((result_paths || []).map((rp) =>
        db.upsertAsset({
          source: 'generated', kind: 'image', storage_path: rp,
          title: `${tool.name} — ${prompt.slice(0, 40)}`,
          provenance: {
            tool_id, tool: tool.name, prompt, job_id: jobId, date: new Date().toISOString(),
            ...(userImageRelPath ? { input_path: userImageRelPath } : {}),
          },
          job_id: jobId, mime: 'image/png',
        }).catch(() => null)
      ));
      const assetIds = cataloged.filter(Boolean).map((asset) => asset.id);
      const job = await db.completeJob(jobId, { resultPaths: result_paths, result: { asset_ids: assetIds } });
      res.json(job);
    } catch (err) {
      await db.completeJob(jobId, { resultPaths: [], error: err.message });
      res.status(500).json({ error: err.message, job_id: jobId });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
