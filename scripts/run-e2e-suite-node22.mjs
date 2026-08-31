import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertE2ERuntime } from './assert-e2e-runtime.mjs';

// Critical membership is title-based and preflighted. File:line selectors are
// convenient during diagnosis but silently become empty selections after an
// unrelated edit, which is unacceptable for a required release gate.
const critical = [
  { file: 'e2e/accessibility-1200.spec.js', title: 'tiled 1200 player keeps one canvas, bounded DOM, keyboard paint, and zone navigation' },
  { file: 'e2e/auth-contract.spec.js', title: 'valid Telegram initData authenticates the Telegram identity and wins over a dev header' },
  { file: 'e2e/auth-contract.spec.js', title: 'missing or invalid Telegram initData is rejected' },
  { file: 'e2e/bfcache-lifecycle.spec.js', title: 'legacy queue keeps painting after persisted pagehide/pageshow' },
  { file: 'e2e/coloring-surface-gesture-guard.spec.js', title: 'classic pointer capture stays on the canvas and paint commits progress' },
  { file: 'e2e/creator.spec.js', title: '3. File upload shows grid, crop, and color controls' },
  { file: 'e2e/creator.spec.js', title: '6. Compute shows previews and quality indicator' },
  { file: 'e2e/creator.spec.js', title: '6c. 1200x1200 creator path uploads tiled storage and opens bounded player' },
  { file: 'e2e/creator.spec.js', title: '8. Save flow: saves, confirms, and opens play view' },
  { file: 'e2e/creator.spec.js', title: '11. Delete a user-created coloring from gallery' },
  { file: 'e2e/guided-path.spec.js', title: 'guided home shows one primary action and a bounded choice window' },
  { file: 'e2e/guided-path.spec.js', title: 'completion hands off to a committed choice, including an honest stop' },
  { file: 'e2e/guided-player.spec.js', title: '1200x1200 guided player autofocuses, auto-advances, and supports free exploration + return' },
  { file: 'e2e/input-gesture-evidence.spec.js', title: 'classic keyboard paint commits server progress' },
  { file: 'e2e/input-gesture-evidence.spec.js', title: 'tiled real touch paint commits server progress and captures the pointer' },
  { file: 'e2e/p0-final-acceptance.spec.js', title: 'final acceptance: real 1200x1200 with existing progress, zero interactions, first action = PAINT' },
  { file: 'e2e/recovery-p0.spec.js', title: 'cold root reopen restores the last artwork and resumable state' },
  { file: 'e2e/special-cells-1200-delivery.spec.js', title: '1200 treatment delivers INITIAL_TARGET, paints visible Spark on canvas, uses bounded effect, continues' },
  { file: 'e2e/tiled-completion.spec.js', title: 'tiled completion shows the completion overlay in the player' },
  { file: 'e2e/tiled-low-zoom.spec.js', title: 'overview is preview-stable, work reloads tiles, 502 stays local and retry recovers' },
  { file: 'e2e/tiled-reload-journal.spec.js', title: 'offline journal replay reconciles an already resident tile after reload' },
  { file: 'e2e/tiled-stroke-engine.spec.js', title: '30-cell touch drag paints progressively while the finger is down' },
  { file: 'e2e/tiled-stroke-engine.spec.js', title: 'drag across a tile boundary paints every valid cell with no stall' },
  { file: 'e2e/unlocks-recommendations.spec.js', title: 'progression-locked direct ID opens an actionable locked screen, not a generic error' },
  { file: 'e2e/unlocks-recommendations.spec.js', title: 'premium direct ID shows a neutral unavailable state without payment CTA' },
  { file: 'e2e/unlocks-recommendations.spec.js', title: 'catalog showcase stays fail-closed without a mounted payment adapter' },
];

// The Pixel critical lane contains the heaviest 1200/tiled journeys. Keep
// two explicit, duration-balanced partitions so each partition gets a fresh
// API/SQLite runtime. The union is asserted below and preflighted by the
// wrapper; a future critical-title edit must update both partitions.
const criticalPixelPartitionA = new Set([
  '30-cell touch drag paints progressively while the finger is down',
  'offline journal replay reconciles an already resident tile after reload',
  'tiled 1200 player keeps one canvas, bounded DOM, keyboard paint, and zone navigation',
  'final acceptance: real 1200x1200 with existing progress, zero interactions, first action = PAINT',
  '1200x1200 guided player autofocuses, auto-advances, and supports free exploration + return',
  'tiled real touch paint commits server progress and captures the pointer',
  '11. Delete a user-created coloring from gallery',
  'completion hands off to a committed choice, including an honest stop',
  'progression-locked direct ID opens an actionable locked screen, not a generic error',
  'classic keyboard paint commits server progress',
  'classic pointer capture stays on the canvas and paint commits progress',
  'guided home shows one primary action and a bounded choice window',
  'missing or invalid Telegram initData is rejected',
]);
const criticalPixelA = critical.filter(({ title }) => criticalPixelPartitionA.has(title));
const criticalPixelB = critical.filter(({ title }) => !criticalPixelPartitionA.has(title));
if (criticalPixelA.length !== 13 || criticalPixelB.length !== 13
  || new Set([...criticalPixelA, ...criticalPixelB].map(({ file, title }) => `${file}:${title}`)).size !== critical.length) {
  throw new Error('Critical Pixel partitions must cover each critical title exactly once (13 + 13).');
}

