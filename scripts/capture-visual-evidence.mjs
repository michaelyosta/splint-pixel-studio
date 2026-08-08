import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = resolve(import.meta.dirname, '..');
const webPort = Number(process.env.VISUAL_EVIDENCE_WEB_PORT || 5290);
const apiPort = Number(process.env.VISUAL_EVIDENCE_API_PORT || 3112);
const evidenceDir = resolve(projectRoot, 'docs', 'evidence', 'visual-qa-2026-08-07');
const children = [];

async function isAvailable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(url, name) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isAvailable(url)) return;
    await delay(100);
  }
  throw new Error(`${name} did not become available at ${url}`);
}

function start(command, args, env, cwd) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
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

async function waitVisible(page, selector) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function capture(page, viewport, screen, selector, metrics) {
  await waitVisible(page, selector);
  await page.waitForTimeout(350);
  const safeName = `${screen}-${viewport.width}`;
  await page.screenshot({ path: resolve(evidenceDir, `${safeName}.png`) });
  const measurement = {
    viewport,
    screen,
    ...(await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      domNodes: document.querySelectorAll('*').length,
      canvasCount: document.querySelectorAll('canvas').length,
      canvasPixels: Array.from(document.querySelectorAll('canvas')).reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
      resourceCount: performance.getEntriesByType('resource').length,
      resourceBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      largestResources: performance.getEntriesByType('resource')
        .map((entry) => ({ name: entry.name, bytes: entry.encodedBodySize || 0 }))
        .filter((entry) => entry.bytes > 0)
        .sort((first, second) => second.bytes - first.bytes)
        .slice(0, 8),
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    }))),
  };
  metrics.push(measurement);
  return measurement;
}

mkdirSync(evidenceDir, { recursive: true });

const sharedEnv = {
  ...process.env,
  E2E_WEB_PORT: String(webPort),
  E2E_API_PORT: String(apiPort),
};
const metrics = [];

try {
  start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], sharedEnv, projectRoot);
  start(process.execPath, ['scripts/run-e2e-api.mjs'], sharedEnv, projectRoot);
  await waitFor(`http://127.0.0.1:${webPort}/`, 'Vite visual evidence server');
  await waitFor(`http://127.0.0.1:${apiPort}/health`, 'API visual evidence server');

  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: 'networkidle' });
      await capture(page, viewport, 'home', '.home-page', metrics);

      await page.locator('.app-tab-bar button[aria-label="Каталог"]').click();
      await capture(page, viewport, 'catalog', '.catalog-page', metrics);

      await page.locator('.app-tab-bar button[aria-label="Главная"]').click();
      await waitVisible(page, '.home-page');
      await page.locator('.home-featured-card, .home-continue-card, .home-art-card').first().click();
      const onboardingSkip = page.locator('.onboarding-card .secondary-button');
      await page.waitForTimeout(800);
      if (await onboardingSkip.isVisible().catch(() => false)) await onboardingSkip.click();
      await capture(page, viewport, 'player', '.player-page', metrics);

      await page.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: 'networkidle' });
      await page.locator('.app-tab-bar button[aria-label="Профиль"]').click();
      await capture(page, viewport, 'profile', '.profile-page', metrics);
      await context.close();
    }

    const tiledContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const tiledPage = await tiledContext.newPage();
    await tiledPage.setExtraHTTPHeaders({ 'X-User-Id': 'visual-evidence-1200' });
    await tiledPage.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: 'networkidle' });
    await tiledPage.getByText('Создать').first().click();
    await tiledPage.getByRole('button', { name: 'Из изображения' }).click();
    await waitVisible(tiledPage, '.creator-page');
    await tiledPage.locator('.file-field input[type="file"]').setInputFiles(resolve(projectRoot, 'public', 'assets', 'catalog', 'alpine-train.png'));
    await tiledPage.locator('.grid-detail-range').fill('18');
    await tiledPage.locator('button.create-button').first().click();
    await waitVisible(tiledPage, '.creator-previews');
    const saveButton = tiledPage.locator('button', { hasText: 'Сохранить и начать' });
    await saveButton.waitFor({ state: 'visible', timeout: 15_000 });
    await Promise.all([
      tiledPage.waitForResponse((response) => response.url().includes('/api/colorings/create')),
      saveButton.click(),
    ]);
    await waitVisible(tiledPage, '.creator-success-page');
    const tileResponses = [];
    tiledPage.on('response', (response) => {
      if (response.url().includes('/api/colorings/') && response.url().includes('/tiles/') && response.ok()) tileResponses.push(response.url());
    });
    const firstTileResponse = tiledPage.waitForResponse(
      (response) => response.url().includes('/api/colorings/') && response.url().includes('/tiles/') && response.ok(),
      { timeout: 20_000 },
    ).catch(() => null);
    await tiledPage.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
    const tiledOnboardingSkip = tiledPage.locator('.onboarding-card .secondary-button');
    await tiledPage.waitForTimeout(800);
    if (await tiledOnboardingSkip.isVisible().catch(() => false)) await tiledOnboardingSkip.click();
    await firstTileResponse;
    await tiledPage.waitForTimeout(250);
    const tiledMeasurement = await capture(tiledPage, { width: 390, height: 844 }, 'tiled-1200', '.progressive-coloring-session', metrics);
    const frameTiming = await tiledPage.evaluate(async () => {
      const samples = [];
      let previous = performance.now();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      for (let index = 0; index < 60; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        samples.push(now - previous);
        previous = now;
      }
      const ordered = [...samples].sort((first, second) => first - second);
      return {
        frames: samples.length,
        medianMs: Number(ordered[Math.floor(ordered.length / 2)].toFixed(2)),
        p95Ms: Number(ordered[Math.floor(ordered.length * 0.95)].toFixed(2)),
      };
    });
    const tiledBox = await tiledPage.locator('.progressive-coloring-session').boundingBox();
    if (tiledBox) {
      await tiledPage.mouse.move(tiledBox.x + tiledBox.width / 2, tiledBox.y + tiledBox.height / 2);
      await tiledPage.mouse.wheel(0, -480);
    }
    tiledMeasurement.frameTiming = frameTiming;
    tiledMeasurement.wheelInteraction = Boolean(tiledBox);
    tiledMeasurement.tileResponses = tileResponses.length;
    await tiledContext.close();
  } finally {
    await browser.close();
  }

  writeFileSync(resolve(evidenceDir, 'metrics.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    webPort,
    apiPort,
    screens: metrics,
  }, null, 2));
  console.log(`Visual evidence written to ${evidenceDir}`);
} finally {
  stop(children[1]);
  stop(children[0]);
}
