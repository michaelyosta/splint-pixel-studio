import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function normalizeInventoryFile(file) {
  return String(file)
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^e2e\//, '');
}

export function logicalTestId({ file, title }) {
  // Source line numbers are provenance only: harmless edits can move a test
  // without changing the test identity or its shard allocation.
  return `${normalizeInventoryFile(file)}:${String(title)}`;
}

export function projectCaseId(row) {
  return `${logicalTestId(row)}|${String(row.project)}`;
}

export function inventoryFingerprint(rows) {
  const canonicalRows = rows
    .map((row) => projectCaseId(row))
    .sort();
  return createHash('sha256').update(canonicalRows.join('\n')).digest('hex');
}

export function parsePlaywrightList(output) {
  const rows = [];
  const unparsedTestLines = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*\[(.+?)\]\s+›\s+(.+?)\s+›\s+(.+)$/);
    if (!match) continue;
    const location = match[2].match(/^(.*?\.spec\.js):(\d+):\d+$/);
    if (!location) {
      unparsedTestLines.push(line.trim());
      continue;
    }
    const titlePath = match[3].split(/\s+›\s+/);
    const title = titlePath.at(-1)?.trim();
    if (!title) {
      unparsedTestLines.push(line.trim());
      continue;
    }
    rows.push({
      project: match[1],
      file: normalizeInventoryFile(location[1]),
      line: Number(location[2]),
      title,
    });
  }
  const totalMatch = String(output).match(/Total:\s+(\d+)\s+tests?/);
  return {
    rows,
    reportedTotal: totalMatch ? Number(totalMatch[1]) : null,
    unparsedTestLines,
  };
}

export function manifestInventory(manifest) {
  return (manifest.groups || []).flatMap((group) => (group.projects || []).map((project) => ({
    project,
    file: group.file,
    line: group.line,
    title: group.title,
  })));
}

function countBy(rows, keyFactory) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFactory(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function compareInventories(currentRows, manifest) {
  const manifestRows = manifestInventory(manifest);
  const currentCases = countBy(currentRows, projectCaseId);
  const manifestCases = countBy(manifestRows, projectCaseId);
  const currentLogical = countBy(currentRows, logicalTestId);
  const manifestLogical = countBy(manifestRows, logicalTestId);
  const missingFromManifest = [...currentCases.keys()].filter((key) => !manifestCases.has(key)).sort();
  const staleManifestEntries = [...manifestCases.keys()].filter((key) => !currentCases.has(key)).sort();
  const duplicateAssignments = [...manifestCases.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
  const duplicateCurrentCases = [...currentCases.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
  const logicalMissing = [...currentLogical.keys()].filter((key) => !manifestLogical.has(key)).sort();
  const logicalStale = [...manifestLogical.keys()].filter((key) => !currentLogical.has(key)).sort();
  const projectApplicabilityMismatches = [...new Set([...currentLogical.keys(), ...manifestLogical.keys()])]
    .sort()
    .filter((key) => {
      const currentProjects = currentRows.filter((row) => logicalTestId(row) === key).map((row) => row.project).sort();
      const manifestProjects = manifestRows.filter((row) => logicalTestId(row) === key).map((row) => row.project).sort();
      return JSON.stringify(currentProjects) !== JSON.stringify(manifestProjects);
    });
  const expectedFingerprint = manifest.coverage?.inventory_fingerprint || null;
  const actualFingerprint = inventoryFingerprint(currentRows);
  const manifestFingerprint = inventoryFingerprint(manifestRows);
  return {
    current_logical_tests: currentLogical.size,
    manifest_logical_tests: manifestLogical.size,
    current_project_cases: currentRows.length,
    manifest_project_cases: manifestRows.length,
    missing_from_manifest: missingFromManifest,
    stale_manifest_entries: staleManifestEntries,
    duplicate_assignments: duplicateAssignments,
    duplicate_current_cases: duplicateCurrentCases,
    logical_missing: logicalMissing,
    logical_stale: logicalStale,
    project_applicability_mismatches: projectApplicabilityMismatches,
    expected_fingerprint: expectedFingerprint,
    actual_fingerprint: actualFingerprint,
    manifest_fingerprint: manifestFingerprint,
    ok: missingFromManifest.length === 0
      && staleManifestEntries.length === 0
      && duplicateAssignments.length === 0
      && duplicateCurrentCases.length === 0
      && logicalMissing.length === 0
      && logicalStale.length === 0
      && projectApplicabilityMismatches.length === 0
      && expectedFingerprint === actualFingerprint
      && manifestFingerprint === actualFingerprint,
  };
}

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
