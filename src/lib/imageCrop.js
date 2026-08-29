export function extractCrop(image, crop) {
  const { scale, offsetX, offsetY, size } = crop;
  const cropSize = Math.min(image.naturalWidth, image.naturalHeight) / scale;
  const cx = image.naturalWidth / 2 + offsetX;
  const cy = image.naturalHeight / 2 + offsetY;
  const sx = Math.max(0, Math.min(image.naturalWidth - cropSize, cx - cropSize / 2));
  const sy = Math.max(0, Math.min(image.naturalHeight - cropSize, cy - cropSize / 2));
  const sw = Math.min(cropSize, image.naturalWidth - sx);
  const sh = Math.min(cropSize, image.naturalHeight - sy);

  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  // Draw directly from the decoded image. A source-sized intermediate canvas
  // can add tens of megabytes for a phone photo before preview work starts.
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
  return out;
}

export function renderImageCropPreview(image, crop) {
  const canvas = extractCrop(image, crop);
  return canvas.toDataURL('image/png');
}

export function renderFitPreview(image, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const srcRatio = image.naturalWidth / image.naturalHeight;
  let dw, dh;
  if (srcRatio > 1) {
    dw = size * 0.94;
    dh = dw / srcRatio;
  } else {
    dh = size * 0.94;
    dw = dh * srcRatio;
  }
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return canvas.toDataURL('image/png');
}

export function renderGridPreview(width, height, palette, cells) {
  const pixelCanvas = document.createElement('canvas');
  pixelCanvas.width = width;
  pixelCanvas.height = height;
  const pixelContext = pixelCanvas.getContext('2d');
  cells.forEach((color, index) => {
    pixelContext.fillStyle = palette[color];
    pixelContext.fillRect(index % width, Math.floor(index / width), 1, 1);
  });
  const preview = document.createElement('canvas');
  preview.width = 512;
  preview.height = 512;
  const previewContext = preview.getContext('2d');
  previewContext.imageSmoothingEnabled = false;
  previewContext.drawImage(pixelCanvas, 0, 0, 512, 512);
  return preview.toDataURL('image/png');
}

