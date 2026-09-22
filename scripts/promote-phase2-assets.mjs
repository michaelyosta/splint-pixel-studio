import { spawn } from 'node:child_process';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const basePath = resolve(root, 'content/catalog-manifest.json');
const phasePath = resolve(root, 'content/phase-2-manifest.json');
const phaseDraftPath = resolve(root, 'content/catalog-manifest-phase-2-draft.json');
const statePath = resolve(root, 'content/content-production-state.json');
const registryPath = resolve(root, 'content/content-registry-phase-2.json');
const registryDraftPath = resolve(root, 'content/content-registry-phase-2-draft.json');
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
      else rejectProcess(new Error(`content ingestion failed with ${signal || `exit code ${code}`}`));
    });
  });
}

function phaseProgress(phase, phaseEntries) {
  const generated = phaseEntries.filter((entry) => entry.generation_status === 'generated').length;
  const qaPass = phaseEntries.filter((entry) => entry.qa_status === 'PASS').length;
  const nextEntryIndex = phaseEntries.findIndex((entry) => entry.qa_status !== 'PASS');
  const nextEntryId = nextEntryIndex === -1 ? null : phaseEntries[nextEntryIndex].id;
  const complete = nextEntryIndex === -1;
  return {
    phase: {
      ...phase,
      entries: phaseEntries,
      status: complete ? 'complete' : 'approved-in-progress',
      updated_at: new Date().toISOString(),
      progress: {
        ...phase.progress,
        remaining_to_final_320: phaseEntries.length - qaPass,
        phase2_assets_generated: generated,
        phase2_pass_colorings: qaPass,
        next_phase2_id: nextEntryId,
        imagegen_jobs_paused: false,
        pause_reason: null,
        no_existing_assets_deleted: true,
      },
    },
    generated,
    qaPass,
    nextEntryIndex,
    nextEntryId,
    complete,
  };
}

function updateState(state, progress, ingestionReport, outcome) {
  const history = [...(state.imagegen_history || []), {
    stage: 'phase2 asset ingestion',
    id: outcome.id,
    generated: outcome.generation_status === 'generated' ? 1 : 0,
    qa_status: outcome.qa_status,
    qa_notes: outcome.qa_notes,
    qa_region_count: outcome.qa_region_count ?? null,
    runtime_catalog_count: ingestionReport.runtime_catalog_count ?? null,
  }];
  return {
    ...state,
    updated_at: new Date().toISOString(),
    run_status: progress.complete ? 'phase2-complete' : 'phase2-in-progress',
    pause_reason: null,
    current_progress: {
      ...state.current_progress,
      pass_colorings: 165 + progress.qaPass,
      remaining_colorings: 155 - progress.qaPass,
      processed_colorings: 165 + progress.qaPass,
      runtime_catalog_count: ingestionReport.runtime_catalog_count ?? (165 + progress.qaPass),
      covers_pass: ingestionReport.covers ?? state.current_progress.covers_pass,
    },
    phase2_progress: {
      ...state.phase2_progress,
      planned: 155,
      generated: progress.generated,
      qa_pass: progress.qaPass,
      next_entry_index: progress.nextEntryIndex === -1 ? 155 : progress.nextEntryIndex,
      next_entry_id: progress.nextEntryId,
      generation_resumed: true,
    },
    imagegen_history: history,
  };
}

function mergePhase2Collections(baseCollections, phaseCollections, entries) {
  const entryCollectionIds = new Set(entries.map((entry) => entry.collection_id).filter(Boolean));
  const phaseById = new Map((phaseCollections || []).map((collection) => [collection.id, collection]));
  const retained = (baseCollections || [])
    .filter((collection) => entryCollectionIds.has(collection.id))
    .map((collection) => phaseById.get(collection.id) || collection);
  const added = (phaseCollections || []).filter((collection) => (
    entryCollectionIds.has(collection.id) && !retained.some((candidate) => candidate.id === collection.id)
  ));
  return [...retained, ...added];
}

const [baseBefore, phaseBefore, stateBefore, registryBefore] = await Promise.all([
  readJson(basePath),
  readJson(phasePath),
  readJson(statePath),
  readJson(registryPath),
]);

