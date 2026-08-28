import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

// Alpha's visible glyph contract is intentionally bounded to the positive
// event family plus passive Artifact. Legacy Fuse/Choice/Hazard vocabulary is
// retained for server compatibility, not required in the player-facing RC.
const KINDS = ['spark', 'bomb', 'artifact'];
const LEGACY_GRID = 96;
const TILED_GRID = 160;
const TILE = 32;
const GLYPH_GRID_SIZE = 12;
const evidenceDir = resolve('docs/evidence/special-glyph-parity');

function legacyFixtureOwnerId(testInfo) {
  const identity = [
    testInfo.project.name,
    testInfo.testId,
    testInfo.repeatEachIndex,
    testInfo.retry,
  ].join(':');
  return `e2e_legacy_${createHash('sha256').update(identity).digest('hex')}`;
}

async function createLegacy(page, {
  cohort = 'treatment',
  allKinds = true,
  ownerId = 'user_special_glyph_legacy',
} = {}) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': ownerId });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort,
      storage: 'legacy',
      size: { width: LEGACY_GRID, height: LEGACY_GRID },
    },
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe(cohort);
  expect(fixture.storage).toBe('legacy');
  expect(fixture.size).toEqual({ width: LEGACY_GRID, height: LEGACY_GRID });
  expect(fixture.id).toContain(`tpl_cohort_e2e_${ownerId.slice(0, 24)}_`);
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  expect(progress.specials_experiment_group).toBe(cohort);
  if (allKinds) {
    expect(KINDS.filter((kind) => progress.specials.some((special) => special.kind === kind)))
      .toHaveLength(KINDS.length);
  }
  return { created: { id: fixture.id }, progress };
}

async function createTiled(page, { cohort = 'treatment', allKinds = true } = {}) {
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_glyph_tiled' });
  const fixtureResponse = await page.request.post('/api/__e2e/seed-cohort-template', {
    data: {
      cohort,
      storage: 'tiled',
      size: { width: TILED_GRID, height: TILED_GRID },
    },
  });
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json();
  expect(fixture.cohort).toBe(cohort);
  expect(fixture.storage).toBe('tiled');
  expect(fixture.size).toEqual({ width: TILED_GRID, height: TILED_GRID });
  const progressResponse = await page.request.get(`/api/colorings/${fixture.id}/progress`);
  expect(progressResponse.ok()).toBe(true);
  const progress = await progressResponse.json();
  expect(progress.specials_experiment_group).toBe(cohort);
  const specials = await findTiledSpecials(page, fixture.id);
  if (allKinds) {
    expect(KINDS.filter((kind) => specials.some((special) => special.kind === kind)))
      .toHaveLength(KINDS.length);
  }
  return { created: { id: fixture.id }, progress, specials };
}

async function findTiledSpecials(page, id) {
  const result = [];
  for (let tileY = 0; tileY < Math.ceil(TILED_GRID / TILE); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(TILED_GRID / TILE); tileX += 1) {
      const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
      expect(response.ok()).toBe(true);
      const tile = await response.json();
      for (const special of tile.specials || []) {
        if (special.state === 'unseen' && KINDS.includes(special.kind)) result.push(special);
      }
    }
  }
  return result.sort((a, b) => Number(a.cell_index) - Number(b.cell_index));
}

function onePerKind(specials, minSpacing = 48) {
  const chosen = [];
  for (const kind of KINDS) {
    const candidate = specials.find((special) => special.kind === kind
      && chosen.every((other) => Math.abs(Number(other.cell_index) - Number(special.cell_index)) > minSpacing));
    if (candidate) chosen.push(candidate);
  }
  return chosen;
}

async function openColoring(page, id, { width = 390, height = 844, splintMetrics = true } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('splint_onboarding_version', '2');
      // Evidence captures must not be relabeled by a nearby special cell.
      // The glyph under test is identified by the captured fixture, not by
      // the first contextual hint that becomes visible after camera movement.
      localStorage.setItem('splint_special_help_v1', JSON.stringify({
        version: 1,
        introSeen: true,
        kinds: ['spark', 'bomb', 'fuse', 'choice', 'artifact', 'hazard'],
      }));
    } catch {}
  });
  await page.goto(`/?${splintMetrics ? 'splintMetrics=1&' : ''}coloring=${id}`);
}

