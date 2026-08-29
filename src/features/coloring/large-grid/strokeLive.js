/**
 * Live stroke painting for the progressive (tiled) player.
 *
 * The interactive hot path is: pointer sample → rasterize → O(1) dedupe →
 * validate against the already-loaded local tile → mutate tile.filled →
 * dirty visual paint. paintStrokeIndex is the pure, testable core of that
 * loop: it decides for ONE rasterized cell whether it paints, and mutates
 * the tile in place when it does. No React, no network, no guide/minimap
 * work — those settle at stroke finalization.
 */

export const PAINT_STATUS = Object.freeze({
  PAINTED: 'painted',
  ALREADY_FILLED: 'already-filled',
  WRONG: 'wrong',
  UNLOADED: 'unloaded',
});

/**
 * Validate and optimistically paint one cell of an in-flight stroke.
 *
 * @param {object} pointer stroke state: { color, changes, dirtyTiles,
 *        unloadedCells, wrongDetected, wrongCell }
 * @param {number} index global row-major cell index
 * @param {object} env  { width, tileSize = 32, mode = 'classic',
 *        getTile(tileX, tileY) -> tile|null }
 * @returns {{ status: string, index: number, tileX: number, tileY: number,
 *            target?: number }}
 */
export function paintStrokeIndex(pointer, index, env = {}) {
  const width = Number(env.width);
  const tileSize = Number(env.tileSize) || 32;
  const mode = env.mode || 'classic';
  const x = index % width;
  const y = Math.floor(index / width);
  const tileX = Math.floor(x / tileSize);
  const tileY = Math.floor(y / tileSize);
  const tile = env.getTile?.(tileX, tileY);
  if (!tile) {
    pointer.unloadedCells.push(index);
    return { status: PAINT_STATUS.UNLOADED, index, tileX, tileY };
  }
  const localX = x - tile.offsetX;
  const localY = y - tile.offsetY;
  const localIndex = localY * tile.width + localX;
  if (tile.filled[localIndex] !== -1) {
    return { status: PAINT_STATUS.ALREADY_FILLED, index, tileX, tileY };
  }
  const target = tile.cells[localIndex];
  if (mode !== 'reveal' && target !== pointer.color) {
    // Wrong-color cells stay empty; bounded feedback (once per gesture) is
    // the caller's job via wrongDetected/wrongCell.
    if (!pointer.wrongDetected) {
      pointer.wrongDetected = true;
      pointer.wrongCell = { index, target };
    }
    return { status: PAINT_STATUS.WRONG, index, tileX, tileY, target };
  }
  const paintColor = mode === 'reveal' ? target : pointer.color;
  tile.filled[localIndex] = paintColor;
  pointer.changes.push({ index, tileKey: `${tileX}:${tileY}`, to: paintColor });
  pointer.dirtyTiles.add(`${tileX}:${tileY}`);
  return { status: PAINT_STATUS.PAINTED, index, tileX, tileY, target };
}

/**
 * Append a pointer sample to the stroke: rasterize the gap from the previous
 * sample, dedupe O(1) with the stroke Set, and paint every new cell.
 *
 * `env.onOutcome(outcome)` is called for every NEW cell's outcome — the
 * allocation-free hot path. Returns the number of rasterized cells so the
 * caller can keep a `rasterized` counter without extra bookkeeping.
 *
 * @returns {number} rasterized cell count for this sample (path length)
 */
export function extendStroke(pointer, cellIndex, env = {}) {
  if (!pointer || !env || pointer.lastIndex === cellIndex) return 0;
  const path = rasterizeStroke(pointer.lastIndex, cellIndex, env.width, env.height);
  pointer.lastIndex = cellIndex;
  for (const index of path) {
    if (pointer.indexSet.has(index)) continue;
    pointer.indexSet.add(index);
    const outcome = paintStrokeIndex(pointer, index, env);
    env.onOutcome?.(outcome);
  }
  return path.length;
}

import { rasterizeStroke } from '../engine/strokeRasterizer.js';
