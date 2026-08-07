'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TOOLS, TOOL_NAMES } = require('../mcp/contract');
const { createDispatcher, fileUrl, shapeAsset, shapeJob } = require('../mcp/dispatch');
const { CATEGORIES, McpError, errorResult, normalizeApiError } = require('../mcp/errors');
const { normalizeApiUrl } = require('../mcp/config');

const CONFIG = {
  apiUrl: 'https://studio.freshcontext.ai',
  token: 'machine-token-for-test',
  downloadSigningSecret: 'download-secret-for-test',
  signedUrlTtlSeconds: 300,
  timeoutMs: 30_000,
  allowLocalFiles: false,
  allowedImageHosts: [],
};

test('configuration normalizes API URLs without trailing slashes', () => {
  assert.equal(normalizeApiUrl('https://studio.freshcontext.ai///'), 'https://studio.freshcontext.ai');
});

function fakeApi(overrides = {}) {
  return {
    get: async () => [],
    post: async () => ({}),
    patch: async () => ({}),
    postMultipart: async () => ({}),
    fetchBinary: async () => Buffer.from('zip'),
    ...overrides,
  };
}

test('shared contract exposes the complete stable tool set and bounds', () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), TOOL_NAMES);
  assert.equal(TOOLS.length, 12);
  const generate = TOOLS.find((tool) => tool.name === 'studio_generate_image');
  assert.deepEqual(generate.inputSchema.required, ['tool_id', 'prompt']);
  assert.equal(generate.inputSchema.properties.variants.minimum, 1);
  assert.equal(generate.inputSchema.properties.variants.maximum, 4);
  assert.deepEqual(generate.inputSchema.properties.aspect.enum, ['1:1', '16:9', '9:16', '4:3', '3:4']);
  assert.deepEqual(generate.inputSchema.properties.input_image.properties.type.enum, ['local_file', 'https_url']);
  assert.ok(TOOLS.find((tool) => tool.name === 'studio_get_job'));
  assert.ok(TOOLS.find((tool) => tool.name === 'studio_download_job'));
});

test('generation maps only persisted tool inputs to the API and preserves structured output', async () => {
  let request;
  const dispatcher = createDispatcher({
    config: CONFIG,
    requestId: 'req-123',
    apiClient: fakeApi({
      post: async (requestPath, body, options) => {
        request = { requestPath, body, options };
        return {
          id: 'job-1',
          status: 'complete',
          tool_id: 'tool-1',
          prompt: 'citrus cross-section',
          result_paths: ['generated/job-1_0.png'],
          result: { asset_ids: ['asset-1'] },
        };
      },
    }),
  });

  const result = await dispatcher.call('studio_generate_image', {
    tool_id: 'tool-1',
    prompt: 'citrus cross-section',
    aspect: '1:1',
    variants: 1,
    system_prompt: 'must never be accepted',
    reference_image_paths: ['references/not-client-controlled.png'],
  });

  assert.equal(request.requestPath, '/api/generate');
  assert.equal(request.options.requestId, 'req-123');
  assert.deepEqual(request.body, { tool_id: 'tool-1', prompt: 'citrus cross-section', aspect: '1:1', variants: 1 });
  assert.equal(Object.hasOwn(request.body, 'system_prompt'), false);
  assert.equal(Object.hasOwn(request.body, 'reference_image_paths'), false);
  assert.equal(result.structuredContent.job_id, 'job-1');
  assert.deepEqual(result.structuredContent.asset_ids, ['asset-1']);
  assert.match(result.structuredContent.assets[0].file_url, /^https:\/\/studio\.freshcontext\.ai\/mcp\/download\/asset\//);
});

test('tool listing retains configured reference exemplar metadata', async () => {
  const dispatcher = createDispatcher({
    config: CONFIG,
    apiClient: fakeApi({
      get: async () => [{ id: 'tool-1', name: 'Botanical', kind: 'image', default_aspect_ratio: '16:9', default_variants: 2, reference_image_paths: ['references/exemplar.png'], system_prompt: 'private prompt' }],
    }),
  });
  const result = await dispatcher.call('studio_list_tools', { kind: 'image' });
  assert.deepEqual(result.structuredContent.items[0].reference_image_paths, ['references/exemplar.png']);
  assert.equal(result.structuredContent.items[0].system_prompt, undefined);
});

test('job and archive output shaping includes asset IDs and download metadata', async () => {
  const shaped = shapeJob({ id: 'job-2', status: 'complete', tool_id: 'tool-2', prompt: 'subject', result_paths: ['generated/job-2_0.png'], result: { asset_ids: ['asset-2'] } }, CONFIG);
  assert.deepEqual(shaped.asset_ids, ['asset-2']);
  assert.equal(shaped.assets[0].storage_path, 'generated/job-2_0.png');
  assert.match(shaped.download_url, /^https:\/\/studio\.freshcontext\.ai\/mcp\/download\/job\//);
  assert.equal(shaped.result_paths.some((value) => value.includes('/Users/')), false);
  const shapedAsset = shapeAsset({ id: 'asset-2', storage_path: 'generated/job-2_0.png', provenance: { source_path: '/Users/private/input.png', nested: { temp: '/tmp/private.png' } } }, CONFIG);
  const serializedAsset = JSON.stringify(shapedAsset);
  assert.equal(serializedAsset.includes('/Users/private'), false);
  assert.equal(serializedAsset.includes('/tmp/private'), false);

  const dispatcher = createDispatcher({
    config: CONFIG,
    apiClient: fakeApi({ get: async () => ({ available: true, filename: 'studio-job-2.zip', content_type: 'application/zip', byte_size: 1234 }) }),
  });
  const result = await dispatcher.call('studio_download_job', { id: 'job-2' });
  assert.equal(result.structuredContent.filename, 'studio-job-2.zip');
  assert.equal(result.structuredContent.byte_size, 1234);
  assert.match(result.structuredContent.download_url, /^https:\/\/studio\.freshcontext\.ai\/mcp\/download\/job\//);
});

test('production URL shaping encodes storage segments and never falls back to localhost', () => {
  assert.equal(fileUrl('https://studio.freshcontext.ai/', 'generated/a space/image.png'), 'https://studio.freshcontext.ai/files/generated/a%20space/image.png');
  assert.equal(fileUrl('https://studio.freshcontext.ai', '/Users/private/output.png'), null);
  assert.equal(fileUrl('https://studio.freshcontext.ai', 'generated/../private.png'), null);
  assert.equal(fileUrl('http://localhost:3440', 'generated/image.png'), 'http://localhost:3440/files/generated/image.png');
});

test('API failures normalize to stable categories with bounded safe content', () => {
  assert.equal(normalizeApiError({ status: 401, path: '/api/tools' }).category, 'AUTH_REQUIRED');
  assert.equal(normalizeApiError({ status: 404, path: '/api/jobs/job-1' }).category, 'JOB_NOT_FOUND');
  assert.equal(normalizeApiError({ status: 429, path: '/api/generate', operation: 'generate' }).category, 'RATE_LIMITED');
  assert.equal(normalizeApiError({ status: 500, path: '/api/generate', operation: 'generate' }).category, 'GENERATION_FAILED');
  assert.deepEqual(CATEGORIES.length, 9);
  const result = errorResult(new McpError('UPSTREAM_UNAVAILABLE', 'Authorization: Bearer machine-token-for-test /Users/private/trace'));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('machine-token-for-test'), false);
  assert.equal(serialized.includes('/Users/private'), false);
});
