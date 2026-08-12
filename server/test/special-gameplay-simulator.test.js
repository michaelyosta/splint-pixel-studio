import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import { chooseActionableWindow } from '../services/tiled-guidance.js';
import {
  HAZARD_KIND,
  SPECIAL_EVENT_MAX_CELLS,
  capSpecialsPerTile,
  SPARK_DENSITY_CELLS,
  SPARK_PITY_INTERVAL_CELLS,
  SPARK_TARGET_MAX_CELLS,
  generateSparkCells,
  generateSpecialCells,
  specialDensityForGrid,
} from '../services/tiled-specials.js';
import {
  DEFAULT_SEED_COUNT,
  DEFAULT_SIZES,
  assignEventKinds,
  buildSyntheticTemplate,
  chooseActionableWindowFast,
  digestSweepReport,
  generateParameterizedSparkCells,
  percentileSummary,
  percentileWithAverage,
  resolveEventKindMix,
  runBalanceSweep,
  runCadenceSweep,
  runEventMixSweep,
  runBaseline,
  simulateSpecialGameplay,
} from '../scripts/special-gameplay-simulator.mjs';

function serverCwd() {
  return basename(process.cwd()).toLowerCase() === 'server'
    ? process.cwd()
    : join(process.cwd(), 'server');
}

test('baseline simulator is deterministic for the same seed', () => {
  const first = simulateSpecialGameplay({ width: 160, height: 160, seed: 'baseline-seed-1' });
  const second = simulateSpecialGameplay({ width: 160, height: 160, seed: 'baseline-seed-1' });
  first.route.elapsed_ms = 0;
  second.route.elapsed_ms = 0;
  assert.deepEqual(first, second);
});

test('Spark-only baseline keeps density/pity and models the complete Smart target cap', () => {
  const run = simulateSpecialGameplay({ width: 500, height: 500, seed: 'baseline-seed-1' });
  assert.deepEqual(run.model.gameplay_types, ['spark']);
  assert.equal(run.model.spark_density_cells, SPARK_DENSITY_CELLS);
  assert.equal(run.model.spark_pity_interval_cells, SPARK_PITY_INTERVAL_CELLS);
  assert.equal(run.model.spark_derived_changes_cap, SPARK_TARGET_MAX_CELLS);
  assert.equal(run.placement.spark_count, Math.ceil(250_000 / SPARK_DENSITY_CELLS));
  assert.equal(run.route.completed_cells, run.template.total_cells);
  assert.equal(run.route.truncated, false);
  assert.ok(run.route.spark_events <= run.placement.spark_count);
  assert.ok(run.route.assisted_cells <= run.route.spark_events * SPARK_TARGET_MAX_CELLS);
  for (const event of run.route.events) {
    assert.ok(event.assisted_cells <= SPARK_TARGET_MAX_CELLS);
  }
  assert.equal(run.route.gaps_cells.length, run.route.spark_events - 1);
  assert.equal(run.route.gaps_targets.length, run.route.spark_events - 1);
  assert.equal(
    run.route.total_smart_targets,
    run.route.regular_targets + run.route.spark_plans + run.route.no_op_plans,
  );
  assert.ok(run.route.missed_sparks >= 0);
});

test('smart route reaches the guaranteed early Spark on the first plan', () => {
  const run = simulateSpecialGameplay({ width: 160, height: 160, seed: 'baseline-seed-2' });
  assert.equal(run.route.smart_targets_to_first_spark, 1);
  assert.equal(run.route.non_spark_targets_to_first_spark, 0);
  assert.equal(run.route.spark_plans, 1);
  assert.equal(run.route.events[0].discovered_by_pity, true);
});

test('control cohort keeps Spark-only gameplay inert', () => {
  const run = simulateSpecialGameplay({
    width: 160,
    height: 160,
    seed: 'baseline-seed-2',
    sparkTreatment: false,
  });
  assert.equal(run.route.spark_plans, 0);
  assert.equal(run.route.spark_events, 0);
  assert.equal(run.route.assisted_cells, 0);
  assert.equal(run.route.completed_cells, run.template.total_cells);
});

