import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (!process.versions.node.startsWith('22.')) {
  console.error(`E2E requires Node 22; detected ${process.versions.node}. Invoke this script with the Node 22 executable.`);
  process.exit(2);
}

const suites = {
  critical: [
    'e2e/accessibility-1200.spec.js:70',
    'e2e/bfcache-lifecycle.spec.js:113',
    'e2e/coloring-surface-gesture-guard.spec.js:164',
    'e2e/creator.spec.js:177',
    'e2e/creator.spec.js:221',
    'e2e/creator.spec.js:276',
    'e2e/creator.spec.js:394',
    'e2e/guided-path.spec.js:55',
    'e2e/guided-path.spec.js:65',
    'e2e/guided-player.spec.js:36',
    'e2e/input-gesture-evidence.spec.js:57',
    'e2e/input-gesture-evidence.spec.js:69',
    'e2e/p0-final-acceptance.spec.js:22',
    'e2e/recovery-p0.spec.js:40',
    'e2e/special-cells-1200-delivery.spec.js:322',
    'e2e/tiled-completion.spec.js:3',
    'e2e/tiled-low-zoom.spec.js:85',
    'e2e/tiled-reload-journal.spec.js:65',
    'e2e/tiled-stroke-engine.spec.js:309',
    'e2e/tiled-stroke-engine.spec.js:443',
    'e2e/unlocks-recommendations.spec.js:159',
    'e2e/unlocks-recommendations.spec.js:201',
    'e2e/unlocks-recommendations.spec.js:224',
  ],
  extended: ['e2e'],
};

const suiteName = process.argv[2];
const selectors = suites[suiteName];
if (!selectors) {
  console.error(`Unknown E2E suite: ${suiteName || '(missing)'}. Expected: ${Object.keys(suites).join(', ')}`);
  process.exit(2);
}

const projectRoot = resolve(import.meta.dirname, '..');
const playwrightCli = resolve(projectRoot, 'node_modules/@playwright/test/cli.js');
const result = spawnSync(process.execPath, [playwrightCli, 'test', ...selectors, ...process.argv.slice(3)], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'test',
  },
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
