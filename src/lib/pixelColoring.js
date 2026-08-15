export function getProgress(cells, filled) {
  const completed = filled.reduce((total, color, index) => total + (color === cells[index] ? 1 : 0), 0);
  return { completed, total: cells.length, percent: Math.round((completed / cells.length) * 100) };
}

// `percent` is intentionally rounded for display, so it is not safe to use
// as a completion signal (for example, 575/576 rounds to 100%).
export function isProgressComplete(progress) {
  return Boolean(progress && progress.total > 0 && progress.completed === progress.total);
}

export function normalizeHex(red, green, blue) {
  return `#${[red, green, blue].map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, '0')).join('')}`;
}

export function findRewardingColor(template, filled, excluded = null) {
  const counts = template.palette.map((_, color) => template.cells.reduce((total, target, index) => total + (target === color && filled[index] === -1 ? 1 : 0), 0));
  return counts
    .map((count, color) => ({ count, color }))
    .filter((item) => item.count > 0 && item.color !== excluded)
    .sort((first, second) => first.count - second.count)[0]?.color;
}

export function renderCompletedImage(template, filled, pixelSize = 16) {
  const canvas = document.createElement('canvas');
  canvas.width = template.width * pixelSize;
  canvas.height = template.height * pixelSize;
  const context = canvas.getContext('2d');
  template.cells.forEach((target, index) => {
    const x = (index % template.width) * pixelSize;
    const y = Math.floor(index / template.width) * pixelSize;
    context.fillStyle = filled[index] === target ? template.palette[target] : '#10202d';
    context.fillRect(x, y, pixelSize, pixelSize);
  });
  return canvas.toDataURL('image/png');
}

function rgbToLab([red, green, blue]) {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const pivot = (value) => value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116);
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return [(116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

export function perceptualColorDistance(first, second) {
  return labDistance(rgbToLab(first), rgbToLab(second));
}

export const PIXELIZATION_PIPELINES = Object.freeze({
  classic: 'classic-v1',
  paintable: 'paintable-v1',
  paintableDither: 'paintable-v1',
});

function normalizeStylePreset(stylePreset) {
  if (stylePreset === 'paintable' || stylePreset === 'paintable-dither') return stylePreset;
  return 'classic';
}

function createAbortError(message = 'Pixelization cancelled') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function createPipelineContext(options = {}) {
  const checkCancelled = () => {
    if (options.signal?.aborted || options.shouldCancel?.()) throw createAbortError();
  };
  const progress = (stage, value, detail = {}) => {
    if (typeof options.onProgress !== 'function') return;
    try {
      options.onProgress({ stage, progress: Math.max(0, Math.min(1, value)), ...detail });
    } catch {
      // Progress reporting is observational and must not break conversion.
    }
  };
  return { checkCancelled, progress };
}

function smoothCells(cells, width, height, palette) {
  const result = [...cells];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const neighbours = [cells[index - 1], cells[index + 1], cells[index - width], cells[index + width]];
      const same = neighbours.filter((item) => item === cells[index]).length;
      const counts = neighbours.reduce((map, color) => map.set(color, (map.get(color) || 0) + 1), new Map());
      const dominant = [...counts.entries()].sort((first, second) => second[1] - first[1])[0];
      const currentColor = palette?.[cells[index]];
      const dominantColor = palette?.[dominant[0]];
      // Keep deliberate high-contrast details, such as eyes or a small accent.
      if (same === 0 && dominant[1] >= 3 && (!currentColor || !dominantColor || perceptualColorDistance(currentColor, dominantColor) < 24)) {
        result[index] = dominant[0];
      }
    }
  }
  return result;
}

function createChunkedYielder(yieldEvery, checkCancelled = null) {
  if (!Number.isInteger(yieldEvery) || yieldEvery < 1) return null;
  let counter = 0;
  return async () => {
    checkCancelled?.();
    counter += 1;
    if (counter % yieldEvery !== 0) return;
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
      await scheduler.yield();
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    checkCancelled?.();
  };
}

async function sampleGridColorsAsync(imageData, imageWidth, imageHeight, gridWidth, gridHeight, yieldEvery, checkCancelled = null) {
  const yieldChunk = createChunkedYielder(yieldEvery, checkCancelled);
  const colors = [];
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    if (yieldChunk) await yieldChunk();
    const top = Math.floor((gridY * imageHeight) / gridHeight);
    const bottom = Math.max(top + 1, Math.floor(((gridY + 1) * imageHeight) / gridHeight));
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const left = Math.floor((gridX * imageWidth) / gridWidth);
      const right = Math.max(left + 1, Math.floor(((gridX + 1) * imageWidth) / gridWidth));
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = ((y * imageWidth) + x) * 4;
          sum[0] += imageData[offset];
          sum[1] += imageData[offset + 1];
          sum[2] += imageData[offset + 2];
          count += 1;
        }
      }
      colors.push(sum.map((channel) => channel / count));
    }
  }
  return colors;
}

async function edgeAwareSmoothColorsAsync(colors, width, height, yieldEvery, checkCancelled = null) {
  const yieldChunk = createChunkedYielder(yieldEvery, checkCancelled);
  const labs = colors.map(rgbToLab);
  const result = new Array(colors.length);
  for (let index = 0; index < colors.length; index += 1) {
    if (index % width === 0 && yieldChunk) await yieldChunk();
    const color = colors[index];
    const similar = [color];
    for (const neighbour of neighbouringIndices(index, width, height)) {
      if (labDistance(labs[index], labs[neighbour]) < 18) similar.push(colors[neighbour]);
    }
    result[index] = similar.length < 3
      ? color
      : [0, 1, 2].map((channel) => similar.reduce((sum, item) => sum + item[channel], 0) / similar.length);
  }
  return result;
}