test('maxPlans bounds runtime and marks truncated runs', () => {
  const run = simulateSpecialGameplay({ width: 500, height: 500, seed: 'baseline-seed-1', maxPlans: 5 });
  assert.equal(run.route.total_smart_targets, 5);
  assert.equal(run.route.truncated, true);
  assert.ok(run.route.completed_cells < run.template.total_cells);
});

test('fast window scoring matches production chooseActionableWindow', () => {
  const width = 32;
  const height = 32;
  const cells = [];
  const filled = [];
  for (let index = 0; index < width * height; index += 1) {
    cells.push(index % 5);
    filled.push(index % 3 === 0 ? 1 : -1);
  }
  const offsetX = 64;
  const offsetY = 96;
  for (const colorIndex of [0, 1, 4]) {
    const options = {
      cells,
      filled,
      width,
      height,
      colorIndex,
      offsetX,
      offsetY,
      cameraCenterX: 90,
      cameraCenterY: 110,
    };
    assert.deepEqual(
      chooseActionableWindowFast(options),
      chooseActionableWindow(options),
    );
  }
});

test('synthetic artwork is deterministic and uses the full palette', () => {
  const first = buildSyntheticTemplate({ width: 64, height: 64 });
  const second = buildSyntheticTemplate({ width: 64, height: 64 });
  assert.deepEqual(first, second);
  assert.equal(first.template.palette.length, 8);
  const colors = new Set();
  for (const tile of first.tiles) {
    for (const color of tile.cells) colors.add(color);
  }
  assert.equal(colors.size, 8);
});

test('baseline aggregates gap percentiles across seeds per size', () => {
  const baseline = runBaseline({ sizes: [160], seeds: ['a', 'b'], maxPlans: 10_000 });
  const summary = baseline.aggregate.per_size['160'];
  assert.equal(summary.runs, 2);
  const expectedGaps = baseline.runs
    .flatMap((run) => run.route.gaps_cells)
    .sort((first, second) => first - second);
  assert.equal(summary.gaps_cells.count, expectedGaps.length);
  assert.ok(summary.gaps_cells.p50 != null);
  assert.ok(summary.gaps_cells.p90 != null);
  assert.ok(summary.gaps_cells.p95 != null);
  assert.ok(summary.gaps_cells.max >= summary.gaps_cells.p50);
  assert.equal(summary.gaps_cells.max, expectedGaps[expectedGaps.length - 1]);
  assert.ok(summary.smart_targets_to_first_event.avg >= 1);
  assert.ok(summary.events_per_target > 0);
  assert.ok(summary.type_distribution.spark != null);
  assert.ok(summary.type_streak_avg.avg >= 1);
  assert.ok(summary.assisted_progress.count > 0);
  assert.ok(summary.nearest_neighbor.p50 != null);
  assert.ok(summary.cluster_size.count > 0);
  assert.equal(summary.trap_rate, 0);
  assert.equal(summary.rare_rate, 0);
});

test('percentile summaries expose p50/p90/p95 and worst values', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const summary = percentileSummary(values, [50, 90, 95]);
  assert.equal(summary.count, 10);
  assert.equal(summary.min, 1);
  assert.equal(summary.p50, 5);
  assert.equal(summary.p90, 9);
  assert.equal(summary.p95, 10);
  assert.equal(summary.max, 10);
  const averaged = percentileWithAverage(values, [50, 90, 95]);
  assert.equal(averaged.avg, 5.5);
  assert.equal(averaged.p95, 10);
});

