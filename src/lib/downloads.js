'use strict';

const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { dirs } = require('./storage');
const { buildStoredZip } = require('./zip');

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'studio';
}

function resolveWithin(root, relativePath) {
  if (!root || !relativePath || path.isAbsolute(relativePath)) return null;
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, relativePath);
  if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) return null;
  return abs;
}

function resolveStoragePath(storagePath) {
  if (typeof storagePath !== 'string') return null;
  const match = /^(generated|references|library)\/(.+)$/.exec(storagePath);
  if (!match) return null;
  const root = dirs()[match[1]];
  return resolveWithin(root, match[2]);
}

function resolveGeneratedResult(relpath) {
  if (typeof relpath !== 'string') return null;
  const rest = relpath.startsWith('generated/') ? relpath.slice('generated/'.length) : relpath;
  return resolveWithin(dirs().generated, rest);
}

function availableJobEntries(job) {
  const entries = [];
  (Array.isArray(job && job.result_paths) ? job.result_paths : []).forEach((relpath, index) => {
    const abs = resolveGeneratedResult(relpath);
    if (!abs || !fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return;
    const ext = path.extname(abs) || '.png';
    entries.push({
      name: `${slugify(job.tool_name || job.tool || 'studio')}-${index + 1}${ext}`,
      data: fs.readFileSync(abs),
      storage_path: relpath,
      byte_size: stat.size,
    });
  });
  return entries;
}

async function getJobDownloadMetadata(id) {
  const job = await db.getJob(id);
  if (!job) return null;
  const tool = job.tool_id ? await db.getTool(job.tool_id).catch(() => null) : null;
  const withTool = { ...job, tool_name: tool && tool.name };
  const entries = availableJobEntries(withTool);
  if (!entries.length) return { job: withTool, available: false, entries: [] };
  const filename = `${slugify(tool && tool.name)}-${String(job.id).slice(0, 8)}.zip`;
  return {
    job: withTool,
    available: true,
    filename,
    content_type: 'application/zip',
    byte_size: entries.reduce((total, entry) => total + entry.data.length, 0),
    output_count: entries.length,
    entries,
  };
}

async function buildJobArchive(id) {
  const metadata = await getJobDownloadMetadata(id);
  if (!metadata || !metadata.available) return metadata;
  return { ...metadata, buffer: buildStoredZip(metadata.entries) };
}

module.exports = {
  availableJobEntries,
  buildJobArchive,
  getJobDownloadMetadata,
  resolveGeneratedResult,
  resolveStoragePath,
  slugify,
};