async function smoothCellsAsync(cells, width, height, palette, yieldEvery, checkCancelled = null) {
  const yieldChunk = createChunkedYielder(yieldEvery, checkCancelled);
  const result = [...cells];
  for (let y = 1; y < height - 1; y += 1) {
    if (yieldChunk) await yieldChunk();
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const neighbours = [cells[index - 1], cells[index + 1], cells[index - width], cells[index + width]];
      const same = neighbours.filter((item) => item === cells[index]).length;
      const counts = neighbours.reduce((map, color) => map.set(color, (map.get(color) || 0) + 1), new Map());
      const dominant = [...counts.entries()].sort((first, second) => second[1] - first[1])[0];
      const currentColor = palette?.[cells[index]];
      const dominantColor = palette?.[dominant[0]];
      if (same === 0 && dominant[1] >= 3 && (!currentColor || !dominantColor || perceptualColorDistance(currentColor, dominantColor) < 24)) {
        result[index] = dominant[0];
      }
    }
  }
  return result;
}

function neighbouringIndices(index, width, height) {
  const x = index % width;
  const y = Math.floor(index / width);
  const neighbours = [];
  if (x > 0) neighbours.push(index - 1);
  if (x < width - 1) neighbours.push(index + 1);
  if (y > 0) neighbours.push(index - width);
  if (y < height - 1) neighbours.push(index + width);
  return neighbours;
}

export function cleanUpSmallRegions(cells, width, height, palette) {
  let result = [...cells];
  const minRegionSize = Math.max(1, Math.floor((width * height) / 500));
  const paletteLab = palette.map(rgbToLab);

  for (let pass = 0; pass < 2; pass += 1) {
    const visited = new Uint8Array(result.length);
    const replacements = [];

    for (let start = 0; start < result.length; start += 1) {
      if (visited[start]) continue;
      const color = result[start];
      const component = [];
      const boundary = new Map();
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const index = stack.pop();
        component.push(index);
        for (const neighbour of neighbouringIndices(index, width, height)) {
          const neighbourColor = result[neighbour];
          if (neighbourColor === color) {
            if (!visited[neighbour]) {
              visited[neighbour] = 1;
              stack.push(neighbour);
            }
          } else {
            boundary.set(neighbourColor, (boundary.get(neighbourColor) || 0) + 1);
          }
        }
      }

      if (component.length > minRegionSize || !boundary.size) continue;
      const nearestNeighbourDistance = Math.min(...[...boundary.keys()].map((candidate) => labDistance(paletteLab[color], paletteLab[candidate])));
      // High-contrast tiny regions are usually intentional visual features.
      if (nearestNeighbourDistance >= 28) continue;

      let replacement = color;
      let score = -Infinity;
      for (const [candidate, sharedEdges] of boundary) {
        const candidateScore = (sharedEdges * 18) - labDistance(paletteLab[color], paletteLab[candidate]);
        if (candidateScore > score) {
          score = candidateScore;
          replacement = candidate;
        }
      }
      if (replacement !== color) replacements.push({ component, replacement });
    }

    if (!replacements.length) break;
    for (const { component, replacement } of replacements) {
      for (const index of component) result[index] = replacement;
    }
  }

  return result;
}

async function cleanUpSmallRegionsAsync(cells, width, height, palette, yieldEvery, checkCancelled = null) {
  const yieldChunk = createChunkedYielder(yieldEvery, checkCancelled);
  let result = [...cells];
  const minRegionSize = Math.max(1, Math.floor((width * height) / 500));
  const paletteLab = palette.map(rgbToLab);

  for (let pass = 0; pass < 2; pass += 1) {
    const visited = new Uint8Array(result.length);
    const replacements = [];

    for (let start = 0; start < result.length; start += 1) {
      if (yieldChunk) await yieldChunk();
      if (visited[start]) continue;
      const color = result[start];
      const component = [];
      const boundary = new Map();
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const index = stack.pop();
        component.push(index);
        for (const neighbour of neighbouringIndices(index, width, height)) {
          const neighbourColor = result[neighbour];
          if (neighbourColor === color) {
            if (!visited[neighbour]) {
              visited[neighbour] = 1;
              stack.push(neighbour);
            }
          } else {
            boundary.set(neighbourColor, (boundary.get(neighbourColor) || 0) + 1);
          }
        }
      }

      if (component.length > minRegionSize || !boundary.size) continue;
      const nearestNeighbourDistance = Math.min(...[...boundary.keys()].map((candidate) => labDistance(paletteLab[color], paletteLab[candidate])));
      if (nearestNeighbourDistance >= 28) continue;

      let replacement = color;
      let score = -Infinity;
      for (const [candidate, sharedEdges] of boundary) {
        const candidateScore = (sharedEdges * 18) - labDistance(paletteLab[color], paletteLab[candidate]);
        if (candidateScore > score) {
          score = candidateScore;
          replacement = candidate;
        }
      }
      if (replacement !== color) replacements.push({ component, replacement });
    }

    if (!replacements.length) break;
    for (const { component, replacement } of replacements) {
      for (const index of component) result[index] = replacement;
    }
  }

  return result;
}

