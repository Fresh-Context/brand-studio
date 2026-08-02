'use strict';

// Studio data layer over Supabase (contextListener). Generalized model per
// STUDIO-PRD.md: tools (any kind) → jobs (a run) → assets (the catalog) with a
// taxonomy + embeddings. All async.

const crypto = require('crypto');
const { sb, unwrap } = require('./lib/supabase');

const TOOLS = 'studio_tools';
const JOBS = 'studio_jobs';
const ASSETS = 'studio_assets';
const TAXONOMY = 'studio_taxonomy';
const EMBEDDINGS = 'studio_asset_embeddings';

const nowISO = () => new Date().toISOString();

// ── Tools ────────────────────────────────────────────────────────────────────
async function listTools({ kind = null } = {}) {
  let q = sb().from(TOOLS).select('*').order('created_at', { ascending: false });
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q, 'listTools');
}

async function getTool(id) {
  return unwrap(await sb().from(TOOLS).select('*').eq('id', id).maybeSingle(), 'getTool');
}

async function createTool(input) {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    name: input.name,
    description: input.description ?? '',
    kind: input.kind ?? 'image',
    media_type: input.media_type ?? 'image',
    system_prompt: input.system_prompt ?? '',
    default_aspect_ratio: input.default_aspect_ratio ?? '16:9',
    default_variants: input.default_variants ?? 2,
    reference_image_paths: input.reference_image_paths ?? [],
    executor: input.executor ?? 'local',
    local_config: input.local_config ?? {},
    n8n_config: input.n8n_config ?? {},
    parameter_visibility: input.parameter_visibility ?? {},
  };
  return unwrap(await sb().from(TOOLS).insert(row).select().single(), 'createTool');
}

async function updateTool(id, patch) {
  const keys = Object.keys(patch).filter((k) => k !== 'id');
  if (!keys.length) return getTool(id);
  const current = await getTool(id);
  if (!current) return null;
  const next = {};
  for (const k of keys) next[k] = patch[k];
  next.updated_at = nowISO();
  next.version = (current.version ?? 1) + 1;
  return unwrap(await sb().from(TOOLS).update(next).eq('id', id).select().single(), 'updateTool');
}

async function deleteTool(id) {
  const res = await sb().from(TOOLS).delete().eq('id', id);
  if (res.error) throw new Error(`deleteTool: ${res.error.message}`);
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
async function listJobs({ toolId = null, kind = null, limit = 100 } = {}) {
  let q = sb().from(JOBS).select('*').order('created_at', { ascending: false }).limit(limit);
  if (toolId) q = q.eq('tool_id', toolId);
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q, 'listJobs');
}

async function getJob(id) {
  return unwrap(await sb().from(JOBS).select('*').eq('id', id).maybeSingle(), 'getJob');
}

async function createJob(input) {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    tool_id: input.tool_id,
    kind: input.kind ?? 'image',
    prompt: input.prompt,
    media_type: input.media_type ?? 'image',
    aspect_ratio: input.aspect_ratio ?? '16:9',
    variants: input.variants ?? 2,
    executor: input.executor,
    status: input.status ?? 'pending',
    params: input.params ?? {},
    metadata: input.metadata ?? {},
    user_image_path: input.user_image_path ?? null,
  };
  return unwrap(await sb().from(JOBS).insert(row).select().single(), 'createJob');
}

async function completeJob(id, { resultPaths = [], result = {}, error = null } = {}) {
  return unwrap(
    await sb().from(JOBS).update({
      status: error ? 'failed' : 'complete',
      result_paths: resultPaths,
      result,
      error_message: error,
      completed_at: nowISO(),
    }).eq('id', id).select().single(),
    'completeJob'
  );
}

async function setJobStarred(id, starred) {
  return unwrap(await sb().from(JOBS).update({ starred: !!starred }).eq('id', id).select().single(), 'setJobStarred');
}

// ── Assets (catalog) ─────────────────────────────────────────────────────────
// `hidden`: set true automatically when negative feedback is captured (mirrors
// the auto-star on positive feedback) — the "filter off-brand visuals from the
// gallery" behavior. Excluded from browse/search by default; nothing is
// deleted, so `includeHidden: true` (or the Feedback tab, which is unaffected)
// always still finds it. `toolId` filters on the shot type a generated asset
// came from (provenance->>tool_id) — library assets have none, so this only
// ever matches generated work, which is the intended scope for "shot type".
function applyAssetFilters(q, { form = null, tag = null, kind = null, source = null, starred = null, toolId = null, includeHidden = false } = {}) {
  if (form) q = q.eq('form', form);
  if (kind) q = q.eq('kind', kind);
  if (source) q = q.eq('source', source);
  if (starred != null) q = q.eq('starred', !!starred);
  if (tag) q = q.contains('tags', [tag]);
  if (toolId) q = q.eq('provenance->>tool_id', toolId);
  if (!includeHidden) q = q.eq('hidden', false);
  return q;
}

