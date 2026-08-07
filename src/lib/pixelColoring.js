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

function createChunkedYielder(yieldEvery) {
  if (!Number.isInteger(yieldEvery) || yieldEvery < 1) return null;
  let counter = 0;
  return async () => {
    counter += 1;
    if (counter % yieldEvery !== 0) return;
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
      await scheduler.yield();
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
}

async function sampleGridColorsAsync(imageData, imageWidth, imageHeight, gridWidth, gridHeight, yieldEvery) {
  const yieldChunk = createChunkedYielder(yieldEvery);
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

async function edgeAwareSmoothColorsAsync(colors, width, height, yieldEvery) {
  const yieldChunk = createChunkedYielder(yieldEvery);
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

async function smoothCellsAsync(cells, width, height, palette, yieldEvery) {
  const yieldChunk = createChunkedYielder(yieldEvery);
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

async function cleanUpSmallRegionsAsync(cells, width, height, palette, yieldEvery) {
  const yieldChunk = createChunkedYielder(yieldEvery);
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

async function mapColorsToPaletteAsync(sourcePixels, paletteRgb, paletteLab, width, height, yieldEvery) {
  const yieldChunk = createChunkedYielder(yieldEvery);
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

export async function buildColoringFromImage(file, { width, height, colors, crop, yieldEvery } = {}) {
  const bitmap = await createImageBitmap(file);
  const analysis = analysisDimensions(width, height);
  const canvas = createRasterCanvas(analysis.width, analysis.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  drawSourceImage(context, bitmap, analysis.width, analysis.height, crop);
  bitmap.close();
  const pixels = context.getImageData(0, 0, analysis.width, analysis.height).data;
  const yieldChunk = createChunkedYielder(yieldEvery);
  const sourcePixels = yieldChunk
    ? await edgeAwareSmoothColorsAsync(
      await sampleGridColorsAsync(pixels, analysis.width, analysis.height, width, height, yieldEvery),
      width,
      height,
      yieldEvery,
    )
    : edgeAwareSmoothColors(
      sampleGridColors(pixels, analysis.width, analysis.height, width, height),
      width,
      height,
    );
  const paletteRgb = buildPalette(paletteSamples(pixels, analysis.width, analysis.height), colors);
  const paletteLab = paletteRgb.map(rgbToLab);
  const cells = yieldChunk
    ? await mapColorsToPaletteAsync(sourcePixels, paletteRgb, paletteLab, width, height, yieldEvery)
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
      await smoothCellsAsync(cells, width, height, paletteRgb, yieldEvery),
      width,
      height,
      paletteRgb,
      yieldEvery,
    )
    : cleanUpSmallRegions(smoothCells(cells, width, height, paletteRgb), width, height, paletteRgb);
  const palette = paletteRgb.map(([red, green, blue]) => normalizeHex(red, green, blue));
  const originalDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  return {
    width,
    height,
    palette,
    cells: smoothedCells,
    previewDataUrl: await renderPreview(width, height, palette, smoothedCells),
    originalDataUrl,
  };
}
