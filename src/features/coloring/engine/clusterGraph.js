export function getClusterBounds(cluster, width) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const idx of cluster) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX, minY, maxX, maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function findClusters(template, filled, color) {
  const { width, height, cells } = template;
  const visited = new Uint8Array(cells.length);
  const clusters = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== color) { visited[i] = 1; continue; }
    if (filled[i] !== -1) { visited[i] = 1; continue; }
    if (visited[i]) continue;
    const cluster = [];
    const queue = [i];
    visited[i] = 1;
    while (queue.length) {
      const idx = queue.shift();
      cluster.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          if (nx === x && ny === y) continue;
          const ni = ny * width + nx;
          if (visited[ni]) continue;
          if (cells[ni] !== color || filled[ni] !== -1) continue;
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

const CLUSTER_MERGE_DISTANCE = 1;

export function mergeClusters(clusters, width) {
  if (clusters.length <= 1) return clusters;
  const items = clusters.map(c => ({ cluster: c, bounds: getClusterBounds(c, width) }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < items.length && !merged; i++) {
      for (let j = i + 1; j < items.length && !merged; j++) {
        const a = items[i].bounds;
        const b = items[j].bounds;
        const gapX = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX) - 1;
        const gapY = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY) - 1;
        if (gapX <= CLUSTER_MERGE_DISTANCE && gapY <= CLUSTER_MERGE_DISTANCE) {
          items[i] = {
            cluster: [...items[i].cluster, ...items[j].cluster],
            bounds: {
              minX: Math.min(a.minX, b.minX),
              minY: Math.min(a.minY, b.minY),
              maxX: Math.max(a.maxX, b.maxX),
              maxY: Math.max(a.maxY, b.maxY),
              width: Math.max(a.maxX, b.maxX) - Math.min(a.minX, b.minX) + 1,
              height: Math.max(a.maxY, b.maxY) - Math.min(a.minY, b.minY) + 1,
            },
          };
          items.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return items.map(item => item.cluster);
}