test('event mix route reports first event, events/target, type distribution, streaks, assisted progress, and spatial clustering', () => {
  const run = simulateSpecialGameplay({
    width: 160,
    height: 160,
    seed: 'baseline-seed-1',
    eventMix: true,
    maxPlans: 5000,
  });
  assert.ok(run.route.spark_events > 0);
  assert.equal(run.route.smart_targets_to_first_event, run.route.events[0].plan_index);
  assert.ok(run.route.first_event_kind != null);
  assert.equal(run.route.non_spark_targets_to_first_event, 0);
  assert.equal(run.route.events_per_target, run.route.spark_events / run.route.total_smart_targets);
  assert.equal(
    run.route.events_per_regular_target,
    run.route.spark_events / run.route.regular_targets,
  );
  assert.ok(Object.keys(run.route.type_distribution).length > 1);
  assert.ok(Math.abs(Object.values(run.route.type_distribution)
    .reduce((sum, share) => sum + share, 0) - 1) < 1e-9);
  assert.deepEqual(
    Object.keys(run.route.first_event_by_kind).sort(),
    Object.keys(run.route.events_by_kind).sort(),
  );
  assert.ok(run.route.type_streak.avg >= 1);
  assert.ok(run.route.type_streak.p95 >= 1);
  assert.ok(run.route.type_streak.p95 <= run.route.type_streak.max);
  assert.ok(run.route.assisted_progress.count === run.route.spark_events);
  assert.ok(run.route.assisted_progress.avg >= 0);
  assert.ok(run.placement.nearest_neighbor_distance.p95 != null);
  assert.ok(run.placement.nearest_neighbor_distance.distances.length === run.route.spark_count - 1);
  assert.ok(run.placement.clusters.p95_size != null);
  assert.ok(run.route.trap_rate > 0);
  assert.ok(run.route.rare_rate > 0);
});

test('default coverage includes multiple seeds and 160/500/1200 sizes', () => {
  assert.deepEqual([...DEFAULT_SIZES], [160, 500, 1200]);
  assert.equal(DEFAULT_SEED_COUNT, 5);
  const report = runBaseline({
    sizes: [160, 500, 1200],
    seeds: ['a', 'b'],
    maxPlans: 100,
  });
  assert.deepEqual(
    Object.keys(report.aggregate.per_size).map(Number).sort((first, second) => first - second),
    [160, 500, 1200],
  );
  for (const size of [160, 500, 1200]) {
    const row = report.aggregate.per_size[String(size)];
    assert.equal(row.runs, 2);
    assert.ok(row.smart_targets_to_first_event.avg >= 1);
    assert.deepEqual(row.first_event_kinds, { spark: 2 });
    assert.ok(row.nearest_neighbor.count > 0);
    assert.ok(row.cluster_size.count > 0);
  }
});

test('event mix sweep aggregates expose first event, events/target, type distribution, and assisted progress', () => {
  const sweep = runEventMixSweep({
    sizes: [160],
    seeds: ['a'],
    densities: [250, 400],
    maxPlans: 5000,
  });
  const row = sweep.per_density['250'].per_size['160'];
  assert.ok(row.smart_targets_to_first_event.avg >= 1);
  assert.ok(row.events_per_target > 0);
  assert.ok(row.type_distribution.fuse > 0);
  assert.ok(row.assisted_progress.p50 != null);
  assert.ok(row.nearest_neighbor.p50 != null);
  assert.ok(row.type_streak_avg.avg >= 1);
});

test('kind adapter follows production and never silently omits hazard', () => {
  const production = resolveEventKindMix({ includeHazard: false });
  assert.equal(production.source, 'production');
  assert.deepEqual(production.active_kinds, ['spark', 'bomb', 'fuse', 'choice', 'artifact']);
  assert.equal(production.production.hazard_registered, true);
  assert.equal(production.production.hazard_in_active_kinds, true);
  assert.equal(production.production.hazard_in_pattern, false);
  assert.equal(production.production.hazard_actions_supported, true);
  assert.equal(production.hazard.kind, HAZARD_KIND);
  assert.equal(production.hazard.included, false);
  assert.equal(production.hazard.omitted, true);
  assert.ok(production.hazard.reason.includes('disabled'));
});

