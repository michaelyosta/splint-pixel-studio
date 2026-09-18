import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'content/catalog-manifest.json');
const phasePath = resolve(root, 'content/phase-2-manifest.json');
const phaseDraftPath = resolve(root, 'content/catalog-manifest-phase-2-draft.json');
const registryPath = resolve(root, 'content/content-registry-phase-2.json');
const registryDraftPath = resolve(root, 'content/content-registry-phase-2-draft.json');
const statePath = resolve(root, 'content/content-production-state.json');

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const passEntries = source.entries.filter((entry) => entry.qa_status === 'PASS');
const remaining = source.entries.filter((entry) => entry.qa_status !== 'PASS');
if (passEntries.length !== 165) throw new Error(`Expected 165 existing PASS entries, got ${passEntries.length}`);
if (remaining.length !== 155) throw new Error(`Expected 155 remaining entries, got ${remaining.length}`);

const sceneSets = [
  {
    collection: { id: 'col_blockbound-worlds', slug: 'blockbound-worlds', title: 'Blockbound Worlds', theme: 'voxel-sandbox', mood: 'adventure', direction: 'original block and voxel sandbox worlds with bold saturated materials, readable chunky geometry, and dramatic dawn or sunset light', tags: ['voxel', 'sandbox', 'blocks', 'adventure'], lighting_concepts: ['golden voxel dawn', 'torch amber cave light', 'lava orange underglow', 'aurora night'], primary_palettes: ['grass green / sky blue / stone gray / torch amber', 'moss green / copper / cloud blue / ember orange', 'deep slate / lava orange / crystal cyan / sand gold'] },
    albums: [
      { id: 'alb_blockbound-worlds_voxel-dawn', slug: 'voxel-dawn', title: 'Voxel Dawn', focus: 'exploration in a block-built world', scenes: ['Skybridge Spawn', 'Floating Orchard', 'Copper Canyon Base', 'Cloud Tram Station', 'Glacier Blockhouse', 'Sunset Mesa Portal', 'Lantern Village', 'Mossy Ruin Garden', 'Redstone Waterwheel', 'Aurora Quarry'] },
      { id: 'alb_blockbound-worlds_craft-survive', slug: 'craft-survive', title: 'Craft & Survive', focus: 'survival crafting with clever shelters, tools, and resource routes', scenes: ['Pine Shelter Blueprint', 'Rain Barrel Camp', 'Lava Route Workshop', 'Rope Bridge Cache', 'Desert Water Vault', 'Underground Crop Room', 'Stormwatch Cabin', 'Crystal Tool Bench', 'Night Watch Beacon', 'River Raft Workshop'] },
    ],
  },
  {
    collection: { id: 'col_minigame-mayhem', slug: 'minigame-mayhem', title: 'Minigame Mayhem', theme: 'arcade-obstacle', mood: 'high-energy', direction: 'original user-generated minigame and obstacle-world energy with playful hazards, bold lanes, and kinetic stadium lighting', tags: ['minigame', 'obstacle', 'arcade', 'esports'], lighting_concepts: ['arcade spotlights', 'electric cyan stage light', 'candy sunset', 'ultraviolet obstacle glow'], primary_palettes: ['hot pink / arcade cyan / lemon yellow / cobalt', 'violet / lime / coral / white', 'orange / turquoise / magenta / deep navy'] },
    albums: [
      { id: 'alb_minigame-mayhem_obstacle-arcade', slug: 'obstacle-arcade', title: 'Obstacle Arcade', focus: 'inventive obstacle courses and playful challenge rooms', scenes: ['Neon Wall Run', 'Spiral Bounce Tower', 'Tilted Tile Dash', 'Magnet Maze', 'Foam Pit Launch', 'Laser Hoop Alley', 'Moving Bridge Sprint', 'Color Gate Climb', 'Wind Tunnel Run', 'Final Platform'] },
      { id: 'alb_minigame-mayhem_ranked-arena', slug: 'ranked-arena', title: 'Ranked Arena', focus: 'tactical esports arenas with readable objectives and team-ready staging', scenes: ['Beacon Capture', 'Tactical Rooftop', 'Crystal Relay', 'Three-Lane Showdown', 'Signal Tower Match', 'Shield Garden', 'Portal Control Room', 'Arena Tunnel Pick', 'Overlook Strategy Deck', 'Victory Stage'] },
    ],
  },
  {
    collection: { id: 'col_creature-collectors', slug: 'creature-collectors', title: 'Creature Collectors', theme: 'creature-collecting', mood: 'wonder', direction: 'original creature-collecting adventures with expressive invented creatures, discovery habitats, and magical game-world lighting', tags: ['creatures', 'collecting', 'fantasy', 'discovery'], lighting_concepts: ['cosmic glow', 'moonlit meadow', 'crystal canyon light', 'storm backlight'], primary_palettes: ['electric blue / ember orange / leaf green / cream', 'crystal cyan / violet / midnight blue / gold', 'ice blue / coral / moss / indigo'] },
    albums: [
      { id: 'alb_creature-collectors_pocket-beasts', slug: 'pocket-beasts', title: 'Pocket Beasts', focus: 'friendly invented creatures, habitats, nests, and collection moments', scenes: ['Prism Hatchery', 'Cloudtail Meadow', 'Ember Puddle', 'Moon-Eared Grove', 'Bubblefin Dock', 'Moss Horn Clearing', 'Tiny Thunder Nest', 'Starberry Burrow', 'Lanternwing Garden', 'Velvet Scale Pond'] },
      { id: 'alb_creature-collectors_mythic-expeditions', slug: 'mythic-expeditions', title: 'Mythic Expeditions', focus: 'fantasy game-world expeditions through strange landscapes and ancient portals', scenes: ['Lantern Swamp', 'Crystal Canyon', 'Whispering Giant', 'Sky Ruin Camp', 'Silverroot Passage', 'Volcanic Nest', 'Moonwell Crossing', 'Sunken Temple Map', 'Cloud Serpent Valley', 'Final Relic Gate'] },
    ],
  },
  {
    collection: { id: 'col_neon-city-rush', slug: 'neon-city-rush', title: 'Neon City Rush', theme: 'neon-city', mood: 'electric', direction: 'original neon open-city and luxury-chaos energy with glossy architecture, street racing cues, and colored night reflections', tags: ['neon', 'city', 'racing', 'tuner'], lighting_concepts: ['neon rain', 'blue-hour city', 'sunset boulevard', 'harbor sodium glow'], primary_palettes: ['sunset coral / hot pink / electric blue / black', 'cyan / violet / chrome / deep navy', 'lime / magenta / amber / asphalt charcoal'] },
    albums: [
      { id: 'alb_neon-city-rush_midnight-district', slug: 'midnight-district', title: 'Midnight District', focus: 'open-city night scenes with stylish architecture, signs without text, and cinematic reflections', scenes: ['Rooftop Drift', 'Velvet Boulevard', 'Rainlit Market', 'Glass Tower Skywalk', 'Midnight Marina', 'Luxury Garage Row', 'Elevated Train Loop', 'Neon Courtyard', 'Canal of Reflections', 'Sunrise Overpass'] },
      { id: 'alb_neon-city-rush_tuner-nights', slug: 'tuner-nights', title: 'Tuner Nights', focus: 'street racing and tuner culture expressed through original vehicles, garages, and luminous roads', scenes: ['Chrome Garage', 'Electric Apex', 'Tunnel Start Line', 'Rooftop Service Bay', 'Colorshift Coupe', 'Underpass Pit Crew', 'Coastal Drift Route', 'Signal Corner', 'Nitro Workshop', 'Finish Line Glow'] },
    ],
  },
  {
    collection: { id: 'col_cyber-arena', slug: 'cyber-arena', title: 'Cyber Arena', theme: 'cyberpunk-sport', mood: 'intense', direction: 'original futuristic cyber worlds, tactical esports, and battle-arena energy with clear silhouettes and layered neon lighting', tags: ['cyber', 'arena', 'tactical', 'battle'], lighting_concepts: ['dramatic arena spotlights', 'red emergency light', 'holographic lighting', 'acid-green backlight'], primary_palettes: ['charcoal / signal orange / olive / electric blue', 'magenta / cyan / gunmetal / white', 'ultraviolet / acid green / concrete gray / ember'] },
    albums: [
      { id: 'alb_cyber-arena_circuit-champions', slug: 'circuit-champions', title: 'Circuit Champions', focus: 'futuristic competitive arenas with readable lanes, consoles, and team-color lighting', scenes: ['Pulse Grid', 'Holo Goal', 'Circuit Balcony', 'Data Sprint', 'Quantum Dugout', 'Signal Bridge', 'Orbital Scoreboard', 'Laser Court', 'Team Podium', 'Champion Core'] },
      { id: 'alb_cyber-arena_battle-protocol', slug: 'battle-protocol', title: 'Battle Protocol', focus: 'original tactical battle arenas with cover, energy barriers, and strategic objectives', scenes: ['Shield Relay', 'Gravity Vault', 'Tactical Hangar', 'Prism Barricade', 'Command Garden', 'Drone Canyon', 'Core Extraction', 'Magnetic Stronghold', 'Storm Platform', 'Last Beacon'] },
    ],
  },
  {
    collection: { id: 'col_streamer-stickerverse', slug: 'streamer-stickerverse', title: 'Streamer Stickerverse', theme: 'internet-core', mood: 'playful', direction: 'original gaming and streaming culture, sticker language, meme energy, and internet-native compositions without logos or real people', tags: ['streaming', 'stickers', 'meme', 'internet-core'], lighting_concepts: ['RGB room lighting', 'screen glow', 'candy arcade light', 'late-night monitor blue'], primary_palettes: ['RGB cyan / magenta / black / candy yellow', 'violet / acid green / coral / ink navy', 'hot pink / cyan / tangerine / graphite'] },
    albums: [
      { id: 'alb_streamer-stickerverse_live-loop', slug: 'live-loop', title: 'Live Loop', focus: 'invented streaming setups, creator rooms, chat-inspired shapes, and luminous screen light without text', scenes: ['Stream Deck Shrine', 'Chat Bubble Storm', 'Headset Hangout', 'RGB Desk Garden', 'Cozy Queue Screen', 'Creator Snack Wall', 'Pixel Camera Booth', 'Night Stream Loft', 'Victory Reaction Room', 'Offline Glow'] },
      { id: 'alb_streamer-stickerverse_sticker-chaos', slug: 'sticker-chaos', title: 'Sticker Chaos', focus: 'bold collectible sticker and meme-inspired scenes with original symbols, expressive objects, and playful visual punch', scenes: ['Reaction Arcade', 'Meme Meteor', 'Sticker Skatepark', 'Glitch Picnic', 'Emoji Creature Parade', 'Capsule Drop', 'Bubble Tea Battle', 'Tiny Victory Garden', 'Sticker Space Bus', 'Chaos Trophy Shelf'] },
    ],
  },
  {
    collection: { id: 'col_dreamcore-idols', slug: 'dreamcore-idols', title: 'Dreamcore Idols', theme: 'surreal-pop', mood: 'dreamy', direction: 'original anime-inspired universes, idols, fashion, pop staging, dreamcore, and surreal digital worlds with expressive atmospheric light', tags: ['anime-inspired', 'idols', 'fashion', 'dreamcore'], lighting_concepts: ['cosmic glow', 'pastel portal light', 'dramatic violet spotlight', 'soft dawn through impossible glass'], primary_palettes: ['fuchsia / cloud blue / chrome / violet', 'peach / lavender / electric teal / midnight', 'gold / cobalt / rose / black cherry'] },
    albums: [
      { id: 'alb_dreamcore-idols_digital-debut', slug: 'digital-debut', title: 'Digital Debut', focus: 'original pop performers, fashion-forward stages, invented costumes, and luminous performance worlds', scenes: ['Stage in the Clouds', 'Prism Mic', 'Backstage Portal', 'Rooftop Encore', 'Mirror Choreography', 'Velvet Lightshow', 'Floating Dressing Room', 'Idol Garden Set', 'Silver Confetti Hall', 'Final Bow'] },
      { id: 'alb_dreamcore-idols_surreal-pop', slug: 'surreal-pop', title: 'Surreal Pop', focus: 'dreamcore and surreal digital worlds filled with bold fashion objects, impossible rooms, and soft neon atmosphere', scenes: ['Mirror Mall', 'Soft-Serve Planet', 'Pastel Portal Room', 'Moonlit Elevator', 'Infinite Bedroom', 'Cloud Arcade', 'Ribbon Highway', 'Fuchsia Aquarium', 'Velvet Dream Train', 'Digital Daydream'] },
    ],
  },
];

