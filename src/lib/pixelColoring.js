export function getProgress(cells, filled) {
  const completed = filled.reduce((total, color, index) => total + (color === cells[index] ? 1 : 0), 0);
  return { completed, total: cells.length, percent: Math.round((completed / cells.length) * 100) };
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

function colorDistance(first, second) {
  const redMean = (first[0] + second[0]) / 2;
  const red = first[0] - second[0];
  const green = first[1] - second[1];
  const blue = first[2] - second[2];
  return (2 + redMean / 256) * red ** 2 + 4 * green ** 2 + (2 + (255 - redMean) / 256) * blue ** 2;
}

function smoothCells(cells, width, height) {
  const result = [...cells];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const neighbours = [cells[index - 1], cells[index + 1], cells[index - width], cells[index + width]];
      const same = neighbours.filter((item) => item === cells[index]).length;
      const counts = neighbours.reduce((map, color) => map.set(color, (map.get(color) || 0) + 1), new Map());
      const dominant = [...counts.entries()].sort((first, second) => second[1] - first[1])[0];
      if (same === 0 && dominant[1] >= 3) result[index] = dominant[0];
    }
  }
  return result;
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
  const weighted = [...buckets.values()].map((bucket) => ({
    color: bucket.color.map((channel) => channel / bucket.count),
    count: bucket.count,
  }));
  const centers = [weighted.sort((first, second) => second.count - first.count)[0].color];
  while (centers.length < requestedColors && centers.length < weighted.length) {
    let candidate = null;
    let candidateScore = -1;
    weighted.forEach((entry) => {
      const distance = Math.min(...centers.map((center) => colorDistance(entry.color, center)));
      const saturation = Math.max(...entry.color) - Math.min(...entry.color);
      const score = distance * Math.sqrt(entry.count) * (1 + saturation / 255);
      if (score > candidateScore) {
        candidate = entry.color;
        candidateScore = score;
      }
    });
    centers.push([...candidate]);
  }
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    weighted.forEach((entry) => {
      let closest = 0;
      let distance = Infinity;
      centers.forEach((center, index) => {
        const nextDistance = colorDistance(entry.color, center);
        if (nextDistance < distance) { closest = index; distance = nextDistance; }
      });
      entry.color.forEach((channel, index) => { sums[closest][index] += channel * entry.count; });
      sums[closest][3] += entry.count;
    });
    centers.forEach((center, index) => {
      if (sums[index][3]) centers[index] = sums[index].slice(0, 3).map((channel) => channel / sums[index][3]);
      else centers[index] = center;
    });
  }
  if (centers.length === 1) centers.push(centers[0].map((channel) => channel > 127 ? 0 : 255));
  return centers
    .map((color) => color.map(Math.round))
    .sort((first, second) => (first[0] * .299 + first[1] * .587 + first[2] * .114) - (second[0] * .299 + second[1] * .587 + second[2] * .114));
}

function renderPreview(width, height, palette, cells) {
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

export async function buildColoringFromImage(file, { width, height, colors, crop }) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (crop) {
    const cropSize = Math.min(bitmap.width, bitmap.height) / crop.scale;
    const cx = bitmap.width / 2 + crop.offsetX;
    const cy = bitmap.height / 2 + crop.offsetY;
    const sx = Math.max(0, Math.min(bitmap.width - cropSize, cx - cropSize / 2));
    const sy = Math.max(0, Math.min(bitmap.height - cropSize, cy - cropSize / 2));
    const sw = Math.min(cropSize, bitmap.width - sx);
    const sh = Math.min(cropSize, bitmap.height - sy);
    context.fillStyle = '#101820';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  } else {
    const sourceRatio = bitmap.width / bitmap.height;
    const targetRatio = width / height;
    let drawWidth = sourceRatio > targetRatio ? width : height * sourceRatio;
    let drawHeight = sourceRatio > targetRatio ? width / sourceRatio : height;
    drawWidth *= .94;
    drawHeight *= .94;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;
    context.fillStyle = '#101820';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
  }
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const sourcePixels = [];
  for (let index = 0; index < pixels.length; index += 4) {
    sourcePixels.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
  }
  const paletteRgb = buildPalette(sourcePixels, colors);
  const cells = sourcePixels.map((rgb) => {
    let closestIndex = 0;
    let closestDistance = Infinity;
    paletteRgb.forEach((color, paletteIndex) => {
      const distance = colorDistance(rgb, color);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = paletteIndex;
      }
    });
    return closestIndex;
  });
  const smoothedCells = smoothCells(cells, width, height);
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
    previewDataUrl: renderPreview(width, height, palette, smoothedCells),
    originalDataUrl,
  };
}
