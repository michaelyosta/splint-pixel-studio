/** Adapter for the current production converter, retained for baseline runs. */
export const id = 'current';

export async function run({ page, sourceUrl, options }) {
  if (!page) throw new TypeError('current adapter requires a Playwright page');
  return page.evaluate(async ({ sourceUrl: url, buildOptions }) => {
    const { buildColoringFromImage } = await import('/src/lib/pixelColoring.js');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Source image request failed (${response.status}): ${url}`);
    const blob = await response.blob();
    const name = url.split('/').pop() || 'pixelization-source.png';
    const file = new File([blob], name, { type: blob.type || 'image/png' });
    const output = await buildColoringFromImage(file, buildOptions);
    return { width: output.width, height: output.height, palette: output.palette, cells: output.cells };
  }, { sourceUrl, buildOptions: options });
}

export default { id, run };
