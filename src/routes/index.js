'use strict';

const express = require('express');
const { requireBearer } = require('../lib/auth');
const db = require('../db');

function mountApi(app) {
  const api = express.Router();
  api.use(requireBearer); // the machine/MCP door; browser UI is oauth2-proxy-gated in prod

  api.get('/status', async (_req, res) => {
    const base = {
      ok: true,
      supabase_configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
      openai_key_set: !!process.env.OPENAI_API_KEY,
      bearer_set: !!process.env.STUDIO_BEARER_TOKEN,
    };
    try {
      const [tools, jobs, assets] = await Promise.all([
        db.listTools(), db.listJobs({ limit: 10000 }), db.listAssets({ limit: 10000 }),
      ]);
      res.json({ ...base, tools: tools.length, jobs: jobs.length, assets: assets.length });
    } catch (e) {
      res.json({ ...base, ok: false, store_error: e.message });
    }
  });

  api.get('/taxonomy', async (req, res) => {
    try { res.json(await db.listTaxonomy({ kind: req.query.kind || null })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.use('/tools', require('./tools'));
  api.use('/jobs', require('./jobs'));
  api.use('/assets', require('./assets'));
  api.use('/feedback', require('./feedback'));
  api.use('/generate', require('./generate'));
  api.use('/brand', require('./brand'));

  app.use('/api', api);
}

module.exports = { mountApi };
