'use strict';

// Where asset files live. Three roots:
//   generated  — Studio outputs (writable)
//   references — shot-type reference exemplars (writable)
//   library    — the brand-marketing library (read-only)
// Local dev falls back to a gitignored data/ dir inside this checkout; prod
// overrides via env (persistent volume for generated/references, repo mount
// for library).

const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..'); // repo root

function resolveDir(value, fallback) {
  const p = value || fallback;
  return path.isAbsolute(p) ? p : path.resolve(APP_ROOT, p);
}

function dirs() {
  return {
    generated: resolveDir(process.env.STUDIO_GENERATED_DIR, 'data/generated'),
    references: resolveDir(process.env.STUDIO_REFERENCES_DIR, 'data/references'),
    library: resolveDir(process.env.STUDIO_LIBRARY_DIR, 'data/library'),
  };
}

module.exports = { dirs, APP_ROOT };
