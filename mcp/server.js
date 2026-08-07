#!/usr/bin/env node
'use strict';

// Fresh Context Studio MCP server.
//
// This file is only the local stdio transport. Tool contracts and API dispatch
// live in contract.js and dispatch.js so the hosted /mcp transport cannot drift.
// The API URL is selected from STUDIO_API_URL or brand-studio/.env; the bearer
// credential is never logged or included in tool content.

const crypto = require('node:crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { loadStudioEnv, readConfig } = require('./config');
const { createDispatcher } = require('./dispatch');
const { errorResult, McpError } = require('./errors');
const { SERVER_INSTRUCTIONS, TOOLS } = require('./contract');

function createMcpServer({ dispatcher }) {
  if (!dispatcher || typeof dispatcher.call !== 'function') throw new Error('MCP dispatcher is required.');
  const server = new Server(
    { name: 'fresh-context-studio', version: '0.2.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const requestId = extra && extra.requestId ? String(extra.requestId) : crypto.randomUUID();
      return await dispatcher.call(request.params.name, request.params.arguments || {}, { requestId });
    } catch (error) {
      return errorResult(error instanceof McpError ? error : new McpError('UPSTREAM_UNAVAILABLE'));
    }
  });
  return server;
}

async function assertApiReachable(config, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable in this Node runtime.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 10_000));
  try {
    const response = await fetchImpl(`${config.apiUrl}/healthz`, { signal: controller.signal });
    if (!response.ok) throw new Error(`healthz returned HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Studio API is unreachable at ${config.apiUrl}. Start Studio or check STUDIO_API_URL.`);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  loadStudioEnv();
  const config = readConfig(process.env, { requireToken: true });
  console.error(`[fresh-context-studio MCP] selected API URL: ${config.apiUrl}`);
  await assertApiReachable(config);
  const dispatcher = createDispatcher({ config, mode: 'stdio' });
  const server = createMcpServer({ dispatcher });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[fresh-context-studio MCP] connected via stdio → API ${config.apiUrl}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[fresh-context-studio MCP] fatal: ${error.message || 'startup failed'}`);
    process.exit(1);
  });
}

module.exports = { assertApiReachable, createMcpServer, main };
