#!/usr/bin/env node
'use strict';

// Hosted read-only smoke. Set STUDIO_API_URL and STUDIO_BEARER_TOKEN for the
// deployed target (or leave the URL unset for localhost). No generation call.

const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { loadStudioEnv, readConfig } = require('./config');

async function main() {
  loadStudioEnv();
  const config = readConfig(process.env, { requireToken: true });
  const endpoint = `${config.apiUrl}/mcp`;
  const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'studio-hosted-smoke', version: '0.2.0' } } });

  const unauthenticated = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: initialize });
  assert.equal(unauthenticated.status, 401, 'missing credentials must return 401');
  assert.equal(unauthenticated.headers.get('location'), null, 'machine auth must not redirect to Google');
  const invalid = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid-studio-token' }, body: initialize });
  assert.equal(invalid.status, 401, 'invalid credentials must return 401');
  assert.equal(invalid.headers.get('location'), null, 'invalid machine auth must not redirect to Google');

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  });
  const client = new Client({ name: 'studio-hosted-smoke', version: '0.2.0' }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes('studio_get_job'));
  assert.ok(names.includes('studio_download_job'));
  const listed = await client.callTool({ name: 'studio_list_tools', arguments: { kind: 'image' } });
  const searched = await client.callTool({ name: 'studio_search_assets', arguments: { query: 'citrus cross-section', limit: 3 } });
  const context = await client.callTool({ name: 'studio_brand_context', arguments: {} });
  assert.equal(listed.isError, undefined);
  assert.equal(searched.isError, undefined);
  assert.equal(context.isError, undefined);

  const assets = searched.structuredContent && (searched.structuredContent.assets || searched.structuredContent.items);
  if (Array.isArray(assets) && assets[0] && assets[0].asset_id) {
    const asset = await client.callTool({ name: 'studio_get_asset', arguments: { id: assets[0].asset_id } });
    assert.equal(asset.isError, undefined);
  }
  const payloadText = JSON.stringify({ listed, searched, context });
  assert.equal(payloadText.includes(config.token), false, 'credentials must not appear in tool content');
  assert.equal(/\/Users\/|\/home\/|\/app\//.test(payloadText), false, 'internal filesystem paths must not appear');

  await client.close();
  console.log(`Hosted MCP read-only smoke passed: ${endpoint}`);
}

main().catch((error) => {
  console.error(`FAILED: ${error.message || error}`);
  process.exit(1);
});
