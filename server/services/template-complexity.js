export const PUBLIC_COMPLEXITY_BUDGET = Object.freeze({
  totalCells: 25_600,
  paletteSize: 24,
  connectedComponents: 2_500,
  maxComponentsPerColor: 1_500,
  smallRegionCount: 1_500,
  // A four-neighbour two-colour checkerboard reaches 0.5 because half of
  // all horizontal/vertical edges cross colours. Keep the public threshold
  // below that adversarial pattern while allowing ordinary illustrations.
  checkerboardScore: 0.45,
  workingWindows: 2_000,
  estimatedMergeCost: 5_000_000,
});

function neighbors(index, width, height) {
  const x = index % width;
  const y = Math.floor(index / width);
  return [
    y > 0 ? index - width : -1,
    y + 1 < height ? index + width : -1,
    x > 0 ? index - 1 : -1,
    x + 1 < width ? index + 1 : -1,
  ].filter((value) => value >= 0);
}

export function measureTemplateComplexity({ width, height, palette, cells }) {
  const totalCells = width * height;
  const visited = new Uint8Array(totalCells);
  const componentsByColor = new Map();
  const sizes = [];
  for (let start = 0; start < totalCells; start += 1) {
    if (visited[start]) continue;
    visited[start] = 1;
    const color = cells[start];
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const index = stack.pop();
      size += 1;
      for (const next of neighbors(index, width, height)) {
        if (!visited[next] && cells[next] === color) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
    componentsByColor.set(color, (componentsByColor.get(color) || 0) + 1);
  }

  let differentEdges = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width) {
        edgeCount += 1;
        if (cells[index] !== cells[index + 1]) differentEdges += 1;
      }
      if (y + 1 < height) {
        edgeCount += 1;
        if (cells[index] !== cells[index + width]) differentEdges += 1;
      }
    }
  }
  const smallRegionCount = sizes.filter((size) => size <= 2).length;
  const connectedComponentCount = sizes.length;
  const maxComponentsPerColor = Math.max(0, ...componentsByColor.values());
  const checkerboardScore = edgeCount ? differentEdges / edgeCount : 0;
  const estimatedWorkingWindows = Math.ceil(connectedComponentCount / 4) + Math.ceil(totalCells / 4096);
  const estimatedMergeCost = connectedComponentCount * Math.max(1, Math.ceil(Math.log2(connectedComponentCount + 1))) + smallRegionCount * 8;

  return {
    totalCells,
    paletteSize: palette.length,
    connectedComponents: connectedComponentCount,
    maxComponentsPerColor,
    smallRegionCount,
    checkerboardScore,
    workingWindows: estimatedWorkingWindows,
    estimatedMergeCost,
    largestRegion: Math.max(0, ...sizes),
  };
}

export function validatePublicTemplateComplexity(input, budget = PUBLIC_COMPLEXITY_BUDGET) {
  const metrics = measureTemplateComplexity(input);
  const failures = Object.entries({
    totalCells: metrics.totalCells,
    paletteSize: metrics.paletteSize,
    connectedComponents: metrics.connectedComponents,
    maxComponentsPerColor: metrics.maxComponentsPerColor,
    smallRegionCount: metrics.smallRegionCount,
    checkerboardScore: metrics.checkerboardScore,
    workingWindows: metrics.workingWindows,
    estimatedMergeCost: metrics.estimatedMergeCost,
  }).filter(([key, value]) => value > budget[key]).map(([key, value]) => ({ key, value, budget: budget[key] }));
  return { allowed: failures.length === 0, metrics, failures, budget };
}