test('hazard opt-in uses the production kind adapter and disjoint placer', () => {
  const adapter = resolveEventKindMix({ includeHazard: true });
  assert.equal(adapter.source, 'production');
  assert.ok(adapter.active_kinds.includes(HAZARD_KIND));
  assert.equal(adapter.pattern.includes(HAZARD_KIND), false);
  assert.equal(adapter.hazard.included, true);
  assert.equal(adapter.hazard.omitted, false);
  assert.equal(adapter.production.hazard_in_pattern, false);
  assert.ok(adapter.hazard.reason.includes('production'));
});

test('hazard opt-in mix is deterministic and reports hazard events with no assisted paint', () => {
  const options = {
    width: 160,
    height: 160,
    seed: 'baseline-seed-1',
    eventMix: true,
    includeHazard: true,
    maxPlans: 5000,
  };
  const first = simulateSpecialGameplay(options);
  const second = simulateSpecialGameplay(options);
  first.route.elapsed_ms = 0;
  second.route.elapsed_ms = 0;
  assert.deepEqual(first, second);
  assert.ok(first.model.gameplay_types.includes(HAZARD_KIND));
  assert.equal(first.model.kind_adapter.source, 'production');
  assert.equal(first.model.kind_adapter.hazard.included, true);
  assert.ok(first.route.events_by_kind.hazard > 0);
  assert.ok(first.route.type_distribution.hazard > 0);
  assert.equal(first.route.assisted_per_event_by_kind.hazard.avg, 0);
  assert.equal(first.route.assisted_cells_by_kind.hazard, 0);
});

test('hazard pattern and both modes quantify pattern hazards without assisted paint', () => {
  const patternAdapter = resolveEventKindMix({ includeHazard: true, hazardMode: 'pattern' });
  assert.equal(patternAdapter.source, 'simulator-pattern-fixture');
  assert.equal(patternAdapter.hazard.mode, 'pattern');
  assert.ok(patternAdapter.pattern.includes(HAZARD_KIND));
  const patternRun = simulateSpecialGameplay({
    width: 160,
    height: 160,
    seed: 'baseline-seed-1',
    eventMix: true,
    includeHazard: true,
    hazardMode: 'pattern',
    maxPlans: 5000,
  });
  assert.ok(patternRun.route.events_by_kind.hazard > 0);
  assert.equal(patternRun.route.assisted_per_event_by_kind.hazard.avg, 0);
  const bothRun = simulateSpecialGameplay({
    width: 160,
    height: 160,
    seed: 'baseline-seed-1',
    eventMix: true,
    includeHazard: true,
    hazardMode: 'both',
    maxPlans: 5000,
  });
  assert.equal(
    bothRun.placement.kind_counts.hazard,
    patternRun.placement.kind_counts.hazard + 1,
  );
  assert.equal(bothRun.route.assisted_per_event_by_kind.hazard.avg, 0);
});

test('balance sweep returns deterministic 160/500/1200 multi-seed hazard-aware aggregate', () => {
  const options = {
    sizes: [160, 500, 1200],
    seeds: ['a', 'b'],
    densities: [250, 400],
    maxPlans: 500,
  };
  const first = runBalanceSweep(options);
  const second = runBalanceSweep(options);
  assert.equal(digestSweepReport(first), digestSweepReport(second));
  assert.equal(first.balance, true);
  assert.equal(first.event_mix, true);
  assert.deepEqual(
    Object.keys(first.per_density['250'].per_size).map(Number).sort((a, b) => a - b),
    [160, 500, 1200],
  );
  assert.equal(first.per_density['250'].per_size['160'].runs, 2);
  assert.ok(first.per_density['250'].per_size['160'].events_by_kind.hazard.avg > 0);
  assert.ok(first.per_density['250'].per_size['160'].type_distribution.hazard > 0);
  assert.ok(first.per_density['250'].per_size['160'].assisted_progress.p95 != null);
  assert.ok(first.per_density['250'].per_size['160'].nearest_neighbor.p95 != null);
});

test('1200x1200 baseline run stays bounded', () => {
  const run = simulateSpecialGameplay({
    width: 1200,
    height: 1200,
    seed: 'baseline-seed-1',
    maxPlans: 500,
  });
  assert.equal(run.route.total_smart_targets, 500);
  assert.equal(run.route.truncated, true);
});