async function mapColorsToPaletteAsync(sourcePixels, paletteRgb, paletteLab, width, height, yieldEvery, checkCancelled = null) {
  const yieldChunk = createChunkedYielder(yieldEvery, checkCancelled);
  const cells = new Array(sourcePixels.length);
  for (let index = 0; index < sourcePixels.length; index += 1) {
    if (index % width === 0 && yieldChunk) await yieldChunk();
    const lab = rgbToLab(sourcePixels[index]);
    let closestIndex = 0;
    let closestDistance = Infinity;
    paletteLab.forEach((color, paletteIndex) => {
      const distance = labDistance(lab, color);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = paletteIndex;
      }
    });
    cells[index] = closestIndex;
  }
  return cells;
}

export function buildPalette(pixels, requestedColors) {
  const buckets = new Map();
  pixels.forEach((pixel) => {
    const key = pixel.map((channel) => Math.round(channel / 16) * 16).join(',');
    const bucket = buckets.get(key) || { color: [0, 0, 0], count: 0 };
    pixel.forEach((channel, index) => { bucket.color[index] += channel; });
    bucket.count += 1;
    buckets.set(key, bucket);
  });
  const weighted = [...buckets.values()].map((bucket) => {
    const color = bucket.color.map((channel) => channel / bucket.count);
    return { color, lab: rgbToLab(color), count: bucket.count };
  });
  const first = weighted.sort((firstEntry, secondEntry) => secondEntry.count - firstEntry.count)[0];
  const centers = [{ color: first.color, lab: first.lab }];
  while (centers.length < requestedColors && centers.length < weighted.length) {
    let candidate = null;
    let candidateScore = -1;
    weighted.forEach((entry) => {
      const distance = Math.min(...centers.map((center) => labDistance(entry.lab, center.lab)));
      const saturation = Math.max(...entry.color) - Math.min(...entry.color);
      const score = distance * Math.sqrt(entry.count) * (1 + saturation / 255);
      if (score > candidateScore) {
        candidate = entry;
        candidateScore = score;
      }
    });
    centers.push({ color: [...candidate.color], lab: [...candidate.lab] });
  }
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    weighted.forEach((entry) => {
      let closest = 0;
      let distance = Infinity;
      centers.forEach((center, index) => {
        const nextDistance = labDistance(entry.lab, center.lab);
        if (nextDistance < distance) { closest = index; distance = nextDistance; }
      });
      entry.color.forEach((channel, index) => { sums[closest][index] += channel * entry.count; });
      sums[closest][3] += entry.count;
    });
    centers.forEach((center, index) => {
      if (sums[index][3]) {
        const color = sums[index].slice(0, 3).map((channel) => channel / sums[index][3]);
        centers[index] = { color, lab: rgbToLab(color) };
      }
    });
  }
  if (centers.length === 1) {
    const color = centers[0].color.map((channel) => channel > 127 ? 0 : 255);
    centers.push({ color, lab: rgbToLab(color) });
  }
  return centers
    .map((center) => center.color.map(Math.round))
    .sort((first, second) => (first[0] * .299 + first[1] * .587 + first[2] * .114) - (second[0] * .299 + second[1] * .587 + second[2] * .114));
}

function robustChannelMean(values) {
  if (values.length < 7) return values.reduce((sum, value) => sum + value, 0) / values.length;
  const sorted = [...values].sort((first, second) => first - second);
  const trim = Math.max(1, Math.floor(sorted.length * 0.15));
  const kept = sorted.slice(trim, sorted.length - trim);
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

function sampleRobustCell(imageData, imageWidth, left, top, right, bottom) {
  const sampleWidth = Math.min(5, right - left);
  const sampleHeight = Math.min(5, bottom - top);
  const channels = [[], [], []];
  for (let sampleY = 0; sampleY < sampleHeight; sampleY += 1) {
    const y = top + Math.min(bottom - top - 1, Math.floor(((sampleY + 0.5) * (bottom - top)) / sampleHeight));
    for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
      const x = left + Math.min(right - left - 1, Math.floor(((sampleX + 0.5) * (right - left)) / sampleWidth));
      const offset = ((y * imageWidth) + x) * 4;
      channels[0].push(imageData[offset]);
      channels[1].push(imageData[offset + 1]);
      channels[2].push(imageData[offset + 2]);
    }
  }
  return channels.map(robustChannelMean);
}

export function sampleGridColorsRobust(imageData, imageWidth, imageHeight, gridWidth, gridHeight) {
  const colors = [];
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const top = Math.floor((gridY * imageHeight) / gridHeight);
    const bottom = Math.max(top + 1, Math.floor(((gridY + 1) * imageHeight) / gridHeight));
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const left = Math.floor((gridX * imageWidth) / gridWidth);
      const right = Math.max(left + 1, Math.floor(((gridX + 1) * imageWidth) / gridWidth));
      colors.push(sampleRobustCell(imageData, imageWidth, left, top, right, bottom));
    }
  }
  return colors;
}

