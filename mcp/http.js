'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpServer } = require('./server');
const { readConfig } = require('./config');
const { createDispatcher } = require('./dispatch');
const { McpError } = require('./errors');
const { verifyDownloadToken, signingSecretFromEnv } = require('../src/lib/signed-links');
const db = require('../src/db');
const { resolveStoragePath, buildJobArchive } = require('../src/lib/downloads');
const { dirs } = require('../src/lib/storage');

function requestIdFor(req) {
  const supplied = String(req.get('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : require('node:crypto').randomUUID();
}

function authFailure(res, requestId) {
  res.set('WWW-Authenticate', 'Bearer');
  res.set('X-Request-ID', requestId);
  return res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'AUTH_REQUIRED: Studio MCP machine authentication is required.' },
    id: null,
  });
}

function hasMachineBearer(req, token) {
  if (!token) return false;
  const header = String(req.get('authorization') || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const provided = match[1].trim();
  const expected = Buffer.from(token);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && require('node:crypto').timingSafeEqual(actual, expected);
}

function safeFilename(value, fallback) {
  const name = path.basename(String(value || fallback)).replace(/[^A-Za-z0-9._-]+/g, '-');
  return name || fallback;
}

async function serveSignedDownload(req, res, config) {
  const requestId = requestIdFor(req);
  res.set('X-Request-ID', requestId);
  const kind = req.params.kind;
  const payload = verifyDownloadToken(req.params.token, {
    secret: config.downloadSigningSecret || signingSecretFromEnv(),
    expectedKind: kind,
  });
  if (!payload) return res.status(404).json({ error: 'Download link expired or invalid.' });
  res.set('Cache-Control', 'private, no-store');
  if (kind === 'asset') {
    const asset = await db.getAsset(payload.id);
    const absolutePath = asset && resolveStoragePath(asset.storage_path);
    if (!asset || !absolutePath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return res.status(404).json({ error: 'Output unavailable.' });
    const extension = path.extname(absolutePath).toLowerCase();
    const mime = asset.mime || ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extension] || 'application/octet-stream');
    res.set('Content-Type', mime);
    res.set('Content-Length', String(fs.statSync(absolutePath).size));
    res.set('Content-Disposition', `inline; filename="${safeFilename(path.basename(absolutePath), 'studio-output')}"`);
    return res.sendFile(absolutePath);
  }
  if (kind === 'job') {
    const archive = await buildJobArchive(payload.id);
    if (!archive || !archive.available) return res.status(404).json({ error: 'Output unavailable.' });
    res.set('Content-Type', archive.content_type);
    res.set('Content-Length', String(archive.buffer.length));
    res.set('Content-Disposition', `attachment; filename="${safeFilename(archive.filename, 'studio-job.zip')}"`);
    return res.send(archive.buffer);
  }
  return res.status(404).json({ error: 'Output unavailable.' });
}

function mountMcp(app, { env = process.env, dispatcherFactory = createDispatcher } = {}) {
  const config = readConfig(env, { requireToken: false });

  // Signed links are intentionally below /mcp but do not use bearer auth: the
  // HMAC token is the authorization boundary and contains no bearer credential.
  app.get('/mcp/download/:kind/:token', async (req, res) => {
    try {
      await serveSignedDownload(req, res, config);
    } catch {
      if (!res.headersSent) res.status(404).json({ error: 'Output unavailable.' });
    }
  });

  app.post('/mcp', (req, res, next) => {
    const requestId = requestIdFor(req);
    if (!hasMachineBearer(req, config.token)) return authFailure(res, requestId);
    req.studioRequestId = requestId;
    req.setTimeout(config.timeoutMs);
    res.setTimeout(config.timeoutMs);
    return express.json({ limit: '12mb' })(req, res, next);
  }, async (req, res) => {
    const requestId = req.studioRequestId || requestIdFor(req);
    res.set('X-Request-ID', requestId);
    const started = Date.now();
    const dispatcher = dispatcherFactory({ config, mode: 'hosted', requestId });
    const server = createMcpServer({ dispatcher });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    transport.onerror = () => console.error(`[studio-mcp] request=${requestId} transport_error`);
    res.once('finish', () => {
      console.log(`[studio-mcp] request=${requestId} method=${req.method} path=/mcp status=${res.statusCode} duration_ms=${Date.now() - started}`);
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[studio-mcp] request=${requestId} handler_error`);
      if (!res.headersSent) {
        const message = error instanceof McpError ? error.message : 'UPSTREAM_UNAVAILABLE: Studio MCP request failed.';
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message }, id: null });
      }
    }
  });

  return { config };
}

module.exports = { authFailure, hasMachineBearer, mountMcp, requestIdFor, serveSignedDownload };