test('CLI produces a reproducible JSON baseline report', (t) => {
  const cwd = serverCwd();
  const out = join(cwd, '.test-tmp', `cli-smoke-${process.pid}.json`);
  t.after(() => rmSync(out, { force: true }));
  const stdout = execFileSync(process.execPath, [
    join(cwd, 'scripts', 'diagnose-special-gameplay.mjs'),
    '--sizes', '160',
    '--seeds', '1',
    '--max-plans', '10_000',
    '--out', out,
    '--json',
  ], { encoding: 'utf8', timeout: 60_000 });
  const report = JSON.parse(stdout);
  assert.equal(report.model.route_model, 'baseline-v1');
  assert.equal(report.aggregate.per_size['160'].runs, 1);
  assert.ok(report.report_digest);
  assert.ok(report.model.approximation.includes('Approximation'));
});

test('CLI cadence sweep is reproducible with --sweep and --densities', (t) => {
  const cwd = serverCwd();
  const out = join(cwd, '.test-tmp', `cli-sweep-${process.pid}.json`);
  t.after(() => rmSync(out, { force: true }));
  const stdout = execFileSync(process.execPath, [
    join(cwd, 'scripts', 'diagnose-special-gameplay.mjs'),
    '--sweep',
    '--densities', '250,400',
    '--sizes', '160',
    '--seeds', '1',
    '--max-plans', '5000',
    '--out', out,
    '--json',
  ], { encoding: 'utf8', timeout: 60_000 });
  const report = JSON.parse(stdout);
  assert.equal(report.sweep, true);
  assert.deepEqual(report.densities, [250, 400]);
  assert.deepEqual(report.sizes, [160]);
  assert.equal(report.per_density['250'].per_size['160'].runs, 1);
  assert.ok(report.report_digest);
});

test('CLI balance sweep reports production hazard generation explicitly', (t) => {
  const cwd = serverCwd();
  const out = join(cwd, '.test-tmp', `cli-balance-${process.pid}.json`);
  t.after(() => rmSync(out, { force: true }));
  const stdout = execFileSync(process.execPath, [
    join(cwd, 'scripts', 'diagnose-special-gameplay.mjs'),
    '--balance',
    '--densities', '250,400',
    '--sizes', '160',
    '--seeds', '1',
    '--max-plans', '2000',
    '--out', out,
    '--json',
  ], { encoding: 'utf8', timeout: 60_000 });
  const report = JSON.parse(stdout);
  assert.equal(report.balance, true);
  assert.equal(report.event_mix, true);
  assert.equal(report.model.kind_adapter.source, 'production');
  assert.equal(report.model.kind_adapter.hazard.included, true);
  assert.ok(report.per_density['250'].per_size['160'].events_by_kind.hazard.avg > 0);
  assert.ok(report.report_digest);
});

test('event mix kind assignment matches the production multi-kind contract', () => {
  const artwork = buildSyntheticTemplate({ width: 160, height: 160 });
  const options = {
    templateId: artwork.template.id,
    seed: 'mix-seed',
    width: 160,
    height: 160,
    tileSize: 32,
    tiles: artwork.tiles,
  };
  const generated = generateSparkCells({
    ...options,
    densityCells: specialDensityForGrid(160, 160),
    maxSpecials: SPECIAL_EVENT_MAX_CELLS,
  });
  assert.deepEqual(
    assignEventKinds(capSpecialsPerTile(generated), { seed: options.seed, width: 160, height: 160 }),
    generateSpecialCells(options),
  );
  const kinds = new Set(assignEventKinds(capSpecialsPerTile(generated), { seed: options.seed, width: 160, height: 160 })
    .map((cell) => cell.kind));
  assert.ok(kinds.size > 1);
});

test('parameterized placement mirrors production generateSparkCells', () => {
  const artwork = buildSyntheticTemplate({ width: 160, height: 160 });
  const options = {
    templateId: artwork.template.id,
    seed: 'cadence-seed',
    width: 160,
    height: 160,
    tileSize: 32,
    tiles: artwork.tiles,
    densityCells: 400,
    maxSpecials: 512,
  };
  assert.deepEqual(
    generateParameterizedSparkCells(options),
    generateSparkCells(options),
  );
});

