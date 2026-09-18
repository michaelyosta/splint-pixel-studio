import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const phasePath = resolve(root, 'content/phase-2-manifest.json');
const basePath = resolve(root, 'content/catalog-manifest.json');
const registryPath = resolve(root, 'content/content-registry.json');
const statePath = resolve(root, 'content/content-production-state.json');

const phase = JSON.parse(await readFile(phasePath, 'utf8'));
const base = JSON.parse(await readFile(basePath, 'utf8'));
const registryDocument = JSON.parse(await readFile(registryPath, 'utf8'));
const state = JSON.parse(await readFile(statePath, 'utf8'));
const failures = [];

const countBy = (items, key) => items.reduce((counts, item) => {
  counts[item[key]] = (counts[item[key]] || 0) + 1;
  return counts;
}, {});
const unique = (items) => new Set(items).size;
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const phase1Pass = base.entries.filter((entry) => entry.qa_status === 'PASS' && !entry.id.startsWith('coloring_phase2_'));
const phaseEntries = phase.entries;
const phaseIds = phaseEntries.map((entry) => entry.id);
const baseIds = base.entries.map((entry) => entry.id);
const phase1Registry = Array.isArray(registryDocument) ? registryDocument : registryDocument.entries;
const phaseSlotById = new Map(phaseEntries.map((entry) => [entry.supersedes_planned_id, entry]));
const merged = base.entries.map((entry) => phaseSlotById.get(entry.id) || entry);
const mergedCollectionCounts = countBy(merged, 'collection_id');
const mergedAlbumCounts = countBy(merged, 'album_id');
const phaseCoverIds = phase.cover_plan.entries.map((cover) => cover.id);
const baseCoverIds = base.covers.map((cover) => cover.id);
const phaseGenerated = phaseEntries.filter((entry) => entry.generation_status === 'generated').length;
const phasePass = phaseEntries.filter((entry) => entry.qa_status === 'PASS').length;
const nextEntryIndex = phaseEntries.findIndex((entry) => entry.qa_status !== 'PASS');
const nextEntryId = nextEntryIndex === -1 ? null : phaseEntries[nextEntryIndex]?.id;
const acceptedPhaseIds = new Set(phaseEntries.filter((entry) => entry.qa_status === 'PASS').map((entry) => entry.id));

