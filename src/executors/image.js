'use strict';

// Image executor — OpenAI gpt-image-2. Ported from local-server/studio/executors/
// local.js. /v1/images/edits when the tool has reference exemplars, else
// /v1/images/generations. Writes PNGs to the generated dir; returns relative paths.

const fs = require('fs');
const path = require('path');
const { dirs } = require('../lib/storage');

const MODEL = 'gpt-image-2';
const OPENAI_BASE = 'https://api.openai.com/v1';

function aspectToSize(aspect) {
  switch (aspect) {
    case '1:1': return '1024x1024';
    case '16:9': return '1792x1024';
    case '9:16': return '1024x1792';
    case '4:3': return '1536x1024';
    case '3:4': return '1024x1536';
    default: return '1024x1024';
  }
}

async function openaiFetch(endpoint, { body, headers = {} } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const res = await fetch(`${OPENAI_BASE}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, ...headers },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${endpoint} ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

const composePrompt = (system, user) => (system ? `${system}\n\n${user}` : user);

function saveBase64Images(images, jobId, generatedDir) {
  fs.mkdirSync(generatedDir, { recursive: true });
  const saved = [];
  for (let i = 0; i < images.length; i++) {
    const b64 = images[i].b64_json;
    if (!b64) continue;
    const filename = `${jobId}_${i}.png`;
    fs.writeFileSync(path.join(generatedDir, filename), Buffer.from(b64, 'base64'));
    saved.push(`generated/${filename}`);
  }
  return saved;
}

async function generate({ tool, prompt, aspect, variants, jobId, userImagePath }) {
  const { generated: generatedDir, references: referencesDir } = dirs();
  const fullPrompt = composePrompt(tool.system_prompt, prompt);
  const size = aspectToSize(aspect || tool.default_aspect_ratio);
  const n = Math.max(1, Math.min(10, (variants || tool.default_variants) | 0));

  const refRelPaths = [...(tool.reference_image_paths || [])];
  if (userImagePath) refRelPaths.push(userImagePath);

  if (refRelPaths.length === 0) {
    const resp = await openaiFetch('/images/generations', {
      headers: { 'Content-Type': 'application/json' },
      // gpt-image-* rejects `response_format` (b64_json is the only output);
      // the param was removed from /images/generations for these models.
      body: JSON.stringify({ model: MODEL, prompt: fullPrompt, size, n }),
    });
    return { result_paths: saveBase64Images(resp.data || [], jobId, generatedDir) };
  }

  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', fullPrompt);
  form.append('size', size);
  form.append('n', String(n));
  for (const rel of refRelPaths) {
    const abs = path.isAbsolute(rel) ? rel : path.join(referencesDir, path.basename(rel));
    if (!fs.existsSync(abs)) throw new Error(`Reference image missing on disk: ${rel}`);
    form.append('image[]', new Blob([fs.readFileSync(abs)], { type: 'image/png' }), path.basename(abs));
  }
  const resp = await openaiFetch('/images/edits', { body: form });
  return { result_paths: saveBase64Images(resp.data || [], jobId, generatedDir) };
}

module.exports = { generate, aspectToSize, MODEL };
