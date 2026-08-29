#!/usr/bin/env node

/**
 * Build a bounded, evidence-backed catalog quality report.
 *
 * This is a diagnostic/content-pipeline report. It does not rewrite the
 * catalog, change creator defaults, or promote a paintable raster. Exact
 * pixelization recommendations are attached only when a template explicitly
 * carries a matching evidence source id and logical resolution.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildContentMetadata } from '../server/services/content-quality.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultCatalog = path.join(repoRoot, 'server', 'catalog-templates.json');
const defaultRecommendations = path.join(repoRoot, 'docs', 'evidence', 'pixelization', 'automatic-recommendation', 'current-recommendation.json');

function parseArgs(argv) {
  const result = {
    catalog: defaultCatalog,
    recommendations: defaultRecommendations,
    output: null,
    format: 'json',
  };
  for (const argument of argv) {
    if (argument.startsWith('--catalog=')) result.catalog = path.resolve(argument.slice('--catalog='.length));
    else if (argument.startsWith('--recommendations=')) result.recommendations = path.resolve(argument.slice('--recommendations='.length));
    else if (argument.startsWith('--output=')) result.output = path.resolve(argument.slice('--output='.length));
    else if (argument.startsWith('--format=')) result.format = argument.slice('--format='.length);
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/content-quality-audit.mjs [--catalog=...] [--recommendations=...] [--output=...] [--format=json|markdown]');
      process.exit(0);
    }
  }
  if (!['json', 'markdown'].includes(result.format)) throw new Error('--format must be json or markdown');
  return result;
}

function recommendationKey(image, width, height = width) {
  return `${String(image || '')}@${Number(width)}x${Number(height)}`;
}

function recommendationIndex(report) {
  const index = new Map();
  for (const entry of Array.isArray(report?.entries) ? report.entries : []) {
    index.set(recommendationKey(entry.image, entry.width, entry.height), entry.recommendation || null);
  }
  return index;
}

function sourceId(template) {
  return template.pixelization_source_id
    || template.content_source_id
    || template.source_id
    || null;
}

function summarize(entries, recommendations) {
  const countBy = (selector) => entries.reduce((counts, entry) => {
    const value = selector(entry);
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
  const evidenceEntries = Array.isArray(recommendations?.entries) ? recommendations.entries : [];
  return {
    artwork_count: entries.length,
    duration_bands: countBy((entry) => entry.content_metadata.duration.band),
    complexity_bands: countBy((entry) => entry.content_metadata.complexity.band),
    quality_gate_status: countBy((entry) => entry.content_metadata.quality_gate.status),
    style_status: countBy((entry) => entry.content_metadata.style.status),
    attached_pixelization_rows: entries.filter((entry) => entry.pixelization_evidence).length,
    pixelization_evidence: {
      source_commit: recommendations?.source?.gitCommit || null,
      policy_version: recommendations?.policyVersion || null,
      provisional_positive: evidenceEntries.filter((entry) => entry.recommendation?.status === 'provisional-positive').length,
      human_review: evidenceEntries.filter((entry) => entry.recommendation?.status === 'human-review').length,
      unavailable: evidenceEntries.filter((entry) => entry.recommendation?.status === 'unavailable').length,
    },
  };
}

function buildReport(catalog, recommendations) {
  if (!Array.isArray(catalog)) throw new TypeError('Catalog input must be an array');
  const index = recommendationIndex(recommendations);
  const entries = catalog.map((template) => {
    const image = sourceId(template);
    const key = image ? recommendationKey(image, template.width, template.height) : null;
    const pixelizationEvidence = key ? index.get(key) || null : null;
    const contentMetadata = buildContentMetadata(template, { pixelization: pixelizationEvidence });
    return {
      id: template.id,
      title: template.title,
      collection_id: template.collection_id || null,
      theme: template.theme || null,
      mood: template.mood || null,
      width: Number(template.width),
      height: Number(template.height),
      storage_mode: template.storage_mode || 'legacy',
      pixelization_source_id: image,
      pixelization_evidence: pixelizationEvidence,
      content_metadata: contentMetadata,
    };
  });
  return {
    schema_version: 'content-quality-audit.v1',
    generated_at: new Date().toISOString(),
    source: {
      catalog: path.relative(repoRoot, defaultCatalog).replaceAll('\\', '/'),
      recommendations: path.relative(repoRoot, defaultRecommendations).replaceAll('\\', '/'),
    },
    contract: {
      advisory: true,
      catalog_mutated: false,
      creator_preview_final_parity_changed: false,
      exact_resolution_pixelization_only: true,
      unknown_style_route: 'classic',
    },
    summary: summarize(entries, recommendations),
    entries,
  };
}

function markdownReport(report) {
  const lines = [
    '# Content quality audit',
    '',
    `Generated: \`${report.generated_at}\``,
    '',
    '> Advisory diagnostic only. It does not mutate catalog content, change creator defaults, or claim that a style is artistically approved.',
    '',
    '## Contract',
    '',
    '- Duration is a coarse session promise; tiled maps above the public 25,600-cell budget are labelled `Длинная · по сегментам`.',
    '- Complexity uses bounded raster metrics when the complete legacy raster is available, and dimensions/editorial data for tiled maps.',
    '- Pixelization evidence attaches only to an exact source id and logical resolution. Unknown rows stay on classic fallback and remain review debt.',
    '- Creator preview/final parity is not changed by this report.',
    '',
    '## Catalog summary',
    '',
    `- Artworks: ${report.summary.artwork_count}`,
    `- Duration bands: ${JSON.stringify(report.summary.duration_bands)}`,
    `- Complexity bands: ${JSON.stringify(report.summary.complexity_bands)}`,
    `- Quality gate: ${JSON.stringify(report.summary.quality_gate_status)}`,
    `- Style status: ${JSON.stringify(report.summary.style_status)}`,
    `- Exact pixelization rows attached: ${report.summary.attached_pixelization_rows}`,
    '',
    '## Artwork labels',
    '',
    '| Artwork | Pack | Duration | Complexity | Style route | Gate |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of report.entries) {
    lines.push(`| ${entry.title} | ${entry.collection_id || '—'} | ${entry.content_metadata.duration.label} | ${entry.content_metadata.complexity.label} | ${entry.content_metadata.style.label} | ${entry.content_metadata.quality_gate.status} |`);
  }
  const evidence = report.summary.pixelization_evidence;
  lines.push(
    '',
    '## Pixelization evidence snapshot',
    '',
    `- Source commit: ${evidence.source_commit || 'unknown'}`,
    `- Policy: ${evidence.policy_version || 'unknown'}`,
    `- Provisional-positive rows: ${evidence.provisional_positive}`,
    `- Human-review rows: ${evidence.human_review}`,
    `- Unavailable rows: ${evidence.unavailable}`,
    '',
    'The current catalog has no explicit source ids for the R&D corpus, so this snapshot intentionally does not auto-promote a paintable route. A content producer must attach exact evidence before a future curated pack can use it.',
    '',
  );
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  const catalog = JSON.parse(await readFile(args.catalog, 'utf8'));
  const recommendations = JSON.parse(await readFile(args.recommendations, 'utf8'));
  const report = buildReport(catalog, recommendations);
  const content = args.format === 'markdown' ? markdownReport(report) : `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) await writeFile(args.output, content, 'utf8');
  else process.stdout.write(content);
}

export { buildReport, markdownReport };