async function waitTiledWork(page) {
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toBeVisible({ timeout: 30000 });
  let lod = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await session.getAttribute('data-smart-state').catch(() => null);
    lod = await session.getAttribute('data-lod-mode').catch(() => null);
    if (state === 'ready' || state === 'freeExploration') break;
    if (state === 'errorRetryable') {
      const retry = page.locator('.progressive-grid-error button').first();
      if (await retry.isVisible().catch(() => false)) await retry.click();
    }
    await page.waitForTimeout(1000);
  }
  await expect(page.locator('.progressive-grid-area > canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.__splintClient?.getSnapshot?.()?.manifest)),
    { timeout: 30000 },
  ).toBe(true);
  if (lod !== 'work') {
    const canvas = page.locator('.progressive-grid-area > canvas');
    await canvas.focus();
    for (let step = 0; step < 20; step += 1) {
      await canvas.press('+');
      const current = await session.getAttribute('data-lod-mode');
      if (current === 'work') break;
    }
  }
}

async function readCamera(page, surface) {
  const root = surface === 'tiled'
    ? page.locator('.progressive-grid-area')
    : page.locator('.coloring-canvas-viewport');
  await expect(root).toBeVisible();
  return {
    x: Number(await root.getAttribute('data-camera-x')),
    y: Number(await root.getAttribute('data-camera-y')),
    zoom: Number(await root.getAttribute('data-camera-zoom')),
    box: await root.boundingBox(),
  };
}

async function centerCell(page, surface, cellIndex, gridWidth) {
  const canvas = page.locator(surface === 'tiled'
    ? '.progressive-grid-area > canvas'
    : 'canvas.coloring-canvas');
  await canvas.focus();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const camera = await readCamera(page, surface);
    if (camera.zoom >= 0.95) break;
    await canvas.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', {
      key: '+',
      code: 'Equal',
      bubbles: true,
      cancelable: true,
    })));
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const camera = await readCamera(page, surface);
    const worldX = ((cellIndex % gridWidth) + 0.5) * TILE;
    const worldY = ((Math.floor(cellIndex / gridWidth)) + 0.5) * TILE;
    const centerWorldX = (camera.box.width / 2 - camera.x) / camera.zoom;
    const centerWorldY = (camera.box.height / 2 - camera.y) / camera.zoom;
    const dx = Math.round((worldX - centerWorldX) / 96);
    const dy = Math.round((worldY - centerWorldY) / 96);
    const key = (axis, delta) => (axis === 'x' ? (delta > 0 ? 'Shift+ArrowLeft' : 'Shift+ArrowRight') : (delta > 0 ? 'Shift+ArrowUp' : 'Shift+ArrowDown'));
    for (let step = 0; step < Math.min(Math.abs(dx), 160); step += 1) {
      await canvas.evaluate((element, keyName) => element.dispatchEvent(new KeyboardEvent('keydown', {
        key: keyName,
        code: keyName,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })), key('x', dx).replace('Shift+', ''));
    }
    for (let step = 0; step < Math.min(Math.abs(dy), 160); step += 1) {
      await canvas.evaluate((element, keyName) => element.dispatchEvent(new KeyboardEvent('keydown', {
        key: keyName,
        code: keyName,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })), key('y', dy).replace('Shift+', ''));
    }
    await page.waitForTimeout(250);
    const after = await readCamera(page, surface);
    const viewLeft = (0 - after.x) / after.zoom;
    const viewRight = (after.box.width - after.x) / after.zoom;
    const viewTop = (0 - after.y) / after.zoom;
    const viewBottom = (after.box.height - after.y) / after.zoom;
    const visible = worldX >= viewLeft + 8
      && worldX <= viewRight - 8
      && worldY >= viewTop + 8
      && worldY <= viewBottom - 8;
    if (visible) return after;
  }
  const finalCamera = await readCamera(page, surface);
  throw new Error(`Could not center cell ${cellIndex} on ${surface}; camera=${JSON.stringify(finalCamera)}`);
}

function projectCell(cellIndex, gridWidth, camera) {
  const worldX = ((Number(cellIndex) % gridWidth) + 0.5) * TILE;
  const worldY = ((Math.floor(Number(cellIndex) / gridWidth)) + 0.5) * TILE;
  const x = worldX * camera.zoom + camera.x;
  const y = worldY * camera.zoom + camera.y;
  const margin = 8;
  return {
    x,
    y,
    visible: Number.isFinite(x) && Number.isFinite(y)
      && x >= margin
      && x <= camera.box.width - margin
      && y >= margin
      && y <= camera.box.height - margin,
  };
}

async function ensureTargetVisible(page, surface, cellIndex, gridWidth) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const camera = await readCamera(page, surface);
    const projection = projectCell(cellIndex, gridWidth, camera);
    if (projection.visible) return camera;
    await centerCell(page, surface, cellIndex, gridWidth);
  }
  const camera = await readCamera(page, surface);
  const projection = projectCell(cellIndex, gridWidth, camera);
  expect(projection.visible, `Target cell ${cellIndex} is outside the ${surface} canvas after bounded recenter: ${JSON.stringify({ camera, projection })}`).toBe(true);
  return camera;
}

