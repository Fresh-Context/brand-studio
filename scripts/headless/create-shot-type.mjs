// Register the "Growth & Form — Circumscribed Specimen" shot type via the app's
// own Supabase data layer (createTool). Run foreground (has egress to Supabase).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const db = require('./src/db');

const SYSTEM_PROMPT = [
  "A single specimen in the Fresh Context scientific-illustration register — the lineage of D'Arcy Thompson's On Growth and Form and Maria Sibylla Merian's botanical plates — rendered as ONE richly drawn organic subject CIRCUMSCRIBED by a fine geometric construction that reveals the mathematical law of its growth.",
  "COMPOSITION (required): a single specimen centered on the ground, its natural form rendered in full engraved detail; over and around it, a light construction armature honest to the subject's own symmetry — a bounding circle or ellipse, an inscribed polygon (a pentagon/pentagram for five-fold flowers, an octagon/eight-point star for eight-fold pods), a golden rectangle with nested squares and a logarithmic spiral for spiral shells and cones, a polar grid of concentric circles and radial spokes for radial heads — plus cross-axes and small dotted node points at the key intersections. The geometry TRANSCRIBES the specimen; it never splits, halves, or replaces it. This is NOT a two-natures diptych and NOT a grid of tiles.",
  "PALETTE: warm cream ground (#f5efe3); the specimen in warm naturalist color (olive green #78803e foliage, burnt orange #c4683a and marigold #e9a13b for fruit and stamens, russet and sepia woods, pearl and caramel shells); construction lines in fine dark brown ink (#3a2418); ONE burnt-orange accent only — a single node, point, or arc.",
  "LINE: hand-drawn, confident, scientific-illustration quality; fine ink for the armature, richer engraved botanical-plate rendering for the specimen. Optional brown-ink analytical marks (a caliper for measurement, a loupe ring for close reading) ONLY when the concept calls for them, never by default.",
  "STRICT: no text, no letters, no numbers, no labels, no logos, no UI, no photorealism, no drop shadows, no grid of tiles, no split composition.",
].join('\n\n');

const tool = await db.createTool({
  name: 'Growth & Form — Circumscribed Specimen',
  description: "A single organic specimen circumscribed by a geometric construction honest to its own growth law (bounding circle/ellipse, inscribed polygon, golden-rectangle spiral, or polar grid) — D'Arcy Thompson growth-and-form. NOT a two-natures split. Warm palette, brown-ink armature, one orange accent. Subject = the specimen; the register supplies the geometry.",
  kind: 'image',
  media_type: 'image',
  system_prompt: SYSTEM_PROMPT,
  default_aspect_ratio: '1:1',
  default_variants: 2,
  reference_image_paths: ['cs-nautilus.png', 'cs-blossom.png', 'cs-leaf.png', 'gf-transformation.png'],
  executor: 'local',
});

console.log('CREATED shot type:');
console.log('  id:', tool.id);
console.log('  name:', tool.name);
console.log('  refs:', tool.reference_image_paths);
console.log('  aspect:', tool.default_aspect_ratio, '· variants:', tool.default_variants);
