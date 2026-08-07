'use strict';

// Studio asset indexer — walks the brand-marketing library + Studio generation
// outputs into studio_assets + studio_asset_embeddings. Incremental (skips files
// whose content_hash is unchanged). Modeled on local-server/rag/vault-indexer.js.
//
//   cd brand-studio
//   node scripts/index-assets.js --sample 10        # validate on a small mix
//   node scripts/index-assets.js                     # full run (all sources)
//   node scripts/index-assets.js --source library    # one source
//   node scripts/index-assets.js --force             # re-index even if unchanged
//
// Describe strategy (right model per task): library rasters → gpt-4o-mini vision;
// our own generations → prompt text (ground truth, no vision spend); svg/oversize
// → filename+path text fallback. Embeddings → text-embedding-3-small (1536-dim).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sizeOf = require('image-size');

const db = require('../src/db');
const { dirs } = require('../src/lib/storage');
const { embed, describe, EMBED_MODEL } = require('../src/lib/openai');
const taxonomyDefaults = require('../src/taxonomy');

const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const IMAGE_EXT = new Set([...RASTER, 'svg']);
const MAX_VISION_BYTES = 20 * 1024 * 1024; // OpenAI image cap

function parseArgs(argv) {
  const a = { source: 'all', sample: null, force: false, concurrency: 5, dry: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--force') a.force = true;
    else if (t === '--dry') a.dry = true;
    else if (t === '--sample') a.sample = parseInt(argv[++i], 10);
    else if (t === '--source') a.source = argv[++i];
    else if (t === '--concurrency') a.concurrency = parseInt(argv[++i], 10);
  }
  return a;
}

function walk(root) {
  const out = [];
  (function rec(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) rec(abs);
      else {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (IMAGE_EXT.has(ext)) out.push(abs);
      }
    }
  })(root);
  return out;
}