const spookyCollection = {
  id: 'col_spooky-cute', slug: 'spooky-cute', title: 'Spooky Cute', theme: 'dark-cute', mood: 'cursed-cozy', direction: 'dark cute and cursed cute scenes with playful ghosts, eerie sweets, and moody violet, teal, and ember lighting', tags: ['dark-cute', 'cursed-cute', 'ghosts', 'witchy'], lighting_concepts: ['moonlight', 'toxic green backlight', 'candlelit violet', 'arcade red'], primary_palettes: ['bubblegum pink / black cherry / lavender / toxic mint', 'violet / ember red / teal / charcoal', 'candy orange / midnight blue / ghost white / magenta']
};
const spookyAlbums = [
  { id: 'alb_spooky-cute_kind-ghosts', slug: 'kind-ghosts', title: 'Добрые привидения', focus: 'cursed-cute ghost encounters and haunted rooms', scenes: ['Ghost Arcade', 'Haunted Sleepover', 'Spectral Skate Ramp', 'Moonlit Ghost Garden', 'Cursed Camera Booth'] },
  { id: 'alb_spooky-cute_witches-cafe', slug: 'witches-cafe', title: 'Ведьмино кафе', focus: 'dark cute witch cafés, enchanted pastries, and glowing potion counters', scenes: ['Potion Soda Bar', 'Midnight Bakery', 'Spellbook Food Truck', 'Candlelit Candy Shop', 'Moon Cake Counter', 'Bat Window Booth', 'Mystery Menu Table', 'Pumpkin Espresso Lab', 'Velvet Tea Stage', 'Closing Time Cauldron'] },
];

