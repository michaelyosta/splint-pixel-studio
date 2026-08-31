import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadShardManifest(projectRoot, manifestPath) {
  const resolvedPath = resolve(projectRoot, manifestPath);
  return {
    path: resolvedPath,
    value: JSON.parse(readFileSync(resolvedPath, 'utf8')),
  };
}

function escapeRegex(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function buildShardPlan(manifest, shardIndex, shardCount) {
  const expectedShardCount = Number(manifest.selected_topology?.shards);
  if (!Number.isInteger(expectedShardCount) || expectedShardCount !== shardCount) {
    throw new Error(`Manifest expects ${expectedShardCount} shards, received ${shardCount}`);
  }
  const groups = (manifest.groups || []).filter((group) => Number(group.shard) === shardIndex);
  if (!groups.length) throw new Error(`Manifest shard ${shardIndex}/${shardCount} has no assigned logical tests`);

  const files = [...new Set(groups.map((group) => `e2e/${group.file}`))].sort();
  const titles = [...new Set(groups.map((group) => group.title))].sort();
  // Playwright's grep input is matched against its normalized title path,
  // not the pretty ` › ` rendering emitted by --list. File arguments keep
  // same-title cases in their owning spec; the preflight proves the exact
  // project-case count for every generated shard.
  const grep = `(?:${titles.map(escapeRegex).join('|')})`;

  return {
    shardIndex,
    shardCount,
    groups,
    files,
    grep,
    expectedLogicalTests: groups.length,
    expectedProjectCases: groups.reduce((total, group) => total + Number(group.project_cases || 0), 0),
    historicalDurationMs: groups.reduce((total, group) => total + Number(group.historical_duration_ms || 0), 0),
  };
}

export function buildManifestPlaywrightArgs(plan) {
  return [...plan.files, `--grep=${plan.grep}`];
}