const mimeFor = (ext) => (ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`);
const cleanTitle = (file) => path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').trim();

async function pool(items, size, worker) {
  const results = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await worker(items[my], my).catch((e) => ({ error: e.message, item: items[my] }));
    }
  });
  await Promise.all(runners);
  return results;
}

async function buildWorklist({ source }, gen) {
  const items = [];
  if (source === 'all' || source === 'library') {
    for (const abs of walk(gen.libraryDir)) {
      const rel = path.relative(gen.libraryDir, abs);
      items.push({ source: 'library', abs, storage_path: `library/${rel}`, title: cleanTitle(abs), dir: path.dirname(rel) });
    }
  }
  if (source === 'all' || source === 'generated') {
    const jobs = await db.listJobs({ limit: 10000 });
    const tools = await db.listTools();
    const toolName = Object.fromEntries(tools.map((t) => [t.id, t.name]));
    for (const j of jobs) {
      for (const rp of j.result_paths || []) {
        items.push({
          source: 'generated',
          abs: path.join(gen.generatedDir, path.basename(rp)),
          storage_path: rp, // already 'generated/<file>'
          title: `${toolName[j.tool_id] || 'Studio'} — ${(j.prompt || '').slice(0, 40)}`,
          job: j, toolName: toolName[j.tool_id] || 'Studio',
        });
      }
    }
  }
  return items;
}

async function processItem(item, forms, tags, { force, dry }) {
  if (!fs.existsSync(item.abs)) return { skipped: 'missing', storage_path: item.storage_path };
  const buf = fs.readFileSync(item.abs);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');

  const existing = await db.getAssetByPath(item.storage_path);
  if (existing && existing.content_hash === hash && !force) {
    return { skipped: 'unchanged', storage_path: item.storage_path };
  }

  const ext = path.extname(item.abs).slice(1).toLowerCase();
  let width = null, height = null, mime = mimeFor(ext);
  try { const d = sizeOf(buf); width = d.width; height = d.height; if (d.type) mime = mimeFor(d.type); } catch { /* svg/unknown */ }

  // Describe.
  let described;
  if (item.source === 'generated') {
    described = await describe({ text: `${item.toolName}: ${item.job.prompt}`, forms, tags });
  } else if (RASTER.has(ext) && buf.length <= MAX_VISION_BYTES) {
    described = await describe({ imageDataUri: `data:${mime};base64,${buf.toString('base64')}`, forms, tags });
  } else {
    described = await describe({ text: `Filename: ${item.title}. Location: ${item.dir}.`, forms, tags });
  }

  const provenance = item.source === 'generated'
    ? { tool_id: item.job.tool_id, tool: item.toolName, prompt: item.job.prompt, job_id: item.job.id, date: item.job.created_at }
    : { legacy: true, dir: item.dir };

  const embedText = [
    item.title,
    described.caption,
    `form: ${described.form}`,
    described.tags.length ? `tags: ${described.tags.join(', ')}` : '',
    item.source === 'generated' ? `prompt: ${item.job.prompt}` : '',
  ].filter(Boolean).join('\n');

  const result = { storage_path: item.storage_path, form: described.form, tags: described.tags, caption: described.caption };
  if (dry) return { ...result, dry: true };

  const embedding = await embed(embedText);
  const asset = await db.upsertAsset({
    source: item.source, kind: 'image', storage_path: item.storage_path, title: item.title,
    form: described.form, tags: described.tags, caption: described.caption, provenance,
    job_id: item.source === 'generated' ? item.job.id : null,
    width, height, mime, content_hash: hash,
  });
  await db.upsertAssetEmbedding({ asset_id: asset.id, content: embedText, embedding, model: EMBED_MODEL });
  return result;
}

(async () => {
  const args = parseArgs(process.argv);
  const d = dirs();
  const gen = { libraryDir: d.library, generatedDir: d.generated };

  // Taxonomy from DB (reflects edits); fall back to code defaults.
  let taxo = await db.listTaxonomy();
  if (!taxo.length) taxo = [
    ...taxonomyDefaults.FORMS.map((f) => ({ kind: 'form', ...f })),
    ...taxonomyDefaults.TAGS.map((t) => ({ kind: 'tag', ...t })),
  ];
  const forms = taxo.filter((t) => t.kind === 'form');
  const tags = taxo.filter((t) => t.kind === 'tag');

  let items = await buildWorklist(args, gen);
  if (args.sample) {
    // A deterministic mix of both sources for validation.
    const lib = items.filter((i) => i.source === 'library').slice(0, Math.ceil(args.sample / 2));
    const genI = items.filter((i) => i.source === 'generated').slice(0, Math.floor(args.sample / 2));
    items = [...lib, ...genI];
  }

  console.log(`Indexing ${items.length} assets (source=${args.source}${args.sample ? `, sample=${args.sample}` : ''}${args.dry ? ', DRY' : ''}). caption=${process.env.STUDIO_CAPTION_MODEL || 'gpt-4o-mini'} embed=${EMBED_MODEL}`);
  const t0 = Date.now();
  let done = 0;
  const results = await pool(items, args.concurrency, async (item) => {
    const r = await processItem(item, forms, tags, args);
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${items.length}`);
    return r;
  });

  const ok = results.filter((r) => r && !r.error && !r.skipped);
  const skipped = results.filter((r) => r && r.skipped);
  const errors = results.filter((r) => r && r.error);
  const byForm = {};
  for (const r of ok) byForm[r.form] = (byForm[r.form] || 0) + 1;

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — indexed ${ok.length}, skipped ${skipped.length}, errors ${errors.length}`);
  console.log('By form:', Object.entries(byForm).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}:${n}`).join('  '));
  if (args.sample || args.dry) {
    console.log('\nSample results:');
    for (const r of ok.slice(0, 20)) console.log(`  [${r.form}] ${r.storage_path}\n      ${r.caption}\n      tags: ${r.tags.join(', ')}`);
  }
  if (errors.length) { console.log('\nErrors:'); for (const e of errors.slice(0, 10)) console.log(`  ${e.item?.storage_path}: ${e.error}`); }
  process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
