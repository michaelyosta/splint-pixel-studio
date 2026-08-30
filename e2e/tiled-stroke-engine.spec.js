import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * TILED STROKE ENGINE E2E — "does paint follow the finger?"
 *
 * Uses a real touch-emulated pointer path (CDP Input.dispatchTouchEvent) on a
 * 1200x1200 template whose flat color bands guarantee 30+ valid cells in a
 * horizontal line. The smart engine has already selected a color and parked
 * the camera on its target, so the tests paint a line of the ACTIVE color
 * right under the camera — no palette interaction, no minimap (both would
 * re-plan guidance / hit the minimap viewport frame and move the camera).
 *
 * Asserts:
 *  1. cells fill WHILE the finger is still down (mid-drag canvas pixel probe,
 *     before pointerup and before any /progress/actions POST),
 *  2. pointerup finalization is bounded (stroke metrics, ?splintMetrics=1),
 *  3. the server commits the same cells (authoritative progress),
 *  4. a second stroke starts immediately (no finalization hitch),
 *  5. a drag across a tile boundary paints every valid cell.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(__dirname, 'fixtures', 'stroke-bars.png');
const evidenceDir = resolve(__dirname, '..', 'docs', 'evidence');

const GRID = 1200;
const CELL = 32;

async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

async function createAndOpenBarsColoring(page) {
  // ?splintMetrics=1 must be present when the app module loads so the
  // stroke recorder is compiled in.
  await page.goto('/?splintMetrics=1');
  await page.getByText('Создать').first().click();
  await page.getByRole('button', { name: 'Из изображения' }).click();
  await expect(page.locator('.creator-page')).toBeVisible({ timeout: 10000 });
  await page.locator('.file-field input[type="file"]').setInputFiles([fixture]);
  // Select the named preset so the same React path as a user click updates
  // both the selected resolution and the authoritative preview fingerprint.
  await page.getByRole('button', { name: 'Сетка 1200 на 1200' }).click();
  await expect(page.locator('.creator-previews')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.creator-preview-option.selected')).toHaveAttribute('data-status', 'ready', { timeout: 120000 });
  const saveButton = page.locator('button', { hasText: 'Сохранить и начать' });
  await expect(saveButton).toBeEnabled({ timeout: 120000 });
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/colorings/create')),
    saveButton.click(),
  ]);
  expect(response.status()).toBe(201);
  const created = await response.json();
  await expect(page.locator('.creator-success-page')).toBeVisible({ timeout: 30000 });
  await page.locator('.creator-success-page button:has-text("Начать раскрашивать")').click();
  await expect(page.locator('.progressive-coloring-session')).toBeVisible({ timeout: 45000 });
  await dismissOnboarding(page);
  return created.id;
}

