#!/usr/bin/env node
/**
 * CLI baseline report for Spark-only special gameplay.
 *
 * Usage:
 *   node server/scripts/diagnose-special-gameplay.mjs
 *   node server/scripts/diagnose-special-gameplay.mjs --sizes 160,500,1200 --seeds 5
 *   node server/scripts/diagnose-special-gameplay.mjs --seeds a,b,c --json
 *   node server/scripts/diagnose-special-gameplay.mjs --out server/.test-tmp/report.json
 *   node server/scripts/diagnose-special-gameplay.mjs --sweep --densities 250,400,600
 *   node server/scripts/diagnose-special-gameplay.mjs --mix-sweep --densities 250,400,600
 *
 * The route model is explicitly an approximation; see
 * special-gameplay-simulator.mjs for the exact contract.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BALANCE_SWEEP_DENSITIES,
  BALANCE_SWEEP_MAX_PLANS,
  BALANCE_SWEEP_SEED_COUNT,
  BALANCE_SWEEP_SIZES,
  CADENCE_SWEEP_DENSITIES,
  CADENCE_SWEEP_MAX_PLANS,
  CADENCE_SWEEP_SEED_COUNT,
  CADENCE_SWEEP_SIZES,
  DEFAULT_DENSITY_CELLS,
  DEFAULT_MAX_PLANS,
  DEFAULT_MAX_SPECIALS,
  DEFAULT_PALETTE_SIZE,
  DEFAULT_SEED_COUNT,
  DEFAULT_SIZES,
  defaultSeeds,
  digestReport,
  digestSweepReport,
  runBaseline,
  runBalanceSweep,
  runCadenceSweep,
} from './special-gameplay-simulator.mjs';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(serverDir, '.test-tmp', 'special-gameplay-baseline.json');
const DEFAULT_SWEEP_OUT = join(serverDir, '.test-tmp', 'special-gameplay-cadence-sweep.json');
const DEFAULT_BALANCE_OUT = join(serverDir, '.test-tmp', 'special-gameplay-balance.json');

function parseArgs(argv) {
  const args = {
    sizes: null,
    seeds: null,
    palette: null,
    maxPlans: null,
    maxSpecials: null,
    densities: null,
    sweep: false,
    mix: false,
    mixSweep: false,
    hazard: false,
    balance: false,
    out: null,
    json: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[index + 1];
    if (argument === '--sizes') {
      args.sizes = next().split(',').map(Number);
      index += 1;
    } else if (argument === '--seeds') {
      const value = next();
      args.seeds = /^\d+$/.test(value)
        ? defaultSeeds(Number(value))
        : value.split(',');
      index += 1;
    } else if (argument === '--palette') {
      args.palette = Number(next().replaceAll('_', ''));
      index += 1;
    } else if (argument === '--max-plans') {
      args.maxPlans = Number(next().replaceAll('_', ''));
      index += 1;
    } else if (argument === '--max-specials') {
      args.maxSpecials = Number(next().replaceAll('_', ''));
      index += 1;
    } else if (argument === '--densities') {
      args.densities = next().split(',').map(Number);
      index += 1;
    } else if (argument === '--sweep') {
      args.sweep = true;
    } else if (argument === '--mix') {
      args.mix = true;
    } else if (argument === '--mix-sweep') {
      args.mixSweep = true;
    } else if (argument === '--hazard') {
      args.hazard = true;
    } else if (argument === '--balance') {
      args.balance = true;
    } else if (argument === '--out') {
      args.out = next();
      index += 1;
    } else if (argument === '--json') {
      args.json = true;
    } else if (argument === '--verbose') {
      args.verbose = true;
    } else if (argument === '--help' || argument === '-h') {
      args.help = true;
    }
  }
  return args;
}

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '-';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(digits);
}

function printHelp() {
  console.log(`diagnose-special-gameplay.mjs - Spark-only baseline simulator

Options:
  --sizes 160,500,1200   grid sizes (default: ${DEFAULT_SIZES.join(',')})
  --seeds 5              seed count or explicit seed list (default: ${DEFAULT_SEED_COUNT})
  --palette 8            palette colors in synthetic artwork (default: ${DEFAULT_PALETTE_SIZE})
  --max-plans 250000     route planning budget per run (default: ${DEFAULT_MAX_PLANS})
  --max-specials ${DEFAULT_MAX_SPECIALS}     Spark-only cap; mixed production uses 8192 unless overridden
  --densities 250,400,600
                         density cells per special for --sweep (default: ${CADENCE_SWEEP_DENSITIES.join(',')})
  --sweep                cadence sweep over densities on bounded sizes/seeds
  --mix                  label candidates with the multi-kind production cycle
  --mix-sweep            deterministic multi-kind cadence sweep (--sweep --mix)
  --hazard               include the simulator V1 Hazard fixture when mixed
  --balance              deterministic 160/500/1200 multi-seed balance sweep with
                         the intended V1 family; production registry status and
                         any omitted kinds are reported explicitly
  --out <path>           JSON report path (default: ${DEFAULT_OUT})
  --json                 print JSON report instead of tables
  --verbose              print per-seed rows
  --help                 show this help

Reported metrics include first event/Spark targets, events per smart target,
p50/p90/p95/worst cell and target gaps, per-kind type distribution and streaks,
trap/rare rates, assisted progress, and spatial cluster/neighbor percentiles.
Defaults cover 160/500/1200 grids across 5 seeds. Balance defaults use
${BALANCE_SWEEP_SEED_COUNT} seeds, ${BALANCE_SWEEP_MAX_PLANS} max plans, and
${BALANCE_SWEEP_DENSITIES.join('/')} density cells per special.

Reported route model is an approximation; see the simulator module docs.
`);
}

function printSummary(report) {
  const label = report.model.event_mix ? 'Multi-kind baseline' : 'Spark-only baseline';
  console.log(`${label}: sizes=${report.sizes.join('/')} seeds=${report.seeds.length} route=${report.model.route_model}`);
  console.log(`Approximation: ${report.model.approximation}`);
  console.log('');
  printHazardStatus(report);
  const header = [
    'size',
    'cells',
    'colors',
    'regions',
    'sparks',
    'events.avg',
    'missed.avg',
    'candidates.avg',
    'targets.avg',
    'events/tgt',
    'first',
    'first.evt',
    'gap.c.p50',
    'gap.c.p90',
    'gap.c.p95',
    'gap.c.worst',
    'gap.t.p50',
    'gap.t.p90',
    'gap.t.p95',
    'gap.t.worst',
    'clusters.avg',
    'nn.avg',
    'nn.p95',
    'assist.avg',
    'assist.p95',
    'wall.ms',
  ];
  console.log(header.join(' | '));
  for (const size of report.sizes) {
    const row = report.aggregate.per_size[size];
    if (!row) continue;
    const values = [
      size,
      row.total_cells,
      row.colors_total,
      row.regions_total,
      fmt(row.spark_count.avg, 1),
      fmt(row.spark_events.avg, 1),
      fmt(row.missed_sparks.avg, 1),
      fmt(row.total_candidates.avg, 0),
      fmt(row.total_smart_targets.avg, 0),
      fmt(row.events_per_target, 3),
      fmt(row.smart_targets_to_first_spark.avg, 1),
      fmt(row.smart_targets_to_first_event.avg, 1),
      fmt(row.gaps_cells.p50, 0),
      fmt(row.gaps_cells.p90, 0),
      fmt(row.gaps_cells.p95, 0),
      fmt(row.gaps_cells.max, 0),
      fmt(row.gaps_targets.p50, 0),
      fmt(row.gaps_targets.p90, 0),
      fmt(row.gaps_targets.p95, 0),
      fmt(row.gaps_targets.max, 0),
      fmt(row.clusters.avg, 1),
      fmt(row.nearest_neighbor_average, 1),
      fmt(row.nearest_neighbor?.p95, 1),
      fmt(row.assisted_ratio, 3),
      fmt(row.assisted_progress?.p95, 3),
      fmt(row.elapsed_ms, 1),
    ];
    console.log(values.join(' | '));
  }
  console.log('');
  if (report.model.event_mix) printKindDistribution(report);
  console.log('Columns: sparks=Spark candidates per artwork, events.avg=discovered Spark claims, missed.avg=Spark cells '
    + 'auto-filled by use_spark before a player could claim them, candidates.avg=route candidate-tile evaluations, '
    + 'targets.avg=smart targets per run, events/tgt=discovered events per smart target, first=smart targets to first '
    + 'Spark, first.evt=smart targets to first event of any kind, gap.c=completed-cell gap between event discoveries, '
    + 'gap.t=regular-target gap between event discoveries, clusters=Spark clusters (threshold '
    + `${report.model.spark_cluster_threshold_cells} cells), nn.avg/nn.p95=Spark nearest-neighbor cells, `
    + 'assist.avg=assisted cells / completed cells, assist.p95=per-event assisted-progress percentile.');
}

function printKindDistribution(report) {
  const kinds = report.model.gameplay_types
    || Object.keys(report.aggregate.per_size[String(report.sizes[0])]?.type_distribution || {});
  console.log('Type distribution (events avg, event share %, hazard/rare %):');
  const header = [
    'size',
    ...kinds.flatMap((kind) => [`${kind}.avg`, `${kind}.%`]),
    'hazard%',
    'rare%',
  ];
  console.log(header.join(' | '));
  for (const size of report.sizes) {
    const row = report.aggregate.per_size[size];
    if (!row) continue;
    const kindValues = kinds.flatMap((kind) => [
      fmt(row.events_by_kind?.[kind]?.avg, 1),
      fmt(row.type_distribution?.[kind] != null ? row.type_distribution[kind] * 100 : null, 1),
    ]);
    const values = [
      size,
      ...kindValues,
      fmt((row.trap_rate ?? 0) * 100, 1),
      fmt((row.rare_rate ?? 0) * 100, 1),
    ];
    console.log(values.join(' | '));
  }
}

function printHazardStatus(report) {
  const adapter = report.model?.kind_adapter;
  if (!adapter) {
    console.log('Kind adapter: Spark-only baseline (no event mix).');
    console.log('');
    return;
  }
  console.log(`Kind adapter: source=${adapter.source} version=${adapter.generation_version} active=${adapter.active_kinds.join('/')}`);
  console.log(`Hazard registry: registered=${adapter.production.hazard_registered} `
    + `in_active_kinds=${adapter.production.hazard_in_active_kinds} `
    + `in_pattern=${adapter.production.hazard_in_pattern} `
    + `actions_supported=${adapter.production.hazard_actions_supported}`);
  console.log(`Hazard in report: included=${adapter.hazard.included} omitted=${adapter.hazard.omitted}`);
  console.log(`Hazard note: ${adapter.hazard.reason}`);
  console.log('');
}

function printSweepKindMix(report) {
  const kinds = report.model.gameplay_types || [];
  console.log('Kind mix by density/size (avg event share %):');
  const header = ['density', 'size', ...kinds.map((kind) => `${kind}.%`)];
  console.log(header.join(' | '));
  for (const density of report.densities) {
    const perSize = report.per_density[String(density)]?.per_size || {};
    for (const size of report.sizes) {
      const row = perSize[size];
      if (!row) continue;
      const values = [
        density,
        size,
        ...kinds.map((kind) => fmt(
          row.type_distribution?.[kind] != null ? row.type_distribution[kind] * 100 : null,
          1,
        )),
      ];
      console.log(values.join(' | '));
    }
  }
  console.log('');
}

function printSweepSummary(report) {
  const kinds = report.model.gameplay_types || ['spark'];
  console.log(`Cadence sweep: densities=${report.densities.join('/')} sizes=${report.sizes.join('/')} `
    + `seeds=${report.seeds.length} mix=${report.event_mix ? 'multi-kind' : 'spark-only'} route=${report.model.route_model}`);
  console.log(`Approximation: ${report.model.approximation}`);
  console.log('');
  printHazardStatus(report);
  const header = [
    'density',
    'size',
    'cells',
    'specials.avg',
    'events.avg',
    ...kinds.map((kind) => `${kind}.avg`),
    'events/tgt',
    'first.evt',
    'gap.t.p50',
    'gap.t.p90',
    'gap.t.p95',
    'gap.t.worst',
    'streak.max',
    'streak.avg',
    'nn.p95',
    'cluster.max',
    'trap.avg%',
    'hazard.avg%',
    'rare.avg%',
    'assist.avg',
    'assist.p95',
    'wall.ms',
  ];
  console.log(header.join(' | '));
  for (const density of report.densities) {
    const perSize = report.per_density[String(density)]?.per_size || {};
    for (const size of report.sizes) {
      const row = perSize[size];
      if (!row) continue;
      const kindValues = kinds.map((kind) => fmt(row.events_by_kind?.[kind]?.avg, 1));
      const values = [
        density,
        size,
        row.total_cells,
        fmt(row.spark_count.avg, 1),
        fmt(row.spark_events.avg, 1),
        ...kindValues,
        fmt(row.events_per_target, 3),
        fmt(row.smart_targets_to_first_event.avg, 1),
        fmt(row.gaps_targets.p50, 0),
        fmt(row.gaps_targets.p90, 0),
        fmt(row.gaps_targets.p95, 0),
        fmt(row.gaps_targets.max, 0),
        fmt(row.type_streak_max?.max, 0),
        fmt(row.type_streak_avg?.avg, 1),
        fmt(row.nearest_neighbor?.p95, 1),
        fmt(row.cluster_size?.max, 0),
        fmt((row.trap_rate ?? 0) * 100, 1),
        fmt(row.type_distribution?.hazard != null ? row.type_distribution.hazard * 100 : null, 1),
        fmt((row.rare_rate ?? 0) * 100, 1),
        fmt(row.assisted_ratio, 3),
        fmt(row.assisted_progress?.p95, 3),
        fmt(row.elapsed_ms, 1),
      ];
      console.log(values.join(' | '));
    }
  }
  console.log('');
  printSweepKindMix(report);
  console.log('Columns: specials.avg=generated candidates per artwork, events.avg=discovered events, '
    + 'kind columns=events discovered by kind, events/tgt=events per smart target, first.evt=smart targets to first event, '
    + 'gap.t.p50/p90/p95/worst=regular-target gap between discoveries, streak.max/avg=longest and average same-kind event '
    + 'streak, nn.p95=Spark nearest-neighbor percentile, cluster.max=largest Spark cluster, trap.avg%=fuse events / all '
    + 'events, hazard.avg%=hazard events / all events, rare.avg%=artifact events / all events, assist.avg=assisted cells '
    + '/ completed cells, assist.p95=per-event assisted-progress percentile.');
}

function printVerbose(report) {
  console.log('Per-seed runs:');
  for (const run of report.runs) {
    const gaps = run.route;
    const kinds = Object.entries(run.route.events_by_kind || {})
      .map(([kind, count]) => `${kind}=${count}`)
      .join(',');
    const distribution = Object.entries(run.route.type_distribution || {})
      .map(([kind, share]) => `${kind}=${fmt(share != null ? share * 100 : null, 0)}%`)
      .join(',');
    console.log([
      run.template.width,
      run.seed,
      `sparks=${run.placement.spark_count}`,
      `events=${run.route.spark_events}`,
      `kinds=${kinds}`,
      `missed=${run.route.missed_sparks}`,
      `targets=${run.route.total_smart_targets}`,
      `candidates=${run.route.total_candidates}`,
      `first=${fmt(run.route.smart_targets_to_first_spark, 0)}`,
      `firstEvt=${fmt(run.route.smart_targets_to_first_event, 0)}/${run.route.first_event_kind || '-'}`,
      `evtTgt=${fmt(run.route.events_per_target, 3)}`,
      `types=${distribution}`,
      `gapC=${fmt(gaps.gaps_cells_summary.p50, 0)}/${fmt(gaps.gaps_cells_summary.p95, 0)}/${fmt(gaps.gaps_cells_summary.max, 0)}`,
      `gapT=${fmt(gaps.gaps_targets_summary.p50, 0)}/${fmt(gaps.gaps_targets_summary.p95, 0)}/${fmt(gaps.gaps_targets_summary.max, 0)}`,
      `trap=${fmt(run.route.trap_rate, 3)}`,
      `rare=${fmt(run.route.rare_rate, 3)}`,
      `assist=${fmt(run.route.assisted_ratio, 3)}`,
      `assistP=${fmt(run.route.assisted_progress?.p95, 3)}`,
      `nnP=${fmt(run.placement.nearest_neighbor_distance?.p95, 1)}`,
      `ms=${fmt(run.route.elapsed_ms, 1)}`,
    ].join(' '));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const sweepMode = args.sweep || args.mixSweep || args.balance;
  const eventMix = args.mix || args.mixSweep || args.balance;
  const includeHazard = args.hazard || args.balance;
  if (args.hazard && !eventMix) {
    throw new Error('--hazard requires --mix, --mix-sweep, or --balance');
  }
  const sizes = args.sizes || (
    args.balance
      ? [...BALANCE_SWEEP_SIZES]
      : (sweepMode ? [...CADENCE_SWEEP_SIZES] : [...DEFAULT_SIZES])
  );
  const seeds = args.seeds || (
    args.balance
      ? defaultSeeds(BALANCE_SWEEP_SEED_COUNT)
      : (sweepMode ? defaultSeeds(CADENCE_SWEEP_SEED_COUNT) : defaultSeeds())
  );
  const maxPlans = args.maxPlans || (
    args.balance
      ? BALANCE_SWEEP_MAX_PLANS
      : (sweepMode ? CADENCE_SWEEP_MAX_PLANS : DEFAULT_MAX_PLANS)
  );
  const maxSpecials = args.maxSpecials || null;
  const densities = args.densities || (
    args.balance ? [...BALANCE_SWEEP_DENSITIES] : [...CADENCE_SWEEP_DENSITIES]
  );
  let report;
  if (args.balance) {
    report = runBalanceSweep({
      sizes,
      seeds,
      densities,
      paletteSize: args.palette || DEFAULT_PALETTE_SIZE,
      maxPlans,
      maxSpecials: maxSpecials || undefined,
      includeHazard: true,
    });
  } else if (sweepMode) {
    report = runCadenceSweep({
      sizes,
      seeds,
      densities,
      paletteSize: args.palette || DEFAULT_PALETTE_SIZE,
      maxPlans,
      maxSpecials: maxSpecials || DEFAULT_MAX_SPECIALS,
      eventMix,
      includeHazard,
    });
  } else {
    report = runBaseline({
      sizes,
      seeds,
      paletteSize: args.palette || DEFAULT_PALETTE_SIZE,
      maxPlans,
      densityCells: densities.length === 1 ? densities[0] : DEFAULT_DENSITY_CELLS,
      maxSpecials: maxSpecials || DEFAULT_MAX_SPECIALS,
      eventMix,
      includeHazard,
    });
  }
  report.generated_at = new Date().toISOString();
  report.report_digest = report.sweep ? digestSweepReport(report) : digestReport(report);

  const outPath = resolve(args.out || (
    args.balance ? DEFAULT_BALANCE_OUT : (sweepMode ? DEFAULT_SWEEP_OUT : DEFAULT_OUT)
  ));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    if (report.sweep) printSweepSummary(report);
    else printSummary(report);
    if (args.verbose) {
      console.log('');
      printVerbose(report);
    }
    console.log(`Report: ${outPath}`);
    console.log(`Digest: ${report.report_digest}`);
  }
}

main().catch((error) => {
  console.error(`diagnose-special-gameplay failed: ${error.stack || error}`);
  process.exitCode = 1;
});
