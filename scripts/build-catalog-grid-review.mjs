import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = join(root, 'content', 'generated', 'catalog-grids');
const report = JSON.parse(await readFile(join(generatedRoot, 'candidate-report.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'content', 'catalog-manifest.json'), 'utf8'));
if (report.status !== 'candidate-ready-human-review-required' || report.selected_count !== 320) {
  throw new Error('Review gallery requires all 320 candidate maps');
}

const entryById = new Map(manifest.entries.map((entry) => [entry.id, entry]));
const cards = [...report.results]
  .sort((a, b) => b.regions4 - a.regions4)
  .map((item) => {
    const entry = entryById.get(item.id);
    if (!entry) throw new Error(`Missing canonical manifest entry ${item.id}`);
    const searchable = [item.id, entry.title, entry.collection_id, entry.album_id, entry.access].join(' ').toLowerCase();
    const image = `previews/${basename(item.preview_asset)}`;
    const effortRatio = (item.regions4 / item.previous_grid.regions4).toFixed(1);
    return `<article class="card" data-search="${escapeHtml(searchable)}" data-quality="${item.quality_level || 'unknown'}">
  <div class="image"><img loading="lazy" decoding="async" src="${escapeHtml(image)}" alt="${escapeHtml(entry.title || entry.id)}"></div>
  <div class="body"><p class="id">${escapeHtml(item.id)}</p><h2>${escapeHtml(entry.title || entry.id)}</h2>
    <p class="tags">${escapeHtml(entry.collection_id)} · ${escapeHtml(entry.album_id)} · ${escapeHtml(entry.access)}</p>
    <p class="metrics"><b>${item.width}×${item.height}</b><span class="${item.quality_level}">${escapeHtml(item.quality_level || 'unknown')}</span></p>
    <p>Области: <b>${item.regions4.toLocaleString('en-US')}</b> <small>(было ${item.previous_grid.regions4.toLocaleString('en-US')}, ×${effortRatio})</small></p>
    <p>Ячейки в областях ≤2: ${(item.smallRegionCellRatio * 100).toFixed(2)}% · одиночные: ${(item.singletonAreaRatio * 100).toFixed(2)}%</p>
    <p>Карта: ${(item.cell_map_bytes / 1024).toFixed(1)} KiB gz · ячеек ${item.cell_count.toLocaleString('en-US')}</p>
  </div>
</article>`;
  }).join('\n');

const quality = report.quality_analysis;
const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Splint — 1200px catalog candidate review</title>
<style>
:root{color-scheme:light dark;font:15px/1.45 system-ui,Segoe UI,sans-serif;background:#101820;color:#edf3f6}*{box-sizing:border-box}body{margin:0}header{position:sticky;top:0;z-index:2;padding:16px max(16px,calc((100vw - 1440px)/2));background:#101820ee;backdrop-filter:blur(14px);border-bottom:1px solid #33414b}h1{font-size:20px;margin:0 0 6px}.summary{color:#c3cdd4;margin:0 0 12px}.toolbar{display:flex;gap:10px;flex-wrap:wrap}input,select{font:inherit;color:inherit;background:#1a2934;border:1px solid #485967;border-radius:8px;padding:9px 11px}input{flex:1;min-width:240px}main{max-width:1440px;margin:auto;padding:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}.card{overflow:hidden;border:1px solid #34444f;border-radius:12px;background:#17242d}.image{height:300px;display:flex;align-items:center;justify-content:center;background:#0b1217;padding:8px}.image img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated}.body{padding:12px}.id{font:11px/1.4 ui-monospace,Consolas,monospace;color:#9fb1bc;overflow-wrap:anywhere;margin:0 0 4px}h2{font-size:16px;line-height:1.25;margin:0 0 5px}.tags,small{color:#aab8c0}.tags{font-size:12px;margin:0 0 10px}.metrics{display:flex;justify-content:space-between;align-items:center;margin:0 0 7px}.good,.fair,.noisy,.unknown{font-size:12px;text-transform:uppercase;border-radius:20px;padding:2px 8px;background:#29433a}.fair{background:#504a2a}.noisy{background:#583238}.body p:not(.id):not(.tags):not(.metrics){margin:5px 0;font-size:13px}.empty{padding:30px;text-align:center;color:#aab8c0;display:none}
</style></head><body>
<header><h1>1200px-кандидаты · визуальная проверка, публикация не выполнена</h1>
<p class="summary">320 работ · текущая медиана областей ${report.median_previous_regions4} → ${report.median_regions4} · p90 ${report.p90_regions4} · quality gate: good ${quality.candidate_levels.good}, fair ${quality.candidate_levels.fair}, noisy ${quality.candidate_levels.noisy} · мелкие ≤2: медиана ${(quality.median_small_region_cell_ratio * 100).toFixed(2)}%</p>
<div class="toolbar"><input id="search" type="search" placeholder="Поиск по ID, названию, коллекции…"><select id="quality"><option value="">Все quality-статусы</option><option value="good">good</option><option value="fair">fair</option><option value="noisy">noisy</option></select></div></header>
<main id="cards">${cards}</main><div id="empty" class="empty">Совпадений нет.</div>
<script>const search=document.querySelector('#search'),quality=document.querySelector('#quality'),cards=[...document.querySelectorAll('.card')],empty=document.querySelector('#empty');function filter(){const q=search.value.trim().toLowerCase(),level=quality.value;let shown=0;for(const card of cards){const visible=card.dataset.search.includes(q)&&(!level||card.dataset.quality===level);card.hidden=!visible;if(visible)shown++}empty.style.display=shown?'none':'block'}search.addEventListener('input',filter);quality.addEventListener('change',filter);</script></body></html>`;
const output = join(generatedRoot, 'catalog-review-1200.html');
await writeFile(output, html);
console.log(output);

function basename(path) {
  return String(path).replaceAll('\\', '/').split('/').at(-1);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