const phaseAlbums = [
  ...spookyAlbums.map((album) => ({ ...album, collection: spookyCollection })),
  ...sceneSets.flatMap((set) => set.albums.map((album) => ({ ...album, collection: set.collection }))),
];
const phaseScenes = phaseAlbums.flatMap((album) => album.scenes.map((title, index) => ({ album, title, index })));
if (phaseScenes.length !== remaining.length) throw new Error(`Expected 155 phase-2 scenes, got ${phaseScenes.length}`);
const freePhaseSlots = new Set([0, 5, 15, 24, 35, 44, 55, 64, 75, 84, 95, 115]);
const collectionCoverId = (collection) => collection.id === 'col_spooky-cute' ? `cover_collection_${collection.slug}` : `cover_collection_phase2_${collection.slug}`;
const albumCoverId = (album) => album.collection.id === 'col_spooky-cute' ? `cover_album_${album.slug}` : `cover_album_phase2_${album.slug}`;
const phase2CoverEntries = sceneSets.flatMap(({ collection, albums }) => {
  const collectionLighting = collection.lighting_concepts[0];
  const collectionPalette = collection.primary_palettes[0];
  const coverPrompt = (subject, detail, lighting, palette) => [
    'a finished, full-color, premium digital illustration for the Splint coloring app',
    `Asset type: original square full-color catalog cover for ${subject}`,
    `Primary request: ${detail}`,
    `Lighting concept: ${lighting}; primary palette: ${palette}`,
    'Composition: bold central focal point, readable at small mobile thumbnail size, layered but uncluttered, full-bleed background to every canvas edge, no external border or frame, no embedded text',
    'Style/medium: sophisticated contemporary digital illustration, saturated and atmospheric, collectible-looking, original invented subjects only',
    'Pixelization-first design: preserve the story, silhouette, and major color masses on the actual Splint logical grid; use 1–3 focal elements, clear foreground/midground/background separation, broad readable shapes, and restrained decoration instead of micro-texture or many tiny objects',
    'Constraints: no monochrome-only output, no grayscale-only output, no text, letters, watermark, signature, logo, trademark, copyrighted characters, franchise references, real-person likeness, named artist imitation, or artificial white frame',
  ].join('\n');
  const collectionCover = {
    id: collectionCoverId(collection),
    kind: 'collection',
    parent_id: collection.id,
    title: collection.title,
    orientation: 'cover',
    width: 1200,
    height: 1200,
    primary_palette: collectionPalette,
    lighting_concept: collectionLighting,
    generation_status: 'planned',
    qa_status: 'pending',
    generation_prompt: coverPrompt(`the collection «${collection.title}»`, `a visually magnetic cover establishing ${collection.direction}`, collectionLighting, collectionPalette),
    source_asset: `content/generated/covers/phase2-${collection.slug}.png`,
    optimized_asset: `public/assets/catalog/generated/covers/phase2-${collection.slug}.png`,
  };
  const albumCovers = albums.map((album, albumIndex) => {
    const lighting = collection.lighting_concepts[(albumIndex + 1) % collection.lighting_concepts.length];
    const palette = collection.primary_palettes[(albumIndex + 1) % collection.primary_palettes.length];
    return {
      id: albumCoverId({ ...album, collection }),
      kind: 'album',
      parent_id: album.id,
      collection_id: collection.id,
      title: album.title,
      orientation: 'cover',
      width: 1200,
      height: 1200,
      primary_palette: palette,
      lighting_concept: lighting,
      generation_status: 'planned',
      qa_status: 'pending',
      generation_prompt: coverPrompt(`the album «${album.title}» in «${collection.title}»`, `a strong thumbnail focal point expressing ${album.focus}`, lighting, palette),
      source_asset: `content/generated/covers/phase2-${album.slug}.png`,
      optimized_asset: `public/assets/catalog/generated/covers/phase2-${album.slug}.png`,
    };
  });
  return [collectionCover, ...albumCovers];
});

