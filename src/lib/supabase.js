'use strict';

// Supabase client (service key — bypasses RLS). Same contextListener project as
// local-server; Studio state lives in studio_tools / studio_jobs / studio_assets
// / studio_asset_embeddings / studio_taxonomy.

const { createClient } = require('@supabase/supabase-js');

let _client = null;
function sb() {
  if (_client) return _client;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Studio requires SUPABASE_URL and SUPABASE_SERVICE_KEY');
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

function unwrap(res, ctx) {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data;
}

module.exports = { sb, unwrap };
