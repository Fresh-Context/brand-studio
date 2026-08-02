'use strict';

// Auth for /api/* — two doors + a dev-open fallback:
//   1. Browser door (prod): oauth2-proxy authenticates via Google and injects
//      X-Forwarded-Email. The app is only reachable through the proxy in prod, so
//      an email in the allowed domain is trusted.
//   2. Machine door: a bearer token (STUDIO_BEARER_TOKEN) — for the MCP server /
//      cloud skills, and for the browser UI in dev (stored in localStorage).
//   3. Dev fallback: if no token is configured, /api is open (local only).

function requireBearer(req, res, next) {
  const allowedDomain = process.env.STUDIO_ALLOWED_EMAIL_DOMAIN || 'freshcontext.ai';
  const fwdEmail = (req.get('x-forwarded-email') || req.get('x-auth-request-email') || '').toLowerCase();
  if (fwdEmail && fwdEmail.endsWith(`@${allowedDomain}`)) return next(); // browser door (prod)

  const token = process.env.STUDIO_BEARER_TOKEN;
  if (token) {
    const header = req.get('authorization') || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : (req.get('x-studio-token') || '');
    if (provided && provided === token) return next(); // machine door
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next(); // dev-open (no token configured)
}

module.exports = { requireBearer };