const generatedAt = '2026-09-16T00:00:00.000Z';
const entries = phaseScenes.map(({ album, title, index }, slotIndex) => {
  const slot = remaining[slotIndex];
  const collection = album.collection;
  const lighting_concept = collection.lighting_concepts[slotIndex % collection.lighting_concepts.length];
  const primary_palette = collection.primary_palettes[slotIndex % collection.primary_palettes.length];
  const id = `coloring_phase2_${collection.slug}_${album.slug}_${String(index + 1).padStart(2, '0')}`;
  const description = `${title}: an original ${album.focus} scene with ${collection.direction}.`;
  const signature = `${collection.slug}|${album.slug}|${title}|${index}`.toLocaleLowerCase();
  const dims = { width: slot.width, height: slot.height };
  return {
    id,
    supersedes_planned_id: slot.id,
    slug: id.replace(/^coloring_/, ''),
    title,
    description,
    collection_id: collection.id,
    collection_title: collection.title,
    album_id: album.id,
    album_title: album.title,
    access: freePhaseSlots.has(slotIndex) ? 'free' : 'premium',
    difficulty: slot.difficulty,
    orientation: slot.orientation,
    width: dims.width,
    height: dims.height,
    grid_width: slot.grid_width,
    grid_height: slot.grid_height,
    tags: [...collection.tags, collection.slug],
    season: ['evergreen'],
    audience: ['teens', 'adults', 'broad'],
    mood: collection.mood,
    palette: primary_palette,
    primary_palette,
    lighting_concept,
    generation_prompt: [
      'a finished, full-color, premium digital illustration for the Splint coloring app',
      'Use case: illustration-story; digital tap-to-fill artwork, not a printable coloring-book page',
      `Primary request: ${description}`,
      `Collection direction: ${collection.direction}; album direction: ${album.title}`,
      `Lighting concept: ${lighting_concept}; primary palette: ${primary_palette}`,
      `Composition/framing: ${slot.orientation}; all main subjects fully visible with at least 7% clear breathing space inside the scene, full-bleed background to every canvas edge, no external border or frame`,
      `Master canvas: ${dims.width}×${dims.height}`,
      `Difficulty: ${slot.difficulty}; target approximately ${slot.difficulty === 'simple' ? '15–35' : slot.difficulty === 'medium' ? '25–60' : '40–80'} large or medium tappable regions`,
      'Style/medium: colorful, bold, saturated, contemporary, high-energy, collectible-looking, internet-native, game-inspired, fashion-forward digital illustration with clean smooth contours, deliberate bounded regions, expressive atmospheric lighting, original invented subjects only',
      'Pixelization-first design: preserve the story, silhouette, and major color masses on the actual Splint logical grid; use 1–3 focal elements, clear foreground/midground/background separation, broad readable shapes, and restrained decoration instead of micro-texture or many tiny objects',
      'Every intended colorable region must remain a closed meaningful shape after downsampling. Preserve readable silhouettes and mobile tap targets. No monochrome-only output, no grayscale-only output, no generic children’s clip-art, no random rainbow palette, no muddy beige palette, no text, letters, watermark, signature, logo, trademark, copyrighted characters, franchise references, real-person likeness, named artist imitation, hatching, cross-hatching, texture strokes, dense micro-elements, arbitrary divider lines, accidental gaps, cropped key objects, artificial white border, or frame',
    ].join('\n'),
    negative_constraints: ['no monochrome-only output', 'no external border or frame', 'no text or logos', 'no copyrighted IP', 'no real-person likeness', 'no micro-detail overload'],
    generation_status: 'planned',
    qa_status: 'pending',
    source_asset: `content/generated/masters/${id}.png`,
    optimized_asset: `public/assets/catalog/generated/${id.replace(/^coloring_/, '')}.png`,
    preview_asset: `public/assets/catalog/generated/${id.replace(/^coloring_/, '')}-pixel.png`,
    semantic_signature: signature,
  };
});