// WebKit emulation cannot execute the 1200x1200 creator/touch scenarios in
// this local/CI harness. Its creator worker also has a known provider-bound
// failure mode (worker module requests can fail before the test oracle runs),
// so keep the supported smoke subset explicit instead of reporting a 26-test
// gate with conditional skips as if it were full iOS parity. Save/1200/touch
// journeys remain required on Chromium/Pixel and on the separate physical
// iOS gate.
const criticalWebkit = critical.filter(({ title }) => new Set([
  'valid Telegram initData authenticates the Telegram identity and wins over a dev header',
  'missing or invalid Telegram initData is rejected',
  'classic pointer capture stays on the canvas and paint commits progress',
  '3. File upload shows grid, crop, and color controls',
  '6. Compute shows previews and quality indicator',
  '11. Delete a user-created coloring from gallery',
  'guided home shows one primary action and a bounded choice window',
  'completion hands off to a committed choice, including an honest stop',
  'classic keyboard paint commits server progress',
  'tiled completion shows the completion overlay in the player',
  'overview is preview-stable, work reloads tiles, 502 stays local and retry recovers',
  'progression-locked direct ID opens an actionable locked screen, not a generic error',
  'premium direct ID shows a neutral unavailable state without payment CTA',
  'catalog showcase stays fail-closed without a mounted payment adapter',
]).has(title));

const suites = {
  critical,
  'critical-webkit': criticalWebkit,
  'critical-pixel-a': criticalPixelA,
  'critical-pixel-b': criticalPixelB,
  extended: { files: ['e2e'] },
};

const suiteName = process.argv[2];
const suite = suites[suiteName];
if (!suite) {
  console.error(`Unknown E2E suite: ${suiteName || '(missing)'}. Expected: ${Object.keys(suites).join(', ')}`);
  process.exit(2);
}

const projectRoot = resolve(import.meta.dirname, '..');
assertE2ERuntime(projectRoot);
const playwrightCli = resolve(projectRoot, 'node_modules/@playwright/test/cli.js');
const forwardedArgs = process.argv.slice(3);

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runPlaywright(args, options = {}) {
  return spawnSync(process.execPath, [playwrightCli, 'test', ...args], {
    cwd: projectRoot,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'test',
      ...(options.env || {}),
    },
    windowsHide: true,
    encoding: 'utf8',
  });
}

function selectedProjectCount(args) {
  let count = 0;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--project' && args[index + 1]) {
      count += 1;
      index += 1;
    } else if (args[index].startsWith('--project=')) {
      count += 1;
    }
  }
  return count || 3;
}

let args;
if (Array.isArray(suite)) {
  const files = [...new Set(suite.map(({ file }) => file))];
  const grep = suite.map(({ title }) => escapedRegExp(title)).join('|');
  const list = runPlaywright(['--list', ...files, '--grep', grep, ...forwardedArgs], {
    capture: true,
    // Do not overwrite the real JSON/HTML result while checking membership.
    env: { CI: '', PLAYWRIGHT_JSON_OUTPUT_FILE: '', PLAYWRIGHT_HTML_OUTPUT_DIR: '' },
  });
  const listing = `${list.stdout || ''}\n${list.stderr || ''}`;
  const listedLines = listing.split(/\r?\n/).map((line) => line.trimEnd());
  const missing = suite
    .filter(({ title }) => !listedLines.some((line) => line.endsWith(`› ${title}`) || line.endsWith(`> ${title}`)))
    .map(({ title }) => title);
  const countMatch = listing.match(/Total:\s+(\d+)\s+tests?\s+in/);
  const listedCount = countMatch ? Number(countMatch[1]) : null;
  const expectedCount = suite.length * selectedProjectCount(forwardedArgs);
  if (list.status !== 0 || missing.length || listedCount !== expectedCount) {
    console.error('Critical E2E manifest preflight failed.');
    if (list.stdout) process.stderr.write(list.stdout);
    if (list.stderr) process.stderr.write(list.stderr);
    if (missing.length) console.error(`Missing critical titles: ${missing.join(' | ')}`);
    console.error(`Expected ${expectedCount} tests for ${suite.length} manifest entries; listed ${listedCount ?? 'unknown'}.`);
    process.exit(2);
  }
  args = [...files, '--grep', grep, ...forwardedArgs];
} else {
  args = suite.files.concat(forwardedArgs);
}

const result = runPlaywright(args);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