assert(['approved-in-progress', 'phase2-complete', 'complete'].includes(phase.status), `unexpected Phase 2 status: ${phase.status}`);
assert(typeof phase.progress.imagegen_jobs_paused === 'boolean', 'ImageGen pause flag must be boolean');
assert(phase.progress.no_existing_assets_deleted === true, 'existing assets deletion guard must remain true');
assert(phase.progress.phase2_assets_generated === phaseGenerated, 'manifest generated counter does not match entry statuses');
assert(phase.progress.phase2_pass_colorings === phasePass, 'manifest PASS counter does not match entry statuses');
assert(phase.progress.remaining_to_final_320 === phaseEntries.length - phasePass, 'manifest remaining counter does not match entry statuses');
assert(phase.progress.next_phase2_id === nextEntryId, 'manifest cursor must point to the first unaccepted Phase 2 ID');
assert(state.phase2_progress?.planned === phaseEntries.length && state.phase2_progress?.generated === phaseGenerated && state.phase2_progress?.qa_pass === phasePass, 'state Phase 2 counters do not match the manifest');
assert(state.phase2_progress?.next_entry_index === (nextEntryIndex === -1 ? phaseEntries.length : nextEntryIndex) && state.phase2_progress?.next_entry_id === nextEntryId && state.phase2_progress?.generation_resumed === true, 'state Phase 2 cursor does not match the manifest');
assert(phase1Pass.length === 165, `expected 165 Phase 1 PASS entries, got ${phase1Pass.length}`);
assert(phaseEntries.length === 155, `expected 155 Phase 2 entries, got ${phaseEntries.length}`);
assert(unique(phaseIds) === phaseEntries.length, 'Phase 2 IDs must be unique');
assert([...acceptedPhaseIds].every((id) => baseIds.includes(id)), 'accepted Phase 2 IDs must be present in the runtime manifest');
assert(phaseEntries.filter((entry) => entry.qa_status !== 'PASS').every((entry) => baseIds.includes(entry.supersedes_planned_id)), 'unaccepted Phase 2 entries must retain their planned slot');
assert(base.entries.length === 320, `runtime manifest must retain 320 planned slots, got ${base.entries.length}`);
assert(unique(phaseEntries.map((entry) => entry.title)) === phaseEntries.length, 'Phase 2 titles must be unique');
assert(unique(phaseEntries.map((entry) => entry.semantic_signature)) === phaseEntries.length, 'Phase 2 semantic signatures must be unique');
const phase1Signatures = new Set((Array.isArray(phase1Registry) ? phase1Registry : []).map((entry) => entry.semantic_signature));
assert(!phaseEntries.some((entry) => phase1Signatures.has(entry.semantic_signature)), 'Phase 2 semantic signatures must not overlap Phase 1 registry');
const bannedIpPattern = /minecraft|roblox|gta(?: vi)?|counter[- ]strike|cs2|fortnite|pokemon|disney|hasbro|hasbik|anime franchise|real person/i;
assert(!phaseEntries.some((entry) => bannedIpPattern.test(`${entry.title} ${entry.description} ${entry.generation_prompt}`)), 'Phase 2 metadata/prompts must not name protected IP or real people');
assert(phase.collections.length === 8, `expected 8 Phase 2 collections, got ${phase.collections.length}`);
assert(phase.collections.reduce((total, collection) => total + collection.albums.length, 0) === 16, 'Phase 2 must define 16 albums');
assert(phaseEntries.every((entry) => ['planned', 'generated'].includes(entry.generation_status)), 'Phase 2 entries have an invalid generation status');
assert(phaseEntries.every((entry) => ['pending', 'PASS', 'REGENERATE', 'REJECT'].includes(entry.qa_status)), 'Phase 2 entries have an invalid QA status');
assert(phaseEntries.every((entry) => entry.primary_palette && entry.lighting_concept), 'every Phase 2 entry must define palette and lighting');
assert(phaseEntries.every((entry) => entry.generation_prompt.startsWith('a finished, full-color, premium digital illustration for the Splint coloring app')), 'every Phase 2 prompt must start with the full-color Splint asset direction');
assert(phaseEntries.every((entry) => entry.generation_prompt.includes('full-bleed background') && entry.generation_prompt.includes('no external border or frame')), 'every Phase 2 prompt must require full-bleed output without a frame');
assert(phaseEntries.every((entry) => entry.source_asset && entry.optimized_asset && entry.preview_asset), 'every Phase 2 entry must define all asset paths');
assert(phaseEntries.filter((entry) => entry.qa_status === 'PASS').every((entry) => (
  entry.generation_status === 'generated'
  && entry.source_asset
  && entry.optimized_asset
  && entry.preview_asset
)), 'every accepted Phase 2 entry must be generated and technically integrated');
const obsoletePixelGate = /REJECT_PIXEL_NOISE|REJECT_MICRO_DETAIL|REJECT_WEAK_PIXEL_SILHOUETTE|REJECT_COLOR_MUD|REJECT_TOO_MANY_SMALL_OBJECTS|REJECT_PIXELIZED_SUBJECT_LOSS|REJECT_BACKGROUND_TOO_BUSY/;
assert(!phaseEntries.some((entry) => obsoletePixelGate.test(JSON.stringify(entry))), 'obsolete per-image pixel rejection gates must not remain in the Phase 2 manifest');
assert(countBy(phaseEntries, 'access').free === 12 && countBy(phaseEntries, 'access').premium === 143, 'Phase 2 access distribution must be 12 FREE / 143 PREMIUM');
assert(merged.length === 320, `merged catalog plan must contain 320 entries, got ${merged.length}`);
assert(countBy(merged, 'access').free === 172 && countBy(merged, 'access').premium === 148, 'merged access distribution must be 172 FREE / 148 PREMIUM');
assert(countBy(merged, 'orientation').portrait === 220 && countBy(merged, 'orientation').square === 70 && countBy(merged, 'orientation').landscape === 30, 'merged orientation distribution mismatch');
assert(countBy(merged, 'difficulty').simple === 96 && countBy(merged, 'difficulty').medium === 128 && countBy(merged, 'difficulty').detailed === 96, 'merged difficulty distribution mismatch');
assert(unique(merged.map((entry) => entry.id)) === merged.length, 'merged catalog IDs must be unique');
assert(Object.values(mergedCollectionCounts).every((total) => total === 20), 'every final collection must contain 20 works');
assert(Object.values(mergedAlbumCounts).every((total) => total === 10), 'every final album must contain 10 works');
assert(phase.cover_plan.final_covers === 48, 'final cover target must remain 48');
assert(phase.cover_plan.new_phase2_covers === 21, 'Phase 2 must plan 21 new covers');
assert(phase.cover_plan.entries.length === 21, 'Phase 2 cover plan must contain 21 entries');
assert(unique(phaseCoverIds) === phaseCoverIds.length, 'Phase 2 cover IDs must be unique');
assert(unique(baseCoverIds) === baseCoverIds.length, 'final cover IDs must be unique');
assert(phaseCoverIds.every((id) => baseCoverIds.includes(id)), 'promoted Phase 2 cover IDs must be present in the final cover manifest');
assert(phase.cover_plan.entries.every((cover) => ['planned', 'generated'].includes(cover.generation_status) && ['pending', 'PASS', 'REGENERATE'].includes(cover.qa_status)), 'Phase 2 covers have an invalid generation or QA status');
assert(phase.cover_plan.entries.every((cover) => cover.primary_palette && cover.lighting_concept && cover.generation_prompt.startsWith('a finished, full-color, premium digital illustration for the Splint coloring app')), 'every Phase 2 cover must define full-color metadata and prompt');
const coverPass = base.covers.filter((cover) => cover.qa_status === 'PASS');
assert(base.covers.length === phase.cover_plan.final_covers, `final cover count must be ${phase.cover_plan.final_covers}, got ${base.covers.length}`);
assert(coverPass.length === base.covers.length, `all final covers must be technically accepted, got ${coverPass.length}/${base.covers.length}`);
for (const cover of coverPass) {
  for (const assetPath of [cover.source_asset, cover.optimized_asset]) {
    try { await access(resolve(root, assetPath)); } catch { failures.push(`accepted cover asset is missing: ${cover.id} -> ${assetPath}`); }
  }
}

const dimensionByOrientation = {
  portrait: [1600, 2000],
  square: [1600, 1600],
  landscape: [2000, 1500],
};
for (const entry of phaseEntries) {
  const expected = dimensionByOrientation[entry.orientation];
  assert(expected && entry.width === expected[0] && entry.height === expected[1], `invalid master dimensions for ${entry.id}`);
}

const result = {
  ok: failures.length === 0,
  failures,
  phase1_pass: phase1Pass.length,
  phase2_generated: phaseGenerated,
  phase2_pass: phasePass,
  phase2_planned: phaseEntries.length,
  merged_planned_catalog: merged.length,
  access: countBy(merged, 'access'),
  orientation: countBy(merged, 'orientation'),
  difficulty: countBy(merged, 'difficulty'),
  collections: unique(merged.map((entry) => entry.collection_id)),
  albums: unique(merged.map((entry) => entry.album_id)),
  phase2_covers: phase.cover_plan.entries.length,
  final_cover_target: phase.cover_plan.final_covers,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