async function listAssets({ form = null, tag = null, kind = null, source = null, starred = null, toolId = null, includeHidden = false, limit = 60, before = null } = {}) {
  let q = sb().from(ASSETS).select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  q = applyAssetFilters(q, { form, tag, kind, source, starred, toolId, includeHidden });
  // Keyset cursor: rows strictly older than (created_at, id) of the last row the
  // caller has. id is the tiebreak for identical timestamps (batch indexer runs).
  if (before && before.created_at) {
    q = before.id
      ? q.or(`created_at.lt."${before.created_at}",and(created_at.eq."${before.created_at}",id.lt."${before.id}")`)
      : q.lt('created_at', before.created_at);
  }
  return unwrap(await q, 'listAssets');
}

async function countAssets({ form = null, tag = null, kind = null, source = null, starred = null, toolId = null, includeHidden = false } = {}) {
  let q = sb().from(ASSETS).select('id', { count: 'exact', head: true });
  q = applyAssetFilters(q, { form, tag, kind, source, starred, toolId, includeHidden });
  const res = await q;
  if (res.error) throw new Error(`countAssets: ${res.error.message}`);
  return res.count ?? 0;
}

async function getAsset(id) {
  return unwrap(await sb().from(ASSETS).select('*').eq('id', id).maybeSingle(), 'getAsset');
}

async function getAssetByPath(storagePath) {
  return unwrap(await sb().from(ASSETS).select('*').eq('storage_path', storagePath).maybeSingle(), 'getAssetByPath');
}

// Upsert on storage_path (unique) — the indexer + generate both write here idempotently.
async function upsertAsset(input) {
  const row = {
    source: input.source,
    kind: input.kind ?? 'image',
    storage_path: input.storage_path,
    title: input.title ?? null,
    form: input.form ?? null,
    tags: input.tags ?? [],
    caption: input.caption ?? null,
    provenance: input.provenance ?? {},
    job_id: input.job_id ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    mime: input.mime ?? null,
    content_hash: input.content_hash ?? null,
    indexed_at: input.indexed_at ?? nowISO(),
  };
  return unwrap(
    await sb().from(ASSETS).upsert(row, { onConflict: 'storage_path' }).select().single(),
    'upsertAsset'
  );
}

async function setAssetStarred(id, starred) {
  return unwrap(await sb().from(ASSETS).update({ starred: !!starred }).eq('id', id).select().single(), 'setAssetStarred');
}

async function setAssetHidden(id, hidden) {
  return unwrap(await sb().from(ASSETS).update({ hidden: !!hidden }).eq('id', id).select().single(), 'setAssetHidden');
}

// ── Taxonomy ───────────────────────────────────────────────────────────────--
async function listTaxonomy({ kind = null } = {}) {
  let q = sb().from(TAXONOMY).select('*').order('kind').order('value');
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q, 'listTaxonomy');
}

async function upsertTaxonomy(entries) {
  if (!entries.length) return [];
  return unwrap(
    await sb().from(TAXONOMY).upsert(entries, { onConflict: 'kind,value' }).select(),
    'upsertTaxonomy'
  );
}

// ── Embeddings (RAG) ───────────────────────────────────────────────────────--
async function upsertAssetEmbedding({ asset_id, content, embedding, model }) {
  return unwrap(
    await sb().from(EMBEDDINGS).upsert(
      { asset_id, content, embedding, model: model ?? 'text-embedding-3-small' },
      { onConflict: 'asset_id' }
    ).select().single(),
    'upsertAssetEmbedding'
  );
}

// ── Feedback (gallery judgments → the /studio-crit triage queue + audit log) ──
// Capture is dumb (verdict + why + tags); routing intelligence lives in the
// triage skill, which writes its decision record into `disposition` and flips
// `status`. Tool/job/prompt are derived from the asset's provenance — never
// denormalized here. See STUDIO-PRD.md "Gallery feedback loop → upstream rules".
const FEEDBACK = 'studio_feedback';

