import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = resolve(import.meta.dirname, '..');
const webPort = Number(process.env.METRICS_WEB_PORT || 5390);
const apiPort = Number(process.env.METRICS_API_PORT || 3122);
const evidenceDir = resolve(projectRoot, 'docs', 'evidence');
const children = [];

async function isAvailable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(url, name) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isAvailable(url)) return;
    await delay(150);
  }
  throw new Error(`${name} did not become available at ${url}`);
}

function start(command, args, env, cwd) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

mkdirSync(evidenceDir, { recursive: true });

const sharedEnv = {
  ...process.env,
  E2E_WEB_PORT: String(webPort),
  E2E_API_PORT: String(apiPort),
};

let exitCode = 0;
try {
  start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], sharedEnv, projectRoot);
  start(process.execPath, ['scripts/run-e2e-api.mjs'], sharedEnv, projectRoot);
  await waitFor(`http://127.0.0.1:${webPort}/`, 'Vite metrics server');
  await waitFor(`http://127.0.0.1:${apiPort}/health`, 'API metrics server');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { 'X-User-Id': 'tiled-metrics-1' },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem('splint_onboarding_version', '2'); } catch {}
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
    });
  });

  await page.goto(`http://127.0.0.1:${webPort}/?splintMetrics=1`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Создать').first().click();
  await page.getByRole('button', { name: 'Из изображения' }).click();
  await page.locator('.file-field input[type="file"]').setInputFiles(resolve(projectRoot, 'e2e', 'fixtures', 'test-image.png'));
  await page.locator('.grid-detail-range').fill('18');
  await page.locator('button.create-button').first().click();
  await page.locator('.creator-previews').first().waitFor({ state: 'visible', timeout: 90_000 });
  const saveButton = page.locator('button', { hasText: 'Сохранить и начать' });
  await saveButton.waitFor({ state: 'visible', timeout: 20_000 });
  const [createResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/colorings/create')),
    saveButton.click(),
  ]);
  if (!createResponse.ok()) throw new Error(`create failed: ${createResponse.status()}`);
  const created = await createResponse.json();

  const firstTile = page.waitForResponse(
    (response) => response.url().includes('/api/colorings/') && response.url().includes('/tiles/') && response.ok(),
    { timeout: 30_000 },
  ).catch(() => null);
  await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
  await page.locator('.progressive-coloring-session').first().waitFor({ state: 'visible', timeout: 20_000 });
  await firstTile;
  await page.waitForTimeout(500);

  const canvas = page.locator('.progressive-grid-area canvas').first();
  await canvas.focus();
  const gridWidth = Number(await page.locator('.progressive-coloring-session').getAttribute('data-grid-width'));
  const cursorIndex = Number(await canvas.getAttribute('data-keyboard-cell'));
  const cursorX = cursorIndex % gridWidth;
  const cursorY = Math.floor(cursorIndex / gridWidth);
  const tileResponse = await page.request.get(`http://127.0.0.1:${apiPort}/colorings/${created.id}/tiles/${Math.floor(cursorX / 32)}/${Math.floor(cursorY / 32)}`);
  const tile = await tileResponse.json();
  const targetColor = Number(tile.cells[(cursorY % 32) * 32 + (cursorX % 32)]);
  const palette = page.getByRole('radiogroup', { name: 'Палитра цветов' });
  await palette.getByRole('radio').nth(targetColor).focus();
  await page.keyboard.press('Enter');
  await canvas.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);

  // Drag the canvas with a real touch drag while sampling frame deltas.
  const touch = await context.newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const box = await page.locator('.progressive-grid-area').boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.evaluate(() => {
    window.__frameSamples = [];
    let previous = performance.now();
    const sample = () => {
      const now = performance.now();
      window.__frameSamples.push(now - previous);
      previous = now;
      window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
  for (let step = 1; step <= 12; step += 1) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX + step * 10, y: startY + step * 8 }],
    });
    await delay(16);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(900);
  const frameSamples = await page.evaluate(() => window.__frameSamples || []);
  const ordered = [...frameSamples].sort((first, second) => first - second);
  const frameTiming = frameSamples.length
    ? {
        frames: frameSamples.length,
        medianMs: Number(ordered[Math.floor(ordered.length / 2)].toFixed(2)),
        p95Ms: Number(ordered[Math.floor(ordered.length * 0.95)].toFixed(2)),
      }
    : null;

  const metrics = await page.evaluate(() => ({ ...window.__splintTiledMetrics }));
  const evidence = {
    capturedAt: new Date().toISOString(),
    viewport: { width: 390, height: 844 },
    templateId: created.id,
    templateSize: `${created.width}x${created.height}`,
    interactions: ['keyboard_paint', 'touch_drag'],
    frameTiming,
    metrics,
  };
  const evidencePath = resolve(evidenceDir, 'device-metrics-2026-08-07.json');
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`Metrics written to ${evidencePath}`);
  console.log(JSON.stringify({
    firstTileMs: metrics.firstTileAt == null ? null : Math.round(metrics.firstTileAt - metrics.startedAt),
    commits: metrics.commits,
    interactionFps: metrics.interactionFps,
    maxFps: metrics.maxFps,
    cacheTiles: metrics.cacheTiles,
    cacheBytes: metrics.cacheBytes,
    domNodes: metrics.domNodes,
    heapMB: metrics.heapBytes == null ? null : Number((metrics.heapBytes / 1024 / 1024).toFixed(1)),
    frameTiming,
  }, null, 2));

  if (!metrics.firstTileAt || !metrics.commits) {
    throw new Error('Metrics did not record a first tile or a paint commit');
  }
  await browser.close();
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  stop(children[1]);
  stop(children[0]);
}
process.exit(exitCode);
