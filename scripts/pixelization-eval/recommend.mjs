#!/usr/bin/env node

/**
 * Conservative, evidence-only pixelization recommendation.
 *
 * This module consumes the JSON emitted by scripts/pixelization-eval/run.mjs.
 * It never changes the creator pipeline or silently upscales a logical raster.
 * The recommendation is intentionally a routing suggestion for review, not a
 * production default switch: a mixed metric vector falls back to classic and
 * is marked for human review.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const RECOMMENDATION_POLICY_VERSION = 'pixelization-routing-v1';

export const DEFAULT_POLICY = Object.freeze({
  minEffortImprovementRelative: -0.10,
  maxEffortRegressionRelative: 0.05,
  maxEdgeRecallDrop: 0.03,
  maxEdgePrecisionDrop: 0.03,
  maxMeanDeltaEIncrease: 0.75,
  maxTinyAreaIncrease: 0.005,
  maxTransitionRatioIncrease: 0.01,
});

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function relativeDelta(candidate, baseline) {
  const next = finite(candidate);
  const previous = finite(baseline);
  if (next === null || previous === null) return null;
  if (previous === 0) return next === 0 ? 0 : null;
  return (next - previous) / previous;
}

function firstFinite(...values) {
  return values.map(finite).find((value) => value !== null) ?? null;
}

function getDeltas(comparison) {
  const deltas = comparison?.deltas || {};
  const baseline = comparison || {};
  return {
    effortRelative: firstFinite(deltas.classicLowerBoundRelative, relativeDelta(deltas.classicLowerBound, baseline.baselineClassicLowerBound)),
    edgeRecall: firstFinite(deltas.edgeRecall),
    edgePrecision: firstFinite(deltas.edgePrecision),
    meanDeltaE: firstFinite(deltas.meanDeltaE),
    tinyAreaRatio: firstFinite(deltas.tinyAreaRatio),
    transitionRatio: firstFinite(deltas.transitionRatio),
    regions4Relative: firstFinite(deltas.regions4Relative, relativeDelta(deltas.regions4, baseline.baselineRegions4)),
    runtimeRelative: firstFinite(deltas.runtimeRelative, relativeDelta(deltas.runtimeMs, baseline.baselineRuntimeMs)),
  };
}

function hasValue(value) {
  return value !== null && Number.isFinite(value);
}

function classifyComparison(comparison, policy = DEFAULT_POLICY) {
  const deltas = getDeltas(comparison);
  const unavailable = comparison?.unavailableMetrics?.length > 0
    || !comparison?.baselineAdapter
    || !comparison?.candidateAdapter
    || !hasValue(deltas.effortRelative);

  if (unavailable) {
    return {
      decision: 'classic',
      status: 'unavailable',
      confidence: 'none',
      reasons: ['paired-comparison-unavailable'],
      deltas,
    };
  }

  const hardRegressions = [];
  if (deltas.effortRelative > policy.maxEffortRegressionRelative) hardRegressions.push('effort-regression');
  if (hasValue(deltas.edgeRecall) && deltas.edgeRecall < -policy.maxEdgeRecallDrop) hardRegressions.push('edge-recall-drop');
  if (hasValue(deltas.edgePrecision) && deltas.edgePrecision < -policy.maxEdgePrecisionDrop) hardRegressions.push('edge-precision-drop');
  if (hasValue(deltas.meanDeltaE) && deltas.meanDeltaE > policy.maxMeanDeltaEIncrease) hardRegressions.push('source-error-increase');
  if (hasValue(deltas.tinyAreaRatio) && deltas.tinyAreaRatio > policy.maxTinyAreaIncrease) hardRegressions.push('tiny-region-increase');
  if (hasValue(deltas.transitionRatio) && deltas.transitionRatio > policy.maxTransitionRatioIncrease) hardRegressions.push('boundary-fragmentation-increase');

  const meaningfulEffortImprovement = deltas.effortRelative <= policy.minEffortImprovementRelative;
  if (hardRegressions.length) {
    return {
      decision: 'classic',
      status: 'human-review',
      confidence: 'low',
      reasons: hardRegressions,
      deltas,
    };
  }
  if (meaningfulEffortImprovement) {
    return {
      decision: 'paintable',
      status: 'provisional-positive',
      confidence: 'medium',
      reasons: ['effort-improvement-within-guardrails'],
      deltas,
    };
  }
  return {
    decision: 'classic',
    status: 'conservative-fallback',
    confidence: 'medium',
    reasons: ['no-meaningful-effort-improvement'],
    deltas,
  };
}

function unavailableEntries(summary) {
  const warnings = Array.isArray(summary?.warnings) ? summary.warnings : [];
  const entries = new Map();
  for (const warning of warnings) {
    const match = String(warning).match(/^([^@]+)@(\d+): paired comparison unavailable/);
    if (!match) continue;
    const key = `${match[1]}@${match[2]}`;
    entries.set(key, {
      image: match[1],
      width: Number(match[2]),
      height: Number(match[2]),
      baselineAdapter: 'classic',
      candidateAdapter: 'paintable',
      recommendation: classifyComparison({ unavailableMetrics: ['candidate-unavailable'] }),
      source: 'warning',
    });
  }
  return [...entries.values()];
}

function compareOrder(first, second) {
  return String(first.image).localeCompare(String(second.image)) || Number(first.width) - Number(second.width);
}

export function buildRecommendation(summary, policy = DEFAULT_POLICY) {
  if (!summary || !Array.isArray(summary.comparisons)) {
    throw new TypeError('Pixelization recommendation requires a run summary with comparisons');
  }
  const comparisons = summary.comparisons.map((comparison) => ({
    image: comparison.image,
    category: comparison.category || null,
    width: comparison.width,
    height: comparison.height,
    baselineAdapter: comparison.baselineAdapter || 'classic',
    candidateAdapter: comparison.candidateAdapter || 'paintable',
    recommendation: classifyComparison(comparison, policy),
    source: 'paired-comparison',
    panel: comparison.panel || null,
  }));
  const entries = [...comparisons, ...unavailableEntries(summary)].sort(compareOrder);
  const counts = entries.reduce((accumulator, entry) => {
    const decision = entry.recommendation.decision;
    accumulator[decision] = (accumulator[decision] || 0) + 1;
    return accumulator;
  }, {});
  const statusCounts = entries.reduce((accumulator, entry) => {
    const status = entry.recommendation.status;
    accumulator[status] = (accumulator[status] || 0) + 1;
    return accumulator;
  }, {});
  const reviewEntries = entries.filter((entry) => entry.recommendation.status === 'human-review');
  return {
    schemaVersion: 'pixelization-recommendation.v1',
    policyVersion: RECOMMENDATION_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      schemaVersion: summary.schemaVersion || null,
      generatedAt: summary.generatedAt || null,
      gitCommit: summary.gitCommit || null,
      manifest: summary.manifest || null,
    },
    logicalResolution: {
      note: 'Each recommendation applies to the exact logical width×height pair. A render/preview scale must not be treated as extra paintable logical detail.',
      paintableLimit: 'paintable-v1 is bounded at 512×512 logical cells; larger requests remain classic unless a separately evaluated pipeline exists.',
    },
    renderResolution: {
      previewWidth: finite(summary.options?.previewWidth),
      previewHeight: finite(summary.options?.previewHeight),
      note: 'Preview dimensions affect presentation only. They do not change the returned logical cells, predicted effort or paintability.',
    },
    policy: { ...policy },
    counts,
    statusCounts,
    humanReviewCount: reviewEntries.length,
    entries,
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
  };
}

function markdownReport(report) {
  const lines = [
    '# Pixelization routing recommendation',
    '',
    `Policy: \`${report.policyVersion}\``,
    `Source run: \`${report.source.gitCommit || 'unknown'}\` (${report.source.generatedAt || 'unknown'})`,
    '',
    '> This is an evidence-only routing suggestion. It does not change the creator default, and it does not prove artistic quality or mobile paint feel.',
    '',
    '## Contract',
    '',
    '- Recommendations are per exact logical resolution; render/preview scale is reported separately and cannot create logical cells.',
    '- `classic` is the safe fallback when the candidate is unavailable or a guardrail regresses.',
    '- `paintable` is only provisional when effort improves by at least 10% and no configured guardrail regresses.',
    '- `human-review` means the fallback is classic while the candidate remains useful as an explicit comparison, not an automatic winner.',
    '',
    '## Matrix',
    '',
    '| Artwork | Logical size | Recommendation | Status | Reasons |',
    '| --- | ---: | --- | --- | --- |',
  ];
  for (const entry of report.entries) {
    const recommendation = entry.recommendation;
    lines.push(`| ${entry.image} | ${entry.width}×${entry.height} | ${recommendation.decision} | ${recommendation.status} | ${recommendation.reasons.join(', ')} |`);
  }
  lines.push('', '## Counts', '', `- classic fallback: ${report.counts.classic || 0}`, `- paintable provisional-positive: ${report.counts.paintable || 0}`, `- unavailable rows: ${report.statusCounts.unavailable || 0}`, `- human-review rows: ${report.humanReviewCount}`, '', '## Interpretation', '', 'The recommendation is intentionally conservative. A candidate can reduce predicted manual effort and still fall back to classic when edge recall or another structural guardrail regresses. The next safe step is visual/mobile review of the rows marked `human-review`, not an automatic creator default switch.', '');
  return lines.join('\n');
}

function parseArgs(argv) {
  const result = { input: null, output: null, format: 'json' };
  for (const argument of argv) {
    if (argument.startsWith('--input=')) result.input = path.resolve(argument.slice('--input='.length));
    else if (argument.startsWith('--output=')) result.output = path.resolve(argument.slice('--output='.length));
    else if (argument.startsWith('--format=')) result.format = argument.slice('--format='.length);
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/pixelization-eval/recommend.mjs --input=summary.json [--output=recommendation.json] [--format=json|markdown]');
      process.exit(0);
    }
  }
  if (!result.input) throw new Error('--input=summary.json is required');
  if (!['json', 'markdown'].includes(result.format)) throw new Error('--format must be json or markdown');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  const summary = JSON.parse(await readFile(args.input, 'utf8'));
  const recommendation = buildRecommendation(summary);
  const content = args.format === 'markdown'
    ? markdownReport(recommendation)
    : `${JSON.stringify(recommendation, null, 2)}\n`;
  if (args.output) await writeFile(args.output, content, 'utf8');
  else process.stdout.write(content);
}