async function waitForTiledReady(page) {
  const canvas = page.locator('.progressive-grid-area canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const session = page.locator('.progressive-coloring-session');
  await expect(session).toHaveAttribute('data-smart-state', 'ready', { timeout: 30000 });
  await expect.poll(
    () => page.evaluate(() => Boolean(window.__splintClient?.getSnapshot?.()?.manifest)),
    { timeout: 30000, message: 'tiled client manifest must be loaded before the stroke setup' },
  ).toBe(true);
}

async function waitForTileNetworkIdle(page) {
  await expect.poll(
    () => page.evaluate(() => {
      const stats = window.__splintClient?.getNetworkStats?.();
      const snapshot = window.__splintClient?.getSnapshot?.();
      return {
        activeTileRequests: Number(stats?.activeTileRequests || 0),
        pendingTiles: snapshot?.pendingTiles?.length || 0,
      };
    }),
    { timeout: 60000, message: 'tiled viewport work must settle before the stroke begins' },
  ).toEqual({ activeTileRequests: 0, pendingTiles: 0 });
}

async function readCamera(page) {
  const area = page.locator('.progressive-grid-area');
  return {
    x: Number(await area.getAttribute('data-camera-x')),
    y: Number(await area.getAttribute('data-camera-y')),
    zoom: Number(await area.getAttribute('data-camera-zoom')),
  };
}

async function cellUnderViewportCenter(page, viewportBox) {
  const cam = await readCamera(page);
  return {
    x: Math.floor((viewportBox.width / 2 - cam.x) / cam.zoom / CELL),
    y: Math.floor((viewportBox.height / 2 - cam.y) / cam.zoom / CELL),
    cam,
  };
}

async function fetchTile(page, id, tileX, tileY) {
  const response = await page.request.get(`/api/colorings/${id}/tiles/${tileX}/${tileY}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

/** Row of target colors for cells [xFrom..xTo] at row y (via tile API). */
async function readRow(page, id, y, xFrom, xTo) {
  const cells = [];
  const minTx = Math.floor(xFrom / 32);
  const maxTx = Math.floor(xTo / 32);
  for (let tx = minTx; tx <= maxTx; tx += 1) {
    const tile = await fetchTile(page, id, tx, Math.floor(y / 32));
    for (let x = Math.max(xFrom, tx * 32); x <= Math.min(xTo, tx * 32 + tile.tile.width - 1); x += 1) {
      const localIndex = (y % 32) * tile.tile.width + (x % 32);
      cells.push({ x, color: Number(tile.cells[localIndex]) });
    }
  }
  return cells;
}

/** Longest same-color horizontal run in the row, length >= minLength. */
function findLongestRun(row, minLength) {
  let best = null;
  let runStart = row[0]?.x ?? 0;
  let runColor = row[0]?.color ?? -1;
  let runLen = 1;
  for (let i = 1; i <= row.length; i += 1) {
    const current = row[i];
    if (current && current.color === runColor) {
      runLen += 1;
      continue;
    }
    if (runLen >= minLength && (!best || runLen > best.length)) {
      best = { color: runColor, start: runStart, length: runLen };
    }
    if (current) {
      runStart = current.x;
      runColor = current.color;
      runLen = 1;
    }
  }
  return best;
}

/**
 * Find a horizontal line of `color` near the camera center (cx, cy): scans
 * rows cy±6 for a run >= minRun in [cx-70, cx+70]. With crossBoundary,
 * returns a line across the tile boundary (k*32) nearest to cx instead.
 */
async function findLineUnderCamera(page, id, cx, cy, color, { crossBoundary = false, minRun = 60 } = {}) {
  for (let yOff = 0; yOff <= 6; yOff += 1) {
    for (const y of [cy + yOff, cy - yOff]) {
      if (y < 8 || y > GRID - 8) continue;
      const row = await readRow(page, id, y, Math.max(0, cx - 70), Math.min(GRID - 1, cx + 70));
      const run = findLongestRun(row, minRun);
      if (!run || run.color !== color) continue;
      const runEnd = run.start + run.length - 1;
      if (!crossBoundary) {
        const lineStart = Math.min(Math.max(cx - 15, run.start), runEnd - 29);
        if (lineStart < run.start) continue;
        return { y, lineStart, lineEnd: lineStart + 29, runStart: run.start, runEnd };
      }
      const boundary = Math.max(run.start + 1, Math.min(runEnd - 1, Math.round(cx / 32) * 32));
      if (Math.abs(boundary - cx) > 16) continue;
      const lineStart = boundary - 13;
      const lineEnd = boundary + 13;
      return { y, lineStart, lineEnd, boundary, runStart: run.start, runEnd };
    }
  }
  return null;
}

/** The palette color the smart engine currently has selected (0-based). */
async function selectedPaletteColor(page) {
  const checked = page.locator('.palette .color-swatch[data-state="selected"]');
  await expect(checked).toHaveCount(1, { timeout: 5000 });
  const label = await checked.first().textContent();
  return Number(label.trim()) - 1;
}

/** The CSS rgb of a swatch: "rgb(230, 57, 70)" from the <i> background. */
async function swatchRgb(page, colorIndex) {
  const css = await page.evaluate((index) => {
    const swatches = document.querySelectorAll('.palette .color-swatch');
    const icon = swatches[index]?.querySelector('i');
    return icon ? getComputedStyle(icon).backgroundColor : null;
  }, colorIndex);
  return css ? css.match(/\d+/g).slice(0, 3).map(Number) : null;
}

async function zoomOutTo(page, targetZoom) {
  const zoomOut = page.locator('.progressive-grid-controls button[aria-label="Уменьшить"]');
  for (let i = 0; i < 12; i += 1) {
    const cam = await readCamera(page);
    if (cam.zoom <= targetZoom) break;
    await zoomOut.click();
    await page.waitForTimeout(150);
  }
  return readCamera(page);
}

function cellToScreen(cellX, cellY, cam, viewportBox) {
  return {
    // Touch the cell center, not its top-left edge. An endpoint exactly on a
    // cell boundary is resolved by floor() to the preceding cell and makes
    // the stroke verifier depend on sub-pixel camera rounding.
    x: viewportBox.x + (cellX + 0.5) * CELL * cam.zoom + cam.x,
    y: viewportBox.y + (cellY + 0.5) * CELL * cam.zoom + cam.y,
  };
}

/** Map a screen point to the world cell the engine would paint there. */
async function mapScreenToCell(page, sx, sy) {
  return page.evaluate(({ sx, sy }) => {
    const area = document.querySelector('.progressive-grid-area');
    const client = window.__splintClient;
    const cam = {
      x: Number(area.getAttribute('data-camera-x')),
      y: Number(area.getAttribute('data-camera-y')),
      zoom: Number(area.getAttribute('data-camera-zoom')),
    };
    const rect = area.getBoundingClientRect();
    const cell = client?.mapPointer({ clientX: sx, clientY: sy, rect, camera: cam, cellSize: 32 });
    return cell ? { x: cell.x, y: cell.y } : null;
  }, { sx, sy });
}

/** Find the row actually painted by the live stroke (cache-level scan). */
async function findPaintedRow(page, x, yGuess) {
  return page.evaluate(({ x, yGuess }) => {
    const client = window.__splintClient;
    for (let y = yGuess + 2; y >= yGuess - 2; y -= 1) {
      const cell = client?.getCell(x, y);
      if (cell && cell.filled !== -1) return y;
    }
    return null;
  }, { x, yGuess });
}

/** Read the canvas pixel at the center of a world cell. */
async function canvasPixelAt(page, cellX, cellY) {
  return page.evaluate(({ gx, gy }) => {
    const area = document.querySelector('.progressive-grid-area');
    const canvas = area.querySelector('canvas');
    const cam = {
      x: Number(area.getAttribute('data-camera-x')),
      y: Number(area.getAttribute('data-camera-y')),
      zoom: Number(area.getAttribute('data-camera-zoom')),
    };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = (gx * 32 * cam.zoom + cam.x) * dpr + 4;
    const py = (gy * 32 * cam.zoom + cam.y) * dpr + 4;
    const data = canvas.getContext('2d').getImageData(px, py, 1, 1).data;
    return [data[0], data[1], data[2]];
  }, { gx: cellX, gy: cellY });
}

async function readStrokeMetrics(page) {
  return page.evaluate(() => window.__splintStrokeMetrics || null);
}

async function dragTouchStroke(page, touchSession, points, { stepDelayMs = 40 } = {}) {
  const [start, ...moves] = points;
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y }],
  });
  for (const point of moves) {
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y }],
    });
    if (stepDelayMs) await page.waitForTimeout(stepDelayMs);
  }
}

async function endTouchStroke(page, touchSession) {
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test.describe('tiled stroke engine — paint follows the finger', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await page.context().setExtraHTTPHeaders({ 'X-User-Id': `e2e_stroke_${testInfo.testId}` });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('splint_onboarding_version', '2');
      } catch {
        // Storage may be unavailable.
      }
    });
    await page.route('https://telegram.org/js/telegram-web-app.js', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'window.Telegram = window.Telegram || { WebApp: { ready() {} } };',
      });
    });
  });

  test('30-cell touch drag paints progressively while the finger is down', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', '1200 creator compute is not e2e-practical on WebKit emulation');
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const touchSession = await page.context().newCDPSession(page);
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

    const id = await createAndOpenBarsColoring(page);
    await waitForTiledReady(page);

    const viewportBox = await page.locator('.progressive-grid-area').boundingBox();
    expect(viewportBox).toBeTruthy();
    const center = await cellUnderViewportCenter(page, viewportBox);

    const activeColor = await selectedPaletteColor(page);
    const expectedRgb = await swatchRgb(page, activeColor);
    expect(expectedRgb).toBeTruthy();
    const line = await findLineUnderCamera(page, id, center.x, center.y, activeColor);
    expect(line, 'a 60+ cell run of the active color under the camera is required').toBeTruthy();

    const cam = await zoomOutTo(page, 0.25);

    const start = cellToScreen(line.lineStart, line.y, cam, viewportBox);
    const end = cellToScreen(line.lineEnd, line.y, cam, viewportBox);
    expect(end.x).toBeLessThanOrEqual(viewportBox.x + viewportBox.width + 2);
    expect(start.x).toBeGreaterThanOrEqual(viewportBox.x - 2);
    expect(start.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(start.y).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);

    // The engine maps the touch point through the live camera; resolve the
    // actual painted row (viewport math vs camera offsets can differ by a
    // cell) and use it for probes and server assertions.
    const paintStart = await mapScreenToCell(page, start.x, start.y);
    expect(paintStart).toBeTruthy();
    console.log('DIAG paintStart=', JSON.stringify(paintStart), 'lineStart=', line.lineStart);

    const minTx = Math.floor(line.lineStart / 32);
    const maxTx = Math.floor(line.lineEnd / 32);
    const ty = Math.floor(paintStart.y / 32);
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      await expect.poll(() => page.evaluate(({ x, y }) => (
        window.__splintClient?.getCell(x, y)?.loaded === true
      ), { x: tx * CELL, y: paintStart.y }), {
        timeout: 10000,
        message: `tile ${tx}:${ty} must be resident before the first stroke`,
      }).toBe(true);
    }
    await waitForTileNetworkIdle(page);

    const progressPost = page.waitForResponse(
      (r) => r.url().includes('/progress/actions') && r.request().method() === 'POST',
    );
    const points = [{ x: start.x, y: start.y }];
    for (let i = 1; i <= 15; i += 1) {
      points.push({ x: start.x + ((end.x - start.x) * i) / 15, y: start.y });
    }
    await dragTouchStroke(page, touchSession, points);

    // Resolve the row the engine actually painted (viewport rect can drift a
    // cell between camera steering and the touch events) and probe THAT row.
    const paintY = (await findPaintedRow(page, line.lineStart + 3, paintStart.y)) ?? paintStart.y;
    console.log('DIAG paintY=', paintY, 'expectedStart=', paintStart.y);

    // === MID-DRAG EVIDENCE: finger still down, nothing committed to the
    // server yet — but cells 5/12/20 of the line must be painted already. ===
    for (const offset of [5, 12, 20]) {
      const probe = await canvasPixelAt(page, line.lineStart + offset, paintY);
      expect(probe, `cell ${line.lineStart + offset} painted while finger is down`).toEqual(expectedRgb);
    }
    await page.screenshot({ path: resolve(evidenceDir, 'tiled-stroke-mid-drag.png') });

    await endTouchStroke(page, touchSession);

    const saved = await progressPost;
    expect(saved.status()).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody.completed_cells).toBeGreaterThan(0);

    const metricsAfterFirst = await readStrokeMetrics(page);
    const diagStroke = metricsAfterFirst?.strokes?.[0] || null;
    console.log('DIAG stroke=', JSON.stringify(diagStroke));
    expect(diagStroke).toBeTruthy();
    expect(diagStroke.painted).toBeGreaterThanOrEqual(25);
    expect(diagStroke.finalizeMs).toBeLessThan(150);
    expect(diagStroke.durationMs).toBeGreaterThan(0);
    expect(diagStroke.first).toBe(paintY * GRID + line.lineStart);
    expect(diagStroke.last).toBe(paintY * GRID + line.lineEnd);

    // A second stroke starts immediately after its target tile is resident —
    // no finalization hitch or timing wait is involved in the gesture.
    const secondY = paintY + 4;
    const secondXStart = Math.min(line.lineStart + 40, line.runEnd - 12);
    const secondStart = cellToScreen(secondXStart, secondY, cam, viewportBox);
    const secondEnd = cellToScreen(secondXStart + 12, secondY, cam, viewportBox);
    const secondCell = await mapScreenToCell(page, secondStart.x, secondStart.y);
    expect(secondCell).toBeTruthy();
    const secondTile = {
      tileX: Math.floor(secondCell.x / CELL),
      tileY: Math.floor(secondCell.y / CELL),
    };
    await page.evaluate(({ tileX, tileY }) => (
      window.__splintClient.fetchTile(tileX, tileY).then(() => undefined)
    ), secondTile);
    const secondState = await page.evaluate(({ x, y }) => {
      const cell = window.__splintClient.getCell(x, y);
      return {
        loaded: cell?.loaded ?? false,
        filled: cell?.filled ?? null,
        target: cell?.target ?? null,
      };
    }, secondCell);
    expect(secondState).toEqual({ loaded: true, filled: -1, target: activeColor });
    await dragTouchStroke(page, touchSession, [
      { x: secondStart.x, y: secondStart.y },
      { x: secondEnd.x, y: secondEnd.y },
    ], { stepDelayMs: 30 });
    await endTouchStroke(page, touchSession);
    const metricsAfter = await readStrokeMetrics(page);
    expect(metricsAfter.strokes.length).toBe(2);

    // Server-side: every cell of the first line is filled with the active
    // color. Keep this authoritative read after the second-stroke oracle so
    // its serial tile requests cannot widen the immediate-gesture race window.
    const savedRow = await readRow(page, id, paintY, line.lineStart, line.lineEnd);
    expect(savedRow.length).toBe(30);
    for (const cell of savedRow) {
      expect(cell.color, `cell ${cell.x} target`).toBe(activeColor);
      const tile = await fetchTile(page, id, Math.floor(cell.x / 32), Math.floor(paintY / 32));
      const localIndex = (paintY % 32) * tile.tile.width + (cell.x % 32);
      expect(Number(tile.filled[localIndex]), `server must have cell ${cell.x} filled`).toBe(activeColor);
    }
    await page.screenshot({ path: resolve(evidenceDir, 'tiled-stroke-second-stroke.png') });
  });

  test('drag across a tile boundary paints every valid cell with no stall', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', '1200 creator compute is not e2e-practical on WebKit emulation');
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const touchSession = await page.context().newCDPSession(page);
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

    const id = await createAndOpenBarsColoring(page);
    await waitForTiledReady(page);

    const viewportBox = await page.locator('.progressive-grid-area').boundingBox();
    expect(viewportBox).toBeTruthy();
    const center = await cellUnderViewportCenter(page, viewportBox);

    const activeColor = await selectedPaletteColor(page);
    const expectedRgb = await swatchRgb(page, activeColor);
    expect(expectedRgb).toBeTruthy();
    const line = await findLineUnderCamera(page, id, center.x, center.y, activeColor, { crossBoundary: true });
    expect(line, 'a run of the active color with a tile boundary near the camera is required').toBeTruthy();
    expect(line.boundary).toBeGreaterThan(line.lineStart);
    expect(line.boundary).toBeLessThan(line.lineEnd);

    const cam = await zoomOutTo(page, 0.2);

    const start = cellToScreen(line.lineStart, line.y, cam, viewportBox);
    const end = cellToScreen(line.lineEnd, line.y, cam, viewportBox);
    expect(end.x).toBeLessThanOrEqual(viewportBox.x + viewportBox.width + 2);
    expect(start.x).toBeGreaterThanOrEqual(viewportBox.x - 2);

    const paintStart = await mapScreenToCell(page, start.x, start.y);
    expect(paintStart).toBeTruthy();
    console.log('DIAG cross paintStart=', JSON.stringify(paintStart), 'boundary=', line.boundary);

    const ty = Math.floor(paintStart.y / 32);
    for (let tx = Math.floor(line.lineStart / 32); tx <= Math.floor(line.lineEnd / 32); tx += 1) {
      await expect.poll(() => page.evaluate(({ x, y }) => (
        window.__splintClient?.getCell(x, y)?.loaded === true
      ), { x: tx * CELL, y: paintStart.y }), {
        timeout: 10000,
        message: `tile ${tx}:${ty} must be resident before the boundary stroke`,
      }).toBe(true);
    }
    await waitForTileNetworkIdle(page);

    const progressPost = page.waitForResponse(
      (r) => r.url().includes('/progress/actions') && r.request().method() === 'POST',
    );
    const points = [{ x: start.x, y: start.y }];
    const steps = 14;
    for (let i = 1; i <= steps; i += 1) {
      points.push({ x: start.x + ((end.x - start.x) * i) / steps, y: start.y });
    }
    await dragTouchStroke(page, touchSession, points);

    // Resolve the row the engine actually painted (rect drift safety) and
    // probe the cell just past the boundary mid-drag.
    const paintY = (await findPaintedRow(page, line.boundary, paintStart.y)) ?? paintStart.y;
    console.log('DIAG cross paintY=', paintY, 'boundary=', line.boundary);
    const boundaryProbe = await canvasPixelAt(page, line.boundary, paintY);
    expect(boundaryProbe, 'cell across the tile boundary painted mid-drag').toEqual(expectedRgb);
    await page.screenshot({ path: resolve(evidenceDir, 'tiled-stroke-cross-tile-mid-drag.png') });
    await endTouchStroke(page, touchSession);

    const saved = await progressPost;
    expect(saved.status()).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody.completed_cells).toBeGreaterThanOrEqual(25);

    // Every valid cell on both sides of the boundary is filled on the server.
    const savedRow = await readRow(page, id, paintY, line.lineStart, line.lineEnd);
    for (const cell of savedRow) {
      expect(cell.color).toBe(activeColor);
      const tile = await fetchTile(page, id, Math.floor(cell.x / 32), Math.floor(paintY / 32));
      const localIndex = (paintY % 32) * tile.tile.width + (cell.x % 32);
      expect(Number(tile.filled[localIndex])).toBe(activeColor);
    }
  });
});