async function waitForTile(page, cellIndex, gridWidth, expectedKind = null) {
  const x = cellIndex % gridWidth;
  const y = Math.floor(cellIndex / gridWidth);
  const key = `${Math.floor(x / TILE)}:${Math.floor(y / TILE)}`;
  await page.evaluate(async ({ tileX, tileY }) => {
    await window.__splintClient?.loadManifest?.();
    await window.__splintClient?.fetchTile?.(tileX, tileY, { force: true });
  }, { tileX: Math.floor(x / TILE), tileY: Math.floor(y / TILE) }).catch(() => {});
  await page.waitForFunction(({ tileKey, targetIndex, kind }) => {
    const tile = window.__splintClient?.cache?.peek?.(tileKey);
    if (!tile) return false;
    if (!kind) return true;
    return (tile.specials || []).some((special) => (
      Number(special.cellIndex ?? special.cell_index) === targetIndex
      && special.kind === kind
    ));
  }, { tileKey: key, targetIndex: Number(cellIndex), kind: expectedKind }, { timeout: 60000 });
  await page.waitForTimeout(300);
}

async function cleanCanvasForEvidence(page) {
  const sheet = page.locator('[data-special-help-open]');
  if (await sheet.isVisible().catch(() => false)) {
    const close = sheet.locator('.special-help-close');
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    else await sheet.click({ position: { x: 10, y: 10 } }).catch(() => {});
  }
  const hint = page.locator('[data-special-help-hint]');
  if (await hint.isVisible().catch(() => false)) {
    await hint.locator('.special-help-hint-close').click().catch(() => {});
  }
  const menu = page.locator('.bottom-sheet-close');
  if (await menu.isVisible().catch(() => false)) await menu.click().catch(() => {});
  const collapse = page.locator('.hud-btn--collapse');
  if (await collapse.isVisible().catch(() => false)) await collapse.click().catch(() => {});
  await page.waitForTimeout(250);
}

