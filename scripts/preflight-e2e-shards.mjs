import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  buildManifestPlaywrightArgs,
  buildShardPlan,
  compareInventories,
  loadShardManifest,
  parsePlaywrightList,
} from './e2e-shard-plan.mjs';

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const projectRoot = resolve(import.meta.dirname, '..');
const manifestPath = argument('--manifest', 'docs/E2E_SHARD_LOAD_MANIFEST.json');
const { path, value: manifest } = loadShardManifest(projectRoot, manifestPath);
const shardCount = Number(argument('--shards', manifest.selected_topology?.shards));
const cli = resolve(projectRoot, 'node_modules/@playwright/test/cli.js');
const allGroups = manifest.groups || [];
const assigned = new Map();

function listCurrentSuite() {
  const result = spawnSync(process.execPath, [cli, 'test', '--list'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '' },
    windowsHide: true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Current Playwright inventory failed:\n${output}`);
  const inventory = parsePlaywrightList(output);
  if (inventory.unparsedTestLines.length) {
    throw new Error(`Current Playwright inventory contains unparsed test rows:\n${inventory.unparsedTestLines.join('\n')}`);
  }
  if (inventory.reportedTotal !== inventory.rows.length) {
    throw new Error(`Current Playwright inventory parsed ${inventory.rows.length} rows, but --list reported ${inventory.reportedTotal ?? 'unknown'}`);
  }
  return inventory;
}

const currentInventory = listCurrentSuite();
const inventoryComparison = compareInventories(currentInventory.rows, manifest);
if (!inventoryComparison.ok) {
  throw new Error(`Current Playwright inventory does not match shard manifest:\n${JSON.stringify(inventoryComparison, null, 2)}`);
}

if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error(`Invalid shard count: ${shardCount}`);
for (const group of allGroups) {
  if (assigned.has(group.id)) throw new Error(`Duplicate logical test in manifest: ${group.id}`);
  if (!Number.isInteger(Number(group.shard)) || Number(group.shard) < 1 || Number(group.shard) > shardCount) {
    throw new Error(`Invalid shard assignment for ${group.id}: ${group.shard}`);
  }
  assigned.set(group.id, group.shard);
}

const shardReports = [];
for (let shardIndex = 1; shardIndex <= shardCount; shardIndex += 1) {
  const plan = buildShardPlan(manifest, shardIndex, shardCount);
  const result = spawnSync(process.execPath, [cli, 'test', '--list', ...buildManifestPlaywrightArgs(plan)], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '' },
    windowsHide: true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Shard ${shardIndex}/${shardCount} list failed:\n${output}`);
  const totalMatch = output.match(/Total:\s+(\d+)\s+tests?/);
  const listedProjectCases = totalMatch ? Number(totalMatch[1]) : null;
  if (listedProjectCases !== plan.expectedProjectCases) {
    throw new Error(`Shard ${shardIndex}/${shardCount} expected ${plan.expectedProjectCases} project cases, listed ${listedProjectCases}`);
  }
  shardReports.push({
    shard: shardIndex,
    logical_tests: plan.expectedLogicalTests,
    project_cases: listedProjectCases,
    historical_duration_ms: plan.historicalDurationMs,
  });
}

const listedTotal = shardReports.reduce((total, report) => total + report.project_cases, 0);
const expectedTotal = Number(manifest.coverage?.expected_project_cases);
if (listedTotal !== expectedTotal) throw new Error(`Shard coverage total ${listedTotal} does not equal manifest total ${expectedTotal}`);

console.log(JSON.stringify({
  manifest: manifestPath,
  resolved_manifest: path,
  status: 'PASS',
  shard_count: shardCount,
  logical_tests: inventoryComparison.current_logical_tests,
  project_cases: listedTotal,
  inventory_fingerprint: inventoryComparison.actual_fingerprint,
  missing_from_manifest: inventoryComparison.missing_from_manifest,
  stale_manifest_entries: inventoryComparison.stale_manifest_entries,
  duplicate_assignments: inventoryComparison.duplicate_assignments,
  unmatched_assignments: inventoryComparison.missing_from_manifest.length + inventoryComparison.stale_manifest_entries.length,
  unmatched_selectors: inventoryComparison.project_applicability_mismatches,
  shards: shardReports,
}));
