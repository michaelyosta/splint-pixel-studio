import { buildColoringFromImage } from '../lib/pixelColoring.js';
import { assessQuality } from '../lib/creatorQuality.js';
import { createTiledTemplate } from '../lib/tiledTemplate.js';

let activeGeneration = 0;

self.onmessage = async (event) => {
  const { id, generation, file, options } = event.data || {};
  activeGeneration = Math.max(activeGeneration, Number(generation) || 0);
  try {
    const data = await buildColoringFromImage(file, options);
    if (generation !== activeGeneration) return;
    if (data.width > 160 || data.height > 160) {
      // Keep the 1.44M-cell -> tile conversion off the UI thread as well.
      // The main thread only needs tile records for the upload payload.
      const tiled = createTiledTemplate(data);
      const quality = assessQuality(data.width, data.height, data.palette, data.cells);
      const { cells: _cells, originalDataUrl: _originalDataUrl, ...metadata } = data;
      self.postMessage({
        id,
        generation,
        type: 'result',
        data: { ...metadata, tiles: tiled.tiles, tileSize: 32, tileCount: tiled.tileCount, quality },
      });
      return;
    }
    self.postMessage({ id, generation, type: 'result', data });
  } catch (error) {
    if (generation !== activeGeneration) return;
    self.postMessage({ id, generation, type: 'error', error: error?.message || 'Creator worker failed' });
  }
};
