'use strict';

const CATEGORIES = Object.freeze([
  'AUTH_REQUIRED',
  'API_UNREACHABLE',
  'INVALID_TOOL',
  'INVALID_INPUT',
  'GENERATION_FAILED',
  'JOB_NOT_FOUND',
  'OUTPUT_UNAVAILABLE',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
]);

const CATEGORY_MESSAGES = Object.freeze({
  AUTH_REQUIRED: 'Studio machine authentication is required.',
  API_UNREACHABLE: 'The Studio API could not be reached.',
  INVALID_TOOL: 'The selected Studio tool is invalid or unavailable.',
  INVALID_INPUT: 'The Studio request input is invalid.',
  GENERATION_FAILED: 'Studio image generation failed.',
  JOB_NOT_FOUND: 'The Studio job was not found.',
  OUTPUT_UNAVAILABLE: 'The requested Studio output is not available.',
  RATE_LIMITED: 'The Studio request was rate limited.',
  UPSTREAM_UNAVAILABLE: 'The Studio upstream service is unavailable.',
});

class McpError extends Error {
  constructor(category, message = null, { status = null, details = null, cause = null } = {}) {
    const safeCategory = CATEGORIES.includes(category) ? category : 'UPSTREAM_UNAVAILABLE';
    super(`${safeCategory}: ${message || CATEGORY_MESSAGES[safeCategory]}`);
    this.name = 'McpError';
    this.category = safeCategory;
    this.status = status;
    this.details = details && typeof details === 'object' ? details : null;
    this.cause = cause || null;
  }
}

function redactSensitiveText(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .replace(/(?:token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/(?:\/Users\/|\/home\/|\/app\/|\/tmp\/|\/var\/)[^\s"']+/g, '[path]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function safeUpstreamDetail(body) {
  if (!body) return null;
  if (typeof body === 'string') return redactSensitiveText(body);
  if (typeof body === 'object') {
    const candidate = body.error || body.message || body.detail || body.code;
    return candidate ? redactSensitiveText(candidate) : null;
  }
  return null;
}

function categoryForResponse({ status, path = '', operation = '' } = {}) {
  if (status === 401 || status === 403) return 'AUTH_REQUIRED';
  if (status === 404) {
    if (path.includes('/jobs/')) return 'JOB_NOT_FOUND';
    if (path.includes('/tools')) return 'INVALID_TOOL';
    if (path.includes('/download')) return 'OUTPUT_UNAVAILABLE';
    return operation === 'generate' ? 'INVALID_TOOL' : 'OUTPUT_UNAVAILABLE';
  }
  if (status === 408 || status === 504) return 'UPSTREAM_UNAVAILABLE';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return operation === 'generate' ? 'GENERATION_FAILED' : 'UPSTREAM_UNAVAILABLE';
  if (status >= 400) return operation === 'generate' ? 'INVALID_INPUT' : 'INVALID_INPUT';
  return 'UPSTREAM_UNAVAILABLE';
}

function normalizeApiError({ status = null, path = '', operation = '', body = null, cause = null } = {}) {
  const category = categoryForResponse({ status, path, operation });
  const detail = safeUpstreamDetail(body);
  const message = detail ? `${CATEGORY_MESSAGES[category]} (${detail})` : CATEGORY_MESSAGES[category];
  const details = body && typeof body === 'object' && body.job_id ? { job_id: body.job_id } : null;
  return new McpError(category, message, { status, details, cause });
}

function errorResult(error) {
  const normalized = error instanceof McpError
    ? error
    : new McpError('UPSTREAM_UNAVAILABLE', CATEGORY_MESSAGES.UPSTREAM_UNAVAILABLE, { cause: error });
  const message = redactSensitiveText(normalized.message);
  const result = {
    content: [{ type: 'text', text: message }],
    structuredContent: {
      error: {
        category: normalized.category,
        message,
        ...(normalized.details || {}),
      },
    },
    isError: true,
  };
  return result;
}

module.exports = {
  CATEGORY_MESSAGES,
  CATEGORIES,
  McpError,
  categoryForResponse,
  errorResult,
  normalizeApiError,
  redactSensitiveText,
  safeUpstreamDetail,
};