async function sampleGridColorsRobustAsync(imageData, imageWidth, imageHeight, gridWidth, gridHeight, context, yieldEvery = 24) {
  const yieldChunk = createChunkedYielder(yieldEvery, context.checkCancelled);
  const colors = [];
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    context.checkCancelled();
    if (yieldChunk) await yieldChunk();
    const top = Math.floor((gridY * imageHeight) / gridHeight);
    const bottom = Math.max(top + 1, Math.floor(((gridY + 1) * imageHeight) / gridHeight));
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const left = Math.floor((gridX * imageWidth) / gridWidth);
      const right = Math.max(left + 1, Math.floor(((gridX + 1) * imageWidth) / gridWidth));
      colors.push(sampleRobustCell(imageData, imageWidth, left, top, right, bottom));
    }
    if (gridY % 8 === 0) context.progress('sampling', 0.18 * ((gridY + 1) / gridHeight));
  }
  return colors;
}

function downsampleCellColors(colors, width, height, maxSamples = 12_000) {
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxSamples)));
  const samples = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) samples.push(colors[(y * width) + x]);
  }
  return samples;
}

function mapRgbColorsToPalette(sourcePixels, paletteRgb) {
  const paletteLab = paletteRgb.map(rgbToLab);
  return sourcePixels.map((rgb) => {
    const lab = rgbToLab(rgb);
    return nearestPaletteIndex(lab, paletteLab);
  });
}

function nearestPaletteIndex(lab, paletteLab) {
  let closestIndex = 0;
  let closestDistance = Infinity;
  paletteLab.forEach((color, paletteIndex) => {
    const distance = labDistance(lab, color);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = paletteIndex;
    }
  });
  return closestIndex;
}

function getPaintableOptions(width, height, options = {}) {
  const area = width * height;
  const defaultRegionSize = Math.max(2, Math.min(96, Math.round(Math.sqrt(area) / 16)));
  return {
    minRegionSize: Number.isInteger(options.minRegionSize) ? Math.max(1, options.minRegionSize) : defaultRegionSize,
    maxMergePasses: Number.isInteger(options.maxMergePasses) ? Math.max(1, Math.min(6, options.maxMergePasses)) : 3,
    strongEdgeThreshold: Number.isFinite(options.strongEdgeThreshold) ? Math.max(1, options.strongEdgeThreshold) : 24,
    spatialWeight: Number.isFinite(options.spatialWeight) ? Math.max(0, options.spatialWeight) : 2.25,
    regularizationIterations: Number.isInteger(options.regularizationIterations)
      ? Math.max(0, Math.min(4, options.regularizationIterations))
      : (area > 400_000 ? 1 : 2),
    ditherMode: options.ditherMode === 'ordered' ? 'ordered' : 'none',
  };
}

function addCandidateId(candidateIds, count, value) {
  for (let index = 0; index < count; index += 1) if (candidateIds[index] === value) return count;
  candidateIds[count] = value;
  return count + 1;
}

function scorePaintableCandidate(index, candidate, labels, sourceLabs, paletteLabs, width, height, settings) {
  let score = labDistance(sourceLabs[index], paletteLabs[candidate]);
  forEachNeighbour(index, width, height, (neighbour) => {
    const edge = labDistance(sourceLabs[index], sourceLabs[neighbour]);
    if (edge < settings.strongEdgeThreshold && candidate !== labels[neighbour]) {
      score += settings.spatialWeight * (1 - (edge / settings.strongEdgeThreshold));
    }
  });
  return score;
}

function regularizePaintableLabels(sourcePixels, width, height, paletteRgb, settings, checkCancelled = () => {}) {
  const sourceLabs = sourcePixels.map(rgbToLab);
  const paletteLabs = paletteRgb.map(rgbToLab);
  const labels = mapRgbColorsToPalette(sourcePixels, paletteRgb);
  const candidateIds = new Int16Array(Math.max(8, paletteRgb.length + 4));

  for (let iteration = 0; iteration < settings.regularizationIterations; iteration += 1) {
    let changed = 0;
    for (let index = 0; index < labels.length; index += 1) {
      if ((index & 0x1fff) === 0) checkCancelled();
      let candidateCount = 0;
      candidateCount = addCandidateId(candidateIds, candidateCount, labels[index]);
      forEachNeighbour(index, width, height, (neighbour) => {
        candidateCount = addCandidateId(candidateIds, candidateCount, labels[neighbour]);
      });
      let best = labels[index];
      let bestScore = scorePaintableCandidate(index, best, labels, sourceLabs, paletteLabs, width, height, settings);
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
        const candidate = candidateIds[candidateIndex];
        if (candidate === best) continue;
        const score = scorePaintableCandidate(index, candidate, labels, sourceLabs, paletteLabs, width, height, settings);
        if (score + 0.35 < bestScore || (Math.abs(score - bestScore) <= 0.35 && candidate < best)) {
          best = candidate;
          bestScore = score;
        }
      }
      if (best !== labels[index]) {
        labels[index] = best;
        changed += 1;
      }
    }
    if (!changed) break;
  }
  return { labels, sourceLabs, paletteLabs };
}

