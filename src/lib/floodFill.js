export function floodFillRegion(template, filled, startIndex) {
  if (filled[startIndex] !== -1) return [];
  const { width, height, cells } = template;
  const target = cells[startIndex];
  const stack = [startIndex];
  const visited = new Set();
  const out = [];
  while (stack.length) {
    const index = stack.pop();
    if (visited.has(index)) continue;
    visited.add(index);
    if (cells[index] !== target || filled[index] !== -1) continue;
    out.push(index);
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - width);
    if (y < height - 1) stack.push(index + width);
  }
  return out;
}
