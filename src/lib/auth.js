'use strict';

// Auth for /api/* — two doors + a dev-open fallback:
//   1. Browser door (prod, opt-in): oauth2-proxy authenticates via Google and
//      injects X-Forwarded-Email. Only trusted when STUDIO_TRUST_PROXY_AUTH=true
//      — an operator sets that deliberately once oauth2-proxy is actually
//      deployed and confirmed to be the only path to this container. Coolify's
//      Traefik does NOT strip client-supplied headers on its own: a deployment
//      with the app directly internet-reachable (no proxy in front yet) must
//      never trust this header, or anyone can set
//      "X-Forwarded-Email: anyone@<allowed-domain>" themselves and walk right
//      in — this is exactly the gap that left studio.freshcontext.ai's /api
//      wide open before this fix (STUDIO_TRUST_PROXY_AUTH was never set, so it
//      shouldn't have mattered, but the dev-open fallback below being the
//      *actual* live gap is precisely why that variable defaults to off).
//   2. Machine door: a bearer token (STUDIO_BEARER_TOKEN) — for the MCP server /
//      cloud skills, and for the browser UI in dev (stored in localStorage).
//   3. Dev fallback: if no token is configured, /api is open. Local dev only —
//      every real deployment MUST set STUDIO_BEARER_TOKEN.

function requireBearer(req, res, next) {
  if (process.env.STUDIO_TRUST_PROXY_AUTH === 'true') {
    const allowedDomain = process.env.STUDIO_ALLOWED_EMAIL_DOMAIN || 'freshcontext.ai';
    const fwdEmail = (req.get('x-forwarded-email') || req.get('x-auth-request-email') || '').toLowerCase();
    if (fwdEmail && fwdEmail.endsWith(`@${allowedDomain}`)) return next(); // browser door (prod, behind a confirmed proxy)
  }

  const token = process.env.STUDIO_BEARER_TOKEN;
  if (token) {
    const header = req.get('authorization') || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : (req.get('x-studio-token') || '');
    if (provided && provided === token) return next(); // machine door
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next(); // dev-open (no token configured — local dev only, never prod)
}

module.exports = { requireBearer };
