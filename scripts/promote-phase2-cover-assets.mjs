import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const basePath = resolve(root, 'content/catalog-manifest.json');
const phasePath = resolve(root, 'content/phase-2-manifest.json');
const statePath = resolve(root, 'content/content-production-state.json');
const catalogPath = resolve(root, 'server/catalog-templates.json');
const reportPath = resolve(root, 'content/catalog-ingestion-report.json');

const requestedId = process.argv.find((argument) => argument.startsWith('--id='))?.slice('--id='.length);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function runIngestion(id) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/ingest-content-assets.mjs'), `--only-id=${id}`], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', rejectProcess);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveProcess();
      else rejectProcess(new Error(`cover ingestion failed with ${signal || `exit code ${code}`}`));
    });
  });
}

const replacementSlotByPhaseId = {
  'cover_collection_phase2_blockbound-worlds': 'cover_collection_enchanted-forest',
  'cover_album_phase2_voxel-dawn': 'cover_album_magical-creatures',
  'cover_album_phase2_craft-survive': 'cover_album_secret-trails',
  'cover_collection_phase2_minigame-mayhem': 'cover_collection_mystic-outlands',
  'cover_album_phase2_obstacle-arcade': 'cover_album_fairy-lands',
  'cover_album_phase2_ranked-arena': 'cover_album_lost-temples',
  'cover_collection_phase2_creature-collectors': 'cover_collection_moon-stars',
  'cover_album_phase2_pocket-beasts': 'cover_album_moon-gardens',
  'cover_album_phase2_mythic-expeditions': 'cover_album_cosmic-dreams',
  'cover_collection_phase2_neon-city-rush': 'cover_collection_vamp-romantic',
  'cover_album_phase2_midnight-district': 'cover_album_night-mansion',
  'cover_album_phase2_tuner-nights': 'cover_album_roses-stained-glass',
  'cover_collection_phase2_cyber-arena': 'cover_collection_dream-interiors',
  'cover_album_phase2_circuit-champions': 'cover_album_dark-cottage',
  'cover_album_phase2_battle-protocol': 'cover_album_neo-deco-rooms',
  'cover_collection_phase2_streamer-stickerverse': 'cover_collection_glamour-fashion',
  'cover_album_phase2_live-loop': 'cover_album_vintage-glam',
  'cover_album_phase2_sticker-chaos': 'cover_album_jewelry-accessories',
  'cover_collection_phase2_dreamcore-idols': 'cover_collection_winter-wishes',
  'cover_album_phase2_digital-debut': 'cover_album_first-snow',
  'cover_album_phase2_surreal-pop': 'cover_album_winter-city-lights',
};

const [baseBefore, phaseBefore, stateBefore] = await Promise.all([
  readJson(basePath),
  readJson(phasePath),
  readJson(statePath),
]);

let candidate;
if (requestedId) {
  candidate = phaseBefore.cover_plan.entries.find((entry) => entry.id === requestedId);
} else {
  for (const entry of phaseBefore.cover_plan.entries) {
    if (entry.qa_status !== 'PASS' && await exists(resolve(root, entry.source_asset))) {
      candidate = entry;
      break;
    }
  }
}
if (!candidate) throw new Error(requestedId ? `Phase 2 cover not found: ${requestedId}` : 'No generated Phase 2 cover is ready for promotion');
if (candidate.qa_status === 'PASS') throw new Error(`Phase 2 cover is already accepted: ${candidate.id}`);
const plannedSlotId = replacementSlotByPhaseId[candidate.id];
if (!plannedSlotId) throw new Error(`No planned cover replacement slot is defined for ${candidate.id}`);

const sourcePath = resolve(root, candidate.source_asset);
if (!(await exists(sourcePath))) throw new Error(`Cover source asset is missing: ${candidate.source_asset}`);
const slotIndex = baseBefore.covers.findIndex((entry) => entry.id === plannedSlotId);
if (slotIndex === -1) throw new Error(`Planned cover slot is missing: ${plannedSlotId}`);
if (baseBefore.covers.some((entry) => entry.id === candidate.id)) throw new Error(`Phase 2 cover ID is already in catalog: ${candidate.id}`);

const backups = new Map();
for (const filePath of [basePath, catalogPath, reportPath]) backups.set(filePath, await readFile(filePath));
const candidateManifest = {
  ...baseBefore,
  covers: baseBefore.covers.map((entry, index) => index === slotIndex ? {
    ...candidate,
    supersedes_planned_id: plannedSlotId,
  } : entry),
};
await writeJson(basePath, candidateManifest);

try {
  await runIngestion(candidate.id);
  const baseAfter = await readJson(basePath);
  const promoted = baseAfter.covers.find((entry) => entry.id === candidate.id);
  if (!promoted) throw new Error(`Ingestion did not retain promoted cover: ${candidate.id}`);

  const phaseEntries = phaseBefore.cover_plan.entries.map((entry) => entry.id === candidate.id
    ? {
      ...entry,
      generation_status: promoted.generation_status,
      qa_status: promoted.qa_status,
      qa_notes: promoted.qa_notes,
    }
    : entry);
  const passCount = phaseEntries.filter((entry) => entry.qa_status === 'PASS').length;
  const stateAfter = {
    ...stateBefore,
    updated_at: new Date().toISOString(),
    run_status: passCount === phaseEntries.length ? 'catalog-complete' : 'cover-production-in-progress',
    current_progress: {
      ...stateBefore.current_progress,
      covers_pass: baseAfter.covers.filter((entry) => entry.qa_status === 'PASS').length,
    },
    imagegen_history: [...(stateBefore.imagegen_history || []), {
      stage: 'catalog cover ingestion',
      id: candidate.id,
      generated: promoted.generation_status === 'generated' ? 1 : 0,
      qa_status: promoted.qa_status,
      qa_notes: promoted.qa_notes,
      cover_pass: baseAfter.covers.filter((entry) => entry.qa_status === 'PASS').length,
    }],
  };
  const phaseAfter = {
    ...phaseBefore,
    updated_at: new Date().toISOString(),
    cover_plan: {
      ...phaseBefore.cover_plan,
      pending_imagegen: passCount !== phaseEntries.length,
      entries: phaseEntries,
    },
  };
  await Promise.all([
    writeJson(phasePath, phaseAfter),
    writeJson(statePath, stateAfter),
  ]);
  console.log(JSON.stringify({
    id: candidate.id,
    superseded_slot: plannedSlotId,
    generation_status: promoted.generation_status,
    qa_status: promoted.qa_status,
    qa_notes: promoted.qa_notes,
    phase2_covers_pass: passCount,
    phase2_covers_planned: phaseEntries.length,
    final_covers_pass: baseAfter.covers.filter((entry) => entry.qa_status === 'PASS').length,
    final_covers_total: baseAfter.covers.length,
  }, null, 2));
} catch (error) {
  for (const [filePath, contents] of backups) await writeFile(filePath, contents);
  const optimizedPath = resolve(root, candidate.optimized_asset);
  if (!(await exists(resolve(root, candidateManifest.covers[slotIndex].optimized_asset)))) await unlink(optimizedPath).catch(() => {});
  throw error;
}
