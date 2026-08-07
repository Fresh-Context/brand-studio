// Foreground helper for the standalone brand-studio image executor.
// Runs in a foreground shell (has network egress, unlike Bash-launched daemons).
// Replicates: prepend tool.system_prompt, POST /v1/images/edits with the tool's
// reference exemplars, save b64 PNGs to the generated dir.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REF_DIR = path.resolve(APP, 'data/references');
const GEN_DIR = path.resolve(APP, 'data/generated');
const TOOL_ID = '3012f59d-e753-4551-ad38-0b94ea659006';
const MODEL = 'gpt-image-2';
const SIZE = '1024x1024';
const N = 2;

const KEY = process.env.OPENAI_API_KEY;
const BEARER = process.env.STUDIO_BEARER_TOKEN;
if (!KEY) throw new Error('OPENAI_API_KEY missing from env');

// Pull the tool's brand register + reference list from the local API (localhost works).
const toolsResp = await fetch('http://localhost:3440/api/tools', {
  headers: { Authorization: `Bearer ${BEARER}` },
});
const toolsJson = await toolsResp.json();
const tools = Array.isArray(toolsJson) ? toolsJson : (toolsJson.tools || toolsJson);
const tool = tools.find((t) => t.id === TOOL_ID);
if (!tool) throw new Error('tool not found');
const SYSTEM = tool.system_prompt;
// Lean, curated ref set (4) so each /images/edits call finishes fast inside the
// foreground egress window. Chosen to anchor both organic-plate finish and the
// construction-geometry overlay.
const CURATED = ['gf-coral.png', 'gf-rings.png', 'gf-transformation.png', 'gf-spiral.png'];
console.log(`tool: ${tool.name} · using ${CURATED.length} curated refs · system_prompt ${SYSTEM.length} chars`);

const refBufs = CURATED.map((name) => {
  const abs = path.join(REF_DIR, name);
  if (!fs.existsSync(abs)) throw new Error(`missing ref ${abs}`);
  return { name, buf: fs.readFileSync(abs) };
});

// Which subjects to run this invocation: argv keys (comma/space separated), else all.
const want = (process.argv[2] || '').split(/[,\s]+/).filter(Boolean);

const subjects = [
  { key: 'leaf', prompt: `A single citrus leaf, detailed naturalistic botanical illustration in the manner of a Merian plate — glossy olive-green blade, fine venation, dimensional ink shading, a warm sepia stem — centered on a cream ground and circumscribed by a fine geometric construction that transcribes its form: a bounding ellipse, an inscribed golden rectangle with phi-proportion subdivisions, the midrib as the central axis, small dotted node points at the key intersections, one burnt-orange accent node. No text, no labels, no split, no grid of tiles.` },
  { key: 'blossom', prompt: `A single orange blossom seen face-on, detailed naturalistic botanical illustration — five cream-white petals, a burst of golden-orange stamens, fine dimensional shading like a Merian plate — centered on a cream ground and circumscribed by a fine geometric construction of its five-fold symmetry: a bounding circle with an inscribed regular pentagon and pentagram, radial axes to each petal, small dotted node points at the vertices, one burnt-orange accent. No text, no labels, no split, no grid of tiles.` },
  { key: 'staranise', prompt: `A single star anise pod, detailed naturalistic botanical illustration — eight woody carpels radiating from the center, a glossy seed in each, warm russet and sepia tones, fine dimensional ink shading like a Haeckel plate — centered on a cream ground and circumscribed by a fine geometric construction of its eight-fold symmetry: a bounding circle with an inscribed octagon and eight-point star, radial axes along each carpel, small dotted node points at the tips, one burnt-orange accent. No text, no labels, no split, no grid of tiles.` },
  { key: 'nautilus', prompt: `A single nautilus shell in cross-section, detailed naturalistic scientific illustration — the chambered logarithmic spiral in warm pearl, caramel and sepia, fine dimensional shading like a D'Arcy Thompson On Growth and Form plate — centered on a cream ground and circumscribed by a fine geometric construction that transcribes its growth: a golden rectangle subdivided into nested squares, the logarithmic spiral traced through them, radial growth rays, small dotted node points at the subdivisions, one burnt-orange accent arc. No text, no labels, no split, no grid of tiles.` },
  { key: 'pinecone', prompt: `A single upright pinecone, detailed naturalistic botanical illustration — woody scales in a phyllotactic spiral, warm russet and sepia, fine dimensional ink shading like a Merian plate — centered on a cream ground and circumscribed by a fine geometric construction of its growth pattern: a bounding circle, the Fibonacci parastichy double-spiral overlaid to trace the scale rows, a light radial angular grid marking the golden angle, small dotted node points on the scales, one burnt-orange accent. No text, no labels, no split, no grid of tiles.` },
];

fs.mkdirSync(GEN_DIR, { recursive: true });

async function genOne(subject) {
  const jobId = crypto.randomUUID();
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', `${SYSTEM}\n\n${subject.prompt}`);
  form.append('size', SIZE);
  form.append('n', String(N));
  for (const r of refBufs) {
    form.append('image[]', new Blob([r.buf], { type: 'image/png' }), r.name);
  }
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const saved = [];
  (data.data || []).forEach((img, i) => {
    if (!img.b64_json) return;
    const fn = `${jobId}_${i}.png`;
    fs.writeFileSync(path.join(GEN_DIR, fn), Buffer.from(img.b64_json, 'base64'));
    saved.push(`generated/${fn}`);
  });
  return { key: subject.key, jobId, saved };
}

const run = want.length ? subjects.filter((s) => want.includes(s.key)) : subjects;
// Sequential (not parallel) so a single invocation stays well inside the egress window.
const results = [];
for (const s of run) {
  try { results.push({ status: 'fulfilled', value: await genOne(s) }); }
  catch (e) { results.push({ status: 'rejected', reason: e }); }
}
const subjectsRun = run;
console.log('\n=== RESULTS ===');
for (let i = 0; i < results.length; i++) {
  const s = subjectsRun[i];
  const r = results[i];
  if (r.status === 'fulfilled') {
    console.log(`${s.key}: ${r.value.saved.join('  ')}`);
  } else {
    console.log(`${s.key}: FAILED ${r.reason?.message || r.reason}`);
  }
}
