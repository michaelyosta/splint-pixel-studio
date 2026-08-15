/** Shared browser adapter for production pixelization style presets. */

export async function runStylePreset({ page, sourceUrl, options }, stylePreset) {
  if (!page) throw new TypeError(`${stylePreset} adapter requires a Playwright page`);
  return page.evaluate(async ({ sourceUrl: url, options: buildOptions, style }) => {
    const { buildColoringFromImage } = await import('/src/lib/pixelColoring.js');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Source image request failed (${response.status}): ${url}`);
    const blob = await response.blob();
    const name = url.split('/').pop() || 'pixelization-source.png';
    const file = new File([blob], name, { type: blob.type || 'image/png' });
    const output = await buildColoringFromImage(file, { ...buildOptions, stylePreset: style });
    return {
      width: output.width,
      height: output.height,
      palette: output.palette,
      cells: output.cells,
      outputMetadata: {
        stylePreset: output.stylePreset || style,
        pipelineVersion: output.pipelineVersion || null,
        resultFingerprint: output.resultFingerprint || null,
        producerMetrics: output.metrics || null,
      },
    };
  }, { sourceUrl, options, style: stylePreset });
}
