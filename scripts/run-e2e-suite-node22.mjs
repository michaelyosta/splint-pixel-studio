import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (!process.versions.node.startsWith('22.')) {
  console.error(`E2E requires Node 22; detected ${process.versions.node}. Invoke this script with the Node 22 executable.`);
  process.exit(2);
}

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

const suites = {
  critical,
  extended: { files: ['e2e'] },
};

const suiteName = process.argv[2];
const suite = suites[suiteName];
if (!suite) {
  console.error(`Unknown E2E suite: ${suiteName || '(missing)'}. Expected: ${Object.keys(suites).join(', ')}`);
  process.exit(2);
}

const projectRoot = resolve(import.meta.dirname, '..');
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

let args;
if (suiteName === 'critical') {
  const files = [...new Set(suite.map(({ file }) => file))];
  const grep = suite.map(({ title }) => escapedRegExp(title)).join('|');
  const list = runPlaywright(['--list', ...files, '--grep', grep, ...forwardedArgs], {
    capture: true,
    // Do not overwrite the real JSON/HTML result while checking membership.
    env: { CI: '', PLAYWRIGHT_JSON_OUTPUT_FILE: '', PLAYWRIGHT_HTML_OUTPUT_DIR: '' },
  });
  const listing = `${list.stdout || ''}\n${list.stderr || ''}`;
  const missing = suite.filter(({ title }) => !listing.includes(title)).map(({ title }) => title);
  const countMatch = listing.match(/Total:\s+(\d+)\s+tests?\s+in/);
  const listedCount = countMatch ? Number(countMatch[1]) : null;
  if (list.status !== 0 || missing.length || listedCount !== suite.length) {
    console.error('Critical E2E manifest preflight failed.');
    if (list.stdout) process.stderr.write(list.stdout);
    if (list.stderr) process.stderr.write(list.stderr);
    if (missing.length) console.error(`Missing critical titles: ${missing.join(' | ')}`);
    console.error(`Expected ${suite.length} critical tests; listed ${listedCount ?? 'unknown'}.`);
    process.exit(2);
  }
  args = [...files, '--grep', grep, ...forwardedArgs];
} else {
  args = suite.files.concat(forwardedArgs);
}

const result = runPlaywright(args);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
