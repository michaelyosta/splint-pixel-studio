/**
 * Independent, implementation-agnostic pixelization evaluation metrics.
 *
 * The evaluator deliberately consumes a raster contract instead of importing
 * the production converter. This keeps baseline/candidate comparisons honest:
 * an adapter may change the algorithm, but it cannot change the definitions
 * used to judge the resulting raster.
 */

const DEFAULT_TINY_AREA = 2;
const DEFAULT_SMALL_AREA = 8;
const DEFAULT_HIGH_CONTRAST_DE = 28;
const DEFAULT_LOW_CONTRAST_DE = 12;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function minOf(values) {
  if (!values.length) return null;
  let result = Infinity;
  for (const value of values) result = Math.min(result, value);
  return result;
}

function maxOf(values) {
  if (!values.length) return null;
  let result = -Infinity;
  for (const value of values) result = Math.max(result, value);
  return result;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = Float64Array.from(values);
  sorted.sort();
  const index = clamp((sorted.length - 1) * quantile, 0, sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (index - lower));
}

function rgbFromColor(color) {
  if (Array.isArray(color)) {
    return [0, 1, 2].map((index) => clamp(Number(color[index]) || 0, 0, 255));
  }
  if (Number.isInteger(color) && color >= 0 && color <= 0xffffff) {
    return [(color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff];
  }
  const value = String(color || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return [0, 1, 2].map((index) => parseInt(`${value[index]}${value[index]}`, 16));
  }
  if (/^[0-9a-f]{6}$/i.test(value)) {
    return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  }
  const match = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (match) return match.slice(1, 4).map((channel) => clamp(Number(channel), 0, 255));
  return [0, 0, 0];
}

export function rgbToLab(rgb) {
  const linear = rgbFromColor(rgb).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const pivot = (value) => value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116);
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return [(116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

/** CIE76 distance between two RGB colors (hex strings or RGB triplets). */
export function deltaE76(first, second) {
  return labDistance(rgbToLab(first), rgbToLab(second));
}

function neighbouringIndices(index, width, height, connectivity = 4) {
  const x = index % width;
  const y = Math.floor(index / width);
  const neighbours = [];
  if (x > 0) neighbours.push(index - 1);
  if (x < width - 1) neighbours.push(index + 1);
  if (y > 0) neighbours.push(index - width);
  if (y < height - 1) neighbours.push(index + width);
  if (connectivity === 8) {
    if (x > 0 && y > 0) neighbours.push(index - width - 1);
    if (x < width - 1 && y > 0) neighbours.push(index - width + 1);
    if (x > 0 && y < height - 1) neighbours.push(index + width - 1);
    if (x < width - 1 && y < height - 1) neighbours.push(index + width + 1);
  }
  return neighbours;
}

function validateRaster(raster) {
  if (!raster || !Number.isInteger(raster.width) || !Number.isInteger(raster.height)) {
    throw new TypeError('Pixelization evaluation requires integer width and height');
  }
  if (raster.width < 1 || raster.height < 1) throw new RangeError('Pixelization raster dimensions must be positive');
  if (!Array.isArray(raster.cells) || raster.cells.length !== raster.width * raster.height) {
    throw new RangeError(`Pixelization raster cells must contain exactly ${raster.width * raster.height} entries`);
  }
  if (!Array.isArray(raster.palette) || raster.palette.length < 1) {
    throw new RangeError('Pixelization raster requires a non-empty palette');
  }
  raster.cells.forEach((cell, index) => {
    if (!Number.isInteger(cell) || cell < 0 || cell >= raster.palette.length) {
      throw new RangeError(`Cell ${index} references palette index ${cell}`);
    }
  });
}

function collectComponents(cells, width, height, connectivity) {
  const visited = new Uint8Array(cells.length);
  const components = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (visited[start]) continue;
    const color = cells[start];
    const stack = [start];
    const indices = [];
    visited[start] = 1;
    while (stack.length) {
      const index = stack.pop();
      indices.push(index);
      for (const neighbour of neighbouringIndices(index, width, height, connectivity)) {
        if (!visited[neighbour] && cells[neighbour] === color) {
          visited[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }
    components.push({ color, indices, size: indices.length });
  }
  return components;
}

function histogram(values, bins) {
  const result = Object.fromEntries(bins.map((bin) => [bin.id, 0]));
  for (const value of values) {
    const bin = bins.find((candidate) => value >= candidate.min && value <= candidate.max);
    if (bin) result[bin.id] += 1;
  }
  return result;
}

function density(count, area) {
  return area ? (count / area) * 10000 : 0;
}

function regionSummary(components, area) {
  const sizes = components.map((component) => component.size);
  const areas = sizes.map((size) => size / area);
  const bins = [
    { id: '1', min: 1, max: 1 },
    { id: '2-4', min: 2, max: 4 },
    { id: '5-16', min: 5, max: 16 },
    { id: '17-64', min: 17, max: 64 },
    { id: '65-256', min: 65, max: 256 },
    { id: '257+', min: 257, max: Infinity },
  ];
  const areaBins = [
    { id: '0-0.1%', min: 0, max: 0.001 },
    { id: '0.1-0.5%', min: 0.0010000001, max: 0.005 },
    { id: '0.5-2%', min: 0.0050000001, max: 0.02 },
    { id: '2-10%', min: 0.0200000001, max: 0.1 },
    { id: '10%+', min: 0.1000000001, max: Infinity },
  ];
  const singletonCount = sizes.filter((size) => size === 1).length;
  const tinyCount = sizes.filter((size) => size <= DEFAULT_TINY_AREA).length;
  const smallCount = sizes.filter((size) => size <= DEFAULT_SMALL_AREA).length;
  return {
    count: components.length,
    densityPer10kCells: density(components.length, area),
    singletonCount,
    tinyCount,
    smallCount,
    singletonRegionRatio: components.length ? singletonCount / components.length : 0,
    tinyRegionRatio: components.length ? tinyCount / components.length : 0,
    smallRegionRatio: components.length ? smallCount / components.length : 0,
    singletonAreaRatio: sizes.filter((size) => size === 1).reduce((sum, size) => sum + size, 0) / area,
    tinyAreaRatio: sizes.filter((size) => size <= DEFAULT_TINY_AREA).reduce((sum, size) => sum + size, 0) / area,
    smallAreaRatio: sizes.filter((size) => size <= DEFAULT_SMALL_AREA).reduce((sum, size) => sum + size, 0) / area,
    size: {
      min: minOf(sizes) || 0,
      p10: percentile(sizes, 0.1) || 0,
      median: percentile(sizes, 0.5) || 0,
      p90: percentile(sizes, 0.9) || 0,
      max: maxOf(sizes) || 0,
      mean: mean(sizes),
    },
    sizeHistogram: histogram(sizes, bins),
    areaHistogram: histogram(areas, areaBins),
  };
}

function boundaryStats(cells, width, height, paletteLabs, components4) {
  let transitions = 0;
  let possibleEdges = 0;
  let sameEdges = 0;
  const contrastSamples = [];
  const boundaryPairs = new Map();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x < width - 1) {
        possibleEdges += 1;
        const right = index + 1;
        if (cells[index] !== cells[right]) {
          transitions += 1;
          const de = labDistance(paletteLabs[cells[index]], paletteLabs[cells[right]]);
          contrastSamples.push(de);
          const key = cells[index] < cells[right] ? `${cells[index]}-${cells[right]}` : `${cells[right]}-${cells[index]}`;
          boundaryPairs.set(key, (boundaryPairs.get(key) || 0) + 1);
        } else sameEdges += 1;
      }
      if (y < height - 1) {
        possibleEdges += 1;
        const down = index + width;
        if (cells[index] !== cells[down]) {
          transitions += 1;
          const de = labDistance(paletteLabs[cells[index]], paletteLabs[cells[down]]);
          contrastSamples.push(de);
          const key = cells[index] < cells[down] ? `${cells[index]}-${cells[down]}` : `${cells[down]}-${cells[index]}`;
          boundaryPairs.set(key, (boundaryPairs.get(key) || 0) + 1);
        } else sameEdges += 1;
      }
    }
  }
  const componentByCell = new Int32Array(cells.length);
  componentByCell.fill(-1);
  components4.forEach((component, componentIndex) => {
    component.indices.forEach((index) => { componentByCell[index] = componentIndex; });
  });
  const compactness = components4.map((component) => {
    let perimeter = 0;
    for (const index of component.indices) {
      for (const neighbour of neighbouringIndices(index, width, height, 4)) {
        if (cells[neighbour] !== component.color) perimeter += 1;
      }
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0) perimeter += 1;
      if (x === width - 1) perimeter += 1;
      if (y === 0) perimeter += 1;
      if (y === height - 1) perimeter += 1;
    }
    return {
      perimeter,
      compactness: perimeter ? (4 * Math.PI * component.size) / (perimeter * perimeter) : 0,
      perimeterToArea: component.size ? perimeter / component.size : 0,
    };
  });
  const componentTransitions = components4.map((component, componentIndex) => {
    let boundary = 0;
    let transitionsForComponent = 0;
    for (const index of component.indices) {
      for (const neighbour of neighbouringIndices(index, width, height, 4)) {
        if (componentByCell[neighbour] !== componentIndex) {
          boundary += 1;
          transitionsForComponent += 1;
        }
      }
    }
    return { boundary, transitions: transitionsForComponent };
  });
  const transitionRatio = possibleEdges ? transitions / possibleEdges : 0;
  return {
    possibleEdges,
    transitions,
    sameEdges,
    transitionRatio,
    boundaryContrast: {
      count: contrastSamples.length,
      meanDeltaE: mean(contrastSamples),
      p10DeltaE: percentile(contrastSamples, 0.1),
      medianDeltaE: percentile(contrastSamples, 0.5),
      p90DeltaE: percentile(contrastSamples, 0.9),
      highContrastBoundaryRatio: contrastSamples.length
        ? contrastSamples.filter((value) => value >= DEFAULT_HIGH_CONTRAST_DE).length / contrastSamples.length
        : 0,
    },
    compactness: {
      mean: mean(compactness.map((item) => item.compactness)),
      p10: percentile(compactness.map((item) => item.compactness), 0.1),
      median: percentile(compactness.map((item) => item.compactness), 0.5),
      p90: percentile(compactness.map((item) => item.compactness), 0.9),
      meanPerimeterToArea: mean(compactness.map((item) => item.perimeterToArea)),
    },
    componentBoundary: {
      meanTransitions: mean(componentTransitions.map((item) => item.transitions)),
      p90Transitions: percentile(componentTransitions.map((item) => item.transitions), 0.9),
    },
    pairHistogram: Object.fromEntries([...boundaryPairs.entries()].sort((first, second) => second[1] - first[1])),
  };
}

function colorShares(cells, paletteLength) {
  const counts = new Array(paletteLength).fill(0);
  for (const cell of cells) counts[cell] += 1;
  const total = cells.length;
  const shares = counts.map((count) => count / total);
  const used = counts.filter((count) => count > 0);
  const entropy = shares.filter((share) => share > 0).reduce((sum, share) => sum - (share * Math.log2(share)), 0);
  return { counts, shares, usedCount: used.length, entropy, maxShare: maxOf(shares) || 0, minUsedShare: minOf(shares.filter((share) => share > 0)) || 0 };
}

function paletteStats(palette, cells) {
  const colors = palette.map(rgbFromColor);
  const labs = colors.map(rgbToLab);
  const shares = colorShares(cells, palette.length);
  const pairDistances = [];
  for (let first = 0; first < labs.length; first += 1) {
    for (let second = first + 1; second < labs.length; second += 1) pairDistances.push(labDistance(labs[first], labs[second]));
  }
  return {
    declaredCount: palette.length,
    usedCount: shares.usedCount,
    unusedCount: palette.length - shares.usedCount,
    usageCounts: shares.counts,
    usageShares: shares.shares,
    entropyBits: shares.entropy,
    maxAreaShare: shares.maxShare,
    minUsedAreaShare: shares.minUsedShare,
    pairwiseDeltaE: {
      mean: mean(pairDistances),
      min: minOf(pairDistances),
      median: percentile(pairDistances, 0.5),
      p90: percentile(pairDistances, 0.9),
      max: maxOf(pairDistances),
    },
    labs,
  };
}

function contrastForRegion(component, cells, width, height, paletteLabs) {
  const boundaryDistances = [];
  const seen = new Set();
  for (const index of component.indices) {
    for (const neighbour of neighbouringIndices(index, width, height, 4)) {
      if (cells[neighbour] === component.color) continue;
      const key = index < neighbour ? `${index}:${neighbour}` : `${neighbour}:${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      boundaryDistances.push(labDistance(paletteLabs[component.color], paletteLabs[cells[neighbour]]));
    }
  }
  return mean(boundaryDistances);
}

function tinyContrastSummary(components4, cells, width, height, paletteLabs) {
  const tiny = components4.filter((component) => component.size <= DEFAULT_TINY_AREA && component.indices.length < width * height);
  const contrasts = tiny.map((component) => contrastForRegion(component, cells, width, height, paletteLabs));
  return {
    tinyRegionCount: tiny.length,
    tinyArea: tiny.reduce((sum, component) => sum + component.size, 0),
    highContrastTinyCount: contrasts.filter((value) => value >= DEFAULT_HIGH_CONTRAST_DE).length,
    lowContrastTinyCount: contrasts.filter((value) => value < DEFAULT_LOW_CONTRAST_DE).length,
    mediumContrastTinyCount: contrasts.filter((value) => value >= DEFAULT_LOW_CONTRAST_DE && value < DEFAULT_HIGH_CONTRAST_DE).length,
    meanBoundaryDeltaE: mean(contrasts),
    highContrastAreaRatio: tiny.filter((component, index) => contrasts[index] >= DEFAULT_HIGH_CONTRAST_DE)
      .reduce((sum, component) => sum + component.size, 0) / (width * height),
    lowContrastAreaRatio: tiny.filter((component, index) => contrasts[index] < DEFAULT_LOW_CONTRAST_DE)
      .reduce((sum, component) => sum + component.size, 0) / (width * height),
    thresholds: { lowDeltaE: DEFAULT_LOW_CONTRAST_DE, highDeltaE: DEFAULT_HIGH_CONTRAST_DE },
  };
}

function sourceCellMeans(sourceMeans, width, height) {
  if (!sourceMeans) return null;
  if (!Array.isArray(sourceMeans) || sourceMeans.length !== width * height) return null;
  return sourceMeans;
}

function sourceComparison(sourceMeans, cells, palette, width, height) {
  const means = sourceCellMeans(sourceMeans, width, height);
  if (!means) {
    return {
      available: false,
      meanDeltaE: null,
      medianDeltaE: null,
      p90DeltaE: null,
      maxDeltaE: null,
      sourceEdgeCount: null,
      outputBoundaryCount: null,
      edgePrecision: null,
      edgeRecall: null,
      edgeF1: null,
      note: 'sourceMeans were not supplied or had the wrong length',
    };
  }
  const paletteLabs = palette.map(rgbToLab);
  const sourceLabs = new Float32Array(means.length * 3);
  const deltas = new Float32Array(means.length);
  for (let index = 0; index < means.length; index += 1) {
    const lab = rgbToLab(means[index]);
    const offset = index * 3;
    sourceLabs[offset] = lab[0];
    sourceLabs[offset + 1] = lab[1];
    sourceLabs[offset + 2] = lab[2];
    deltas[index] = Math.hypot(
      lab[0] - paletteLabs[cells[index]][0],
      lab[1] - paletteLabs[cells[index]][1],
      lab[2] - paletteLabs[cells[index]][2],
    );
  }
  const sourceDistance = (first, second) => {
    const firstOffset = first * 3;
    const secondOffset = second * 3;
    return Math.hypot(
      sourceLabs[firstOffset] - sourceLabs[secondOffset],
      sourceLabs[firstOffset + 1] - sourceLabs[secondOffset + 1],
      sourceLabs[firstOffset + 2] - sourceLabs[secondOffset + 2],
    );
  };
  const edgeThreshold = 18;
  let truePositive = 0;
  let outputPositive = 0;
  let sourcePositive = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x < width - 1) {
        const neighbour = index + 1;
        const sourceDelta = sourceDistance(index, neighbour);
        const outputEdge = cells[index] !== cells[neighbour];
        const sourceEdge = sourceDelta >= edgeThreshold;
        if (sourceEdge) sourcePositive += 1;
        if (outputEdge) outputPositive += 1;
        if (sourceEdge && outputEdge) truePositive += 1;
      }
      if (y < height - 1) {
        const neighbour = index + width;
        const sourceDelta = sourceDistance(index, neighbour);
        const outputEdge = cells[index] !== cells[neighbour];
        const sourceEdge = sourceDelta >= edgeThreshold;
        if (sourceEdge) sourcePositive += 1;
        if (outputEdge) outputPositive += 1;
        if (sourceEdge && outputEdge) truePositive += 1;
      }
    }
  }
  const precision = outputPositive ? truePositive / outputPositive : (sourcePositive ? 0 : 1);
  const recall = sourcePositive ? truePositive / sourcePositive : (outputPositive ? 0 : 1);
  return {
    available: true,
    meanDeltaE: mean(deltas),
    medianDeltaE: percentile(deltas, 0.5),
    p90DeltaE: percentile(deltas, 0.9),
    maxDeltaE: maxOf(deltas),
    sourceEdgeCount: sourcePositive,
    outputBoundaryCount: outputPositive,
    edgePrecision: precision,
    edgeRecall: recall,
    edgeF1: (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0,
    edgeThresholdDeltaE: edgeThreshold,
  };
}

function effortLowerBounds(cells, components4, components8, width, height, boundaries) {
  const colorCounts = new Map();
  for (const cell of cells) colorCounts.set(cell, (colorCounts.get(cell) || 0) + 1);
  const colorSwitches = [...colorCounts.keys()].length;
  const regionTaps = components4.length;
  const tinyRegionTaps = components4.filter((component) => component.size <= DEFAULT_TINY_AREA).length;
  const smallRegionTaps = components4.filter((component) => component.size <= DEFAULT_SMALL_AREA).length;
  const boundaryEdges = boundaries.transitions;
  const diagonalMergeLowerBound = Math.max(0, components4.length - components8.length);
  return {
    idealRegionTaps: regionTaps,
    connectivity8RegionTaps: components8.length,
    tinyRegionTaps,
    smallRegionTaps,
    colorSwitchLowerBound: Math.max(0, colorSwitches - 1),
    boundaryTransitionLowerBound: boundaryEdges,
    diagonalMergeLowerBound,
    classicLowerBound: regionTaps + Math.max(0, colorSwitches - 1),
    conservativeManualTapLowerBound: Math.max(regionTaps, colorSwitches) + tinyRegionTaps,
    note: 'These are structural lower bounds, not a prediction of a particular Smart Director or input path.',
  };
}

function relativeLuminance(rgb) {
  return rgbFromColor(rgb).map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const brightest = Math.max(a, b);
  const darkest = Math.min(a, b);
  return (brightest + 0.05) / (darkest + 0.05);
}

function numberReadability(cells, palette, width, height, options = {}) {
  const previewWidth = Number.isFinite(options.previewWidth) ? options.previewWidth : 320;
  const previewHeight = Number.isFinite(options.previewHeight) ? options.previewHeight : previewWidth;
  const cellWidth = previewWidth / width;
  const cellHeight = previewHeight / height;
  const cellPixels = Math.min(cellWidth, cellHeight);
  const paletteRgb = palette.map(rgbFromColor);
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  const ratiosAgainstWhite = paletteRgb.map((color) => contrastRatio(color, white));
  const ratiosAgainstBlack = paletteRgb.map((color) => contrastRatio(color, black));
  const chooseForeground = (background) => contrastRatio(background, white) >= contrastRatio(background, black) ? white : black;
  const chosenRatios = paletteRgb.map((color) => contrastRatio(color, chooseForeground(color)));
  const labelMinPixels = options.labelMinPixels || 7;
  const readableCellRatio = cellPixels >= labelMinPixels ? 1 : 0;
  const contrastReadableRatio = chosenRatios.filter((ratio) => ratio >= 3).length / (chosenRatios.length || 1);
  const digitCoverage = cellPixels >= 10 ? 1 : cellPixels >= 7 ? 0.7 : cellPixels >= 5 ? 0.3 : 0;
  const distinctLabels = new Set(cells).size;
  return {
    previewWidth,
    previewHeight,
    cellPixels,
    labelMinPixels,
    labelsPotentiallyLegible: cellPixels >= labelMinPixels && contrastReadableRatio >= 0.75,
    readableCellRatio,
    contrastReadablePaletteRatio: contrastReadableRatio,
    estimatedDigitCoverage: digitCoverage,
    estimatedLabelCount: cells.length,
    distinctColorLabels: distinctLabels,
    ratiosAgainstWhite,
    ratiosAgainstBlack,
    chosenForegroundContrast: chosenRatios,
    note: 'This is a geometry/contrast proxy. Human number legibility still requires rendered mobile evidence.',
  };
}

export function evaluateRaster(raster, options = {}) {
  validateRaster(raster);
  const { width, height, cells } = raster;
  const area = width * height;
  const paletteInfo = paletteStats(raster.palette, cells);
  const components4 = collectComponents(cells, width, height, 4);
  const components8 = collectComponents(cells, width, height, 8);
  const regions4 = regionSummary(components4, area);
  const regions8 = regionSummary(components8, area);
  const boundaries = boundaryStats(cells, width, height, paletteInfo.labs, components4);
  const tiny = tinyContrastSummary(components4, cells, width, height, paletteInfo.labs);
  const source = sourceComparison(raster.sourceMeans || options.sourceMeans, cells, raster.palette, width, height);
  const effort = effortLowerBounds(cells, components4, components8, width, height, boundaries);
  const readability = numberReadability(cells, raster.palette, width, height, options.numberReadability);
  return {
    schemaVersion: 'pixelization-metrics.v1',
    raster: { width, height, area, paletteLength: raster.palette.length },
    regions4,
    regions8,
    sizeDistributions: { fourConnected: regions4.size, eightConnected: regions8.size },
    isolatedAndContrast: tiny,
    fragmentation: {
      transitionCount: boundaries.transitions,
      possibleEdgeCount: boundaries.possibleEdges,
      transitionRatio: boundaries.transitionRatio,
      boundaryContrast: boundaries.boundaryContrast,
      componentBoundary: boundaries.componentBoundary,
      compactness: boundaries.compactness,
      pairHistogram: boundaries.pairHistogram,
    },
    palette: {
      declaredCount: paletteInfo.declaredCount,
      usedCount: paletteInfo.usedCount,
      unusedCount: paletteInfo.unusedCount,
      usageCounts: paletteInfo.usageCounts,
      usageShares: paletteInfo.usageShares,
      entropyBits: paletteInfo.entropyBits,
      maxAreaShare: paletteInfo.maxAreaShare,
      minUsedAreaShare: paletteInfo.minUsedAreaShare,
      pairwiseDeltaE: paletteInfo.pairwiseDeltaE,
    },
    sourceComparison: source,
    predictedEffort: effort,
    numberReadability: readability,
    definitions: {
      connectivity: 'regions are same-palette connected components; 4-neighbor is the primary paintability view and 8-neighbor exposes diagonal merging',
      tinyRegionCells: `components with <=${DEFAULT_TINY_AREA} cells`,
      highContrastTinyDeltaE: `mean boundary DeltaE >=${DEFAULT_HIGH_CONTRAST_DE} is reported, not automatically penalized`,
      lowContrastTinyDeltaE: `mean boundary DeltaE <${DEFAULT_LOW_CONTRAST_DE} is reported as likely cleanup opportunity`,
      densities: 'component counts normalized per 10,000 cells; raw counts remain available',
      edgeMetrics: 'source edge means use DeltaE >=18 across adjacent source cells; source metrics are unavailable unless sourceMeans are supplied',
      effort: effort.note,
    },
  };
}

export function flattenMetricRow(metrics) {
  const source = metrics.sourceComparison;
  return {
    regions4: metrics.regions4.count,
    regions8: metrics.regions8.count,
    regionDensity4Per10k: metrics.regions4.densityPer10kCells,
    regionDensity8Per10k: metrics.regions8.densityPer10kCells,
    singletonCount: metrics.regions4.singletonCount,
    singletonAreaRatio: metrics.regions4.singletonAreaRatio,
    tinyCount: metrics.regions4.tinyCount,
    tinyAreaRatio: metrics.regions4.tinyAreaRatio,
    smallAreaRatio: metrics.regions4.smallAreaRatio,
    highContrastTinyCount: metrics.isolatedAndContrast.highContrastTinyCount,
    lowContrastTinyCount: metrics.isolatedAndContrast.lowContrastTinyCount,
    transitionCount: metrics.fragmentation.transitionCount,
    transitionRatio: metrics.fragmentation.transitionRatio,
    compactnessMean: metrics.fragmentation.compactness.mean,
    compactnessP90: metrics.fragmentation.compactness.p90,
    paletteUsed: metrics.palette.usedCount,
    paletteEntropyBits: metrics.palette.entropyBits,
    paletteMinUsedAreaShare: metrics.palette.minUsedAreaShare,
    meanDeltaE: source.meanDeltaE,
    edgePrecision: source.edgePrecision,
    edgeRecall: source.edgeRecall,
    edgeF1: source.edgeF1,
    idealRegionTaps: metrics.predictedEffort.idealRegionTaps,
    classicLowerBound: metrics.predictedEffort.classicLowerBound,
    conservativeManualTapLowerBound: metrics.predictedEffort.conservativeManualTapLowerBound,
    previewCellPixels: metrics.numberReadability.cellPixels,
    readableCellRatio: metrics.numberReadability.readableCellRatio,
    labelsPotentiallyLegible: metrics.numberReadability.labelsPotentiallyLegible,
  };
}

export const METRIC_THRESHOLDS = Object.freeze({
  tinyAreaCells: DEFAULT_TINY_AREA,
  smallAreaCells: DEFAULT_SMALL_AREA,
  lowContrastDeltaE: DEFAULT_LOW_CONTRAST_DE,
  highContrastDeltaE: DEFAULT_HIGH_CONTRAST_DE,
  sourceEdgeDeltaE: 18,
});
