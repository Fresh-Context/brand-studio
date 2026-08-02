'use strict';

// The controlled vocabulary for asset search. Derived from the brand register
// (brand-marketing/brand-guidelines/*): the D'Arcy Thompson / Merian primitive
// forms, the analytical-overlay grammar, the plate palette, and the asset types
// we actually produce. Seeded into studio_taxonomy (editable there); the indexer
// constrains the vision model to these values so "search by form/tag" is coherent.

// FORM = the single dominant visual form of the asset.
const FORMS = [
  { value: 'network',     description: 'connected node graph — a context system / GTM graph' },
  { value: 'branch',      description: 'branching / dendritic growth form' },
  { value: 'spiral',      description: 'logarithmic / growth spiral' },
  { value: 'cell-grid',   description: 'cellular or packed-cell structure' },
  { value: 'citrus',      description: 'citrus cross-section / anatomy' },
  { value: 'botanical',   description: 'other botanical specimen, Merian-style' },
  { value: 'plate',       description: 'colored ground / background plate' },
  { value: 'loupe',       description: 'loupe-ring / magnification composition (salience)' },
  { value: 'caliper',     description: 'caliper / measurement overlay composition' },
  { value: 'arrow-field', description: 'deployment / propagation arrows' },
  { value: 'glyph',       description: 'simple system glyph / mark that reads at small size' },
  { value: 'icon',        description: 'editorial icon' },
  { value: 'hedcut',      description: 'stipple portrait, WSJ hedcut style' },
  { value: 'diagram',     description: 'labeled diagram or figure' },
  { value: 'hero',        description: 'editorial hero plate for a header' },
  { value: 'thumbnail',   description: 'produced card / thumbnail' },
  { value: 'mockup',      description: 'product or screen mockup' },
  { value: 'deck',        description: 'deck / slide' },
  { value: 'texture',     description: 'texture, pattern, or abstract ground' },
  { value: 'other',       description: 'none of the above' },
];

// TAG = additional facets (multi-select). Palette, concept, register, usage.
const TAGS = [
  // palette
  { value: 'brown-ink',    description: 'brown ink line (#3a2418)' },
  { value: 'cream',        description: 'cream field (#f5efe3)' },
  { value: 'burnt-orange', description: 'burnt-orange accent (#c4683a)' },
  { value: 'citrus-orange',description: 'citrus-orange plate' },
  { value: 'brick-red',    description: 'brick-red plate' },
  { value: 'olive-green',  description: 'olive-green plate' },
  // concept
  { value: 'context-system',description: 'stands for a shared context system' },
  { value: 'team',          description: 'stands for a team / people' },
  { value: 'frontier',      description: 'the jagged / capability frontier' },
  { value: 'growth-and-form',description: 'growth-and-form / developmental theme' },
  { value: 'deployment',    description: 'propagation / deployment' },
  { value: 'salience',      description: 'salience / close-reading' },
  { value: 'measurement',   description: 'measurement / rigor' },
  { value: 'two-natures',   description: 'the two-natures / dual concept' },
  // register
  { value: 'produced',      description: 'ship-as-is produced asset' },
  { value: 'raw-primitive', description: 'raw component for composition' },
  { value: 'inspiration',   description: 'external inspiration / reference, not our output' },
  // usage
  { value: 'homepage',      description: 'used on or made for the homepage' },
  { value: 'case-study',    description: 'case-study collateral' },
  { value: 'launch',        description: 'launch collateral' },
  { value: 'curation',      description: 'curation pass output' },
  { value: 'portrait',      description: 'a person / portrait' },
];

module.exports = { FORMS, TAGS };
