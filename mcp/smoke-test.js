#!/usr/bin/env node
'use strict';

// Smoke test for the Studio MCP server. Spawns it over stdio, lists tools, and
// exercises the read tools against the live API. Proves the machine door returns
// the same catalog the UI does. (Does not call studio_generate_image — that spends.)

const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: [path.join(__dirname, 'server.js')] });
  const client = new Client({ name: 'studio-mcp-smoke', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);

  console.log('== tools/list ==');
  const { tools } = await client.listTools();
  for (const t of tools) console.log(`  - ${t.name}`);

  console.log('\n== studio_list_tools (kind=image) ==');
  const lt = await client.callTool({ name: 'studio_list_tools', arguments: { kind: 'image' } });
  console.log(lt.content[0].text.split('\n').slice(0, 4).join('\n') + '\n  …');

  console.log('\n== studio_search_assets "citrus cross-section" (limit 5) ==');
  const s = await client.callTool({ name: 'studio_search_assets', arguments: { query: 'citrus cross-section', limit: 5 } });
  console.log(s.content[0].text);

  console.log('\n== studio_search_assets "stipple portrait of a person", form=hedcut (limit 3) ==');
  const s2 = await client.callTool({ name: 'studio_search_assets', arguments: { query: 'stipple portrait of a person', form: 'hedcut', limit: 3 } });
  console.log(s2.content[0].text);

  await client.close();
  console.log('\n== done ==');
}
main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