async function regularizePaintableLabelsAsync(sourcePixels, width, height, paletteRgb, settings, context, yieldEvery = 24) {
  const sourceLabs = sourcePixels.map(rgbToLab);
  const paletteLabs = paletteRgb.map(rgbToLab);
  const labels = mapRgbColorsToPalette(sourcePixels, paletteRgb);
  const candidateIds = new Int16Array(Math.max(8, paletteRgb.length + 4));
  const yieldChunk = createChunkedYielder(yieldEvery, context.checkCancelled);

  for (let iteration = 0; iteration < settings.regularizationIterations; iteration += 1) {
    let changed = 0;
    for (let y = 0; y < height; y += 1) {
      context.checkCancelled();
      if (yieldChunk) await yieldChunk();
      for (let x = 0; x < width; x += 1) {
        const index = (y * width) + x;
        let candidateCount = 0;
        candidateCount = addCandidateId(candidateIds, candidateCount, labels[index]);
        forEachNeighbour(index, width, height, (neighbour) => {
          candidateCount = addCandidateId(candidateIds, candidateCount, labels[neighbour]);
        });
        let best = labels[index];
        let bestScore = scorePaintableCandidate(index, best, labels, sourceLabs, paletteLabs, width, height, settings);
        for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
          const candidate = candidateIds[candidateIndex];
          if (candidate === best) continue;
          const score = scorePaintableCandidate(index, candidate, labels, sourceLabs, paletteLabs, width, height, settings);
          if (score + 0.35 < bestScore || (Math.abs(score - bestScore) <= 0.35 && candidate < best)) {
            best = candidate;
            bestScore = score;
          }
        }
        if (best !== labels[index]) {
          labels[index] = best;
          changed += 1;
        }
      }
      if (y % 8 === 0) context.progress('regularization', 0.18 + (0.25 * ((iteration * height) + y + 1) / (height * Math.max(1, settings.regularizationIterations))));
    }
    if (!changed) break;
  }
  return { labels, sourceLabs, paletteLabs };
}

function forEachNeighbour(index, width, height, callback) {
  const x = index % width;
  const y = Math.floor(index / width);
  if (x > 0) callback(index - 1);
  if (x < width - 1) callback(index + 1);
  if (y > 0) callback(index - width);
  if (y < height - 1) callback(index + width);
}

function collectRegionMap(cells, width, height, checkCancelled = () => {}) {
  const regionIds = new Int32Array(cells.length);
  regionIds.fill(-1);
  const sizes = [];
  const colors = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (regionIds[start] !== -1) continue;
    if ((start & 0x1fff) === 0) checkCancelled();
    const id = sizes.length;
    const color = cells[start];
    const stack = [start];
    regionIds[start] = id;
    let size = 0;
    while (stack.length) {
      const index = stack.pop();
      size += 1;
      forEachNeighbour(index, width, height, (neighbour) => {
        if (regionIds[neighbour] === -1 && cells[neighbour] === color) {
          regionIds[neighbour] = id;
          stack.push(neighbour);
        }
      });
    }
    sizes.push(size);
    colors.push(color);
  }
  return { regionIds, sizes, colors };
}

