import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJson = (relativePath) => readFile(resolve(root, relativePath), 'utf8').then(JSON.parse);
const countBy = (items, key) => items.reduce((counts, item) => {
  counts[item[key]] = (counts[item[key]] || 0) + 1;
  return counts;
}, {});

test('Phase 2 manifest preserves the exact catalog plan and new-ID boundary', async () => {
  const [phase, base, registry, state] = await Promise.all([
    readJson('content/phase-2-manifest.json'),
    readJson('content/catalog-manifest.json'),
    readJson('content/content-registry.json'),
    readJson('content/content-production-state.json'),
  ]);
  const phase1Pass = base.entries.filter((entry) => entry.qa_status === 'PASS' && !entry.id.startsWith('coloring_phase2_'));
  const phaseEntries = phase.entries;
  const phaseSlotById = new Map(phaseEntries.map((entry) => [entry.supersedes_planned_id, entry]));
  const merged = base.entries.map((entry) => phaseSlotById.get(entry.id) || entry);
  const baseIds = new Set(base.entries.map((entry) => entry.id));
  const phase1Signatures = new Set(registry.entries.map((entry) => entry.semantic_signature));
  const phaseIds = phaseEntries.map((entry) => entry.id);
  const collectionCounts = countBy(merged, 'collection_id');
  const albumCounts = countBy(merged, 'album_id');
  const phaseGenerated = phaseEntries.filter((entry) => entry.generation_status === 'generated').length;
  const phasePass = phaseEntries.filter((entry) => entry.qa_status === 'PASS').length;
  const nextEntryIndex = phaseEntries.findIndex((entry) => entry.qa_status !== 'PASS');
  const nextEntryId = nextEntryIndex === -1 ? null : phaseEntries[nextEntryIndex]?.id;

  assert.ok(['approved-in-progress', 'phase2-complete', 'complete'].includes(phase.status));
  assert.equal(typeof phase.progress.imagegen_jobs_paused, 'boolean');
  assert.equal(phase.progress.phase2_assets_generated, phaseGenerated);
  assert.equal(phase.progress.phase2_pass_colorings, phasePass);
  assert.equal(phase.progress.remaining_to_final_320, phaseEntries.length - phasePass);
  assert.equal(phase.progress.next_phase2_id, nextEntryId);
  assert.equal(state.phase2_progress.manifest, 'content/phase-2-manifest.json');
  assert.equal(state.phase2_progress.planned, phaseEntries.length);
  assert.equal(state.phase2_progress.generated, phaseGenerated);
  assert.equal(state.phase2_progress.qa_pass, phasePass);
  assert.equal(state.phase2_progress.next_entry_index, nextEntryIndex === -1 ? phaseEntries.length : nextEntryIndex);
  assert.equal(state.phase2_progress.next_entry_id, nextEntryId);
  assert.equal(state.phase2_progress.generation_resumed, true);
  assert.equal(phase1Pass.length, 165);
  assert.equal(phaseEntries.length, 155);
  assert.equal(base.entries.length, 320);
  assert.equal(new Set(phaseIds).size, 155);
  assert.equal(phaseEntries.filter((entry) => entry.qa_status === 'PASS' && !baseIds.has(entry.id)).length, 0);
  assert.equal(phaseEntries.filter((entry) => entry.qa_status !== 'PASS' && !baseIds.has(entry.supersedes_planned_id)).length, 0);
  assert.equal(new Set(phaseEntries.map((entry) => entry.title)).size, 155);
  assert.equal(new Set(phaseEntries.map((entry) => entry.semantic_signature)).size, 155);
  assert.equal(phaseEntries.filter((entry) => phase1Signatures.has(entry.semantic_signature)).length, 0);
  assert.equal(phaseEntries.filter((entry) => /minecraft|roblox|gta(?: vi)?|counter[- ]strike|cs2|fortnite|pokemon|disney|hasbro|hasbik|anime franchise|real person/i.test(`${entry.title} ${entry.description} ${entry.generation_prompt}`)).length, 0);
  assert.equal(phase.collections.length, 8);
  assert.equal(phase.collections.reduce((total, collection) => total + collection.albums.length, 0), 16);
  assert.equal(merged.length, 320);
  assert.deepEqual(countBy(merged, 'access'), { free: 172, premium: 148 });
  assert.deepEqual(countBy(merged, 'orientation'), { portrait: 220, square: 70, landscape: 30 });
  assert.deepEqual(countBy(merged, 'difficulty'), { simple: 96, medium: 128, detailed: 96 });
  assert.ok(Object.values(collectionCounts).every((count) => count === 20));
  assert.ok(Object.values(albumCounts).every((count) => count === 10));
  assert.ok(phaseEntries.every((entry) => ['planned', 'generated'].includes(entry.generation_status)));
  assert.ok(phaseEntries.every((entry) => ['pending', 'PASS', 'REGENERATE', 'REJECT'].includes(entry.qa_status)));
  assert.ok(phaseEntries.every((entry) => entry.primary_palette && entry.lighting_concept));
  assert.ok(phaseEntries.every((entry) => entry.generation_prompt.startsWith('a finished, full-color, premium digital illustration for the Splint coloring app')));
  assert.ok(phaseEntries.every((entry) => entry.generation_prompt.includes('no external border or frame')));
  assert.ok(phaseEntries.filter((entry) => entry.qa_status === 'PASS').every((entry) => (
    entry.generation_status === 'generated'
    && entry.source_asset
    && entry.optimized_asset
    && entry.preview_asset
  )));
  const obsoletePixelGate = /REJECT_PIXEL_NOISE|REJECT_MICRO_DETAIL|REJECT_WEAK_PIXEL_SILHOUETTE|REJECT_COLOR_MUD|REJECT_TOO_MANY_SMALL_OBJECTS|REJECT_PIXELIZED_SUBJECT_LOSS|REJECT_BACKGROUND_TOO_BUSY/;
  assert.equal(phaseEntries.filter((entry) => obsoletePixelGate.test(JSON.stringify(entry))).length, 0);
  assert.equal(phase.cover_plan.entries.length, 21);
  assert.equal(phase.cover_plan.final_covers, 48);
  assert.equal(new Set(phase.cover_plan.entries.map((cover) => cover.id)).size, 21);
  assert.equal(base.covers.length, 48);
  assert.equal(base.covers.filter((cover) => cover.qa_status === 'PASS').length, 48);
  assert.equal(phase.cover_plan.entries.filter((cover) => cover.qa_status === 'PASS').length, 21);
  assert.ok(phase.cover_plan.entries.every((cover) => base.covers.some((finalCover) => finalCover.id === cover.id)));
  for (const cover of base.covers) {
    await access(resolve(root, cover.source_asset));
    await access(resolve(root, cover.optimized_asset));
  }
});