async function createFeedback({ asset_id, verdict, note = null, critique_tags = [] }) {
  return unwrap(
    await sb().from(FEEDBACK).insert({ asset_id, verdict, note, critique_tags }).select().single(),
    'createFeedback'
  );
}

// Each row comes back with its asset embedded (title/form/path/provenance) so the
// UI audit log and the triage agent can render/group without N+1 fetches.
async function listFeedback({ status = null, assetId = null, verdict = null, limit = 100 } = {}) {
  let q = sb().from(FEEDBACK)
    .select('*, asset:studio_assets(id, title, form, storage_path, source, provenance)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  if (assetId) q = q.eq('asset_id', assetId);
  if (verdict) q = q.eq('verdict', verdict);
  return unwrap(await q, 'listFeedback');
}

async function updateFeedback(id, { status = null, disposition = null } = {}) {
  const patch = {};
  if (status) {
    patch.status = status;
    patch.resolved_at = status === 'open' ? null : nowISO();
  }
  if (disposition != null) patch.disposition = disposition;
  if (!Object.keys(patch).length) throw new Error('updateFeedback: nothing to update');
  return unwrap(await sb().from(FEEDBACK).update(patch).eq('id', id).select().single(), 'updateFeedback');
}

// ── Brand rules (published cache — compiled from vault by /brand-sync) ──────
const BRAND_RULES = 'studio_brand_rules';

async function listBrandRules({ scope = null, kind = null, ambient = null, audience = null } = {}) {
  let q = sb().from(BRAND_RULES).select('*').eq('status', 'active').order('sort').order('compiled_at');
  if (scope) q = q.in('scope', ['global', scope]); // stage queries include the globals
  if (kind) q = q.eq('kind', kind);
  if (ambient != null) q = q.eq('ambient', !!ambient);
  if (audience) q = q.eq('audience', audience);
  return unwrap(await q, 'listBrandRules');
}

// Replace-all publish: the table is a published snapshot, not a merged store.
async function replaceBrandRules(rows) {
  const stamp = nowISO();
  const del = await sb().from(BRAND_RULES).delete().gte('compiled_at', '1970-01-01');
  if (del.error) throw new Error(`replaceBrandRules(delete): ${del.error.message}`);
  const prepared = rows.map((r) => ({
    kind: r.kind,
    scope: r.scope ?? 'global',
    rule: r.rule,
    guidance: r.guidance ?? null,
    audience: r.audience ?? 'external',
    ambient: !!r.ambient,
    source_note: r.source_note ?? null,
    source_title: r.source_title ?? null,
    sort: r.sort ?? 100,
    status: 'active',
    compiled_at: stamp,
  }));
  return unwrap(await sb().from(BRAND_RULES).insert(prepared).select(), 'replaceBrandRules');
}

// Curated brand-voice notes from the vault (same Supabase). Studio is
// employee-gated, so internal brand notes are fine to show; we exclude only
// notes explicitly marked internal, and title-scope to brand/voice material.
// First-pass curation (title match) — refine the selection later.
async function brandVoiceNotes(limit = 8) {
  // High-signal title match only — %brand%/%positioning% pulled in role-hub and
  // research notes, so we scope to voice/lexicon/messaging. (Deeper curation —
  // e.g. semantic selection from the vault RAG — is a later refinement.)
  const res = await sb().from('notes')
    .select('title, path, body_md, type, audience')
    .or('title.ilike.%voice%,title.ilike.%lexicon%,title.ilike.%messaging%,title.ilike.%brand voice%')
    .limit(50);
  const rows = unwrap(res, 'brandVoiceNotes') || [];
  return rows.filter((n) => n.audience !== 'internal').slice(0, limit);
}

// Semantic search RPC (created in the M2 ingestion migration).
async function matchAssets({ embedding, matchCount = 30, filter = {} }) {
  const { data, error } = await sb().rpc('match_studio_assets', {
    query_embedding: embedding,
    match_count: matchCount,
    filter,
  });
  if (error) throw new Error(`matchAssets: ${error.message}`);
  return data;
}

module.exports = {
  listTools, getTool, createTool, updateTool, deleteTool,
  listJobs, getJob, createJob, completeJob, setJobStarred,
  listAssets, countAssets, getAsset, getAssetByPath, upsertAsset, setAssetStarred, setAssetHidden,
  createFeedback, listFeedback, updateFeedback,
  listTaxonomy, upsertTaxonomy,
  upsertAssetEmbedding, matchAssets,
  brandVoiceNotes,
  listBrandRules, replaceBrandRules,
};
