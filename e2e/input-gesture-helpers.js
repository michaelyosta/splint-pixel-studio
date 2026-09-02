import { expect } from '@playwright/test';

export const CELL = 32;
export const GRID = 160;
export const TILE = 32;
export const PALETTE = ['#101820', '#ffffff'];

export function tiledPayload({ width = GRID, height = GRID, tileSize = TILE } = {}) {
  const tiles = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      tiles.push({
        tile_x: tileX,
        tile_y: tileY,
        width: tileWidth,
        height: tileHeight,
        cells: Array(tileWidth * tileHeight).fill(0),
      });
    }
  }
  return tiles;
}

export function legacyPayload({ width = 28, height = 28 } = {}) {
  return {
    storageMode: 'legacy',
    width,
    height,
    palette: PALETTE,
    cells: Array(width * height).fill(0),
  };
}

export async function createColoring(page, payload) {
  const response = await page.request.post('/api/colorings/create', { data: payload });
  expect(response.ok()).toBe(true);
  return response.json();
}

export async function createTiledColoring(page, options = {}) {
  return createColoring(page, {
    title: `Gesture evidence ${Date.now()}`,
    storageMode: 'tiled',
    width: GRID,
    height: GRID,
    tileSize: TILE,
    palette: PALETTE,
    tiles: tiledPayload(options),
  });
}

export async function createLegacyColoring(page, options = {}) {
  return createColoring(page, {
    title: `Gesture evidence legacy ${Date.now()}`,
    ...legacyPayload(options),
  });
}

export async function openColoring(page, id, { metrics = false } = {}) {
  const query = metrics ? `?splintMetrics=1&coloring=${id}` : `/?coloring=${id}`;
  await page.goto(query);
}

export async function dismissOnboarding(page) {
  const skip = page.locator('.onboarding-card .secondary-button');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
}

export async function waitForTiledReady(page, id) {
  const session = page.locator('.progressive-coloring-session');
  await expect(page.locator('.progressive-grid-area canvas').first()).toBeVisible({ timeout: 30000 });
  await page.waitForResponse(
    (response) => response.url().includes(`/colorings/${id}/tiles/`) && response.ok(),
    { timeout: 30000 },
  ).catch(() => {});
  const stateHandle = await page.waitForFunction(() => {
    const state = document.querySelector('.progressive-coloring-session')?.getAttribute('data-smart-state');
    return state === 'ready' || state === 'errorRetryable' ? state : null;
  }, { timeout: 30000 });
  const state = await stateHandle.jsonValue();
  if (state === 'errorRetryable') {
    throw new Error('Tiled player entered errorRetryable before READY. Generic readiness helper does not perform recovery. Recovery must be tested explicitly by the calling test.');
  }
  await expect(session).toHaveAttribute('data-smart-state', 'ready', { timeout: 30000 });
  await page.waitForTimeout(400);
}

const COLORING_SESSION_READINESS_MAX_MS = 30_000;

export async function waitForColoringSessionReady(page, expectedAttributes, label = 'coloring session') {
  await expect.poll(() => page.evaluate(() => {
    const session = document.querySelector('.coloring-session');
    const attributes = session
      ? Object.fromEntries(Array.from(session.attributes)
        .filter(({ name }) => name.startsWith('data-'))
        .map(({ name, value }) => [name, value]))
      : {};
    return {
      documentReadyState: document.readyState,
      present: Boolean(session),
      visible: Boolean(session?.getClientRects().length),
      attributes,
    };
  }), {
    timeout: COLORING_SESSION_READINESS_MAX_MS,
    message: `${label}: bounded .coloring-session readiness exceeded ${COLORING_SESSION_READINESS_MAX_MS}ms; expected data attributes ${JSON.stringify(expectedAttributes)}. The last DOM snapshot is shown in Received.`,
  }).toMatchObject({
    present: true,
    visible: true,
    attributes: expectedAttributes,
  });
}

export async function readTiledCamera(page) {
  const area = page.locator('.progressive-grid-area');
  return {
    x: Number(await area.getAttribute('data-camera-x')),
    y: Number(await area.getAttribute('data-camera-y')),
    zoom: Number(await area.getAttribute('data-camera-zoom')),
  };
}