async function markerSignature(page, surface, cellIndex, gridWidth, kind) {
  const selector = surface === 'tiled'
    ? '.progressive-grid-area > canvas'
    : 'canvas.coloring-canvas';
  return page.evaluate(({
    selector: cssSelector,
    cellIndex: index,
    gridWidth: width,
    kind: markerKind,
    gridSize,
  }) => {
    const canvas = document.querySelector(cssSelector);
    const root = canvas.closest('.progressive-grid-area') || document.querySelector('.coloring-canvas-viewport');
    const ctx = canvas.getContext('2d');
    const client = window.__splintClient;
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const camera = {
      x: Number(root.dataset.cameraX || 0),
      y: Number(root.dataset.cameraY || 0),
      zoom: Number(root.dataset.cameraZoom || 1),
    };
    const worldX = ((index % width) + 0.5) * 32;
    const worldY = ((Math.floor(index / width)) + 0.5) * 32;
    const cx = (worldX * camera.zoom + camera.x) * dpr;
    const cy = (worldY * camera.zoom + camera.y) * dpr;
    const tileX = Math.floor((index % width) / 32);
    const tileY = Math.floor(Math.floor(index / width) / 32);
    const tileKey = `${tileX}:${tileY}`;
    const cachedTile = client?.cache?.peek?.(tileKey);
    const cacheTiles = client?.cache?.values?.() || [];
    const radius = 13 * dpr;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const size = Math.ceil(radius * 2);
    const widthPx = Math.min(canvas.width - x0, size);
    const heightPx = Math.min(canvas.height - y0, size);
    const data = ctx.getImageData(x0, y0, widthPx, heightPx).data;
    const isFamily = (r, g, b) => {
      if (markerKind === 'spark') return b > 180 && g > 160 && r < 180;
      if (markerKind === 'bomb' || markerKind === 'hazard') return r > 170 && r > g + 40 && r > b + 40;
      if (markerKind === 'fuse') return r > 190 && g > 120 && b < 140;
      if (markerKind === 'choice') return g > 140 && r < 200 && b > 90 && g > r + 15;
      if (markerKind === 'artifact') return r > 190 && g > 140 && b < 170 && r > b + 40;
      return false;
    };
    const isDark = (r, g, b) => r < 80 && g < 80 && b < 80;
    const grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));
    let familyCount = 0;
    let darkCount = 0;
    const probe = (dx, dy) => {
      const px = Math.floor(cx + dx * dpr);
      const py = Math.floor(cy + dy * dpr);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
      const localX = px - x0;
      const localY = py - y0;
      if (localX < 0 || localY < 0 || localX >= widthPx || localY >= heightPx) return false;
      const offset = (localY * widthPx + localX) * 4;
      return isFamily(data[offset], data[offset + 1], data[offset + 2]);
    };
    const probeDark = (dx, dy) => {
      const px = Math.floor(cx + dx * dpr);
      const py = Math.floor(cy + dy * dpr);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
      const localX = px - x0;
      const localY = py - y0;
      if (localX < 0 || localY < 0 || localX >= widthPx || localY >= heightPx) return false;
      const offset = (localY * widthPx + localX) * 4;
      return isDark(data[offset], data[offset + 1], data[offset + 2]);
    };
    const cellSpan = (radius * 2) / gridSize;
    const probeSpan = Math.max(1, cellSpan * 0.24);
    for (let gy = 0; gy < gridSize; gy += 1) {
      for (let gx = 0; gx < gridSize; gx += 1) {
        let hit = false;
        const centerOffsetX = -radius + (gx + 0.5) * cellSpan;
        const centerOffsetY = -radius + (gy + 0.5) * cellSpan;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const px = Math.floor(cx + centerOffsetX + dx * probeSpan);
            const py = Math.floor(cy + centerOffsetY + dy * probeSpan);
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
            const localX = px - x0;
            const localY = py - y0;
            if (localX < 0 || localY < 0 || localX >= widthPx || localY >= heightPx) continue;
            const offset = (localY * widthPx + localX) * 4;
            if (isFamily(data[offset], data[offset + 1], data[offset + 2])) {
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
        if (hit) {
          grid[gy][gx] = 1;
          familyCount += 1;
        }
      }
    }
    let familyPixels = 0;
    let familyMinX = widthPx;
    let familyMinY = heightPx;
    let familyMaxX = -1;
    let familyMaxY = -1;
    for (let py = Math.max(0, Math.floor(cy - radius)); py <= Math.min(canvas.height - 1, Math.floor(cy + radius)); py += 1) {
      for (let px = Math.max(0, Math.floor(cx - radius)); px <= Math.min(canvas.width - 1, Math.floor(cx + radius)); px += 1) {
        const localX = px - x0;
        const localY = py - y0;
        if (localX < 0 || localY < 0 || localX >= widthPx || localY >= heightPx) continue;
        const offset = (localY * widthPx + localX) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        if (isDark(r, g, b)) darkCount += 1;
        if (isFamily(r, g, b)) {
          familyPixels += 1;
          familyMinX = Math.min(familyMinX, localX);
          familyMinY = Math.min(familyMinY, localY);
          familyMaxX = Math.max(familyMaxX, localX);
          familyMaxY = Math.max(familyMaxY, localY);
        }
      }
    }
    return {
      kind: markerKind,
      familyCount,
      darkCount,
      grid,
      debug: {
        camera,
        dpr,
        canvas: {
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
          width: canvas.width,
          height: canvas.height,
          rect: canvas.getBoundingClientRect().toJSON(),
        },
        root: root?.getBoundingClientRect?.().toJSON?.() || null,
        world: { x: worldX, y: worldY },
        screen: { x: cx, y: cy },
        tileKey,
        cachedTile: cachedTile ? {
          key: cachedTile.key,
          offsetX: cachedTile.offsetX,
          offsetY: cachedTile.offsetY,
          width: cachedTile.width,
          height: cachedTile.height,
          localIndex: cachedTile.specials?.find((special) => Number(special.cellIndex) === index)?.localIndex ?? null,
          filled: cachedTile.filled?.[cachedTile.specials?.find((special) => Number(special.cellIndex) === index)?.localIndex ?? -1] ?? null,
          specials: cachedTile.specials,
        } : null,
        cacheKeys: cacheTiles.map((tile) => tile.key),
        cacheSpecials: cacheTiles.flatMap((tile) => (tile.specials || []).map((special) => ({
          tile: tile.key,
          ...special,
        }))),
        lod: document.querySelector('.progressive-coloring-session')?.dataset.lodMode || null,
        specialTreatment: document.querySelector('.progressive-coloring-session')?.dataset.specialTreatment || null,
        familyBounds: familyPixels ? {
          pixels: familyPixels,
          x: familyMinX,
          y: familyMinY,
          width: familyMaxX - familyMinX + 1,
          height: familyMaxY - familyMinY + 1,
        } : null,
      },
      probes: {
        north: probe(0, -8),
        south: probe(0, 7),
        east: probe(8, 0),
        west: probe(-8, 0),
        center: probe(0, 0),
        northDark: probeDark(0, -9),
        bottomDark: probeDark(0, 7),
      },
    };
  }, { selector, cellIndex, gridWidth, kind, gridSize: GLYPH_GRID_SIZE });
}

