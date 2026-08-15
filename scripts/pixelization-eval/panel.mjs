/** Browser-side panel renderer used only for evaluation evidence. */

export async function renderPanel({ page, sourceUrl, output, metrics, title }) {
  const dataUrl = await page.evaluate(async ({ sourceUrl: url, output: raster, metrics: metricVector, title: panelTitle }) => {
    // Playwright serializes this callback, so keep its rendering helpers
    // self-contained rather than relying on the Node module closure.
    const toRgb = (hex) => {
      if (Array.isArray(hex)) return [0, 1, 2].map((index) => Math.max(0, Math.min(255, Number(hex[index]) || 0)));
      const value = String(hex || '').replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(value)) return [0, 0, 0];
      return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
    };
    const sourceRectFor = (imageWidth, imageHeight, x, y, width, height) => {
      const sourceRatio = imageWidth / imageHeight;
      const targetRatio = width / height;
      if (sourceRatio > targetRatio) {
        const sourceWidth = imageHeight * targetRatio;
        return { sx: (imageWidth - sourceWidth) / 2, sy: 0, sw: sourceWidth, sh: imageHeight, dx: x, dy: y, dw: width, dh: height };
      }
      const sourceHeight = imageWidth / targetRatio;
      return { sx: 0, sy: (imageHeight - sourceHeight) / 2, sw: imageWidth, sh: sourceHeight, dx: x, dy: y, dw: width, dh: height };
    };
    const drawRaster = (ctx, cells, palette, width, height, x, y, panelWidth, panelHeight) => {
      const image = ctx.createImageData(width, height);
      const rgbPalette = palette.map(toRgb);
      for (let index = 0; index < cells.length; index += 1) {
        const color = rgbPalette[cells[index]] || [0, 0, 0];
        const offset = index * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
      const scratch = document.createElement('canvas');
      scratch.width = width;
      scratch.height = height;
      scratch.getContext('2d').putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch, x, y, panelWidth, panelHeight);
    };
    const drawGrid = (ctx, cells, palette, width, height, x, y, panelWidth, panelHeight) => {
      const cellWidth = panelWidth / width;
      const cellHeight = panelHeight / height;
      ctx.fillStyle = '#eef2f7';
      ctx.fillRect(x, y, panelWidth, panelHeight);
      for (let index = 0; index < cells.length; index += 1) {
        const cellX = x + (index % width) * cellWidth;
        const cellY = y + Math.floor(index / width) * cellHeight;
        const color = toRgb(palette[cells[index]] || '#000000');
        ctx.fillStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
        ctx.fillRect(cellX, cellY, cellWidth + 0.5, cellHeight + 0.5);
      }
      ctx.strokeStyle = 'rgba(10, 20, 30, 0.26)';
      ctx.lineWidth = Math.max(0.5, Math.min(2, cellWidth / 8));
      if (cellWidth >= 3) {
        for (let column = 0; column <= width; column += 1) {
          const lineX = x + column * cellWidth;
          ctx.beginPath(); ctx.moveTo(lineX, y); ctx.lineTo(lineX, y + panelHeight); ctx.stroke();
        }
        for (let row = 0; row <= height; row += 1) {
          const lineY = y + row * cellHeight;
          ctx.beginPath(); ctx.moveTo(x, lineY); ctx.lineTo(x + panelWidth, lineY); ctx.stroke();
        }
      }
      if (Math.min(cellWidth, cellHeight) < 7) return { labels: false, cellWidth, cellHeight };
      ctx.font = `700 ${Math.max(7, Math.floor(Math.min(cellWidth, cellHeight) * 0.58))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let index = 0; index < cells.length; index += 1) {
        const cellX = x + (index % width) * cellWidth + cellWidth / 2;
        const cellY = y + Math.floor(index / width) * cellHeight + cellHeight / 2;
        const color = toRgb(palette[cells[index]] || '#000000');
        const luminance = (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;
        ctx.fillStyle = luminance > 0.58 ? '#0b1220' : '#ffffff';
        ctx.fillText(String(cells[index] + 1), cellX, cellY);
      }
      return { labels: true, cellWidth, cellHeight };
    };
    const metricText = (value) => {
      if (value === null || value === undefined) return 'n/a';
      if (typeof value === 'boolean') return value ? 'yes' : 'no';
      if (typeof value !== 'number') return String(value);
      return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(3);
    };
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 1040;
    const context = canvas.getContext('2d');
    context.fillStyle = '#101820';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f8fafc';
    context.font = '700 26px system-ui, sans-serif';
    context.fillText(panelTitle, 32, 40);
    const panels = [
      { x: 32, y: 72, width: 648, height: 430, label: 'Original source' },
      { x: 720, y: 72, width: 648, height: 430, label: 'Pixelized output' },
      { x: 32, y: 560, width: 648, height: 430, label: 'Number-grid preview' },
    ];
    for (const panel of panels) {
      context.fillStyle = '#e5e7eb';
      context.fillRect(panel.x, panel.y, panel.width, panel.height);
      context.fillStyle = '#ffffff';
      context.font = '600 18px system-ui, sans-serif';
      context.fillText(panel.label, panel.x, panel.y - 12);
    }
    const sourceRect = sourceRectFor(image.naturalWidth, image.naturalHeight, panels[0].x, panels[0].y, panels[0].width, panels[0].height);
    context.imageSmoothingEnabled = true;
    context.drawImage(image, sourceRect.sx, sourceRect.sy, sourceRect.sw, sourceRect.sh, sourceRect.dx, sourceRect.dy, sourceRect.dw, sourceRect.dh);
    drawRaster(context, raster.cells, raster.palette, raster.width, raster.height, panels[1].x, panels[1].y, panels[1].width, panels[1].height);
    const readability = drawGrid(context, raster.cells, raster.palette, raster.width, raster.height, panels[2].x, panels[2].y, panels[2].width, panels[2].height);
    context.fillStyle = '#ffffff';
    context.font = '600 18px system-ui, sans-serif';
    context.fillText('Independent metric vector', 720, 588);
    context.font = '16px ui-monospace, SFMono-Regular, Menlo, monospace';
    const lines = [
      `regions 4/8: ${metricVector.regions4.count} / ${metricVector.regions8.count}`,
      `tiny area / singleton area: ${metricText(metricVector.regions4.tinyAreaRatio * 100)}% / ${metricText(metricVector.regions4.singletonAreaRatio * 100)}%`,
      `transitions / compactness p90: ${metricText(metricVector.fragmentation.transitionRatio * 100)}% / ${metricText(metricVector.fragmentation.compactness.p90)}`,
      `palette used / entropy: ${metricVector.palette.usedCount} / ${metricText(metricVector.palette.entropyBits)} bits`,
      `effort lower bound: ${metricVector.predictedEffort.classicLowerBound} taps`,
      `source ΔE / edge P/R: ${metricText(metricVector.sourceComparison.meanDeltaE)} / ${metricText(metricVector.sourceComparison.edgePrecision)} / ${metricText(metricVector.sourceComparison.edgeRecall)}`,
      `number cell px / labels: ${metricText(metricVector.numberReadability.cellPixels)} / ${readability.labels ? 'shown' : 'hidden'}`,
      'No winner is declared by this panel.',
    ];
    lines.forEach((line, index) => context.fillText(line, 720, 628 + index * 35));
    context.fillStyle = '#cbd5e1';
    context.font = '14px system-ui, sans-serif';
    context.fillText('Panel is evidence for review, not an artistic verdict.', 720, 965);
    return canvas.toDataURL('image/png');
  }, { sourceUrl, output, metrics, title });
  return dataUrl;
}

export async function renderComparisonPanel({ page, sourceUrl, baseline, candidate, comparison, title }) {
  return page.evaluate(async ({ sourceUrl: url, baseline: base, candidate: next, comparison: delta, title: panelTitle }) => {
    const toRgb = (color) => {
      if (Array.isArray(color)) return [0, 1, 2].map((index) => Math.max(0, Math.min(255, Number(color[index]) || 0)));
      const value = String(color || '').replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(value)) return [0, 0, 0];
      return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
    };
    const format = (value, digits = 3) => {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'n/a';
      return Number(value).toFixed(digits);
    };
    const sourceRectFor = (imageWidth, imageHeight, x, y, width, height) => {
      const sourceRatio = imageWidth / imageHeight;
      const targetRatio = width / height;
      if (sourceRatio > targetRatio) {
        const sourceWidth = imageHeight * targetRatio;
        return { sx: (imageWidth - sourceWidth) / 2, sy: 0, sw: sourceWidth, sh: imageHeight, dx: x, dy: y, dw: width, dh: height };
      }
      const sourceHeight = imageWidth / targetRatio;
      return { sx: 0, sy: (imageHeight - sourceHeight) / 2, sw: imageWidth, sh: sourceHeight, dx: x, dy: y, dw: width, dh: height };
    };
    const rasterCanvas = (raster) => {
      const canvas = document.createElement('canvas');
      canvas.width = raster.width;
      canvas.height = raster.height;
      const context = canvas.getContext('2d');
      const image = context.createImageData(raster.width, raster.height);
      const palette = raster.palette.map(toRgb);
      for (let index = 0; index < raster.cells.length; index += 1) {
        const color = palette[raster.cells[index]] || [0, 0, 0];
        const offset = index * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      return canvas;
    };
    const drawRaster = (context, source, x, y, width, height) => {
      context.imageSmoothingEnabled = false;
      context.drawImage(source, x, y, width, height);
    };
    const drawGridOverlay = (context, raster, x, y, width, height) => {
      const cellWidth = width / raster.width;
      const cellHeight = height / raster.height;
      if (Math.min(cellWidth, cellHeight) < 3) return { labels: false, cellPixels: Math.min(cellWidth, cellHeight) };
      context.strokeStyle = 'rgba(10, 20, 30, 0.28)';
      context.lineWidth = Math.max(0.5, Math.min(1.5, cellWidth / 8));
      for (let column = 0; column <= raster.width; column += 1) {
        const lineX = x + column * cellWidth;
        context.beginPath(); context.moveTo(lineX, y); context.lineTo(lineX, y + height); context.stroke();
      }
      for (let row = 0; row <= raster.height; row += 1) {
        const lineY = y + row * cellHeight;
        context.beginPath(); context.moveTo(x, lineY); context.lineTo(x + width, lineY); context.stroke();
      }
      if (Math.min(cellWidth, cellHeight) < 7) return { labels: false, cellPixels: Math.min(cellWidth, cellHeight) };
      const palette = raster.palette.map(toRgb);
      context.font = `700 ${Math.max(7, Math.floor(Math.min(cellWidth, cellHeight) * 0.56))}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (let index = 0; index < raster.cells.length; index += 1) {
        const cellX = x + (index % raster.width) * cellWidth + cellWidth / 2;
        const cellY = y + Math.floor(index / raster.width) * cellHeight + cellHeight / 2;
        const color = palette[raster.cells[index]] || [0, 0, 0];
        const luminance = (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;
        context.fillStyle = luminance > 0.58 ? '#0b1220' : '#ffffff';
        context.fillText(String(raster.cells[index] + 1), cellX, cellY);
      }
      return { labels: true, cellPixels: Math.min(cellWidth, cellHeight) };
    };
    const image = new Image();
    image.src = url;
    await image.decode();
    const baselineRaster = rasterCanvas(base.output);
    const candidateRaster = rasterCanvas(next.output);
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#101820';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f8fafc';
    context.font = '700 28px system-ui, sans-serif';
    context.fillText(panelTitle, 32, 42);
    const topPanels = [
      { x: 32, y: 82, width: 560, height: 370, label: 'Original source' },
      { x: 620, y: 82, width: 560, height: 370, label: `${base.label} output` },
      { x: 1208, y: 82, width: 560, height: 370, label: `${next.label} output` },
    ];
    const lowerPanels = [
      { x: 32, y: 520, width: 560, height: 370, label: `${base.label} number-grid` },
      { x: 620, y: 520, width: 560, height: 370, label: `${next.label} number-grid` },
    ];
    [...topPanels, ...lowerPanels].forEach((panel) => {
      context.fillStyle = '#e5e7eb';
      context.fillRect(panel.x, panel.y, panel.width, panel.height);
      context.fillStyle = '#ffffff';
      context.font = '600 18px system-ui, sans-serif';
      context.fillText(panel.label, panel.x, panel.y - 12);
    });
    const source = sourceRectFor(image.naturalWidth, image.naturalHeight, topPanels[0].x, topPanels[0].y, topPanels[0].width, topPanels[0].height);
    context.imageSmoothingEnabled = true;
    context.drawImage(image, source.sx, source.sy, source.sw, source.sh, source.dx, source.dy, source.dw, source.dh);
    drawRaster(context, baselineRaster, topPanels[1].x, topPanels[1].y, topPanels[1].width, topPanels[1].height);
    drawRaster(context, candidateRaster, topPanels[2].x, topPanels[2].y, topPanels[2].width, topPanels[2].height);
    drawRaster(context, baselineRaster, lowerPanels[0].x, lowerPanels[0].y, lowerPanels[0].width, lowerPanels[0].height);
    drawRaster(context, candidateRaster, lowerPanels[1].x, lowerPanels[1].y, lowerPanels[1].width, lowerPanels[1].height);
    const baseGrid = drawGridOverlay(context, base.output, lowerPanels[0].x, lowerPanels[0].y, lowerPanels[0].width, lowerPanels[0].height);
    const nextGrid = drawGridOverlay(context, next.output, lowerPanels[1].x, lowerPanels[1].y, lowerPanels[1].width, lowerPanels[1].height);
    context.fillStyle = '#ffffff';
    context.font = '700 19px system-ui, sans-serif';
    context.fillText('Independent comparison', 1208, 520);
    context.font = '15px ui-monospace, SFMono-Regular, Menlo, monospace';
    const lines = [
      `metric                 ${base.label.padEnd(10)} ${next.label.padEnd(10)} delta`,
      `regions4               ${String(base.metrics.regions4.count).padEnd(10)} ${String(next.metrics.regions4.count).padEnd(10)} ${delta.deltas.regions4 >= 0 ? '+' : ''}${delta.deltas.regions4}`,
      `effort lower bound     ${String(base.metrics.predictedEffort.classicLowerBound).padEnd(10)} ${String(next.metrics.predictedEffort.classicLowerBound).padEnd(10)} ${format(delta.deltas.classicLowerBoundRelative * 100, 1)}%`,
      `tiny area              ${format(base.metrics.regions4.tinyAreaRatio * 100, 3).padEnd(10)} ${format(next.metrics.regions4.tinyAreaRatio * 100, 3).padEnd(10)} ${format(delta.deltas.tinyAreaRatio * 100, 3)}pp`,
      `transitions            ${format(base.metrics.fragmentation.transitionRatio * 100, 3).padEnd(10)} ${format(next.metrics.fragmentation.transitionRatio * 100, 3).padEnd(10)} ${format(delta.deltas.transitionRatio * 100, 3)}pp`,
      `mean DeltaE            ${format(base.metrics.sourceComparison.meanDeltaE, 3).padEnd(10)} ${format(next.metrics.sourceComparison.meanDeltaE, 3).padEnd(10)} ${format(delta.deltas.meanDeltaE, 3)}`,
      `edge precision         ${format(base.metrics.sourceComparison.edgePrecision, 3).padEnd(10)} ${format(next.metrics.sourceComparison.edgePrecision, 3).padEnd(10)} ${format(delta.deltas.edgePrecision, 3)}`,
      `edge recall            ${format(base.metrics.sourceComparison.edgeRecall, 3).padEnd(10)} ${format(next.metrics.sourceComparison.edgeRecall, 3).padEnd(10)} ${format(delta.deltas.edgeRecall, 3)}`,
      `number cell pixels     ${format(baseGrid.cellPixels, 3).padEnd(10)} ${format(nextGrid.cellPixels, 3).padEnd(10)} labels ${baseGrid.labels ? 'on' : 'off'}/${nextGrid.labels ? 'on' : 'off'}`,
      `regression flags: ${delta.regressions.length ? delta.regressions.join(', ') : 'none'}`,
      `improvement flags: ${delta.improvements.length ? delta.improvements.join(', ') : 'none'}`,
      `unavailable: ${delta.unavailableMetrics.length ? delta.unavailableMetrics.join(', ') : 'none'}`,
    ];
    lines.forEach((line, index) => context.fillText(line, 1208, 560 + index * 30));
    context.fillStyle = '#cbd5e1';
    context.font = '15px system-ui, sans-serif';
    const notes = [
      'Automated structure evidence only.',
      'No subjective beauty winner is declared.',
      'Number readability and paint feel remain human gates.',
    ];
    notes.forEach((line, index) => context.fillText(line, 1208, 1000 + index * 28));
    return canvas.toDataURL('image/png');
  }, { sourceUrl, baseline, candidate, comparison, title });
}
