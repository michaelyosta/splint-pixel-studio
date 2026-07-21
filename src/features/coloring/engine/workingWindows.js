import { getClusterBounds } from './clusterGraph.js';

const MIN_CELL_SIZE = 24;
const BASE_CELL = 32;

export function createWorkingWindows(cluster, template, viewWidth, viewHeight) {
  const width = template.width;
  const bounds = getClusterBounds(cluster, width);
  const zoomX = (viewWidth / (bounds.width * BASE_CELL)) || 1;
  const zoomY = (viewHeight / (bounds.height * BASE_CELL)) || 1;
  const idealZoom = Math.min(zoomX, zoomY);
  const cellAtIdeal = BASE_CELL * idealZoom;
  let zoom;
  if (cellAtIdeal < MIN_CELL_SIZE) {
    zoom = MIN_CELL_SIZE / BASE_CELL;
  } else if (cellAtIdeal > BASE_CELL) {
    zoom = 1;
  } else {
    zoom = idealZoom;
  }
  const cellsVisibleX = Math.floor(viewWidth / (BASE_CELL * zoom));
  const cellsVisibleY = Math.floor(viewHeight / (BASE_CELL * zoom));
  if (bounds.width <= cellsVisibleX && bounds.height <= cellsVisibleY) {
    return [{
      cells: cluster,
      bounds,
      zoom,
      centerX: (bounds.minX + bounds.maxX) / 2,
      centerY: (bounds.minY + bounds.maxY) / 2,
      cellCount: cluster.length,
    }];
  }
  const windows = [];
  const stepX = Math.max(1, Math.floor(cellsVisibleX * 0.65));
  const stepY = Math.max(1, Math.floor(cellsVisibleY * 0.65));
  for (let wy = bounds.minY; wy <= bounds.maxY; wy += stepY) {
    for (let wx = bounds.minX; wx <= bounds.maxX; wx += stepX) {
      const winMinX = wx;
      const winMinY = wy;
      const winMaxX = Math.min(bounds.maxX, wx + cellsVisibleX - 1);
      const winMaxY = Math.min(bounds.maxY, wy + cellsVisibleY - 1);
      const winCells = [];
      for (const idx of cluster) {
        const cx = idx % width;
        const cy = Math.floor(idx / width);
        if (cx >= winMinX && cx <= winMaxX && cy >= winMinY && cy <= winMaxY) {
          winCells.push(idx);
        }
      }
      if (winCells.length > 0) {
        windows.push({
          cells: winCells,
          bounds: {
            minX: winMinX, minY: winMinY,
            maxX: winMaxX, maxY: winMaxY,
            width: winMaxX - winMinX + 1,
            height: winMaxY - winMinY + 1,
          },
          zoom,
          centerX: (winMinX + winMaxX) / 2,
          centerY: (winMinY + winMaxY) / 2,
          cellCount: winCells.length,
        });
      }
    }
  }
  return windows;
}

export function selectNextWindow(windows, currentCenter, previousCenter, blockedIds) {
  if (!windows.length) return null;
  let best = null;
  let bestScore = -Infinity;
  const prevDirX = previousCenter ? currentCenter.x - previousCenter.x : 0;
  const prevDirY = previousCenter ? currentCenter.y - previousCenter.y : 0;
  const prevLen = Math.sqrt(prevDirX * prevDirX + prevDirY * prevDirY);
  for (let i = 0; i < windows.length; i++) {
    if (blockedIds?.has(i)) continue;
    const win = windows[i];
    const dx = win.centerX - currentCenter.x;
    const dy = win.centerY - currentCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let score = -dist * 0.5;
    score += win.cellCount * 0.005;
    if (previousCenter && prevLen > 0) {
      const dot = (dx * prevDirX + dy * prevDirY) / (dist * prevLen || 1);
      if (dot > 0.3) score += 8;
      if (dot < -0.3) score -= 6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { window: win, index: i };
    }
  }
  return best ? best.window : null;
}
