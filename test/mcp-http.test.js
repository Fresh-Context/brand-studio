'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { mountMcp } = require('../mcp/http');
const { TOOLS, TOOL_NAMES } = require('../mcp/contract');

const ENV = {
  STUDIO_API_URL: 'https://studio.test',
  STUDIO_BEARER_TOKEN: 'hosted-test-token',
  STUDIO_DOWNLOAD_SIGNING_SECRET: 'hosted-download-secret',
};

function initializeBody(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-http-test', version: '1.0.0' },
    },
  };
}

async function readMcpResponse(response) {
  const body = await response.text();
  if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
    const data = body.split('\n').find((line) => line.startsWith('data: '));
    return JSON.parse(data.slice(6));
  }
  return JSON.parse(body);
}

async function startApp(dispatcherFactory = () => ({ call: async () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: { items: [] } }) })) {
  const app = express();
  mountMcp(app, { env: ENV, dispatcherFactory });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, url };
}

test('hosted MCP rejects missing credentials with 401 and no Google redirect', async (t) => {
  const { server, url } = await startApp();
  t.after(() => server.close());
  const response = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initializeBody()),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  const payload = await response.json();
  assert.equal(payload.error.message.startsWith('AUTH_REQUIRED:'), true);
});

test('hosted MCP initialize and tools/list use the shared contract', async (t) => {
  const { server, url } = await startApp();
  t.after(() => server.close());
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${ENV.STUDIO_BEARER_TOKEN}` };
  const initialize = await fetch(`${url}/mcp`, { method: 'POST', headers, body: JSON.stringify(initializeBody()) });
  assert.equal(initialize.status, 200);
  const initPayload = await readMcpResponse(initialize);
  assert.equal(initPayload.result.serverInfo.name, 'fresh-context-studio');

  const list = await fetch(`${url}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
  assert.equal(list.status, 200);
  const listPayload = await readMcpResponse(list);
  assert.deepEqual(listPayload.result.tools.map((tool) => tool.name), TOOL_NAMES);
  assert.deepEqual(listPayload.result.tools, TOOLS);
  assert.match(list.headers.get('x-request-id'), /^[A-Za-z0-9._:-]+$/);
});

test('hosted MCP dispatches tools/call without exposing machine credentials', async (t) => {
  let observed;
  let factoryOptions;
  const { server, url } = await startApp((options) => {
    factoryOptions = options;
    return {
      call: async (name, args) => {
        observed = { name, args };
        return { content: [{ type: 'text', text: 'read-only result' }], structuredContent: { items: [] } };
      },
    };
  });
  t.after(() => server.close());
  const response = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${ENV.STUDIO_BEARER_TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'studio_list_tools', arguments: { kind: 'image' } } }),
  });
  assert.equal(response.status, 200);
  const payload = await readMcpResponse(response);
  assert.equal(payload.result.content[0].text, 'read-only result');
  assert.deepEqual(observed, { name: 'studio_list_tools', args: { kind: 'image' } });
  assert.match(factoryOptions.requestId, /^[A-Za-z0-9._:-]+$/);
  assert.equal(factoryOptions.config.token, ENV.STUDIO_BEARER_TOKEN);
  assert.equal(JSON.stringify(payload).includes(ENV.STUDIO_BEARER_TOKEN), false);
});
