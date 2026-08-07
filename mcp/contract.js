'use strict';

const TOOL_NAMES = Object.freeze([
  'studio_search_assets',
  'studio_brand_context',
  'studio_get_asset',
  'studio_set_asset_hidden',
  'studio_list_tools',
  'studio_list_taxonomy',
  'studio_generate_image',
  'studio_record_feedback',
  'studio_list_feedback',
  'studio_resolve_feedback',
  'studio_get_job',
  'studio_download_job',
]);

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const IMAGE_INPUT_TYPES = ['local_file', 'https_url'];

const objectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const outputObjectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: true,
});

const listResultSchema = (items) => outputObjectSchema({ items: { type: 'array', items } }, ['items']);

const TOOLS = Object.freeze([
  {
    name: 'studio_search_assets',
    description: 'Search the Fresh Context Studio brand catalog before spending image-generation credit. Returns reusable assets with title/caption, form, tags, provenance, asset IDs, and signed file references. Hidden/off-brand assets are excluded unless include_hidden is true.',
    inputSchema: objectSchema({
      query: { type: 'string', minLength: 1, description: 'Natural-language search, for example "citrus cross-section" or "deployment arrows".' },
      form: { type: 'string', description: 'Optional controlled form filter. See studio_list_taxonomy.' },
      source: { type: 'string', enum: ['generated', 'library'], description: 'Optional source filter.' },
      kind: { type: 'string', enum: ['image', 'motion', 'video'], description: 'Optional asset kind filter.' },
      tool_id: { type: 'string', description: 'Optional persisted image shot-type ID filter.' },
      include_hidden: { type: 'boolean', default: false, description: 'Include assets hidden by negative feedback. Default false.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    }, ['query']),
    outputSchema: listResultSchema({ type: 'object' }),
  },
  {
    name: 'studio_brand_context',
    description: 'Read published Fresh Context brand rules with scope, kind, guidance, and provenance. Use for situational brand context without changing the canon.',
    inputSchema: objectSchema({
      stage: { type: 'string', enum: ['tof', 'mof', 'bof'], description: 'Funnel stage; returns that stage plus global rules.' },
      kind: { type: 'string', enum: ['voice', 'style', 'lexicon', 'format', 'register', 'routing', 'principle'], description: 'Optional rule dimension.' },
    }),
    outputSchema: listResultSchema({ type: 'object' }),
  },
  {
    name: 'studio_get_asset',
    description: 'Fetch one catalog asset by ID with metadata, provenance, and a signed retrievable file reference.',
    inputSchema: objectSchema({ id: { type: 'string', minLength: 1 } }, ['id']),
    outputSchema: outputObjectSchema({ asset: { type: 'object' } }, ['asset']),
  },
  {
    name: 'studio_set_asset_hidden',
    description: 'Explicitly show or hide a catalog asset. This is a gallery visibility action, not a rule edit.',
    inputSchema: objectSchema({ id: { type: 'string', minLength: 1 }, hidden: { type: 'boolean' } }, ['id', 'hidden']),
    outputSchema: outputObjectSchema({ id: { type: 'string' }, hidden: { type: 'boolean' } }, ['id', 'hidden']),
  },
  {
    name: 'studio_list_tools',
    description: 'List persisted Studio generation tools (shot types). Resolve a human request to a configured tool ID before generation; filter kind=image for image work.',
    inputSchema: objectSchema({ kind: { type: 'string', enum: ['image', 'motion', 'video'] } }),
    outputSchema: listResultSchema({ type: 'object' }),
  },
  {
    name: 'studio_list_taxonomy',
    description: 'List controlled Studio vocabulary for forms, tags, and critique labels.',
    inputSchema: objectSchema({ kind: { type: 'string', description: 'Optional taxonomy kind, such as form, tag, or critique.' } }),
    outputSchema: listResultSchema({ type: 'object' }),
  },
  {
    name: 'studio_generate_image',
    description: 'Paid image generation through a persisted Studio image shot type. Search first, resolve an image tool, and inspect open feedback before calling. The API composes the persisted tool system prompt, configured aspect/defaults, and reference exemplars with the user subject; this tool never accepts an arbitrary system prompt. Explain the credit spend to the user before calling. Default variants remain the persisted tool default; the MCP contract allows at most four.',
    inputSchema: objectSchema({
      tool_id: { type: 'string', minLength: 1, description: 'Persisted image shot-type ID from studio_list_tools.' },
      prompt: { type: 'string', minLength: 1, maxLength: 4000, description: 'Specific subject only; the persisted shot type supplies the brand register.' },
      aspect: { type: 'string', enum: ASPECT_RATIOS, description: 'Optional configured aspect override.' },
      variants: { type: 'integer', minimum: 1, maximum: 4, default: 2, description: 'Optional variant count. Maximum four per MCP call.' },
      input_image: {
        type: 'object',
        description: 'Reserved iteration input. Local stdio may read local_file; hosted clients must use an allowlisted https_url or an uploaded image.',
        properties: {
          type: { type: 'string', enum: IMAGE_INPUT_TYPES },
          value: { type: 'string', minLength: 1 },
        },
        required: ['type', 'value'],
        additionalProperties: false,
      },
    }, ['tool_id', 'prompt']),
    outputSchema: outputObjectSchema({
      job_id: { type: 'string' },
      status: { type: 'string', enum: ['complete', 'failed', 'generating'] },
      tool_id: { type: 'string' },
      assets: { type: 'array', items: { type: 'object' } },
      download: { type: 'object' },
      download_url: { type: 'string' },
      error: { type: ['string', 'null'] },
    }, ['job_id', 'status', 'tool_id', 'assets', 'error']),
  },
  {
    name: 'studio_record_feedback',
    description: 'Record a positive or negative brand judgment on an asset for later /studio-crit triage. It never edits upstream prompts or brand rules.',
    inputSchema: objectSchema({
      asset_id: { type: 'string', minLength: 1 },
      verdict: { type: 'string', enum: ['positive', 'negative'] },
      note: { type: 'string', maxLength: 4000 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 50 },
    }, ['asset_id', 'verdict']),
    outputSchema: outputObjectSchema({ feedback: { type: 'object' } }, ['feedback']),
  },
  {
    name: 'studio_list_feedback',
    description: 'Inspect the feedback queue before generation or triage. Filter by open/resolved/dismissed status, verdict, tool, or asset.',
    inputSchema: objectSchema({
      status: { type: 'string', enum: ['open', 'resolved', 'dismissed'] },
      verdict: { type: 'string', enum: ['positive', 'negative'] },
      tool_id: { type: 'string' },
      asset_id: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    }),
    outputSchema: listResultSchema({ type: 'object' }),
  },
  {
    name: 'studio_resolve_feedback',
    description: 'Persist a human-approved feedback triage disposition. Use resolved or dismissed; this is the only feedback write-back point and does not silently rewrite rules.',
    inputSchema: objectSchema({
      id: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['resolved', 'dismissed', 'open'] },
      disposition: { type: 'object', description: 'Decision record: {level, decisions:[{action,target,detail}], session?}.' },
    }, ['id', 'status']),
    outputSchema: outputObjectSchema({ feedback: { type: 'object' } }, ['feedback']),
  },
  {
    name: 'studio_get_job',
    description: 'Fetch a persisted Studio job by ID. Use after generation to inspect status, tool ID, prompt, result paths, asset IDs, and failure details without generating again.',
    inputSchema: objectSchema({ id: { type: 'string', minLength: 1 } }, ['id']),
    outputSchema: outputObjectSchema({
      id: { type: 'string' },
      status: { type: 'string', enum: ['generating', 'complete', 'failed', 'pending'] },
      tool_id: { type: 'string' },
      prompt: { type: 'string' },
      result_paths: { type: 'array', items: { type: 'string' } },
      asset_ids: { type: 'array', items: { type: 'string' } },
      error: { type: ['string', 'null'] },
    }, ['id', 'status', 'error']),
  },
  {
    name: 'studio_download_job',
    description: 'Return a short-lived signed archive reference for all available outputs of a Studio job. Local stdio may also provide output_path to download the archive; hosted MCP returns a URL and metadata instead of assuming caller filesystem access.',
    inputSchema: objectSchema({
      id: { type: 'string', minLength: 1 },
      output_path: { type: 'string', minLength: 1, description: 'Optional local stdio destination path. Not available through hosted MCP.' },
    }, ['id']),
    outputSchema: outputObjectSchema({
      job_id: { type: 'string' },
      download_url: { type: 'string' },
      filename: { type: 'string' },
      content_type: { type: 'string' },
      byte_size: { type: ['integer', 'null'] },
      expires_at: { type: 'string' },
      output_path: { type: ['string', 'null'] },
    }, ['job_id', 'download_url', 'filename', 'content_type', 'expires_at']),
  },
]);

const SERVER_INSTRUCTIONS = [
  'Fresh Context Studio is the source of truth for on-brand static image work.',
  'Default workflow: search existing assets, resolve a persisted image tool, inspect open feedback, then explain paid credit spend before generation.',
  'Generation uses the persisted tool system prompt, aspect/defaults, and configured reference images; MCP does not accept arbitrary model prompts or edit brand rules.',
  'After generation, inspect the job, retrieve the signed archive, and record the brand judgment. Use studio_resolve_feedback only for human-approved triage.',
].join(' ');

module.exports = {
  ASPECT_RATIOS,
  IMAGE_INPUT_TYPES,
  SERVER_INSTRUCTIONS,
  TOOL_NAMES,
  TOOLS,
};
