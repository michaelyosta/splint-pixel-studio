/** Small deterministic fixtures used to red-team the independent evaluator. */

const BLACK = '#111827';
const WHITE = '#f9fafb';
const RED = '#ef4444';
const BLUE = '#2563eb';
const MID = '#808080';

function rasterFromRows(rows, palette, sourceMeans = null) {
  const height = rows.length;
  const width = rows[0].length;
  const cells = rows.flat();
  return { width, height, palette, cells, ...(sourceMeans ? { sourceMeans } : {}) };
}

function nearestResize(base, scale) {
  const baseHeight = base.length;
  const baseWidth = base[0].length;
  const rows = [];
  for (let y = 0; y < baseHeight * scale; y += 1) {
    const row = [];
    for (let x = 0; x < baseWidth * scale; x += 1) row.push(base[Math.floor(y / scale)][Math.floor(x / scale)]);
    rows.push(row);
  }
  return rows;
}

function sourceHalf(width, height) {
  return Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    return x < width / 2 ? [0, 0, 0] : [255, 255, 255];
  });
}

const uniform = rasterFromRows(Array.from({ length: 8 }, () => Array(8).fill(0)), [MID]);
const checkerboardRows = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (x + y) % 2));
const checkerboard = rasterFromRows(checkerboardRows, [BLACK, WHITE]);
const oversegmentedRows = Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) => {
  if ((x + y) % 5 === 0) return 1;
  if ((x * 3 + y * 7) % 11 === 0) return 2;
  if ((x * 5 + y * 2) % 13 === 0) return 3;
  return 0;
}));
const oversegmented = rasterFromRows(oversegmentedRows, [MID, RED, BLUE, WHITE]);
const intentionalAccentRows = Array.from({ length: 7 }, () => Array(7).fill(0));
intentionalAccentRows[3][3] = 1;
const intentionalAccent = rasterFromRows(intentionalAccentRows, [BLACK, WHITE]);
const blurred = rasterFromRows(Array.from({ length: 8 }, () => Array(8).fill(0)), [MID], sourceHalf(8, 8));
const sameStructureBase = [[0, 0, 1, 1], [0, 0, 1, 1], [2, 2, 3, 3], [2, 2, 3, 3]];
const sameStructure32 = rasterFromRows(nearestResize(sameStructureBase, 8), [BLACK, RED, BLUE, WHITE]);
const sameStructure128 = rasterFromRows(nearestResize(sameStructureBase, 32), [BLACK, RED, BLUE, WHITE]);

export const ADVERSARIAL_FIXTURES = Object.freeze({
  uniform,
  checkerboard,
  oversegmented,
  'intentional-accent': intentionalAccent,
  blurred,
  'same-structure-32': sameStructure32,
  'same-structure-128': sameStructure128,
});

export function getAdversarialFixtures() {
  return Object.entries(ADVERSARIAL_FIXTURES).map(([id, raster]) => ({ id, raster }));
}
