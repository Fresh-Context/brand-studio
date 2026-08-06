'use strict';

// Turns the self-contained "Who We Are" artifact (brand-marketing/brand-guideline/
// whoweare.html) into an embeddable, spike-stripped fragment for the Studio app —
// so the identity page is NATIVELY integrated (one document, no iframe) rather than
// framed. Two outputs in public/:
//   identity-embed.html  — <style> (scoped under .identity-view) + the body markup
//   identity-embed.js     — the scroll/reveal script (run after injection)
//
// whoweare's CSS has aggressive globals (*, html, body, a, h1-4); we scope every
// rule under .identity-view (mapping html/body/:root → the wrapper) so it can't
// restyle the app chrome. @font-face / @keyframes stay global. The scroll JS runs
// on window scroll and finds its elements via document.querySelector — which still
// works because the content lives in the main document (the app rail is fixed and
// the window scrolls).
//
//   cd apps/studio && node scripts/build-identity-embed.js

const fs = require('fs');
const path = require('path');
const { dirs } = require('../src/lib/storage');

const OUT_HTML = path.resolve(__dirname, '../public/identity-embed.html');
const OUT_JS = path.resolve(__dirname, '../public/identity-embed.js');

function resolveIdentitySource(libraryDir = dirs().library, {
  outputHtml = OUT_HTML,
  outputJs = OUT_JS,
} = {}) {
  const librarySource = path.join(libraryDir, 'brand-guideline', 'whoweare.html');
  if (fs.existsSync(librarySource)) {
    return { kind: 'library', path: librarySource };
  }

  // The checked-in public assets keep Identity available on a fresh deployment
  // before the optional library volume has been seeded.
  if (fs.existsSync(outputHtml) && fs.existsSync(outputJs)) {
    return { kind: 'bundled', path: null };
  }

  throw new Error(
    `identity source missing: expected ${librarySource} or bundled identity-embed assets`,
  );
}

function buildIdentityEmbed({
  libraryDir = dirs().library,
  outputHtml = OUT_HTML,
  outputJs = OUT_JS,
} = {}) {
  const source = resolveIdentitySource(libraryDir, { outputHtml, outputJs });
  if (source.kind === 'bundled') {
    console.warn('[identity] library source unavailable; using bundled identity embed');
    return source;
  }

  // Source lives in the library root (STUDIO_LIBRARY_DIR in prod — the mounted
  // volume; the repo's brand-marketing/ in dev via the storage fallback).
  const raw = fs.readFileSync(source.path, 'utf8');

  const styleM = raw.match(/<style>([\s\S]*?)<\/style>/i);
  const scriptM = raw.match(/<script>([\s\S]*?)<\/script>/i);
  if (!styleM) throw new Error('no <style> found');
  let css = styleM[1];
  const js = scriptM ? scriptM[1] : '';

  // Body markup = between </style> and <script> (or end).
  let body = raw.slice(styleM.index + styleM[0].length);
  body = body.replace(/<script>[\s\S]*?<\/script>/i, '');

  // Strip the spike chrome: the top mast + the "Status" colophon cell.
  body = body.replace(/<header class="mast">[\s\S]*?<\/header>/i, '');
  body = body.replace(/<div><div class="lab">Status<\/div>[\s\S]*?<\/p><\/div>/i, '');

  // ── CSS scoping ────────────────────────────────────────────────────────────
  const WRAP = '.identity-view';

  function scopeSelector(sel) {
    return sel.split(',').map((s) => {
      s = s.trim();
      if (!s) return s;
      if (s === '*') return `${WRAP} *`;
      if (s === 'html' || s === 'body' || s === ':root') return WRAP;
      if (/^(html|body)\b/.test(s)) return s.replace(/^(html|body)/, WRAP);
      return `${WRAP} ${s}`;
    }).join(', ');
  }

  // Split top-level rules by balanced braces.
  function splitRules(str) {
    const rules = [];
    let depth = 0, start = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '{') { if (depth === 0) { /* selector so far */ } depth++; }
      else if (c === '}') { depth--; if (depth === 0) { rules.push(str.slice(start, i + 1)); start = i + 1; } }
    }
    const tail = str.slice(start).trim();
    if (tail) rules.push(tail);
    return rules;
  }

  function scopeBlock(cssStr) {
    return splitRules(cssStr).map((rule) => {
      const braceAt = rule.indexOf('{');
      if (braceAt < 0) return rule; // stray (comment)
      const prelude = rule.slice(0, braceAt).trim();
      const inner = rule.slice(braceAt + 1, rule.lastIndexOf('}'));
      if (/^@(font-face|keyframes|-webkit-keyframes|page)/i.test(prelude)) return rule; // keep global
      if (/^@(media|supports)/i.test(prelude)) return `${prelude}{${scopeBlock(inner)}}`; // recurse
      if (/^@/.test(prelude)) return rule; // other at-rules: leave
      return `${scopeSelector(prelude)}{${inner}}`;
    }).join('\n');
  }

  const scopedCss = scopeBlock(css);

  fs.writeFileSync(outputHtml, `<style>\n${scopedCss}\n</style>\n<div class="identity-view">\n${body.trim()}\n</div>\n`);
  fs.writeFileSync(outputJs, js.trim() + '\n');

  console.log(`identity-embed.html  ${(fs.statSync(outputHtml).size / 1024 / 1024).toFixed(2)}MB`);
  console.log(`identity-embed.js    ${fs.statSync(outputJs).size} bytes`);
  console.log(`mast stripped: ${!/<header class="mast">/.test(body)}  ·  status stripped: ${!/class="lab">Status/.test(body)}`);
  return source;
}

if (require.main === module) {
  buildIdentityEmbed();
}

module.exports = { buildIdentityEmbed, resolveIdentitySource };
