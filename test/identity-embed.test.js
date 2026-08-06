'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-identity-embed.js');
const BUNDLED_HTML = path.join(ROOT, 'public', 'identity-embed.html');
const BUNDLED_JS = path.join(ROOT, 'public', 'identity-embed.js');

test('build succeeds with the library mount absent when bundled assets exist', () => {
  const missingLibrary = path.join(os.tmpdir(), `brand-studio-library-${process.pid}`);
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, STUDIO_LIBRARY_DIR: missingLibrary },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /using bundled identity embed/);
  assert.match(fs.readFileSync(BUNDLED_HTML, 'utf8'), /class="identity-view"/);
  assert.ok(fs.statSync(BUNDLED_JS).size > 0);
});
