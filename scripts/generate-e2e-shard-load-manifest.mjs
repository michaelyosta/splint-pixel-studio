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

const groups = [...groupMap.values()].sort((a, b) => b.historical_duration_ms - a.historical_duration_ms || a.id.localeCompare(b.id));
const shards = Array.from({ length: 16 }, (_, index) => ({
  shard: index + 1,
  historical_duration_ms: 0,
  logical_tests: 0,
  project_cases: 0,
  groups: [],
}));
for (const group of groups) {
  const shard = shards.toSorted((a, b) => a.historical_duration_ms - b.historical_duration_ms || a.shard - b.shard)[0];
  shard.historical_duration_ms += group.historical_duration_ms;
  shard.logical_tests += 1;
  shard.project_cases += group.project_cases;
  shard.groups.push(group.id);
  group.shard = shard.shard;
}

const round = (value) => Math.round(value * 100) / 100;
const manifest = {
  schema_version: 1,
  manifest_type: 'e2e-duration-load',
  source_sha: sourceSha,
  source_run_id: sourceRunId,
  generated_at: new Date().toISOString(),
  authoritative_runtime: { node: '22.23.2', npm: '10.9.8', playwright: '1.61.1' },
  selected_topology: {
    shards: 16,
    strategy: 'weighted_16',
    selector: 'file arguments plus escaped test-title grep alternatives',
    expected_logical_tests: groups.length,
    expected_project_cases: rows.length,
  },
  coverage: {
    projects: ['chromium', 'Mobile iPhone', 'Mobile Pixel'],
    expected_logical_tests: groups.length,
    expected_project_cases: rows.length,
  },
  measurement_note: 'Historical Playwright JSON contains test durations but not per-test HTTP request counts. Final shards collect server /metrics into server-metrics.json; unavailable historical request fields remain null.',
  topology_comparison: {
    builtin_16: { shards: 16, strategy: 'playwright --shard=N/16', total_project_cases: 438, empty_shards: 0, projected_slowest_duration_ms: 1354083, projected_slowest_duration_minutes: 22.57 },
    builtin_24: { shards: 24, strategy: 'playwright --shard=N/24', total_project_cases: 438, empty_shards: 3, projected_slowest_duration_ms: 1190064, projected_slowest_duration_minutes: 19.83 },
    builtin_32: { shards: 32, strategy: 'playwright --shard=N/32', total_project_cases: 438, empty_shards: 4, projected_slowest_duration_ms: 1052217, projected_slowest_duration_minutes: 17.54 },
    weighted_16: {
      shards: 16,
      strategy: 'deterministic greedy bin-pack of logical test groups using historical duration',
      total_project_cases: 438,
      empty_shards: 0,
      projected_slowest_duration_ms: Math.max(...shards.map((shard) => shard.historical_duration_ms)),
      projected_slowest_duration_minutes: round(Math.max(...shards.map((shard) => shard.historical_duration_ms)) / 60000),
    },
  },
  shards: shards.map((shard) => ({
    ...shard,
    historical_duration_minutes: round(shard.historical_duration_ms / 60000),
    request_count: null,
    tile_request_count: null,
    p95_api_latency_ms: null,
    max_api_latency_ms: null,
  })),
  groups,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, source_sha: sourceSha, logical_tests: groups.length, project_cases: rows.length }));
