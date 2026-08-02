import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicTemplateComplexity } from '../services/template-complexity.js';

test('checkerboard and fragmented fixtures exceed a constrained public budget', () => {
  const cells = Array.from({ length: 16 * 16 }, (_, index) => (index + Math.floor(index / 16)) % 2);
  const result = validatePublicTemplateComplexity({ width: 16, height: 16, palette: ['#000000', '#ffffff'], cells }, { totalCells: 256, paletteSize: 2, connectedComponents: 4, maxComponentsPerColor: 4, smallRegionCount: 4, checkerboardScore: 0.5, workingWindows: 64, estimatedMergeCost: 10000 });
  assert.equal(result.allowed, false);
  assert.ok(result.failures.some((failure) => failure.key === 'checkerboardScore'));
});

test('large uniform templates remain within the complexity budget', () => {
  const result = validatePublicTemplateComplexity({ width: 8, height: 8, palette: ['#000000'], cells: Array(64).fill(0) });
  assert.equal(result.allowed, true);
  assert.equal(result.metrics.connectedComponents, 1);
});