const countBy = (key, sourceEntries = entries) => sourceEntries.reduce((out, entry) => { out[entry[key]] = (out[entry[key]] || 0) + 1; return out; }, {});
const finalEntries = [...passEntries, ...entries];
const phaseCollections = [spookyCollection, ...sceneSets.map((set) => set.collection)].map((collection) => ({
  id: collection.id,
  slug: collection.slug,
  title: collection.title,
  access: phaseScenes.some(({ album }) => album.collection.id === collection.id && freePhaseSlots.has(phaseScenes.findIndex((scene) => scene.album.id === album.id))) ? 'mixed' : 'premium',
  theme: collection.theme,
  mood: collection.mood,
  direction: collection.direction,
  cover_id: collectionCoverId(collection),
  albums: phaseAlbums.filter((album) => album.collection.id === collection.id).map((album) => ({ id: album.id, slug: album.slug, title: album.title, count: album.scenes.length, cover_id: albumCoverId(album) })),
}));

const manifest = {
  schema_version: 1,
  generated_at: generatedAt,
  status: 'draft-awaiting-owner-approval',
  phase: 'phase-2-game-inspired-creative-direction',
  base_manifest: 'content/catalog-manifest.json',
  pixelization_pipeline: {
    pipeline: 'catalog-ingestion-grid-preview-v1',
    reference: 'actual runtime logical cell map generated by catalog ingestion',
    player_mode: 'legacy/classic cell renderer',
    cell_render_size_css_px: 32,
    grid_by_orientation: { portrait: '64x80', square: '64x64', landscape: '80x60' },
    pixel_preview_asset: 'preview_asset',
    purpose: 'runtime processing and catalog integration; no per-asset visual QA gate',
    optional_spot_checks: 'sampled sanity checks only; never a per-asset acceptance condition',
  },
  progress: {
    existing_pass_colorings: passEntries.length,
    remaining_to_final_320: entries.length,
    phase2_assets_generated: 0,
    phase2_pass_colorings: 0,
    next_phase2_id: entries[0]?.id || null,
    imagegen_jobs_paused: true,
    pause_reason: 'creative-direction-correction-and-usage-limit-after-current-in-flight-batch',
    no_existing_assets_deleted: true,
  },
  preserved_assortment: ['Cozy', 'Calm', 'Seasonal', 'Café', 'Interiors', 'Botanical', 'Relaxing'],
  new_direction: ['block / voxel sandbox', 'survival / crafting', 'user-generated minigame / obstacle', 'creature collecting', 'gaming / streaming', 'sticker / meme / internet-core', 'anime-inspired original universes', 'dark cute / cursed cute', 'neon open-city / luxury-chaos', 'futuristic cyber / neon', 'tactical esports', 'battle arena', 'street racing / tuner', 'fantasy game worlds', 'idols / fashion / pop', 'dreamcore / surreal digital worlds'],
  phase1_registry: 'content/content-registry.json',
  id_policy: 'Phase 1 IDs and assets are preserved; every Phase 2 work receives a new ID and only references its superseded planned slot.',
  catalog_target: { final_colorings: 320, final_free: 172, final_premium: 148, free_range: '40–55%', premium_range: '45–60%', collections: 16, albums: 32 },
  cover_plan: { final_covers: 48, phase1_covers_retained: 27, new_phase2_covers: phase2CoverEntries.length, pending_imagegen: true, entries: phase2CoverEntries },
  phase2_distribution: { total: entries.length, access: countBy('access'), free: entries.filter((entry) => entry.access === 'free').length, premium: entries.filter((entry) => entry.access === 'premium').length, orientation: countBy('orientation'), difficulty: countBy('difficulty') },
  final_distribution_if_merged: {
    total: passEntries.length + entries.length,
    free: passEntries.filter((entry) => entry.access === 'free').length + entries.filter((entry) => entry.access === 'free').length,
    premium: passEntries.filter((entry) => entry.access === 'premium').length + entries.filter((entry) => entry.access === 'premium').length,
    orientation: countBy('orientation', finalEntries),
    difficulty: countBy('difficulty', finalEntries),
  },
  collections: phaseCollections,
  entries,
};