function assertMarkerShape(signature, context = '') {
  expect(signature.familyCount, `${context}${signature.kind} marker family mask missing: ${JSON.stringify({
    grid: signature.grid,
    debug: signature.debug,
  })}`)
    .toBeGreaterThanOrEqual(8);
  if (signature.kind === 'bomb' || signature.kind === 'hazard') {
    expect(signature.darkCount).toBeGreaterThanOrEqual(3);
  }
}

function hamming(first, second) {
  let distance = 0;
  for (let y = 0; y < first.grid.length; y += 1) {
    for (let x = 0; x < first.grid[y].length; x += 1) {
      if (first.grid[y][x] !== second.grid[y][x]) distance += 1;
    }
  }
  return distance;
}

async function captureGlyph(page, surface, special, gridWidth, width, {
  theme = 'dark',
  reducedMotion = false,
  reveal = false,
  directory = 'final',
} = {}) {
  mkdirSync(resolve(evidenceDir, directory), { recursive: true });
  await cleanCanvasForEvidence(page);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  if (theme === 'light') {
    await page.evaluate(() => { document.documentElement.dataset.tgTheme = 'light'; });
  } else {
    await page.evaluate(() => { delete document.documentElement.dataset.tgTheme; });
  }
  if (reveal) await openRevealMode(page);
  else await ensureClassicMode(page);
  await cleanCanvasForEvidence(page);
  await centerCell(page, surface, Number(special.cell_index), gridWidth);
  if (surface === 'tiled') {
    await waitForTile(page, Number(special.cell_index), gridWidth, special.kind);
    await ensureTargetVisible(page, surface, Number(special.cell_index), gridWidth);
  }
  const signature = await markerSignature(page, surface, Number(special.cell_index), gridWidth, special.kind);
  assertMarkerShape(signature, `${surface}-${theme}-${reveal ? 'reveal-' : ''}${reducedMotion ? 'reduced-' : ''}${width}: `);
  await page.screenshot({
    path: resolve(evidenceDir, directory, `${surface}-${theme}-${reveal ? 'reveal-' : ''}${reducedMotion ? 'reduced-' : ''}${width}-${special.kind}.png`),
    fullPage: false,
  });
  return signature;
}

async function openRevealMode(page) {
  await page.locator('.player-menu-btn').click();
  const revealAction = page.locator('.bottom-sheet-actions button', { hasText: '\u0420\u0435\u0436\u0438\u043c \u0440\u0430\u0441\u043a\u0440\u044b\u0442\u0438\u044f' });
  if (await revealAction.isVisible().catch(() => false)) {
    await revealAction.click();
  } else {
    await page.locator('.bottom-sheet-close').click().catch(() => {});
  }
}

async function ensureClassicMode(page) {
  await page.locator('.player-menu-btn').click();
  const classicAction = page.locator('.bottom-sheet-actions button', { hasText: '\u041f\u043e \u043d\u043e\u043c\u0435\u0440\u0430\u043c' });
  if (await classicAction.isVisible().catch(() => false)) {
    await classicAction.click();
  } else {
    await page.locator('.bottom-sheet-close').click().catch(() => {});
  }
}

async function moveToCell(page, surface, cellIndex, gridWidth) {
  const canvas = page.locator(surface === 'tiled'
    ? '.progressive-grid-area > canvas'
    : 'canvas.coloring-canvas');
  await canvas.focus();
  await canvas.press('Home');
  const x = cellIndex % gridWidth;
  const y = Math.floor(cellIndex / gridWidth);
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(cellIndex), { timeout: 15000 });
}

async function claimRequests(page, id, type) {
  const requests = [];
  const handler = (response) => {
    if (!response.url().includes(`/colorings/${id}/progress/actions`) || response.request().method() !== 'POST') return;
    try {
      if (response.request().postDataJSON()?.special_action?.type === type) requests.push(response);
    } catch {}
  };
  page.on('response', handler);
  return { requests, handler };
}

