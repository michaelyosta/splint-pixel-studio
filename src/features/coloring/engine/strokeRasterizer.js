export function rasterizeLine(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let cx = x0;
  let cy = y0;
  while (true) {
    points.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }
  return points;
}

export function rasterizeStroke(prevIndex, currIndex, templateWidth, templateHeight) {
  if (prevIndex == null || currIndex == null) return [];
  const x0 = prevIndex % templateWidth;
  const y0 = Math.floor(prevIndex / templateWidth);
  const x1 = currIndex % templateWidth;
  const y1 = Math.floor(currIndex / templateWidth);
  const line = rasterizeLine(x0, y0, x1, y1);
  const result = [];
  const seen = new Set();
  for (const p of line) {
    if (p.x < 0 || p.x >= templateWidth || p.y < 0 || p.y >= templateHeight) continue;
    const idx = p.y * templateWidth + p.x;
    if (seen.has(idx)) continue;
    seen.add(idx);
    result.push(idx);
  }
  return result;
}