test('event mix reports deterministic count, streak, gap, rate, and assisted metrics', () => {
  const options = {
    width: 160,
    height: 160,
    seed: 'baseline-seed-1',
    eventMix: true,
    maxPlans: 5000,
  };
  const first = simulateSpecialGameplay(options);
  const second = simulateSpecialGameplay(options);
  first.route.elapsed_ms = 0;
  second.route.elapsed_ms = 0;
  assert.deepEqual(first, second);
  assert.deepEqual(first.model.gameplay_types, ['spark', 'bomb', 'fuse', 'choice', 'artifact']);
  assert.equal(first.model.event_mix, true);
  assert.ok(first.placement.kind_counts.spark >= 1);
  assert.ok(Object.keys(first.route.events_by_kind).length > 1);
  assert.equal(
    Object.values(first.route.events_by_kind).reduce((sum, count) => sum + count, 0),
    first.route.spark_events,
  );
  assert.equal(first.route.trap_events, first.route.events
    .filter((event) => event.kind === 'fuse').length);
  assert.equal(first.route.rare_events, first.route.events
    .filter((event) => event.kind === 'artifact').length);
  assert.ok(first.route.trap_rate >= 0 && first.route.trap_rate <= 1);
  assert.ok(first.route.rare_rate >= 0 && first.route.rare_rate <= 1);
  assert.ok(first.route.type_streak.max >= 1);
  assert.deepEqual(
    Object.keys(first.route.gaps_by_kind).sort(),
    Object.keys(first.route.events_by_kind).sort(),
  );
  for (const [kind, summary] of Object.entries(first.route.assisted_per_event_by_kind)) {
    assert.equal(summary.count, first.route.events_by_kind[kind]);
    assert.ok(first.route.assisted_ratio_by_kind[kind] >= 0);
  }
});

test('cadence sweep report is deterministic and includes per-density aggregates', () => {
  const options = {
    sizes: [160],
    seeds: ['a', 'b'],
    densities: [250, 400, 600],
    maxPlans: 5000,
  };
  const first = runCadenceSweep(options);
  const second = runCadenceSweep(options);
  assert.equal(digestSweepReport(first), digestSweepReport(second));
  assert.deepEqual(Object.keys(first.per_density).sort(), ['250', '400', '600']);
  assert.equal(first.per_density['250'].per_size['160'].runs, 2);
  assert.equal(first.event_mix, false);
  assert.deepEqual(first.model.gameplay_types, ['spark']);
  assert.ok(first.per_density['250'].per_size['160'].gaps_targets.p95 != null);
});

test('event mix sweep report is deterministic and deterministic by digest', () => {
  const options = {
    sizes: [160],
    seeds: ['a'],
    densities: [250, 400],
    maxPlans: 5000,
  };
  const first = runEventMixSweep(options);
  const second = runEventMixSweep(options);
  assert.equal(digestSweepReport(first), digestSweepReport(second));
  assert.equal(first.event_mix, true);
  assert.deepEqual(first.model.gameplay_types, ['spark', 'bomb', 'fuse', 'choice', 'artifact']);
  assert.ok(first.per_density['250'].per_size['160'].events_by_kind.fuse.avg > 0);
  assert.ok(first.per_density['250'].per_size['160'].trap_rate > 0);
});

test('event-mix pity remains Spark-only', () => {
  const run = simulateSpecialGameplay({
    width: 160,
    height: 160,
    seed: 'mixed-pity-spark-only',
    densityCells: 250,
    eventMix: true,
    maxPlans: 10_000,
  });
  const pityEvents = run.route.events.filter((event) => event.discovered_by_pity);
  assert.ok(pityEvents.length > 0, 'fixture should exercise pity');
  assert.ok(pityEvents.every((event) => event.kind === 'spark'));
});
