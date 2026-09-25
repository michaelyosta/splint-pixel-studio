export function connectedRegionStats(cells, width, height) {
  if (!(cells instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || cells.length !== width * height) {
    throw new TypeError('Connected-region analysis requires a Uint8Array matching positive grid dimensions');
  }
  const labels = new Int32Array(cells.length);
  const parent = new Int32Array(cells.length + 1);
  let nextLabel = 0;
  const find = (value) => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  for (let y = 0, index = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, index += 1) {
      const color = cells[index];
      const left = x > 0 && cells[index - 1] === color ? labels[index - 1] : 0;
      const up = y > 0 && cells[index - width] === color ? labels[index - width] : 0;
      if (!left && !up) {
        nextLabel += 1;
        parent[nextLabel] = nextLabel;
        labels[index] = nextLabel;
      } else if (left && up) {
        const leftRoot = find(left);
        const upRoot = find(up);
        if (leftRoot !== upRoot) parent[upRoot] = leftRoot;
        labels[index] = leftRoot;
      } else {
        labels[index] = left || up;
      }
    }
  }

  const sizes = new Uint32Array(nextLabel + 1);
  for (let index = 0; index < labels.length; index += 1) sizes[find(labels[index])] += 1;
  const areas = [];
  let singletons = 0;
  let tinyRegions = 0;
  let smallRegionCellCount = 0;
  let tinyRegionCellCount = 0;
  for (let label = 1; label <= nextLabel; label += 1) {
    const size = sizes[label];
    if (!size) continue;
    areas.push(size);
    if (size === 1) singletons += 1;
    if (size <= 2) smallRegionCellCount += size;
    if (size <= 4) {
      tinyRegions += 1;
      tinyRegionCellCount += size;
    }
  }
  areas.sort((a, b) => a - b);
  const percentile = (p) => areas.length ? areas[Math.min(areas.length - 1, Math.floor((areas.length - 1) * p))] : 0;
  return {
    regions4: areas.length,
    regionDensityPer10k: Number((areas.length * 10_000 / cells.length).toFixed(2)),
    singletonCount: singletons,
    singletonAreaRatio: Number((singletons / cells.length).toFixed(5)),
    tinyRegionCount: tinyRegions,
    smallRegionCellCount,
    smallRegionCellRatio: Number((smallRegionCellCount / cells.length).toFixed(5)),
    tinyRegionCellCount,
    tinyRegionCellRatio: Number((tinyRegionCellCount / cells.length).toFixed(5)),
    medianRegionCells: percentile(0.5),
    p90RegionCells: percentile(0.9),
    maxRegionCells: areas.at(-1) || 0,
  };
}