function chooseBoundaryCandidate(boundary, globalCounts) {
  let best = -1;
  let bestScore = -Infinity;
  boundary.forEach((entry, candidate) => {
    const score = (entry.shared * 8) + ((globalCounts[candidate] || 0) * 0.0001) - (entry.distance * 0.12);
    if (score > bestScore || (score === bestScore && candidate < best)) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

function mostCommonPaletteColor(counts) {
  let best = 0;
  for (let index = 1; index < counts.length; index += 1) {
    if (counts[index] > counts[best]) best = index;
  }
  return best;
}

function mergePaintableRegions(cells, width, height, paletteRgb, sourceLabs, settings, checkCancelled = () => {}) {
  let result = [...cells];
  const paletteLabs = paletteRgb.map(rgbToLab);
  const globalCounts = new Int32Array(paletteRgb.length);
  result.forEach((color) => { globalCounts[color] += 1; });
  let finalMap = null;

  for (let pass = 0; pass < settings.maxMergePasses; pass += 1) {
    const map = collectRegionMap(result, width, height, checkCancelled);
    finalMap = map;
    const replacements = new Int16Array(map.sizes.length);
    replacements.fill(-1);
    const handled = new Uint8Array(map.sizes.length);
    const seen = new Int32Array(result.length);
    let seenStamp = 0;
    let replacementCount = 0;

    for (let start = 0; start < result.length; start += 1) {
      if ((start & 0x1fff) === 0) checkCancelled();
      const regionId = map.regionIds[start];
      if (handled[regionId] || map.sizes[regionId] > settings.minRegionSize * 2) continue;
      handled[regionId] = 1;
      const color = map.colors[regionId];
      const members = [start];
      const stack = [start];
      seenStamp += 1;
      seen[start] = seenStamp;
      let minX = start % width;
      let maxX = minX;
      let minY = Math.floor(start / width);
      let maxY = minY;
      const boundary = new Map();
      while (stack.length) {
        const index = stack.pop();
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        forEachNeighbour(index, width, height, (neighbour) => {
          if (map.regionIds[neighbour] === regionId) {
            if (seen[neighbour] !== seenStamp) {
              seen[neighbour] = seenStamp;
              stack.push(neighbour);
              members.push(neighbour);
            }
            return;
          }
          const candidate = result[neighbour];
          const entry = boundary.get(candidate) || { shared: 0, strong: 0, maxSupport: 0, distance: labDistance(paletteLabs[color], paletteLabs[candidate]) };
          entry.shared += 1;
          if (labDistance(sourceLabs[index], sourceLabs[neighbour]) >= settings.strongEdgeThreshold) entry.strong += 1;
          entry.maxSupport = Math.max(entry.maxSupport, map.sizes[map.regionIds[neighbour]]);
          boundary.set(candidate, entry);
        });
      }
      if (!boundary.size) continue;
      const spanX = maxX - minX + 1;
      const spanY = maxY - minY + 1;
      const elongated = Math.max(spanX, spanY) >= Math.max(2, Math.min(spanX, spanY) * 2);
      const overBudget = members.length > settings.minRegionSize;
      if (overBudget && !elongated) continue;
      const candidates = [...boundary.values()];
      const allNeighboursSmall = candidates.every((entry) => entry.maxSupport <= settings.minRegionSize);
      const noiseLike = members.length <= 2 && allNeighboursSmall && candidates.some((entry) => entry.shared >= members.length);
      const bestCandidate = noiseLike ? mostCommonPaletteColor(globalCounts) : chooseBoundaryCandidate(boundary, globalCounts);
      const bestEntry = boundary.get(bestCandidate) || {
        shared: 0,
        strong: 0,
        maxSupport: 0,
        distance: labDistance(paletteLabs[color], paletteLabs[bestCandidate]),
      };
      if (!bestEntry) continue;
      const strongRatio = bestEntry.strong / Math.max(1, bestEntry.shared);
      const supportedAccent = members.length === 1
        && boundary.size === 1
        && bestEntry.maxSupport >= settings.minRegionSize * 2
        && strongRatio >= 0.65;
      const protectedStrongBoundary = bestEntry.maxSupport >= settings.minRegionSize * 2 && strongRatio >= 0.65;

      // A single coherent high-contrast accent survives. Checker/noise cells do
      // not: their neighbouring regions are themselves tiny, so the canonical
      // boundary colour wins deterministically instead of inverting in pairs.
      if (supportedAccent || (!noiseLike && protectedStrongBoundary)) continue;
      if (bestCandidate !== color) {
        replacements[regionId] = bestCandidate;
        replacementCount += 1;
      }
    }

    if (!replacementCount) break;
    result = result.map((color, index) => {
      const replacement = replacements[map.regionIds[index]];
      return replacement >= 0 ? replacement : color;
    });
  }
  return { cells: result, regionMap: finalMap };
}

async function mergePaintableRegionsAsync(cells, width, height, paletteRgb, sourceLabs, settings, context) {
  context.checkCancelled();
  const result = mergePaintableRegions(cells, width, height, paletteRgb, sourceLabs, settings, context.checkCancelled);
  await new Promise((resolve) => setTimeout(resolve, 0));
  context.checkCancelled();
  context.progress('cleanup', 0.85);
  return result;
}

function applyBoundedOrderedDither(cells, sourceLabs, paletteLabs, width, height, settings, checkCancelled = () => {}) {
  if (settings.ditherMode !== 'ordered') return cells;
  const matrix = [0, 2, 3, 1];
  const result = [...cells];
  for (let index = 0; index < result.length; index += 1) {
    if ((index & 0x1fff) === 0) checkCancelled();
    const current = result[index];
    let second = current;
    let secondDistance = Infinity;
    const source = sourceLabs[index];
    paletteLabs.forEach((palette, paletteIndex) => {
      if (paletteIndex === current) return;
      const distance = labDistance(source, palette);
      if (distance < secondDistance) {
        secondDistance = distance;
        second = paletteIndex;
      }
    });
    const currentDistance = labDistance(source, paletteLabs[current]);
    if (second === current || secondDistance - currentDistance > 7) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const localEdge = Math.max(...[...neighbouringIndices(index, width, height)].map((neighbour) => labDistance(sourceLabs[index], sourceLabs[neighbour])));
    if (localEdge >= settings.strongEdgeThreshold * 0.7) continue;
    if ((secondDistance - currentDistance) < matrix[((y & 1) * 2) + (x & 1)] * 1.5) result[index] = second;
  }
  return result;
}

function calculatePaintabilityMetrics(cells, width, height, regionMap, sourceLabs, settings) {
  const sizes = regionMap?.sizes || collectRegionMap(cells, width, height).sizes;
  let tinyCells = 0;
  let microCells = 0;
  sizes.forEach((size) => {
    if (size <= 2) tinyCells += size;
    if (size <= settings.minRegionSize) microCells += size;
  });
  let strongEdges = 0;
  let retainedEdges = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const x = index % width;
    if (x >= width - 1) continue;
    const neighbour = index + 1;
    const sourceEdge = labDistance(sourceLabs[index], sourceLabs[neighbour]);
    if (sourceEdge >= settings.strongEdgeThreshold) {
      strongEdges += 1;
      if (cells[index] !== cells[neighbour]) retainedEdges += 1;
    }
  }
  return {
    regionCount: sizes.length,
    meanRegionSize: cells.length / Math.max(1, sizes.length),
    tinyRegionRatio: tinyCells / Math.max(1, cells.length),
    microRegionRatio: microCells / Math.max(1, cells.length),
    edgeRetention: strongEdges ? retainedEdges / strongEdges : 1,
    predictedEffort: sizes.length,
    minRegionSize: settings.minRegionSize,
  };
}

function fingerprintResult(width, height, palette, cells, stylePreset, pipelineVersion) {
  let hash = 2166136261;
  const update = (value) => {
    const string = String(value);
    for (let index = 0; index < string.length; index += 1) hash = Math.imul(hash ^ string.charCodeAt(index), 16777619);
  };
  update(width);
  update(height);
  update(stylePreset);
  update(pipelineVersion);
  palette.forEach(update);
  cells.forEach(update);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildPaintableCells(sourcePixels, width, height, requestedColors, options = {}) {
  const settings = getPaintableOptions(width, height, options);
  const paletteRgb = buildPalette(downsampleCellColors(sourcePixels, width, height), requestedColors);
  const initial = regularizePaintableLabels(sourcePixels, width, height, paletteRgb, settings, options.checkCancelled);
  const dithered = applyBoundedOrderedDither(initial.labels, initial.sourceLabs, initial.paletteLabs, width, height, settings, options.checkCancelled);
  const cleaned = mergePaintableRegions(dithered, width, height, paletteRgb, initial.sourceLabs, settings, options.checkCancelled);
  const palette = paletteRgb.map(([red, green, blue]) => normalizeHex(red, green, blue));
  return {
    palette,
    cells: cleaned.cells,
    metrics: calculatePaintabilityMetrics(cleaned.cells, width, height, cleaned.regionMap, initial.sourceLabs, settings),
    sourceLabs: initial.sourceLabs,
    paletteRgb,
    settings,
  };
}

async function buildPaintableCellsAsync(sourcePixels, width, height, requestedColors, options, context) {
  const settings = getPaintableOptions(width, height, options);
  const paletteRgb = buildPalette(downsampleCellColors(sourcePixels, width, height), requestedColors);
  context.progress('palette', 0.2);
  const initial = await regularizePaintableLabelsAsync(sourcePixels, width, height, paletteRgb, settings, context, options.yieldEvery || 24);
  context.checkCancelled();
  const dithered = applyBoundedOrderedDither(initial.labels, initial.sourceLabs, initial.paletteLabs, width, height, settings, context.checkCancelled);
  context.progress('regularization', 0.48);
  const cleaned = await mergePaintableRegionsAsync(dithered, width, height, paletteRgb, initial.sourceLabs, settings, context, options.yieldEvery || 24);
  const palette = paletteRgb.map(([red, green, blue]) => normalizeHex(red, green, blue));
  const metrics = calculatePaintabilityMetrics(cleaned.cells, width, height, cleaned.regionMap, initial.sourceLabs, settings);
  context.progress('complete', 1);
  return { palette, cells: cleaned.cells, metrics, sourceLabs: initial.sourceLabs, paletteRgb, settings };
}

function analysisDimensions(width, height) {
  const scale = Math.max(1, Math.min(6, Math.floor(384 / Math.max(width, height))));
  return { width: width * scale, height: height * scale };
}

function drawSourceImage(context, bitmap, targetWidth, targetHeight, crop) {
  context.fillStyle = '#101820';
  context.fillRect(0, 0, targetWidth, targetHeight);
  if (crop) {
    const cropSize = Math.min(bitmap.width, bitmap.height) / crop.scale;
    const cx = bitmap.width / 2 + crop.offsetX;
    const cy = bitmap.height / 2 + crop.offsetY;
    const sx = Math.max(0, Math.min(bitmap.width - cropSize, cx - cropSize / 2));
    const sy = Math.max(0, Math.min(bitmap.height - cropSize, cy - cropSize / 2));
    const sw = Math.min(cropSize, bitmap.width - sx);
    const sh = Math.min(cropSize, bitmap.height - sy);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
    return;
  }

  const sourceRatio = bitmap.width / bitmap.height;
  const targetRatio = targetWidth / targetHeight;
  const drawWidth = sourceRatio > targetRatio ? targetWidth : targetHeight * sourceRatio;
  const drawHeight = sourceRatio > targetRatio ? targetWidth / sourceRatio : targetHeight;
  context.drawImage(bitmap, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight);
}

export function sampleGridColors(imageData, imageWidth, imageHeight, gridWidth, gridHeight) {
  const colors = [];
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const top = Math.floor((gridY * imageHeight) / gridHeight);
    const bottom = Math.max(top + 1, Math.floor(((gridY + 1) * imageHeight) / gridHeight));
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const left = Math.floor((gridX * imageWidth) / gridWidth);
      const right = Math.max(left + 1, Math.floor(((gridX + 1) * imageWidth) / gridWidth));
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = ((y * imageWidth) + x) * 4;
          sum[0] += imageData[offset];
          sum[1] += imageData[offset + 1];
          sum[2] += imageData[offset + 2];
          count += 1;
        }
      }
      colors.push(sum.map((channel) => channel / count));
    }
  }
  return colors;
}

