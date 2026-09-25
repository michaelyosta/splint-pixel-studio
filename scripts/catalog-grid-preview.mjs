import { encodeCatalogGridPng } from './catalog-grid-png.mjs';

export const CATALOG_GRID_PREVIEW_BUDGET_BYTES = 16 * 1024;

export function buildBudgetedCatalogGridPreview({
  cells,
  width,
  height,
  palette,
  budgetBytes = CATALOG_GRID_PREVIEW_BUDGET_BYTES,
  preferredMaxSide = 1200,
  minimumMaxSide = 128,
}) {
  if (!Number.isInteger(budgetBytes) || budgetBytes < 256
    || !Number.isInteger(preferredMaxSide) || preferredMaxSide < 1
    || !Number.isInteger(minimumMaxSide) || minimumMaxSide < 1
    || minimumMaxSide > preferredMaxSide) {
    throw new RangeError('Preview budget and max-side bounds must be positive integers');
  }

  let maxSide = preferredMaxSide;
  let result = encodeCatalogGridPng({ cells, width, height, palette, maxSide });
  while (result.bytes.length > budgetBytes && maxSide > minimumMaxSide) {
    maxSide = Math.max(minimumMaxSide, Math.floor(maxSide * 0.86));
    result = encodeCatalogGridPng({ cells, width, height, palette, maxSide });
  }
  if (result.bytes.length > budgetBytes) {
    throw new RangeError(`Catalog pixel preview cannot meet the ${budgetBytes}-byte budget at ${minimumMaxSide}px`);
  }
  return { ...result, maxSide, byteLength: result.bytes.length };
}