let candidate;
if (requestedId) {
  candidate = phaseBefore.entries.find((entry) => entry.id === requestedId);
} else {
  for (const entry of phaseBefore.entries) {
    if (entry.qa_status !== 'PASS' && await exists(resolve(root, entry.source_asset))) {
      candidate = entry;
      break;
    }
  }
}
if (!candidate) throw new Error(requestedId ? `Phase 2 entry not found: ${requestedId}` : 'No generated Phase 2 asset is ready for promotion');
if (candidate.qa_status === 'PASS') throw new Error(`Phase 2 entry is already accepted: ${candidate.id}`);
if (!candidate.supersedes_planned_id) throw new Error(`Phase 2 entry has no slot lineage: ${candidate.id}`);

const sourcePath = resolve(root, candidate.source_asset);
if (!(await exists(sourcePath))) throw new Error(`Source asset is missing: ${candidate.source_asset}`);
const slotIndex = baseBefore.entries.findIndex((entry) => entry.id === candidate.supersedes_planned_id);
if (slotIndex === -1) throw new Error(`Planned slot is missing: ${candidate.supersedes_planned_id}`);
if (baseBefore.entries.some((entry) => entry.id === candidate.id)) throw new Error(`Phase 2 ID is already in the catalog: ${candidate.id}`);

const optimizedPath = resolve(root, candidate.optimized_asset);
const previewPath = resolve(root, candidate.preview_asset);
const derivativeWasPresent = { optimized: await exists(optimizedPath), preview: await exists(previewPath) };
const backups = new Map();
for (const filePath of [basePath, catalogPath, reportPath]) backups.set(filePath, await readFile(filePath));

const candidateManifest = {
  ...baseBefore,
  collections: mergePhase2Collections(baseBefore.collections, phaseBefore.collections, baseBefore.entries.map((entry, index) => index === slotIndex ? { ...candidate } : entry)),
  entries: baseBefore.entries.map((entry, index) => index === slotIndex ? { ...candidate } : entry),
};
await writeJson(basePath, candidateManifest);

try {
  await runIngestion(candidate.id);
  const baseAfter = await readJson(basePath);
  const promoted = baseAfter.entries.find((entry) => entry.id === candidate.id);
  if (!promoted) throw new Error(`Ingestion did not retain promoted entry: ${candidate.id}`);

  const phaseEntries = phaseBefore.entries.map((entry) => entry.id === candidate.id
    ? {
      ...entry,
      generation_status: promoted.generation_status,
      qa_status: promoted.qa_status,
      qa_notes: promoted.qa_notes,
      qa_region_count: promoted.qa_region_count,
    }
    : entry);
  const progress = phaseProgress(phaseBefore, phaseEntries);
  const ingestionReport = baseAfter.ingestion?.report || {};
  const stateAfter = updateState(stateBefore, progress, {
    ...ingestionReport,
    runtime_catalog_count: baseAfter.ingestion?.runtime_catalog_count,
  }, promoted);
  const phaseAfter = progress.phase;

  if (promoted.qa_status !== 'PASS') {
    for (const [filePath, contents] of backups) await writeFile(filePath, contents);
    if (!derivativeWasPresent.optimized) await unlink(optimizedPath).catch(() => {});
    if (!derivativeWasPresent.preview) await unlink(previewPath).catch(() => {});
  }

  await Promise.all([
    writeJson(phasePath, phaseAfter),
    writeJson(phaseDraftPath, phaseAfter),
    writeJson(statePath, stateAfter),
    writeJson(registryPath, registryBefore.map((entry) => entry.id === candidate.id
      ? {
        ...entry,
        generation_status: promoted.generation_status,
        qa_status: promoted.qa_status,
        qa_notes: promoted.qa_notes,
        qa_region_count: promoted.qa_region_count,
      }
      : entry)),
    writeJson(registryDraftPath, registryBefore.map((entry) => entry.id === candidate.id
      ? {
        ...entry,
        generation_status: promoted.generation_status,
        qa_status: promoted.qa_status,
        qa_notes: promoted.qa_notes,
        qa_region_count: promoted.qa_region_count,
      }
      : entry)),
  ]);

  console.log(JSON.stringify({
    id: candidate.id,
    superseded_slot: candidate.supersedes_planned_id,
    generation_status: promoted.generation_status,
    qa_status: promoted.qa_status,
    qa_notes: promoted.qa_notes,
    qa_region_count: promoted.qa_region_count ?? null,
    phase2_generated: progress.generated,
    phase2_pass: progress.qaPass,
    next_entry_id: progress.nextEntryId,
    runtime_catalog_count: baseAfter.ingestion?.runtime_catalog_count ?? null,
  }, null, 2));
} catch (error) {
  for (const [filePath, contents] of backups) await writeFile(filePath, contents);
  throw error;
}