export function edgeAwareSmoothColors(colors, width, height) {
  const labs = colors.map(rgbToLab);
  return colors.map((color, index) => {
    const similar = [color];
    for (const neighbour of neighbouringIndices(index, width, height)) {
      // Smooth texture within a region, but do not blend across a visible edge.
      if (labDistance(labs[index], labs[neighbour]) < 18) similar.push(colors[neighbour]);
    }
    if (similar.length < 3) return color;
    return [0, 1, 2].map((channel) => similar.reduce((sum, item) => sum + item[channel], 0) / similar.length);
  });
}

function paletteSamples(imageData, width, height) {
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 12_000)));
  const samples = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = ((y * width) + x) * 4;
      samples.push([imageData[offset], imageData[offset + 1], imageData[offset + 2]]);
    }
  }
  return samples;
}

function createRasterCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Canvas API is unavailable');
}

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return [0, 0, 0];
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось подготовить preview изображения'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function canvasToDataUrl(canvas) {
  if (typeof canvas.toDataURL === 'function') return canvas.toDataURL('image/png');
  if (typeof canvas.convertToBlob === 'function') return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  throw new Error('Canvas export API is unavailable');
}

async function renderPreview(width, height, palette, cells) {
  const pixelCanvas = createRasterCanvas(width, height);
  pixelCanvas.width = width;
  pixelCanvas.height = height;
  const pixelContext = pixelCanvas.getContext('2d');
  const rgbaPalette = palette.map(hexToRgb);
  const imageData = pixelContext.createImageData(width, height);
  for (let index = 0; index < cells.length; index += 1) {
    const color = rgbaPalette[cells[index]] || [0, 0, 0];
    const offset = index * 4;
    imageData.data[offset] = color[0];
    imageData.data[offset + 1] = color[1];
    imageData.data[offset + 2] = color[2];
    imageData.data[offset + 3] = 255;
  }
  pixelContext.putImageData(imageData, 0, 0);
  const preview = createRasterCanvas(512, 512);
  const previewContext = preview.getContext('2d');
  previewContext.imageSmoothingEnabled = false;
  previewContext.drawImage(pixelCanvas, 0, 0, 512, 512);
  return canvasToDataUrl(preview);
}

