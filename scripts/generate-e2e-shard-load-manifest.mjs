import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const projectRoot = resolve(import.meta.dirname, '..');
const inputRoot = resolve(projectRoot, argument('--input-root', 'test-results/github-33388276591'));
const outputPath = resolve(projectRoot, argument('--output', 'docs/E2E_SHARD_LOAD_MANIFEST.json'));
const sourceSha = argument('--source-sha', 'unknown');
const sourceRunId = argument('--source-run-id', 'unknown');
const durationSourceSha = argument('--duration-source-sha', sourceSha);
const durationSourceRunId = argument('--duration-source-run-id', sourceRunId);
const shardCount = Number(argument('--shards', '24'));
const minimumGroupWeightMs = Number(argument('--minimum-group-weight-ms', '30000'));

if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error(`Invalid shard count: ${shardCount}`);
if (!Number.isFinite(minimumGroupWeightMs) || minimumGroupWeightMs < 0) {
  throw new Error(`Invalid minimum group weight: ${minimumGroupWeightMs}`);
}

function findResults(directory) {
  const results = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) results.push(...findResults(path));
    else if (entry === 'results.json' && path.includes('\\shard-')) results.push(path);
  }
  return results;
}

function collectSuite(suite, rows) {
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      rows.push({
        file: suite.file,
        line: Number(spec.line),
        title: spec.title,
        project: test.projectName,
        duration: (test.results || []).reduce((total, result) => total + Number(result.duration || 0), 0),
      });
    }
  }
  for (const child of suite.suites || []) collectSuite(child, rows);
}

const rows = [];
for (const resultPath of findResults(inputRoot)) {
  const data = JSON.parse(readFileSync(resultPath, 'utf8'));
  for (const suite of data.suites || []) collectSuite(suite, rows);
}
if (!rows.length) throw new Error(`No Playwright result rows found below ${inputRoot}`);

const groupMap = new Map();
for (const row of rows) {
  const id = `${row.file}:${row.line}:${row.title}`;
  const group = groupMap.get(id) || {
    id,
    file: row.file,
    line: row.line,
    title: row.title,
    historical_duration_ms: 0,
    project_cases: 0,
    projects: [],
    flags: { heavy_tiled: false, visual: false, creator: false, lifecycle: false },
  };
  group.historical_duration_ms += row.duration;
  group.project_cases += 1;
  if (!group.projects.includes(row.project)) group.projects.push(row.project);
  const text = `${row.file} ${row.title}`.toLowerCase();
  group.flags.heavy_tiled = /1200|tiled|glyph|low-zoom|special-cells-gameplay/.test(text);
  group.flags.visual = /visual|evidence|screenshot|glyph|zone-visual/.test(text);
  group.flags.creator = /creator|p0-final/.test(text);
  group.flags.lifecycle = /reload|resume|reopen|bfcache|offline|persist/.test(text);
  groupMap.set(id, group);
}

const round = (value) => Math.round(value * 100) / 100;
const groups = [...groupMap.values()].sort((a, b) => b.historical_duration_ms - a.historical_duration_ms || a.id.localeCompare(b.id));
for (const group of groups) {
  // Some visual/evidence tests report zero duration even though they still
  // create browser/API lifecycle load. Keep those groups visible to the
  // bin-packer instead of allowing them to collapse into one long-lived runtime.
  group.load_weight_ms = Math.max(group.historical_duration_ms, minimumGroupWeightMs);
}

function packGroups(count) {
  const packed = Array.from({ length: count }, (_, index) => ({
    shard: index + 1,
    historical_duration_ms: 0,
    load_weight_ms: 0,
    logical_tests: 0,
    project_cases: 0,
    groups: [],
  }));
  for (const group of groups) {
    const shard = packed.toSorted((a, b) => a.load_weight_ms - b.load_weight_ms || a.shard - b.shard)[0];
    shard.historical_duration_ms += group.historical_duration_ms;
    shard.load_weight_ms += group.load_weight_ms;
    shard.logical_tests += 1;
    shard.project_cases += group.project_cases;
    shard.groups.push(group.id);
  }
  return packed;
}

function topologySummary(count) {
  const packed = packGroups(count);
  const projectedLoad = Math.max(...packed.map((shard) => shard.load_weight_ms));
  return {
    shards: count,
    strategy: `deterministic greedy bin-pack with ${minimumGroupWeightMs}ms minimum logical-group load`,
    total_project_cases: rows.length,
    empty_shards: packed.filter((shard) => !shard.groups.length).length,
    projected_slowest_duration_ms: projectedLoad,
    projected_slowest_duration_minutes: round(projectedLoad / 60000),
    maximum_logical_tests: Math.max(...packed.map((shard) => shard.logical_tests)),
    maximum_project_cases: Math.max(...packed.map((shard) => shard.project_cases)),
  };
}

const shards = packGroups(shardCount);
for (const group of groups) {
  group.shard = shards.find((shard) => shard.groups.includes(group.id)).shard;
}

const selectedTopology = topologySummary(shardCount);
const manifest = {
  schema_version: 2,
  manifest_type: 'e2e-duration-load',
  source_sha: sourceSha,
  source_run_id: sourceRunId,
  duration_source_sha: durationSourceSha,
  duration_source_run_id: durationSourceRunId,
  generated_at: new Date().toISOString(),
  authoritative_runtime: { node: '22.23.2', npm: '10.9.8', playwright: '1.61.1' },
  selected_topology: {
    shards: shardCount,
    strategy: `weighted_${shardCount}_minimum_${minimumGroupWeightMs}ms`,
    selector: 'file arguments plus escaped test-title grep alternatives',
    expected_logical_tests: groups.length,
    expected_project_cases: rows.length,
    minimum_group_weight_ms: minimumGroupWeightMs,
  },
  coverage: {
    projects: ['chromium', 'Mobile iPhone', 'Mobile Pixel'],
    expected_logical_tests: groups.length,
    expected_project_cases: rows.length,
  },
  measurement_note: `Historical Playwright durations from ${durationSourceRunId}; current CI shards collect server /metrics before teardown. A ${minimumGroupWeightMs}ms minimum logical-group load prevents zero-duration visual/evidence groups from collapsing into one long-lived runtime.`,
  topology_comparison: {
    builtin_16: { shards: 16, strategy: 'playwright --shard=N/16', total_project_cases: rows.length, empty_shards: 0, projected_slowest_duration_ms: 1354083, projected_slowest_duration_minutes: 22.57 },
    builtin_24: { shards: 24, strategy: 'playwright --shard=N/24', total_project_cases: rows.length, empty_shards: 3, projected_slowest_duration_ms: 1190064, projected_slowest_duration_minutes: 19.83 },
    builtin_32: { shards: 32, strategy: 'playwright --shard=N/32', total_project_cases: rows.length, empty_shards: 4, projected_slowest_duration_ms: 1052217, projected_slowest_duration_minutes: 17.54 },
    weighted_16: topologySummary(16),
    weighted_24: topologySummary(24),
    weighted_32: topologySummary(32),
    selected: selectedTopology,
  },
  shards: shards.map((shard) => ({
    ...shard,
    historical_duration_minutes: round(shard.historical_duration_ms / 60000),
    load_weight_minutes: round(shard.load_weight_ms / 60000),
    request_count: null,
    tile_request_count: null,
    p95_api_latency_ms: null,
    max_api_latency_ms: null,
  })),
  groups,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, source_sha: sourceSha, source_run_id: sourceRunId, duration_source_run_id: durationSourceRunId, shards: shardCount, minimum_group_weight_ms: minimumGroupWeightMs, logical_tests: groups.length, project_cases: rows.length }));
