'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { McpError, normalizeApiError, redactSensitiveText } = require('./errors');
const { createDownloadUrl } = require('../src/lib/signed-links');
const { ASPECT_RATIOS, IMAGE_INPUT_TYPES, TOOLS } = require('./contract');

const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

function fileUrl(apiUrl, storagePath) {
  const clean = safeStoragePath(storagePath);
  if (!clean) return null;
  return `${String(apiUrl).replace(/\/+$/, '')}/files/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

function safeStoragePath(value) {
  if (typeof value !== 'string' || path.isAbsolute(value)) return null;
  const clean = value.replace(/^\/+/, '');
  const segments = clean.split('/');
  if (!/^(generated|references|library)$/.test(segments[0] || '')) return null;
  if (segments.length < 2 || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) return null;
  return clean;
}

function safePrompt(value) {
  return redactSensitiveText(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeOutput(value, depth = 0) {
  if (depth > 8) return '[redacted]';
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeOutput(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeOutput(item, depth + 1)]));
  }
  return value;
}

function createReferenceLink(id, storagePath, config) {
  if (id && config.downloadSigningSecret) {
    try {
      return createDownloadUrl({
        baseUrl: config.apiUrl,
        kind: 'asset',
        id,
        secret: config.downloadSigningSecret,
        ttlSeconds: config.signedUrlTtlSeconds,
      });
    } catch {
      // Fall through to the authenticated API file reference.
    }
  }
  return { url: fileUrl(config.apiUrl, storagePath), expiresAt: null };
}

function shapeAsset(asset, config) {
  const source = asset || {};
  const id = source.id || source.asset_id || null;
  const storagePath = safeStoragePath(source.storage_path);
  const link = createReferenceLink(id, storagePath, config);
  const provenance = source.provenance && typeof source.provenance === 'object' ? sanitizeOutput(source.provenance) : {};
  return sanitizeOutput({
    asset_id: id,
    id,
    title: source.title || null,
    caption: source.caption || null,
    form: source.form || null,
    tags: asArray(source.tags),
    provenance,
    source: source.source || null,
    kind: source.kind || null,
    mime: source.mime || null,
    hidden: source.hidden === true,
    starred: source.starred === true,
    similarity: source.similarity ?? null,
    storage_path: storagePath,
    file_url: link.url,
    file_url_expires_at: link.expiresAt,
  });
}

function shapeTool(tool) {
  const source = tool || {};
  return sanitizeOutput({
    id: source.id || null,
    name: source.name || null,
    description: source.description || '',
    kind: source.kind || null,
    media_type: source.media_type || null,
    default_aspect_ratio: source.default_aspect_ratio || null,
    default_variants: source.default_variants ?? null,
    reference_image_paths: asArray(source.reference_image_paths).map(safeStoragePath).filter(Boolean),
    executor: source.executor || null,
  });
}

function shapeRule(rule) {
  const source = rule || {};
  return sanitizeOutput({
    scope: source.scope || 'global',
    kind: source.kind || null,
    rule: source.rule || source.guidance || '',
    guidance: source.guidance || null,
    provenance: source.provenance || (source.source_title ? { title: source.source_title } : null),
    source_title: source.source_title || null,
  });
}

function shapeJob(job, config) {
  const source = job || {};
  const result = source.result && typeof source.result === 'object' ? source.result : {};
  const resultPaths = asArray(source.result_paths).map(safeStoragePath).filter(Boolean);
  const assetIds = asArray(source.asset_ids || result.asset_ids).filter((id) => typeof id === 'string');
  const assets = assetIds.map((assetId, index) => {
    const storagePath = resultPaths[index] || null;
    const link = createReferenceLink(assetId, storagePath, config);
    return {
      asset_id: assetId,
      file_url: link.url,
      file_url_expires_at: link.expiresAt,
      mime: 'image/png',
      storage_path: storagePath,
    };
  });
  const download = source.status === 'complete' && resultPaths.length && config.downloadSigningSecret
    ? createDownloadUrl({
      baseUrl: config.apiUrl,
      kind: 'job',
      id: source.id,
      secret: config.downloadSigningSecret,
      ttlSeconds: config.signedUrlTtlSeconds,
    })
    : null;
  return sanitizeOutput({
    id: source.id || null,
    job_id: source.id || null,
    status: source.status || 'generating',
    tool_id: source.tool_id || null,
    prompt: safePrompt(source.prompt || ''),
    result_paths: resultPaths,
    asset_ids: assetIds,
    assets,
    download_url: download && download.url,
    download_url_expires_at: download && download.expiresAt,
    download: download && {
      download_url: download.url,
      expires_at: download.expiresAt,
      content_type: 'application/zip',
    },
    error: source.error_message || source.error ? redactSensitiveText(source.error_message || source.error) : null,
  });
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent == null ? {} : { structuredContent }),
  };
}

function validateString(args, key, { maxLength = 4096 } = {}) {
  if (typeof args[key] !== 'string' || !args[key].trim()) {
    throw new McpError('INVALID_INPUT', `${key} is required.`);
  }
  if (args[key].length > maxLength) throw new McpError('INVALID_INPUT', `${key} is too long.`);
}

function validateId(args, key = 'id') {
  validateString(args, key, { maxLength: 200 });
}

function validateGenerateArgs(args) {
  validateString(args, 'tool_id', { maxLength: 200 });
  validateString(args, 'prompt', { maxLength: 4000 });
  if (args.aspect != null && !ASPECT_RATIOS.includes(args.aspect)) {
    throw new McpError('INVALID_INPUT', 'aspect must be one of 1:1, 16:9, 9:16, 4:3, or 3:4.');
  }
  if (args.variants != null && (!Number.isInteger(args.variants) || args.variants < 1 || args.variants > 4)) {
    throw new McpError('INVALID_INPUT', 'variants must be an integer between 1 and 4.');
  }
  if (args.input_image != null) {
    if (!args.input_image || typeof args.input_image !== 'object' || !IMAGE_INPUT_TYPES.includes(args.input_image.type)) {
      throw new McpError('INVALID_INPUT', 'input_image must contain type local_file or https_url.');
    }
    if (typeof args.input_image.value !== 'string' || !args.input_image.value.trim()) {
      throw new McpError('INVALID_INPUT', 'input_image.value is required.');
    }
  }
}

function assertArrayLimit(value, key, max) {
  if (value == null) return;
  if (!Array.isArray(value) || value.length > max) throw new McpError('INVALID_INPUT', `${key} must be an array with at most ${max} items.`);
}

function hostAllowed(host, allowlist) {
  return allowlist.some((allowed) => allowed === host || (allowed.startsWith('*.') && host.endsWith(allowed.slice(1))));
}

async function readLocalImage(value) {
  const absolute = path.resolve(value);
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat || !stat.isFile()) throw new McpError('INVALID_INPUT', 'input_image local_file is not readable.');
  if (stat.size > MAX_INPUT_IMAGE_BYTES) throw new McpError('INVALID_INPUT', 'input_image exceeds the 10 MB limit.');
  const extension = path.extname(absolute).toLowerCase();
  const mime = IMAGE_MIME_BY_EXTENSION[extension];
  if (!mime) throw new McpError('INVALID_INPUT', 'input_image local_file must be PNG, JPEG, or WebP.');
  return { buffer: await fs.readFile(absolute), mime, filename: `input${extension}` };
}

async function readHttpsImage(value, { fetchImpl, timeoutMs, allowedHosts }) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new McpError('INVALID_INPUT', 'input_image https_url must be a valid URL.'); }
  if (parsed.protocol !== 'https:' || !hostAllowed(parsed.hostname.toLowerCase(), allowedHosts)) {
    throw new McpError('INVALID_INPUT', 'input_image https_url must use an allowlisted HTTPS host.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(parsed, { signal: controller.signal, redirect: 'error' });
  } catch (error) {
    throw new McpError('UPSTREAM_UNAVAILABLE', 'The input image URL could not be fetched.', { cause: error });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new McpError('INVALID_INPUT', 'The input image URL did not return an image.', { status: response.status });
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) throw new McpError('INVALID_INPUT', 'The input image URL must return PNG, JPEG, or WebP.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_INPUT_IMAGE_BYTES) throw new McpError('INVALID_INPUT', 'input_image exceeds the 10 MB limit.');
  const extension = contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : '.jpg';
  return { buffer, mime: contentType, filename: `input${extension}` };
}

function createApiClient({ apiUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 180_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  async function request(method, requestPath, { body, formData = false, operation = '', requestId = null } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(requestId ? { 'X-Request-ID': requestId } : {}),
    };
    const options = { method, headers, signal: controller.signal };
    if (body !== undefined) {
      if (formData) {
        options.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
    }
    let response;
    try {
      response = await fetchImpl(`${String(apiUrl).replace(/\/+$/, '')}${requestPath}`, options);
    } catch (error) {
      clearTimeout(timeout);
      if (error && error.name === 'AbortError') {
        throw new McpError('UPSTREAM_UNAVAILABLE', 'The Studio API request timed out.', { cause: error });
      }
      throw new McpError('API_UNREACHABLE', 'The Studio API could not be reached.', { cause: error });
    }
    clearTimeout(timeout);
    const text = await response.text().catch(() => '');
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text }; }
    }
    if (!response.ok) throw normalizeApiError({ status: response.status, path: requestPath, operation, body: data });
    return data;
  }

  return {
    get: (requestPath, options = {}) => request('GET', requestPath, options),
    post: (requestPath, body, options = {}) => request('POST', requestPath, { ...options, body }),
    patch: (requestPath, body, options = {}) => request('PATCH', requestPath, { ...options, body }),
    postMultipart: (requestPath, form, options = {}) => request('POST', requestPath, { ...options, body: form, formData: true }),
    fetchBinary: async (url, requestId = null) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: requestId ? { 'X-Request-ID': requestId } : {},
          signal: controller.signal,
        });
        if (!response.ok) throw normalizeApiError({ status: response.status, path: '/mcp/download', operation: 'download' });
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError('OUTPUT_UNAVAILABLE', 'The signed output could not be downloaded.', { cause: error });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function createDispatcher({ config, apiClient = null, mode = 'stdio', fetchImpl = globalThis.fetch, requestId: defaultRequestId = null } = {}) {
  if (!config) throw new Error('MCP dispatch config is required.');
  const api = apiClient || createApiClient({ ...config, fetchImpl });
  const isHosted = mode === 'hosted';

  async function inputImage(args) {
    if (!args.input_image) return null;
    if (args.input_image.type === 'local_file') {
      if (isHosted || !config.allowLocalFiles) throw new McpError('INVALID_INPUT', 'Hosted MCP cannot read a server-local input_image path.');
      return readLocalImage(args.input_image.value);
    }
    return readHttpsImage(args.input_image.value, {
      fetchImpl,
      timeoutMs: config.timeoutMs,
      allowedHosts: config.allowedImageHosts,
    });
  }

  async function call(name, args = {}, { requestId = defaultRequestId } = {}) {
    if (!TOOLS.some((tool) => tool.name === name)) throw new McpError('INVALID_INPUT', `Unknown Studio tool: ${name}.`);
    const input = args && typeof args === 'object' ? args : {};
    switch (name) {
      case 'studio_search_assets': {
        validateString(input, 'query', { maxLength: 1000 });
        if (input.limit != null && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)) throw new McpError('INVALID_INPUT', 'limit must be an integer between 1 and 50.');
        const qs = new URLSearchParams({ q: input.query.trim(), limit: String(input.limit || 20) });
        for (const [key, queryKey] of [['form', 'form'], ['source', 'source'], ['kind', 'kind'], ['tool_id', 'tool_id']]) if (input[key]) qs.set(queryKey, input[key]);
        if (input.include_hidden === true) qs.set('include_hidden', 'true');
        const assets = asArray(await api.get(`/api/assets?${qs.toString()}`, { requestId }));
        const shaped = assets.map((asset) => shapeAsset(asset, config));
        const text = shaped.length
          ? shaped.map((asset) => `- [${asset.form || '—'}]${asset.similarity != null ? ` (${(asset.similarity * 100).toFixed(0)}%)` : ''} ${asset.caption || asset.title || ''}\n  id=${asset.asset_id} · ${asset.file_url || 'no file reference'}`).join('\n')
          : 'No matching assets.';
        return textResult(text, { items: shaped });
      }
      case 'studio_brand_context': {
        const qs = new URLSearchParams();
        if (input.stage) qs.set('scope', input.stage);
        if (input.kind) qs.set('kind', input.kind);
        const rules = asArray(await api.get(`/api/brand/rules${qs.toString() ? `?${qs}` : ''}`, { requestId }));
        const shaped = rules.map(shapeRule);
        const text = shaped.length
          ? shaped.map((rule) => `- (${rule.kind || 'rule'}${rule.scope !== 'global' ? `/${rule.scope}` : ''}) ${rule.rule}${rule.guidance ? `\n  ↳ ${rule.guidance}` : ''}${rule.source_title ? ` [${rule.source_title}]` : ''}`).join('\n')
          : 'No published brand rules.';
        return textResult(text, { items: shaped });
      }
      case 'studio_get_asset': {
        validateId(input);
        const asset = shapeAsset(await api.get(`/api/assets/${encodeURIComponent(input.id)}`, { requestId }), config);
        return textResult(JSON.stringify(asset, null, 2), { asset });
      }
      case 'studio_set_asset_hidden': {
        validateId(input);
        if (typeof input.hidden !== 'boolean') throw new McpError('INVALID_INPUT', 'hidden must be a boolean.');
        const asset = await api.post(`/api/assets/${encodeURIComponent(input.id)}/hidden`, { hidden: input.hidden }, { requestId });
        const result = { id: asset.id || input.id, hidden: asset.hidden === true };
        return textResult(`Asset ${result.id} hidden=${result.hidden}.`, result);
      }
      case 'studio_list_tools': {
        if (input.kind != null && !['image', 'motion', 'video'].includes(input.kind)) throw new McpError('INVALID_INPUT', 'kind must be image, motion, or video.');
        const tools = asArray(await api.get(`/api/tools${input.kind ? `?kind=${encodeURIComponent(input.kind)}` : ''}`, { requestId })).map(shapeTool);
        const text = tools.length ? tools.map((tool) => `- ${tool.name} (id=${tool.id}, kind=${tool.kind}, aspect=${tool.default_aspect_ratio}, variants=${tool.default_variants})`).join('\n') : 'No Studio tools configured.';
        return textResult(text, { items: tools });
      }
      case 'studio_list_taxonomy': {
        const tax = sanitizeOutput(asArray(await api.get(`/api/taxonomy${input.kind ? `?kind=${encodeURIComponent(input.kind)}` : ''}`, { requestId })));
        return textResult(tax.length ? tax.map((entry) => `${entry.kind}: ${entry.value} — ${entry.description || ''}`).join('\n') : 'No taxonomy entries.', { items: tax });
      }
      case 'studio_generate_image': {
        validateGenerateArgs(input);
        const image = await inputImage(input);
        let job;
        if (image) {
          const form = new FormData();
          form.set('tool_id', input.tool_id);
          form.set('prompt', input.prompt);
          if (input.aspect) form.set('aspect', input.aspect);
          if (input.variants != null) form.set('variants', String(input.variants));
          form.set('user_image', new Blob([image.buffer], { type: image.mime }), image.filename);
          job = await api.postMultipart('/api/generate', form, { operation: 'generate', requestId });
        } else {
          const body = { tool_id: input.tool_id, prompt: input.prompt };
          if (input.aspect != null) body.aspect = input.aspect;
          if (input.variants != null) body.variants = input.variants;
          job = await api.post('/api/generate', body, { operation: 'generate', requestId });
        }
        const shaped = shapeJob(job, config);
        const text = `Generated job ${shaped.job_id} (${shaped.status}).${shaped.asset_ids.length ? ` Assets: ${shaped.asset_ids.join(', ')}.` : ''}${shaped.download_url ? ` Archive: ${shaped.download_url}` : ''}${shaped.error ? ` Error: ${shaped.error}` : ''}`;
        return textResult(text, shaped);
      }
      case 'studio_record_feedback': {
        validateId(input, 'asset_id');
        if (!['positive', 'negative'].includes(input.verdict)) throw new McpError('INVALID_INPUT', 'verdict must be positive or negative.');
        if (input.note != null && typeof input.note !== 'string') throw new McpError('INVALID_INPUT', 'note must be a string.');
        assertArrayLimit(input.tags, 'tags', 50);
        const feedback = await api.post(`/api/assets/${encodeURIComponent(input.asset_id)}/feedback`, { verdict: input.verdict, note: input.note, tags: input.tags }, { requestId });
        const safeFeedback = sanitizeOutput(feedback);
        return textResult(`Captured ${safeFeedback.verdict} feedback ${safeFeedback.id} (status: ${safeFeedback.status}). Triage via /studio-crit.`, { feedback: safeFeedback });
      }
      case 'studio_list_feedback': {
        if (input.limit != null && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500)) throw new McpError('INVALID_INPUT', 'limit must be an integer between 1 and 500.');
        const qs = new URLSearchParams({ limit: String(input.limit || 100) });
        if (input.status) qs.set('status', input.status);
        if (input.verdict) qs.set('verdict', input.verdict);
        if (input.tool_id) qs.set('tool_id', input.tool_id);
        if (input.asset_id) qs.set('asset_id', input.asset_id);
        const rows = asArray(await api.get(`/api/feedback?${qs}`, { requestId }));
        const shaped = sanitizeOutput(rows.map((feedback) => ({
          ...feedback,
          asset: feedback.asset ? shapeAsset(feedback.asset, config) : null,
        })));
        const text = shaped.length ? shaped.map((feedback) => `- [${feedback.verdict}/${feedback.status}] ${String(feedback.created_at || '').slice(0, 10)} id=${feedback.id} · asset=${feedback.asset_id}${feedback.note ? `\n  why: ${feedback.note}` : ''}`).join('\n') : 'No feedback matching.';
        return textResult(text, { items: shaped });
      }
      case 'studio_resolve_feedback': {
        validateId(input);
        if (!['resolved', 'dismissed', 'open'].includes(input.status)) throw new McpError('INVALID_INPUT', 'status must be resolved, dismissed, or open.');
        const feedback = await api.patch(`/api/feedback/${encodeURIComponent(input.id)}`, { status: input.status, disposition: input.disposition }, { requestId });
        const safeFeedback = sanitizeOutput(feedback);
        return textResult(`Feedback ${safeFeedback.id} → ${safeFeedback.status}.`, { feedback: safeFeedback });
      }
      case 'studio_get_job': {
        validateId(input);
        const job = shapeJob(await api.get(`/api/jobs/${encodeURIComponent(input.id)}`, { requestId }), config);
        return textResult(JSON.stringify(job, null, 2), job);
      }
      case 'studio_download_job': {
        validateId(input);
        if (input.output_path != null && (isHosted || !config.allowLocalFiles)) throw new McpError('INVALID_INPUT', 'output_path is available only to the local stdio transport.');
        const metadata = await api.get(`/api/jobs/${encodeURIComponent(input.id)}/download-metadata`, { requestId });
        if (!metadata || metadata.available !== true) throw new McpError('OUTPUT_UNAVAILABLE', 'The Studio job has no downloadable output.');
        if (!config.downloadSigningSecret) throw new McpError('OUTPUT_UNAVAILABLE', 'Signed Studio download links are not configured.');
        const link = createDownloadUrl({ baseUrl: config.apiUrl, kind: 'job', id: input.id, secret: config.downloadSigningSecret, ttlSeconds: config.signedUrlTtlSeconds });
        let outputPath = null;
        if (input.output_path) {
          const data = await api.fetchBinary(link.url, requestId);
          await fs.writeFile(path.resolve(input.output_path), data);
          outputPath = path.resolve(input.output_path);
        }
        const result = {
          job_id: input.id,
          download_url: link.url,
          filename: metadata.filename,
          content_type: metadata.content_type || 'application/zip',
          byte_size: Number.isInteger(metadata.byte_size) ? metadata.byte_size : null,
          expires_at: link.expiresAt,
          output_path: outputPath,
        };
        return textResult(`Archive for job ${input.id}: ${link.url}${outputPath ? `\nDownloaded to ${outputPath}` : ''}`, result);
      }
      default:
        throw new McpError('INVALID_INPUT', `Unknown Studio tool: ${name}.`);
    }
  }

  return { api, call };
}

module.exports = {
  createApiClient,
  createDispatcher,
  fileUrl,
  safeStoragePath,
  shapeAsset,
  shapeJob,
  shapeRule,
  shapeTool,
};