async function readProgress(page, id) {
  const response = await page.request.get(`/api/colorings/${id}/progress`);
  expect(response.ok()).toBe(true);
  return response.json();
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
    });
  });
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_${testInfo.testId}` });
});

test('legacy glyph masks are distinct and readable for active Alpha kinds', async ({ page }) => {
  test.setTimeout(240000);
  mkdirSync(evidenceDir, { recursive: true });
  const { created, progress } = await createLegacy(page);
  const selected = onePerKind(progress.specials, 16);
  expect(new Set(selected.map((special) => special.kind)).size).toBe(KINDS.length);
  const signatures = [];
  for (const width of [360, 390, 430]) {
    await openColoring(page, created.id, { width });
    await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment', { timeout: 30000 });
    await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false', { timeout: 15000 });
    const canvas = page.locator('canvas.coloring-canvas');
    await canvas.focus();
    for (let step = 0; step < 20; step += 1) {
      const camera = await readCamera(page, 'legacy');
      if (camera.zoom >= 1) break;
      await canvas.press('+');
    }
    for (const special of selected) {
      signatures.push(await captureGlyph(page, 'legacy', special, LEGACY_GRID, width));
    }
  }
  await openColoring(page, created.id, { width: 390 });
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment', { timeout: 30000 });
  for (const special of selected) {
    await captureGlyph(page, 'legacy', special, LEGACY_GRID, 390, { theme: 'light' });
    await captureGlyph(page, 'legacy', special, LEGACY_GRID, 390, { reveal: true });
  }
  for (let first = 0; first < signatures.length; first += 1) {
    for (let second = first + 1; second < signatures.length; second += 1) {
      if (signatures[first].kind === signatures[second].kind) continue;
      const distance = hamming(signatures[first], signatures[second]);
      expect(distance, [
        `${signatures[first].kind} vs ${signatures[second].kind}`,
        `first=${JSON.stringify(signatures[first].grid)}`,
        `second=${JSON.stringify(signatures[second].grid)}`,
      ].join(' ')).toBeGreaterThan(0);
    }
  }
});

test('tiled glyph masks are distinct, hidden in overview, and readable at low zoom for active Alpha kinds', async ({ page }) => {
  test.setTimeout(300000);
  mkdirSync(evidenceDir, { recursive: true });
  const { created, specials } = await createTiled(page);
  const selected = onePerKind(specials);
  expect(new Set(selected.map((special) => special.kind)).size).toBe(KINDS.length);

  await openColoring(page, created.id, { width: 390 });
  await waitTiledWork(page);
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
  const signatures = [];
  for (const width of [360, 390, 430]) {
    await openColoring(page, created.id, { width });
    await waitTiledWork(page);
    await expect(session).toHaveAttribute('data-special-treatment', 'treatment', { timeout: 30000 });
    for (const special of selected) {
      signatures.push(await captureGlyph(page, 'tiled', special, TILED_GRID, width));
    }
  }
  await openColoring(page, created.id, { width: 390 });
  await waitTiledWork(page);
  for (const special of selected) {
    await captureGlyph(page, 'tiled', special, TILED_GRID, 390, { theme: 'light' });
    await captureGlyph(page, 'tiled', special, TILED_GRID, 390, { reveal: true });
  }
  for (let first = 0; first < signatures.length; first += 1) {
    for (let second = first + 1; second < signatures.length; second += 1) {
      if (signatures[first].kind === signatures[second].kind) continue;
      const distance = hamming(signatures[first], signatures[second]);
      expect(distance, [
        `${signatures[first].kind} vs ${signatures[second].kind}`,
        `first=${JSON.stringify(signatures[first].grid)}`,
        `second=${JSON.stringify(signatures[second].grid)}`,
      ].join(' ')).toBeGreaterThan(0);
    }
  }

  const probe = await page.evaluate(() => {
    const session = document.querySelector('.progressive-coloring-session');
    return session?.dataset.lodMode;
  });
  expect(probe).toBe('work');

  // Work LOD low zoom still draws a bounded screen-space marker.
  const canvas = page.locator('.progressive-grid-area > canvas');
  await centerCell(page, 'tiled', Number(selected[0].cell_index), TILED_GRID);
  await waitForTile(page, Number(selected[0].cell_index), TILED_GRID, selected[0].kind);
  await ensureTargetVisible(page, 'tiled', Number(selected[0].cell_index), TILED_GRID);
  await canvas.focus();
  // Keep this in low-zoom WORK rather than driving into the runtime floor
  // (MIN_ZOOM=0.08), so the assertion exercises the readable transition.
  for (let step = 0; step < 11; step += 1) await canvas.press('-');
  const camera = await readCamera(page, 'tiled');
  expect(camera.zoom).toBeLessThan(0.3);
  expect(camera.zoom).toBeGreaterThan(0.13);
  const low = await markerSignature(page, 'tiled', Number(selected[0].cell_index), TILED_GRID, selected[0].kind);
  expect(low.familyCount).toBeGreaterThan(0);
  expect(low.debug.familyBounds?.width).toBeGreaterThanOrEqual(7);
  expect(low.debug.familyBounds?.height).toBeGreaterThanOrEqual(7);
  expect(low.debug.familyBounds?.width).toBeLessThanOrEqual(24);
  expect(low.debug.familyBounds?.height).toBeLessThanOrEqual(24);
  await page.screenshot({ path: resolve(evidenceDir, `tiled-dark-390-low-zoom-${selected[0].kind}.png`), fullPage: false });

  // Overview must not render special markers.
  await canvas.press('0');
  await expect(page.locator('.progressive-coloring-session')).toHaveAttribute('data-lod-mode', 'overview', { timeout: 10000 });
  const overview = await markerSignature(page, 'tiled', Number(selected[0].cell_index), TILED_GRID, selected[0].kind);
  expect(overview.familyCount).toBe(0);
  await page.screenshot({ path: resolve(evidenceDir, 'tiled-dark-390-overview-no-markers.png'), fullPage: false });
});

test('tiled reveal claims exactly once and survives reload without duplicate', async ({ page }) => {
  test.setTimeout(120000);
  const { created, specials } = await createTiled(page);
  const spark = specials.find((special) => special.kind === 'spark');
  expect(spark).toBeTruthy();
  await openColoring(page, created.id, { width: 390 });
  await waitTiledWork(page);
  await openRevealMode(page);
  await moveToCell(page, 'tiled', Number(spark.cell_index), TILED_GRID);
  await page.evaluate(async ({ cellIndex, gridWidth, tileSize }) => {
    const tileX = Math.floor((Number(cellIndex) % gridWidth) / tileSize);
    const tileY = Math.floor(Math.floor(Number(cellIndex) / gridWidth) / tileSize);
    const client = window.__splintClient;
    await client?.loadManifest?.();
    await client?.fetchTile(tileX, tileY, { force: true });
    client?.cache?.pin?.(`${tileX}:${tileY}`);
  }, { cellIndex: Number(spark.cell_index), gridWidth: TILED_GRID, tileSize: TILE });
  await waitForTile(page, Number(spark.cell_index), TILED_GRID, spark.kind);
  const capture = await claimRequests(page, created.id, 'claim_spark');
  const useCapture = await claimRequests(page, created.id, 'use_spark');
  const canvas = page.locator('.progressive-grid-area > canvas');
  await canvas.press('Enter');
  await expect.poll(() => capture.requests.length, { timeout: 15000 }).toBe(1);
  await expect.poll(
    () => useCapture.requests.length || page.locator('.progressive-grid-special-offer').count(),
    { timeout: 15000 },
  ).toBeGreaterThan(0);
  if (useCapture.requests.length) {
    expect(useCapture.requests.at(-1).status()).toBe(200);
    await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(0, { timeout: 15000 });
  } else {
    await expect(page.locator('.progressive-grid-special-offer')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(1);
  }
  page.off('response', capture.handler);
  page.off('response', useCapture.handler);

  await page.reload();
  await waitTiledWork(page);
  const tiledAfterReload = await (await page.request.get(`/api/colorings/${created.id}/progress`)).json();
  await expect(page.locator('.progressive-grid-special-offer')).toHaveCount(tiledAfterReload.special_offer ? 1 : 0, { timeout: 15000 });
  await expect(page.locator('[data-special-discovered]')).toHaveCount(0);
});

test('legacy reveal claims exactly once and survives reload without duplicate', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const ownerId = legacyFixtureOwnerId(testInfo);
  const { created, progress } = await createLegacy(page, { ownerId, allKinds: false });
  const spark = progress.specials.find((special) => special.kind === 'spark');
  expect(spark).toBeTruthy();
  await openColoring(page, created.id, { width: 390 });
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment', { timeout: 30000 });
  await openRevealMode(page);
  await moveToCell(page, 'legacy', Number(spark.cell_index), LEGACY_GRID);
  const beforeClaim = await readProgress(page, created.id);
  expect(beforeClaim.specials.find((special) => special.id === spark.id)).toMatchObject({
    state: 'unseen',
    filled: -1,
  });
  expect(beforeClaim.filled[Number(spark.cell_index)]).toBe(-1);
  const capture = await claimRequests(page, created.id, 'claim_spark');
  const useCapture = await claimRequests(page, created.id, 'use_spark');
  const canvas = page.locator('canvas.coloring-canvas');
  await canvas.press('Enter');
  await expect.poll(() => capture.requests.length, { timeout: 15000 }).toBe(1);
  expect(capture.requests).toHaveLength(1);
  const claimResponse = capture.requests[0];
  expect(claimResponse.status()).toBe(200);
  const claimed = await claimResponse.json();
  expect(claimed.special_offer).toMatchObject({
    kind: 'spark',
    special_id: String(spark.id),
    offer_token: expect.any(String),
  });
  expect(claimed.special_offer.auto_apply).toEqual(expect.any(Boolean));

  if (claimed.special_offer.auto_apply === true) {
    await expect.poll(() => useCapture.requests.length, { timeout: 15000 }).toBe(1);
    expect(useCapture.requests).toHaveLength(1);
    const useResponse = useCapture.requests[0];
    expect(useResponse.status()).toBe(200);
    const used = await useResponse.json();
    expect(used.special_applied_changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: expect.any(Number), color: expect.any(Number) }),
    ]));

    const persistedAfterUse = await readProgress(page, created.id);
    expect(persistedAfterUse.special_offer).toBeNull();
    expect(persistedAfterUse.revision).toBe(used.revision);
    for (const change of used.special_applied_changes) {
      expect(persistedAfterUse.filled[change.index]).toBe(change.color);
    }
    await expect(page.locator('.legacy-grid-special-offer[data-special-kind="spark"]')).toHaveCount(0, { timeout: 15000 });
  } else {
    const stableOffer = page.locator('.legacy-grid-special-offer[data-special-kind="spark"]');
    await expect.poll(async () => {
      const persisted = await readProgress(page, created.id);
      return persisted.special_offer?.offer_token === claimed.special_offer.offer_token;
    }, { timeout: 15000 }).toBe(true);
    expect(useCapture.requests).toHaveLength(0);
    await expect(stableOffer).toBeVisible({ timeout: 15000 });
    await expect(stableOffer).toHaveCount(1);
    expect(await stableOffer.getAttribute('data-special-auto-apply')).not.toBe('true');
  }
  page.off('response', capture.handler);
  page.off('response', useCapture.handler);

  await page.reload();
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment', { timeout: 30000 });
  const legacyAfterReload = await readProgress(page, created.id);
  await expect(page.locator('.legacy-grid-special-offer[data-special-kind="spark"]')).toHaveCount(
    legacyAfterReload.special_offer ? 1 : 0,
    { timeout: 15000 },
  );
  await expect(page.locator('[data-special-discovered]')).toHaveCount(0);
});

test('control reveal renders no markers and emits no special event', async ({ page }) => {
  test.setTimeout(120000);
  const legacy = await createLegacy(page, { cohort: 'control', allKinds: false });
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_glyph_legacy' });
  const tiled = await createTiled(page, { cohort: 'control', allKinds: false });
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_glyph_tiled' });
  const legacyCapture = await claimRequests(page, legacy.created.id, 'claim_spark');
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_glyph_legacy' });
  await openColoring(page, legacy.created.id, { width: 390 });
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'control', { timeout: 30000 });
  await openRevealMode(page);
  await cleanCanvasForEvidence(page);
  mkdirSync(resolve(evidenceDir, 'final/control'), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir, 'final/control/legacy-control-390.png'), fullPage: false });
  const legacyCanvas = page.locator('canvas.coloring-canvas');
  await legacyCanvas.focus();
  await legacyCanvas.press('Enter');
  await page.waitForTimeout(500);
  expect(legacyCapture.requests.length).toBe(0);
  expect(await page.locator('.legacy-grid-special-offer').count()).toBe(0);
  page.off('response', legacyCapture.handler);

  const tiledCapture = await claimRequests(page, tiled.created.id, 'claim_spark');
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_glyph_tiled' });
  await openColoring(page, tiled.created.id, { width: 390 });
  await waitTiledWork(page);
  await openRevealMode(page);
  await cleanCanvasForEvidence(page);
  await page.screenshot({ path: resolve(evidenceDir, 'final/control/tiled-control-390.png'), fullPage: false });
  const tiledCanvas = page.locator('.progressive-grid-area > canvas');
  await tiledCanvas.focus();
  await tiledCanvas.press('Enter');
  await page.waitForTimeout(500);
  expect(tiledCapture.requests.length).toBe(0);
  expect(await page.locator('.progressive-grid-special-offer').count()).toBe(0);
  page.off('response', tiledCapture.handler);
});

test('menu-open overlap QA screenshots stay separate from final evidence', async ({ page }) => {
  test.setTimeout(180000);
  mkdirSync(resolve(evidenceDir, 'overlap'), { recursive: true });
  const legacy = await createLegacy(page, { allKinds: false });
  await openColoring(page, legacy.created.id, { width: 390 });
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-special-cohort', 'treatment', { timeout: 30000 });
  await page.locator('.player-menu-btn').click();
  await expect(page.locator('.bottom-sheet')).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, 'overlap/legacy-menu-open-390.png'), fullPage: false });
  await page.locator('.bottom-sheet-close').click();

  const tiled = await createTiled(page, { allKinds: false });
  await page.context().setExtraHTTPHeaders({ 'X-User-Id': 'user_special_glyph_tiled' });
  await openColoring(page, tiled.created.id, { width: 390 });
  await waitTiledWork(page);
  await page.locator('.player-menu-btn').click();
  await expect(page.locator('.bottom-sheet')).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, 'overlap/tiled-menu-open-390.png'), fullPage: false });
});
