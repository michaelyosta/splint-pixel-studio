import { buildColoringFromImage } from '../lib/pixelColoring.js';
import { assessQuality } from '../lib/creatorQuality.js';
import { createTiledTemplate } from '../lib/tiledTemplate.js';

let activeGeneration = 0;

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    activeGeneration = Math.max(activeGeneration, Number(message.generation) || 0);
    return;
  }
  const { id, generation, file, options = {} } = message;
  const requestGeneration = Number(generation) || 0;
  activeGeneration = Math.max(activeGeneration, requestGeneration);
  try {
    const data = await buildColoringFromImage(file, {
      ...options,
      // Worker conversions always yield so cancellation and progress remain
      // observable on large creation requests.
      yieldEvery: Number.isInteger(options.yieldEvery) && options.yieldEvery > 0 ? options.yieldEvery : 24,
      shouldCancel: () => requestGeneration !== activeGeneration,
      onProgress: (progress) => {
        if (requestGeneration === activeGeneration) self.postMessage({ id, generation: requestGeneration, type: 'progress', progress });
      },
    });
    if (requestGeneration !== activeGeneration) return;
    if (data.width > 160 || data.height > 160) {
      // Keep the 1.44M-cell -> tile conversion off the UI thread as well.
      // The main thread only needs tile records for the upload payload.
      const tiled = createTiledTemplate(data);
      if (requestGeneration !== activeGeneration) return;
      const quality = assessQuality(data.width, data.height, data.palette, data.cells);
      const { cells: _cells, originalDataUrl: _originalDataUrl, ...metadata } = data;
      self.postMessage({
        id,
        generation: requestGeneration,
        type: 'result',
        data: { ...metadata, tiles: tiled.tiles, tileSize: 32, tileCount: tiled.tileCount, quality },
      });
      return;
    }
    self.postMessage({ id, generation: requestGeneration, type: 'result', data });
  } catch (error) {
    if (requestGeneration !== activeGeneration || error?.name === 'AbortError') return;
    self.postMessage({ id, generation: requestGeneration, type: 'error', error: error?.message || 'Creator worker failed' });
  }
};
