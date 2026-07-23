export function extractCrop(image, crop) {
  const { scale, offsetX, offsetY, size } = crop;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = image.naturalWidth;
  srcCanvas.height = image.naturalHeight;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(image, 0, 0);

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
  ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, size, size);
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
