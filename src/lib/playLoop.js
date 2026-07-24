import { floodFillRegion } from './floodFill.js';

export function findForgivingCell(width, height, filled, gridX, gridY) {
  const exactX = Math.min(width - 1, Math.max(0, Math.floor(gridX)));
  const exactY = Math.min(height - 1, Math.max(0, Math.floor(gridY)));
  const exact = exactY * width + exactX;
  if (filled[exact] === -1) return exact;

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, exactY - 1); y <= Math.min(height - 1, exactY + 1); y += 1) {
    for (let x = Math.max(0, exactX - 1); x <= Math.min(width - 1, exactX + 1); x += 1) {
      const index = y * width + x;
      if (filled[index] !== -1) continue;
      const distance = Math.hypot(gridX - (x + 0.5), gridY - (y + 0.5));
      if (distance < nearestDistance && distance <= 1.15) {
        nearest = index;
        nearestDistance = distance;
      }
    }
  }
  return nearest;
}

export function getRevealAction(template, filled, index, fillArea = false) {
  if (index == null || filled[index] !== -1) return null;
  const color = template.cells[index];
  return {
    color,
    indices: fillArea ? floodFillRegion(template, filled, index) : [index],
  };
}

export function getContextGoal(zones, zoneIndices, template, filled) {
  const zone = zones.find((item) => item.percent < 100) || zones.at(-1);
  if (!zone) {
    const remaining = filled.reduce((count, color) => count + (color === -1 ? 1 : 0), 0);
    return remaining ? `Осталось ${remaining} фрагментов` : 'Картина раскрыта';
  }

  const indices = zoneIndices[zone.id] || [];
  const remaining = indices.length
    ? indices.reduce((count, index) => count + (filled[index] !== template.cells[index] ? 1 : 0), 0)
    : Number.isFinite(zone.total) && Number.isFinite(zone.done) ? zone.total - zone.done : null;
  const title = zone.title || 'Фрагмент';
  if (remaining == null) return `${title} · продолжайте раскрывать`;
  if (remaining <= 0) return `${title} раскрыт`;
  if (remaining === 1) return `Ещё один штрих — и «${title}» раскроется`;
  if (zone.percent >= 80) return `«${title}» почти готов`;
  return `${title} · осталось ${remaining} фрагментов`;
}
