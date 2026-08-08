/**
 * Bounded guidance for the progressive grid: counts and locates unfilled
 * cells across only the tiles that are already loaded, so a 1200Г—1200 map
 * never forces a whole-grid scan on the client.
 */

export function computeLoadedGuide({ tiles = [], template, selectedColor = null, zones = [] } = {}) {
  const remainingByZone = new Map();
  const firstCellByZone = new Map();
  let remaining = 0;

  for (const tile of tiles) {
    for (let localY = 0; localY < tile.height; localY += 1) {
      for (let localX = 0; localX < tile.width; localX += 1) {
        const localIndex = localY * tile.width + localX;
        if (tile.filled[localIndex] !== -1) continue;
        const target = tile.cells[localIndex];
        if (selectedColor != null && target !== selectedColor) continue;
        const x = tile.offsetX + localX;
        const y = tile.offsetY + localY;
        const zone = zones.find((candidate) => (
          x >= candidate.x && x < candidate.x + candidate.width
          && y >= candidate.y && y < candidate.y + candidate.height
        ));
        const zoneId = zone == null ? -1 : zone.id;
        remaining += 1;
        remainingByZone.set(zoneId, (remainingByZone.get(zoneId) || 0) + 1);
        if (!firstCellByZone.has(zoneId)) {
          firstCellByZone.set(zoneId, {
            x,
            y,
            index: y * template.width + x,
          });
        }
      }
    }
  }

  return {
    remaining,
    remainingByZone: Object.fromEntries(remainingByZone),
    firstCellByZone: Object.fromEntries(
      [...firstCellByZone.entries()].map(([zoneId, cell]) => [zoneId, cell]),
    ),
  };
}

export function pickNextZoneWithCells(zones, currentZoneId, remainingByZone) {
  const count = zones.length;
  if (!count) return null;
  const start = Number.isInteger(currentZoneId) && currentZoneId >= 0 ? currentZoneId : 0;
  for (let offset = 1; offset <= count; offset += 1) {
    const candidate = zones[(start + offset) % count];
    if ((Number(remainingByZone?.[candidate.id]) || 0) > 0) return candidate;
  }
  return null;
}

export function pickColorWithMostRemaining(tiles, paletteLength) {
  const counts = new Array(Math.max(0, Number(paletteLength) || 0)).fill(0);
  for (const tile of tiles) {
    for (let localIndex = 0; localIndex < tile.cellCount; localIndex += 1) {
      if (tile.filled[localIndex] !== -1) continue;
      const target = tile.cells[localIndex];
      if (target >= 0 && target < counts.length) counts[target] += 1;
    }
  }
  let best = -1;
  let bestCount = 0;
  for (let color = 0; color < counts.length; color += 1) {
    if (counts[color] > bestCount) {
      bestCount = counts[color];
      best = color;
    }
  }
  return best;
}

/**
 * Incremental guide data for the tiled player. Tile summaries are computed
 * once per tile load and adjusted in-place on paint, so a 1200Г—1200 map
 * never rescans the whole loaded cache on every animation frame.
 */
export class TileGuideIndex {
  constructor({ zones = [], paletteLength = 0, template = null } = {}) {
    this.zones = zones;
    this.paletteLength = Math.max(1, Number(paletteLength) || 0);
    this.template = template;
    this.tiles = new Map();
    this.zoneTotals = new Int32Array(zones.length);
    this.zoneColorCounts = new Int32Array(zones.length * this.paletteLength);
  }

  zoneForCell(x, y) {
    for (let index = 0; index < this.zones.length; index += 1) {
      const zone = this.zones[index];
      if (x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) {
        return index;
      }
    }
    return -1;
  }

  scanTile(tile) {
    const counts = new Int32Array(this.zones.length * this.paletteLength);
    const first = new Map();
    const width = this.template?.width || 1;
    for (let localY = 0; localY < tile.height; localY += 1) {
      for (let localX = 0; localX < tile.width; localX += 1) {
        const localIndex = localY * tile.width + localX;
        if (tile.filled[localIndex] !== -1) continue;
        const color = tile.cells[localIndex];
        if (color < 0 || color >= this.paletteLength) continue;
        const x = tile.offsetX + localX;
        const y = tile.offsetY + localY;
        const zone = this.zoneForCell(x, y);
        if (zone < 0) continue;
        counts[zone * this.paletteLength + color] += 1;
        const key = `${zone}:${color}`;
        if (!first.has(key)) {
          first.set(key, { x, y, index: y * width + x });
        }
      }
    }
    return { counts, first };
  }

  addSummary(summary) {
    for (let index = 0; index < summary.counts.length; index += 1) {
      this.zoneColorCounts[index] += summary.counts[index];
    }
    for (let zone = 0; zone < this.zones.length; zone += 1) {
      let total = 0;
      for (let color = 0; color < this.paletteLength; color += 1) {
        total += summary.counts[zone * this.paletteLength + color];
      }
      this.zoneTotals[zone] += total;
    }
  }

  subtractSummary(summary) {
    for (let index = 0; index < summary.counts.length; index += 1) {
      this.zoneColorCounts[index] -= summary.counts[index];
    }
    for (let zone = 0; zone < this.zones.length; zone += 1) {
      let total = 0;
      for (let color = 0; color < this.paletteLength; color += 1) {
        total += summary.counts[zone * this.paletteLength + color];
      }
      this.zoneTotals[zone] -= total;
    }
  }

  addTile(tile) {
    if (!tile || !tile.key || this.tiles.has(tile.key)) return;
    const summary = this.scanTile(tile);
    this.tiles.set(tile.key, summary);
    this.addSummary(summary);
  }

  removeTile(tile) {
    if (!tile || !tile.key) return;
    const summary = this.tiles.get(tile.key);
    if (!summary) return;
    this.subtractSummary(summary);
    this.tiles.delete(tile.key);
  }

  refreshTile(tile) {
    if (!tile || !tile.key) return;
    this.removeTile(tile);
    this.addTile(tile);
  }

  snapshot(selectedColor = null) {
    const remainingByZone = {};
    const firstCellByZone = {};
    let remaining = 0;
    const matchColor = Number.isInteger(selectedColor) && selectedColor >= 0
      ? selectedColor
      : null;
    for (let zone = 0; zone < this.zones.length; zone += 1) {
      let count;
      if (matchColor == null) {
        count = this.zoneTotals[zone];
      } else {
        count = this.zoneColorCounts[zone * this.paletteLength + matchColor];
      }
      if (count > 0) remainingByZone[zone] = count;
      remaining += count;
    }
    for (const summary of this.tiles.values()) {
      for (const [key, cell] of summary.first) {
        const separator = key.indexOf(':');
        const zone = Number(key.slice(0, separator));
        const color = Number(key.slice(separator + 1));
        if (matchColor != null && color !== matchColor) continue;
        const current = firstCellByZone[zone];
        if (!current || cell.index < current.index) {
          firstCellByZone[zone] = { x: cell.x, y: cell.y, index: cell.index };
        }
      }
    }
    return { remaining, remainingByZone, firstCellByZone };
  }
}