export async function readTiledTarget(page) {
  const area = page.locator('.progressive-grid-area');
  const x = await area.getAttribute('data-smart-target-x');
  const y = await area.getAttribute('data-smart-target-y');
  const color = await area.getAttribute('data-smart-color');
  if (x === null || y === null || x === '' || y === '') return null;
  return { x: Number(x), y: Number(y), color: color === '' ? null : Number(color) };
}

export async function waitForTiledCellLoaded(page, cellX, cellY) {
  await expect.poll(async () => page.evaluate(({ x, y }) => {
    const client = window.__splintClient;
    const cell = client?.getCell?.(x, y);
    return Boolean(cell?.loaded);
  }, { x: cellX, y: cellY }), { timeout: 15000 }).toBe(true);
}

export async function pickLoadedUnfilledCell(page) {
  return page.evaluate(() => {
    const client = window.__splintClient;
    if (!client) return null;
    for (const tile of client.cache.values()) {
      if (!tile?.filled || !tile?.width) continue;
      for (let localIndex = 0; localIndex < tile.filled.length; localIndex += 1) {
        if (tile.filled[localIndex] === -1) {
          return {
            x: tile.offsetX + (localIndex % tile.width),
            y: tile.offsetY + Math.floor(localIndex / tile.width),
          };
        }
      }
    }
    return null;
  });
}

export async function pickLoadedVisibleCell(page, box) {
  const camera = await readTiledCamera(page);
  return page.evaluate(({ box, camera }) => {
    const client = window.__splintClient;
    if (!client) return null;
    const margin = 40;
    const minX = box.x + margin;
    const maxX = box.x + box.width - margin;
    const minY = box.y + margin;
    const maxY = box.y + box.height - margin;
    for (const tile of client.cache.values()) {
      if (!tile?.filled || !tile?.width) continue;
      for (let localIndex = 0; localIndex < tile.filled.length; localIndex += 1) {
        if (tile.filled[localIndex] !== -1) continue;
        const x = tile.offsetX + (localIndex % tile.width);
        const y = tile.offsetY + Math.floor(localIndex / tile.width);
        const screenX = box.x + x * 32 * camera.zoom + camera.x + 16 * camera.zoom;
        const screenY = box.y + y * 32 * camera.zoom + camera.y + 16 * camera.zoom;
        if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
          return { x, y };
        }
      }
    }
    return null;
  }, { box, camera });
}

export async function cellToScreen(cellX, cellY, camera, box) {
  return {
    x: box.x + cellX * CELL * camera.zoom + camera.x,
    y: box.y + cellY * CELL * camera.zoom + camera.y,
  };
}

export async function targetScreenPoint(page, box) {
  const target = await readTiledTarget(page);
  const camera = await readTiledCamera(page);
  if (!target) throw new Error('tiled smart target is not available');
  return {
    target,
    camera,
    point: await cellToScreen(target.x, target.y, camera, box),
  };
}

export async function waitForProgressAction(page) {
  return page.waitForResponse(
    (response) => response.url().includes('/progress/actions') && response.request().method() === 'POST',
    { timeout: 20000 },
  );
}

export async function focusLegacyCell(page, index) {
  await waitForColoringSessionReady(page, { 'data-route-status': 'ready' }, 'legacy keyboard input');
  const canvas = page.locator('.coloring-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false');
  await canvas.focus();
  await canvas.press('Home');
  const width = Number(await canvas.getAttribute('data-template-width'));
  const x = index % width;
  const y = Math.floor(index / width);
  for (let step = 0; step < x; step += 1) await canvas.press('ArrowRight');
  for (let step = 0; step < y; step += 1) await canvas.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-keyboard-cell', String(index));
  return canvas;
}

export async function createTouchSession(page) {
  return page.context().newCDPSession(page);
}

export async function sendTouch(session, type, points) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

export async function selectionIsEmpty(page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    return !selection || selection.rangeCount === 0 || selection.toString().length === 0;
  });
}

export async function rawCssTexts(page, selectorFragment) {
  return page.evaluate((fragment) => Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent)
    .filter((text) => text.includes(fragment)), selectorFragment);
}

export async function readComputedGuards(page, selectors) {
  return page.evaluate((selectorList) => Object.fromEntries(selectorList.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) return [selector, null];
    const style = getComputedStyle(element);
    return [selector, {
      userSelect: style.userSelect,
      webkitUserSelect: style.webkitUserSelect,
      touchAction: style.touchAction,
      overscrollBehavior: style.overscrollBehavior,
    }];
  })), selectors);
}