export function renderNumberedPreview(width, height, palette, cells) {
  const pixelSize = 12;
  const canvas = document.createElement('canvas');
  canvas.width = width * pixelSize;
  canvas.height = height * pixelSize;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(8, Math.floor(pixelSize * 0.42))}px Outfit, sans-serif`;
  cells.forEach((color, index) => {
    const x = (index % width) * pixelSize;
    const y = Math.floor(index / width) * pixelSize;
    ctx.fillStyle = palette[color];
    ctx.fillRect(x, y, pixelSize, pixelSize);
    ctx.strokeStyle = '#0b131a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, pixelSize, pixelSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(color + 1), x + pixelSize / 2, y + pixelSize / 2 + 1);
  });
  const preview = document.createElement('canvas');
  preview.width = 320;
  preview.height = 320;
  const previewCtx = preview.getContext('2d');
  previewCtx.imageSmoothingEnabled = false;
  previewCtx.drawImage(canvas, 0, 0, 320, 320);
  return preview.toDataURL('image/png');
}

export const CREATOR_PREVIEW_RESOLUTIONS = Object.freeze([192, 512, 1024, 1200]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function buildCreatorPreviewCacheKey({
  fileToken,
  width,
  height = width,
  colors,
  cropMode = 'fit',
  crop = null,
  stylePreset = 'paintable',
} = {}) {
  const normalizedCrop = cropMode === 'crop'
    ? [crop?.scale ?? 1, crop?.offsetX ?? 0, crop?.offsetY ?? 0].map((value) => Number(value).toFixed(2)).join(':')
    : 'fit';
  return [fileToken || 'no-file', width, height, colors, cropMode, normalizedCrop, stylePreset].join('|');
}

export function isCreatorPreviewCurrent(batchId, currentBatchId) {
  return Number(batchId) === Number(currentBatchId);
}

export function buildCreatorPreviewError(previous = {}, error = null) {
  return {
    ...previous,
    status: 'error',
    progress: 0,
    stage: null,
    error: {
      code: error?.code || 'PREVIEW_FAILED',
      message: error?.message || 'Не удалось построить выбранное превью',
    },
    // A failed recompute must never leave a stale result looking usable.
    pixel: null,
    numbered: null,
    palette: [],
    metrics: null,
    insights: null,
    pipelineVersion: null,
    resultFingerprint: null,
    previewPixelFingerprint: null,
  };
}

export function deriveCreatorPreviewInsights({ width, height, palette = [], cells = [], metrics = {} } = {}) {
  const totalCells = Math.max(0, Number(width) * Number(height));
  const colorsUsed = cells.length ? new Set(cells).size : palette.length;
  const regionCount = Math.max(0, Number(metrics.regionCount || 0));
  const predictedEffort = Math.max(regionCount, Number(metrics.predictedEffort || 0));
  const meanRegionSize = Number(metrics.meanRegionSize || (regionCount ? totalCells / regionCount : totalCells));
  const tinyRegionRatio = clamp(Number(metrics.tinyRegionRatio || 0), 0, 1);
  const microRegionRatio = clamp(Number(metrics.microRegionRatio || 0), 0, 1);
  const edgeRetention = clamp(Number(metrics.edgeRetention ?? 1), 0, 1);
  const fragmentationPerThousand = totalCells ? (regionCount / totalCells) * 1000 : 0;
  const score = Math.round(clamp(
    100
      - Math.min(45, fragmentationPerThousand * 0.55)
      - Math.min(25, microRegionRatio * 100)
      - Math.min(20, tinyRegionRatio * 200)
      - Math.min(10, (1 - edgeRetention) * 20),
    0,
    100,
  ));
  const paintability = score >= 75
    ? { level: 'good', label: 'Легче раскрашивать' }
    : score >= 50
      ? { level: 'fair', label: 'Средняя сложность' }
      : { level: 'noisy', label: 'Много мелкой работы' };
  const numberReadability = meanRegionSize >= 20 && tinyRegionRatio < 0.02
    ? 'Высокая'
    : meanRegionSize >= 8 && microRegionRatio < 0.18
      ? 'Средняя'
      : 'Только при увеличении';
  return {
    totalCells,
    colorsUsed,
    regionCount,
    predictedEffort,
    meanRegionSize,
    tinyRegionRatio,
    microRegionRatio,
    edgeRetention,
    fragmentationPerThousand,
    paintabilityScore: score,
    paintability,
    numberReadability,
  };
}

/**
 * Render a fixed-size, zoomed fragment of the actual generated cell map.
 * The renderer never allocates a width*cellSize by height*cellSize canvas, so
 * 1200x1200 previews stay bounded while their numbers remain readable.
 */
export function renderCreatorNumberGridPreview(width, height, palette, cells, {
  size = 480,
  cellsAcross = 12,
  focusX = 0.5,
  focusY = 0.5,
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Preview dimensions must be positive integers');
  }
  if (!Array.isArray(cells) || cells.length !== width * height) {
    throw new RangeError('Preview cells must match the requested dimensions');
  }
  const boundedSize = clamp(Math.round(size), 240, 640);
  const columns = Math.min(width, clamp(Math.round(cellsAcross), 8, 18));
  const rows = Math.min(height, columns);
  const centerX = clamp(Math.round((width - 1) * Number(focusX)), 0, width - 1);
  const centerY = clamp(Math.round((height - 1) * Number(focusY)), 0, height - 1);
  const startX = clamp(centerX - Math.floor(columns / 2), 0, Math.max(0, width - columns));
  const startY = clamp(centerY - Math.floor(rows / 2), 0, Math.max(0, height - rows));
  const canvas = document.createElement('canvas');
  canvas.width = boundedSize;
  canvas.height = boundedSize;
  const ctx = canvas.getContext('2d');
  const cellSize = boundedSize / Math.max(columns, rows);
  ctx.fillStyle = '#081218';
  ctx.fillRect(0, 0, boundedSize, boundedSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(11, Math.floor(cellSize * 0.34))}px Outfit, sans-serif`;

  for (let localY = 0; localY < rows; localY += 1) {
    for (let localX = 0; localX < columns; localX += 1) {
      const sourceX = startX + localX;
      const sourceY = startY + localY;
      const color = cells[(sourceY * width) + sourceX];
      const x = localX * cellSize;
      const y = localY * cellSize;
      ctx.fillStyle = '#172735';
      ctx.fillRect(x, y, Math.ceil(cellSize), Math.ceil(cellSize));
      ctx.strokeStyle = '#0b131a';
      ctx.lineWidth = Math.max(1, cellSize / 28);
      ctx.strokeRect(x, y, cellSize, cellSize);
      ctx.fillStyle = '#8d9fa5';
      ctx.fillText(String(Number(color) + 1), x + cellSize / 2, y + cellSize / 2);
      // A restrained color cue ties the number to the exact generated
      // palette without turning the unfilled preview into a completed image.
      ctx.fillStyle = palette[color] || '#24465a';
      ctx.fillRect(x + 2, y + cellSize - Math.max(3, cellSize * 0.09) - 2, Math.max(3, cellSize * 0.09), Math.max(3, cellSize * 0.09));
    }
  }
  return canvas.toDataURL('image/png');
}