export async function buildColoringFromImage(file, options = {}) {
  const {
    width,
    height,
    colors,
    crop,
    yieldEvery,
  } = options;
  const stylePreset = normalizeStylePreset(options.stylePreset);
  const pipelineVersion = stylePreset === 'classic' ? PIXELIZATION_PIPELINES.classic : PIXELIZATION_PIPELINES.paintable;
  const pipelineContext = createPipelineContext(options);
  pipelineContext.checkCancelled();
  const bitmap = await createImageBitmap(file);
  const analysis = analysisDimensions(width, height);
  const canvas = createRasterCanvas(analysis.width, analysis.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  drawSourceImage(context, bitmap, analysis.width, analysis.height, crop);
  bitmap.close();
  const pixels = context.getImageData(0, 0, analysis.width, analysis.height).data;
  pipelineContext.progress('rasterized', 0.08);

  if (stylePreset !== 'classic') {
    const sourcePixels = await sampleGridColorsRobustAsync(
      pixels,
      analysis.width,
      analysis.height,
      width,
      height,
      pipelineContext,
      Number.isInteger(yieldEvery) && yieldEvery > 0 ? yieldEvery : 24,
    );
    const candidate = await buildPaintableCellsAsync(
      sourcePixels,
      width,
      height,
      colors,
      { ...options, ditherMode: stylePreset === 'paintable-dither' ? 'ordered' : options.ditherMode },
      pipelineContext,
    );
    pipelineContext.checkCancelled();
    const palette = candidate.palette;
    const originalDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const result = {
      width,
      height,
      palette,
      cells: candidate.cells,
      previewDataUrl: await renderPreview(width, height, palette, candidate.cells),
      originalDataUrl,
      pipelineVersion,
      stylePreset,
      metrics: candidate.metrics,
    };
    result.resultFingerprint = fingerprintResult(width, height, palette, candidate.cells, stylePreset, pipelineVersion);
    result.previewFingerprint = result.resultFingerprint;
    pipelineContext.progress('complete', 1, { resultFingerprint: result.resultFingerprint });
    return result;
  }

  const yieldChunk = createChunkedYielder(yieldEvery, pipelineContext.checkCancelled);
  const sourcePixels = yieldChunk
    ? await edgeAwareSmoothColorsAsync(
      await sampleGridColorsAsync(pixels, analysis.width, analysis.height, width, height, yieldEvery, pipelineContext.checkCancelled),
      width,
      height,
      yieldEvery,
      pipelineContext.checkCancelled,
    )
    : edgeAwareSmoothColors(
      sampleGridColors(pixels, analysis.width, analysis.height, width, height),
      width,
      height,
    );
  const paletteRgb = buildPalette(paletteSamples(pixels, analysis.width, analysis.height), colors);
  const paletteLab = paletteRgb.map(rgbToLab);
  const cells = yieldChunk
    ? await mapColorsToPaletteAsync(sourcePixels, paletteRgb, paletteLab, width, height, yieldEvery, pipelineContext.checkCancelled)
    : sourcePixels.map((rgb) => {
      const lab = rgbToLab(rgb);
      let closestIndex = 0;
      let closestDistance = Infinity;
      paletteLab.forEach((color, paletteIndex) => {
        const distance = labDistance(lab, color);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = paletteIndex;
        }
      });
      return closestIndex;
    });
  const smoothedCells = yieldChunk
    ? await cleanUpSmallRegionsAsync(
      await smoothCellsAsync(cells, width, height, paletteRgb, yieldEvery, pipelineContext.checkCancelled),
      width,
      height,
      paletteRgb,
      yieldEvery,
      pipelineContext.checkCancelled,
    )
    : cleanUpSmallRegions(smoothCells(cells, width, height, paletteRgb), width, height, paletteRgb);
  const palette = paletteRgb.map(([red, green, blue]) => normalizeHex(red, green, blue));
  pipelineContext.checkCancelled();
  const originalDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  const result = {
    width,
    height,
    palette,
    cells: smoothedCells,
    previewDataUrl: await renderPreview(width, height, palette, smoothedCells),
    originalDataUrl,
    pipelineVersion,
    stylePreset,
  };
  result.resultFingerprint = fingerprintResult(width, height, palette, smoothedCells, stylePreset, pipelineVersion);
  result.previewFingerprint = result.resultFingerprint;
  pipelineContext.progress('complete', 1, { resultFingerprint: result.resultFingerprint });
  return result;
}
