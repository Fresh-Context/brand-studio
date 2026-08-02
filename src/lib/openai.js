'use strict';

// OpenAI helpers for the indexer: embeddings + a describe() that returns
// {caption, form, tags} either from an image (vision) or from text (a generation
// prompt). Right models for the jobs: gpt-4o-mini for bulk vision captioning,
// text-embedding-3-small for embeddings (1536-dim, matches the vault RAG).

const OPENAI_BASE = 'https://api.openai.com/v1';
const CAPTION_MODEL = process.env.STUDIO_CAPTION_MODEL || 'gpt-4o-mini';
const EMBED_MODEL = process.env.STUDIO_EMBED_MODEL || 'text-embedding-3-small';

async function openai(endpoint, body) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const res = await fetch(`${OPENAI_BASE}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI ${endpoint} ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

async function embed(text) {
  const r = await openai('/embeddings', { model: EMBED_MODEL, input: text });
  return r.data[0].embedding;
}

function buildSystemPrompt(forms, tags) {
  const formList = forms.map((f) => `- ${f.value}: ${f.description}`).join('\n');
  const tagList = tags.map((t) => `- ${t.value}: ${t.description}`).join('\n');
  return [
    'You are cataloging a Fresh Context brand asset. The brand is a scientific-illustration register:',
    'D\'Arcy Thompson / Maria Sibylla Merian organic forms, brown ink on cream with sparing burnt-orange,',
    'analytical overlays (arrows=deployment, loupe rings=salience, calipers=measurement).',
    '',
    'Return STRICT JSON: {"caption": string, "form": string, "tags": string[]}.',
    '- caption: one factual sentence describing what the asset depicts (for search). No marketing.',
    '- form: EXACTLY ONE value from this list:',
    formList,
    '- tags: 2 to 6 values, preferring this list; you may add at most 2 new short kebab-case tags if clearly warranted:',
    tagList,
  ].join('\n');
}

// description via image (vision) or text (a generation prompt). Provide exactly one.
async function describe({ imageDataUri, text, forms, tags }) {
  const system = buildSystemPrompt(forms, tags);
  const userContent = imageDataUri
    ? [{ type: 'text', text: 'Catalog this asset.' }, { type: 'image_url', image_url: { url: imageDataUri, detail: 'low' } }]
    : `Catalog this asset from its generation prompt:\n\n${text}`;

  const r = await openai('/chat/completions', {
    model: CAPTION_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 300,
  });

  let parsed;
  try { parsed = JSON.parse(r.choices[0].message.content); }
  catch { parsed = {}; }

  const formValues = new Set(forms.map((f) => f.value));
  const form = formValues.has(parsed.form) ? parsed.form : 'other';
  const tagArr = Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string').slice(0, 8) : [];
  const caption = typeof parsed.caption === 'string' ? parsed.caption.trim() : '';
  return { caption, form, tags: tagArr };
}

module.exports = { embed, describe, CAPTION_MODEL, EMBED_MODEL };
