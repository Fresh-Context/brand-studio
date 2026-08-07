'use strict';

const crypto = require('node:crypto');

const TOKEN_VERSION = 1;

function base64url(value) {
  return Buffer.from(value).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (String(value).length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function signPayload(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function createDownloadToken({ kind, id, secret, ttlSeconds = 300, now = Date.now() } = {}) {
  if (!secret) throw new Error('Download signing secret is not configured.');
  if (!['asset', 'job'].includes(kind) || !id) throw new Error('Download token kind and id are required.');
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const payload = base64url(JSON.stringify({ v: TOKEN_VERSION, kind, id: String(id), exp: expiresAt }));
  return { token: `${payload}.${signPayload(payload, secret)}`, expiresAt };
}

function verifyDownloadToken(token, { secret, now = Date.now(), expectedKind = null } = {}) {
  if (!secret || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadPart = token.slice(0, dot);
  const signaturePart = token.slice(dot + 1);
  const expected = signPayload(payloadPart, secret);
  const received = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) return null;
  let payload;
  try { payload = JSON.parse(fromBase64url(payloadPart).toString('utf8')); } catch { return null; }
  if (payload.v !== TOKEN_VERSION || !payload.kind || !payload.id || !Number.isInteger(payload.exp)) return null;
  if (expectedKind && payload.kind !== expectedKind) return null;
  if (payload.exp <= Math.floor(now / 1000)) return null;
  return payload;
}

function createDownloadUrl({ baseUrl, kind, id, secret, ttlSeconds = 300, now = Date.now() } = {}) {
  const { token, expiresAt } = createDownloadToken({ kind, id, secret, ttlSeconds, now });
  return {
    url: `${String(baseUrl).replace(/\/+$/, '')}/mcp/download/${kind}/${token}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

function signingSecretFromEnv(env = process.env) {
  return String(env.STUDIO_DOWNLOAD_SIGNING_SECRET || env.STUDIO_BEARER_TOKEN || '').trim();
}

module.exports = {
  createDownloadToken,
  createDownloadUrl,
  signingSecretFromEnv,
  verifyDownloadToken,
};
