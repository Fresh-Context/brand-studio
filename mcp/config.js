'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const { McpError } = require('./errors');

const DEFAULT_API_URL = 'http://localhost:3440';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

function loadStudioEnv({ envPath = path.resolve(__dirname, '..', '.env') } = {}) {
  dotenv.config({ path: envPath });
  return process.env;
}

function normalizeApiUrl(value) {
  const raw = String(value || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new McpError('INVALID_INPUT', 'STUDIO_API_URL must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new McpError('INVALID_INPUT', 'STUDIO_API_URL must use http or https.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function parseHostAllowlist(value) {
  return String(value || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function readConfig(env = process.env, { requireToken = false, allowAnonymous = false } = {}) {
  const apiUrl = normalizeApiUrl(env.STUDIO_API_URL || DEFAULT_API_URL);
  const token = String(env.STUDIO_BEARER_TOKEN || '').trim();
  if (requireToken && !token && !(allowAnonymous || env.STUDIO_MCP_ALLOW_ANONYMOUS === 'true')) {
    throw new McpError('AUTH_REQUIRED', 'STUDIO_BEARER_TOKEN is required for the Studio MCP machine door.');
  }
  return Object.freeze({
    apiUrl,
    token,
    downloadSigningSecret: String(env.STUDIO_DOWNLOAD_SIGNING_SECRET || token || '').trim(),
    timeoutMs: parsePositiveInt(env.STUDIO_MCP_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, { min: 30_000, max: 600_000 }),
    signedUrlTtlSeconds: parsePositiveInt(env.STUDIO_MCP_SIGNED_URL_TTL_SECONDS, DEFAULT_SIGNED_URL_TTL_SECONDS, { min: 60, max: 86_400 }),
    allowedImageHosts: parseHostAllowlist(env.STUDIO_MCP_ALLOWED_IMAGE_HOSTS),
    allowLocalFiles: env.STUDIO_MCP_ALLOW_LOCAL_FILES !== 'false',
  });
}

module.exports = {
  DEFAULT_API_URL,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  DEFAULT_TIMEOUT_MS,
  loadStudioEnv,
  normalizeApiUrl,
  readConfig,
};
