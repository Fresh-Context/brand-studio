'use strict';

// Seed studio_taxonomy from src/taxonomy.js. Idempotent (upsert on kind,value).
//   cd brand-studio && node scripts/seed-taxonomy.js

require('dotenv').config();
const db = require('../src/db');
const { FORMS, TAGS } = require('../src/taxonomy');

(async () => {
  const entries = [
    ...FORMS.map((f) => ({ kind: 'form', value: f.value, description: f.description })),
    ...TAGS.map((t) => ({ kind: 'tag', value: t.value, description: t.description })),
  ];
  const out = await db.upsertTaxonomy(entries);
  console.log(`Seeded ${out.length} taxonomy entries (${FORMS.length} forms + ${TAGS.length} tags).`);
})().catch((e) => { console.error(e.message); process.exit(1); });
