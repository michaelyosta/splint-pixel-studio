import { buildColoringFromImage } from '../lib/pixelColoring.js';

let activeGeneration = 0;

self.onmessage = async (event) => {
  const { id, generation, file, options } = event.data || {};
  activeGeneration = Math.max(activeGeneration, Number(generation) || 0);
  try {
    const data = await buildColoringFromImage(file, options);
    if (generation !== activeGeneration) return;
    self.postMessage({ id, generation, type: 'result', data });
  } catch (error) {
    if (generation !== activeGeneration) return;
    self.postMessage({ id, generation, type: 'error', error: error?.message || 'Creator worker failed' });
  }
};

