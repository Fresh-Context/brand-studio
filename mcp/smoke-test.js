#!/usr/bin/env node
'use strict';

// Read-only MCP smoke. It proves initialize, tools/list, tool resolution,
// asset search, brand context, and asset retrieval without spending generation
// credit. The child server loads brand-studio/.env and fails clearly if the API
// or machine credential is unavailable.

const path = require('node:path');
const { loadStudioEnv } = require('./config');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

loadStudioEnv();

const CHILD_ENV_KEYS = [
  'STUDIO_API_URL',
  'STUDIO_BEARER_TOKEN',
  'STUDIO_DOWNLOAD_SIGNING_SECRET',
  'STUDIO_MCP_REQUEST_TIMEOUT_MS',
  'STUDIO_MCP_SIGNED_URL_TTL_SECONDS',
  'STUDIO_MCP_ALLOWED_IMAGE_HOSTS',
  'STUDIO_MCP_ALLOW_LOCAL_FILES',
];

async function main() {
  const childEnv = Object.fromEntries(
    CHILD_ENV_KEYS
      .filter((key) => process.env[key] != null)
      .map((key) => [key, process.env[key]]),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, 'server.js')],
    env: childEnv,
  });
  const client = new Client({ name: 'studio-mcp-smoke', version: '0.2.0' }, { capabilities: {} });
  await client.connect(transport);

  console.log('== tools/list ==');
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const name of names) console.log(`  - ${name}`);
  for (const required of ['studio_get_job', 'studio_download_job']) {
    if (!names.includes(required)) throw new Error(`Missing required tool: ${required}`);
  }

  console.log('\n== studio_list_tools (kind=image) ==');
  const listed = await client.callTool({ name: 'studio_list_tools', arguments: { kind: 'image' } });
  console.log((listed.content || [{ text: '' }])[0].text.split('\n').slice(0, 4).join('\n') + '\n  …');

  console.log('\n== studio_search_assets "citrus cross-section" (limit 5) ==');
  const searched = await client.callTool({ name: 'studio_search_assets', arguments: { query: 'citrus cross-section', limit: 5 } });
  console.log((searched.content || [{ text: '' }])[0].text);

  console.log('\n== studio_brand_context ==');
  const context = await client.callTool({ name: 'studio_brand_context', arguments: {} });
  console.log((context.content || [{ text: '' }])[0].text.split('\n').slice(0, 5).join('\n'));

  const assets = searched.structuredContent && (searched.structuredContent.assets || searched.structuredContent.items);
  if (!Array.isArray(assets) || !assets[0] || !assets[0].asset_id) {
    throw new Error('studio_search_assets returned no catalog result for studio_get_asset verification.');
  }
  console.log(`\n== studio_get_asset ${assets[0].asset_id} ==`);
  const asset = await client.callTool({ name: 'studio_get_asset', arguments: { id: assets[0].asset_id } });
  console.log((asset.content || [{ text: '' }])[0].text);

  await client.close();
  console.log('\n== no-spend smoke passed ==');
}

main().catch((error) => {
  console.error(`FAILED: ${error.message || error}`);
  process.exit(1);
});