const registry = entries.map((entry) => ({ id: entry.id, supersedes_planned_id: entry.supersedes_planned_id, semantic_signature: entry.semantic_signature, title: entry.title, collection_id: entry.collection_id, album_id: entry.album_id, tags: entry.tags, access: entry.access, primary_palette: entry.primary_palette, lighting_concept: entry.lighting_concept }));
const state = {
  schema_version: 1,
  updated_at: generatedAt,
  run_status: 'paused-after-current-batch',
  pause_reason: 'owner-correction-to-creative-direction',
  source_manifest: 'content/catalog-manifest.json',
  current_progress: { pass_colorings: passEntries.length, remaining_colorings: remaining.length, processed_colorings: source.ingestion?.report?.processed || 0, runtime_catalog_count: source.ingestion?.runtime_catalog_count || 0, covers_pass: source.covers.filter((cover) => cover.qa_status === 'PASS').length },
  phase2_progress: { manifest: 'content/phase-2-manifest.json', planned: entries.length, generated: 0, qa_pass: 0, next_entry_index: 0, next_entry_id: entries[0]?.id || null, generation_resumed: false },
  imagegen_history: [
    { stage: 'full-color frame-free run', downloaded: 165, qa_pass: 165, note: 'Existing PASS assets retained as the calm/cozy assortment layer.' },
    { stage: 'last in-flight batch', requested: 32, downloaded: 29, qa_pass_pending_ingest: 29, blocked_by_usage_limit: 3, note: 'HTTP 429 usage limit; no retry was started after the owner correction.' },
  ],
  storage: { masters: 'content/generated/masters/', optimized_runtime: 'public/assets/catalog/generated/', manifest: 'content/catalog-manifest.json', phase2_manifest: 'content/phase-2-manifest.json', phase2_draft: 'content/catalog-manifest-phase-2-draft.json', deletion_performed: false },
};

await mkdir(dirname(phasePath), { recursive: true });
await writeFile(phasePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(phaseDraftPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
await writeFile(registryDraftPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ phase_manifest: phasePath, phase_manifest_draft: phaseDraftPath, registry: registryPath, state: statePath, existing_pass: passEntries.length, remaining: entries.length, phase2_collections: phaseCollections.length, phase2_albums: phaseAlbums.length, access: countBy('access'), orientation: countBy('orientation'), difficulty: countBy('difficulty') }, null, 2));
