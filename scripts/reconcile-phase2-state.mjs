import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const basePath = resolve(root, 'content/catalog-manifest.json');
const phasePath = resolve(root, 'content/phase-2-manifest.json');
const phaseDraftPath = resolve(root, 'content/catalog-manifest-phase-2-draft.json');
const statePath = resolve(root, 'content/content-production-state.json');
const registryPath = resolve(root, 'content/content-registry-phase-2.json');
const registryDraftPath = resolve(root, 'content/content-registry-phase-2-draft.json');

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const writeJson = (filePath, value) => writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const [base, phase, state, registry] = await Promise.all([
  readJson(basePath),
  readJson(phasePath),
  readJson(statePath),
  readJson(registryPath),
]);

const phaseIds = new Set(phase.entries.map((entry) => entry.id));
const runtimeEntries = new Map(base.entries.filter((entry) => phaseIds.has(entry.id)).map((entry) => [entry.id, entry]));
const entries = phase.entries.map((entry) => {
  const runtime = runtimeEntries.get(entry.id);
  if (!runtime) return entry;
  return {
    ...entry,
    generation_status: runtime.generation_status,
    qa_status: runtime.qa_status,
    qa_notes: runtime.qa_notes,
    qa_region_count: runtime.qa_region_count,
  };
});
const generated = entries.filter((entry) => entry.generation_status === 'generated').length;
const qaPass = entries.filter((entry) => entry.qa_status === 'PASS').length;
const coversPass = base.covers.filter((cover) => cover.qa_status === 'PASS').length;
const coversComplete = coversPass === base.covers.length && phase.cover_plan.entries.every((cover) => cover.qa_status === 'PASS');
const nextEntryIndex = entries.findIndex((entry) => entry.qa_status !== 'PASS');
const nextEntryId = nextEntryIndex === -1 ? null : entries[nextEntryIndex].id;
const now = new Date().toISOString();

const phaseAfter = {
  ...phase,
  entries,
  status: nextEntryIndex === -1 ? 'complete' : 'approved-in-progress',
  updated_at: now,
  progress: {
    ...phase.progress,
    remaining_to_final_320: entries.length - qaPass,
    phase2_assets_generated: generated,
    phase2_pass_colorings: qaPass,
    next_phase2_id: nextEntryId,
    imagegen_jobs_paused: false,
    pause_reason: null,
    no_existing_assets_deleted: true,
  },
};
const stateAfter = {
  ...state,
  updated_at: now,
  run_status: nextEntryIndex === -1 && coversComplete ? 'catalog-complete' : nextEntryIndex === -1 ? 'phase2-complete' : 'phase2-in-progress',
  pause_reason: null,
  current_progress: {
    ...state.current_progress,
    pass_colorings: 165 + qaPass,
    remaining_colorings: entries.length - qaPass,
    processed_colorings: 165 + qaPass,
    runtime_catalog_count: base.ingestion?.runtime_catalog_count ?? (165 + qaPass),
    covers_pass: coversPass,
  },
  phase2_progress: {
    ...state.phase2_progress,
    planned: entries.length,
    generated,
    qa_pass: qaPass,
    next_entry_index: nextEntryIndex === -1 ? entries.length : nextEntryIndex,
    next_entry_id: nextEntryId,
    generation_resumed: true,
  },
};
const updateRegistry = (items) => items.map((item) => {
  const runtime = runtimeEntries.get(item.id);
  return runtime
    ? {
      ...item,
      generation_status: runtime.generation_status,
      qa_status: runtime.qa_status,
      qa_notes: runtime.qa_notes,
      qa_region_count: runtime.qa_region_count,
    }
    : item;
});

await Promise.all([
  writeJson(phasePath, phaseAfter),
  writeJson(phaseDraftPath, phaseAfter),
  writeJson(statePath, stateAfter),
  writeJson(registryPath, updateRegistry(registry)),
  writeJson(registryDraftPath, updateRegistry(await readJson(registryDraftPath))),
]);

console.log(JSON.stringify({
  phase2_generated: generated,
  phase2_pass: qaPass,
  next_entry_index: nextEntryIndex === -1 ? entries.length : nextEntryIndex,
  next_entry_id: nextEntryId,
  runtime_catalog_count: base.ingestion?.runtime_catalog_count ?? null,
}, null, 2));
