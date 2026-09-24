import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { catalogAssetUrl, CATALOG_SHELF_DEFINITIONS } from './catalog-merchandising.js';

const serviceRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const defaultManifestPath = join(serviceRoot, 'content', 'catalog-manifest.json');
const defaultRuntimePath = join(serviceRoot, 'server', 'catalog-templates.json');
const EXPECTED_CATALOG_COUNT = 320;
const EXPECTED_COVER_COUNT = 48;

function parseJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read catalog input ${path}: ${error.message}`);
  }
}

function assertUnique(values, label, errors) {
  const duplicates = [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
  if (duplicates.length) errors.push(`${label} contains duplicates: ${duplicates.slice(0, 5).join(', ')}`);
}

function assertAssetPath(value, label, errors) {
  const normalized = String(value || '').replaceAll('\\', '/');
  const isCanonicalGeneratedPath = normalized.startsWith('content/generated/')
    || normalized.startsWith('public/assets/catalog/generated/');
  if (!normalized || normalized.includes('..') || !isCanonicalGeneratedPath) {
    errors.push(`${label} is not a canonical generated asset path: ${value}`);
  }
}

function readCatalogGridBytes(template, root = serviceRoot) {
  const asset = String(template?.cell_map_asset || '').replaceAll('\\', '/');
  if (!asset.startsWith('content/generated/') || asset.split('/').includes('..')) {
    throw new Error(`CATALOG_GRID_ASSET_PATH_INVALID: ${template.id}`);
  }
  const width = Number(template.width);
  const height = Number(template.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8
    || width > 1200 || height > 1200) {
    throw new Error(`CATALOG_GRID_DIMENSIONS_INVALID: ${template.id}`);
  }
  const path = resolve(root, asset);
  const realRoot = realpathSync(root);
  const realPath = realpathSync(path);
  const pathFromRoot = relative(realRoot, realPath);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || resolve(realRoot, pathFromRoot) === realRoot) {
    throw new Error(`CATALOG_GRID_ASSET_PATH_INVALID: ${template.id}`);
  }
  const expectedBytes = width * height;
  const compressedBytes = statSync(path).size;
  if (compressedBytes > expectedBytes + 65_536) throw new Error(`CATALOG_GRID_COMPRESSED_SIZE_INVALID: ${template.id}`);
  const compressed = readFileSync(path);
  const actualSha = sha256(compressed);
  if (actualSha !== String(template.cell_map_sha256 || '').toLowerCase()) {
    throw new Error(`CATALOG_GRID_CHECKSUM_MISMATCH: ${template.id}`);
  }
  const raw = gunzipSync(compressed, { maxOutputLength: expectedBytes });
  if (raw.length !== expectedBytes || (template.cell_map_raw_bytes !== undefined
    && Number(template.cell_map_raw_bytes) !== raw.length)) {
    throw new Error(`CATALOG_GRID_SIZE_MISMATCH: ${template.id}`);
  }
  const paletteLength = template.palette?.length || 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] >= paletteLength) throw new Error(`CATALOG_GRID_PALETTE_INDEX_INVALID: ${template.id}`);
  }
  return raw;
}

function buildTilesFromGridBytes(template, raw) {
  const width = Number(template.width);
  const height = Number(template.height);
  const tileSize = Number(template.tile_size || 32);
  const tiles = [];
  for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
    for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tileHeight = Math.min(tileSize, height - tileY * tileSize);
      const cells = new Array(tileWidth * tileHeight);
      for (let y = 0; y < tileHeight; y += 1) {
        const sourceOffset = (tileY * tileSize + y) * width + tileX * tileSize;
        const targetOffset = y * tileWidth;
        for (let x = 0; x < tileWidth; x += 1) cells[targetOffset + x] = raw[sourceOffset + x];
      }
      tiles.push({ tile_x: tileX, tile_y: tileY, width: tileWidth, height: tileHeight, cells });
    }
  }
  return tiles;
}

function validatePublisherTiles(template, tiles) {
  const width = Number(template.width);
  const height = Number(template.height);
  const tileSize = Number(template.tile_size || 32);
  const paletteLength = template.palette?.length || 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8
    || width > 1200 || height > 1200 || !Number.isInteger(tileSize) || tileSize < 8 || tileSize > 128
    || paletteLength < 2 || paletteLength > 32) {
    throw new Error(`CATALOG_TILED_GRID_INVALID: ${template.id}`);
  }
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  if (!Array.isArray(tiles) || tiles.length !== columns * rows) {
    throw new Error(`CATALOG_TILED_GRID_INCOMPLETE: ${template.id}`);
  }
  const coordinates = new Set();
  for (const tile of tiles) {
    const tileX = Number(tile.tile_x);
    const tileY = Number(tile.tile_y);
    const tileWidth = Math.min(tileSize, width - tileX * tileSize);
    const tileHeight = Math.min(tileSize, height - tileY * tileSize);
    const key = `${tileX}:${tileY}`;
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0
      || tileX >= columns || tileY >= rows || coordinates.has(key)
      || Number(tile.width) !== tileWidth || Number(tile.height) !== tileHeight
      || !Array.isArray(tile.cells) || tile.cells.length !== tileWidth * tileHeight
      || tile.cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= paletteLength)) {
      throw new Error(`CATALOG_TILED_TILE_INVALID: ${template.id}:${key}`);
    }
    coordinates.add(key);
  }
  return [...tiles].sort((a, b) => a.tile_y - b.tile_y || a.tile_x - b.tile_x);
}

function parseStoredArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sameJsonArray(first, second) {
  const a = parseStoredArray(first);
  const b = parseStoredArray(second);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

function sameTemplateMap(existing, runtime, tiles = null) {
  if (!existing || Number(existing.width) !== Number(runtime.width)
    || Number(existing.height) !== Number(runtime.height)
    || !sameJsonArray(existing.palette_json, runtime.palette)) return false;
  if (tiles) {
    if (existing.storage_mode !== 'tiled') return false;
    const storedTiles = Array.isArray(existing.tiles) ? existing.tiles : [];
    if (storedTiles.length !== tiles.length) return false;
    return tiles.every((tile, index) => {
      const stored = storedTiles[index];
      return Number(stored.tile_x) === tile.tile_x
        && Number(stored.tile_y) === tile.tile_y
        && Number(stored.width) === tile.width
        && Number(stored.height) === tile.height
        && sameJsonArray(stored.cells_json, tile.cells);
    });
  }
  return (existing.storage_mode || 'legacy') === 'legacy'
    && sameJsonArray(existing.cells_json, runtime.cells);
}

async function templateHasProgress(db, templateId) {
  const row = await db.get(`SELECT
    (SELECT COUNT(*) FROM coloring_progress WHERE template_id=?)
    + (SELECT COUNT(*) FROM coloring_progress_batches WHERE template_id=?)
    + (SELECT COUNT(*) FROM coloring_tiled_progress WHERE template_id=?)
    + (SELECT COUNT(*) FROM coloring_tiled_progress_tiles WHERE template_id=?)
    + (SELECT COUNT(*) FROM coloring_tiled_progress_tile_colors WHERE template_id=?)
    + (SELECT COUNT(*) FROM coloring_tiled_progress_colors WHERE template_id=?)
    + (SELECT COUNT(*) FROM coloring_special_progress WHERE template_id=?) AS progress_count`,
  Array(7).fill(templateId));
  return Number(row?.progress_count || 0) > 0;
}

async function clearStoredGrid(db, templateId) {
  await db.run('DELETE FROM coloring_zones WHERE template_id=?', [templateId]);
  await db.run('DELETE FROM coloring_template_tile_color_counts WHERE template_id=?', [templateId]);
  await db.run('DELETE FROM coloring_template_color_counts WHERE template_id=?', [templateId]);
  await db.run('DELETE FROM coloring_template_guidance_index_meta WHERE template_id=?', [templateId]);
  await db.run('DELETE FROM coloring_special_cells WHERE template_id=?', [templateId]);
  await db.run('DELETE FROM coloring_template_tiles WHERE template_id=?', [templateId]);
}

async function insertTemplateTiles(db, templateId, tiles, now) {
  const batchSize = 100;
  for (let offset = 0; offset < tiles.length; offset += batchSize) {
    const batch = tiles.slice(offset, offset + batchSize);
    const values = [];
    const placeholders = batch.map((tile) => {
      values.push(templateId, tile.tile_x, tile.tile_y, tile.width, tile.height, json(tile.cells), now, now);
      return '(?,?,?,?,?,?,?,?)';
    });
    await db.run(`INSERT INTO coloring_template_tiles
      (template_id,tile_x,tile_y,width,height,cells_json,created_at,updated_at)
      VALUES ${placeholders.join(',')}`, values);
  }
}

function buildCatalogAssetRecords(manifest) {
  const records = [];
  const add = (kind, sourceAsset, id) => {
    const normalized = String(sourceAsset || '').replaceAll('\\', '/');
    const filename = basename(normalized);
    const prefix = kind === 'master'
      ? 'catalog/masters'
      : kind === 'full'
        ? 'catalog/full'
        : kind === 'preview'
          ? 'catalog/previews'
          : kind === 'cover-source'
            ? 'catalog/covers/source'
            : 'catalog/covers';
    records.push({ id, kind, source_asset: normalized, key: `${prefix}/${filename}` });
  };
  for (const entry of manifest.entries || []) {
    add('master', entry.source_asset, entry.id);
    add('full', entry.optimized_asset, entry.id);
    add('preview', entry.preview_asset, entry.id);
  }
  for (const cover of manifest.covers || []) {
    add('cover-source', cover.source_asset, cover.id);
    add('cover', cover.optimized_asset, cover.id);
  }
  const byKey = new Map();
  for (const record of records) {
    const previous = byKey.get(record.key);
    if (previous && previous.source_asset !== record.source_asset) {
      throw new Error(`CATALOG_ASSET_KEY_COLLISION: ${record.key}`);
    }
    byKey.set(record.key, record);
  }
  return [...byKey.values()];
}

export function readCanonicalCatalog({ manifestPath = defaultManifestPath, runtimePath = defaultRuntimePath, gridRoot = serviceRoot } = {}) {
  const manifest = parseJsonFile(manifestPath);
  const runtimeTemplates = parseJsonFile(runtimePath);
  const errors = [];
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const collections = Array.isArray(manifest.collections) ? manifest.collections : [];
  const covers = Array.isArray(manifest.covers) ? manifest.covers : [];
  const runtime = Array.isArray(runtimeTemplates) ? runtimeTemplates : [];
  const collectionIds = new Set(collections.map((collection) => collection.id));
  const albumIds = new Set(collections.flatMap((collection) => (collection.albums || []).map((album) => album.id)));

  if (entries.length !== EXPECTED_CATALOG_COUNT) errors.push(`manifest entries=${entries.length}; expected ${EXPECTED_CATALOG_COUNT}`);
  if (runtime.length !== entries.length) errors.push(`runtime templates=${runtime.length}; manifest entries=${entries.length}`);
  if (collections.length !== 16) errors.push(`manifest collections=${collections.length}; expected 16`);
  if (covers.length !== EXPECTED_COVER_COUNT) errors.push(`manifest covers=${covers.length}; expected ${EXPECTED_COVER_COUNT}`);
  assertUnique(entries.map((entry) => entry.id), 'entry ids', errors);
  assertUnique(collections.map((collection) => collection.id), 'collection ids', errors);
  assertUnique([...albumIds], 'album ids', errors);
  assertUnique(covers.map((cover) => cover.parent_id), 'cover parent ids', errors);
  const expectedCoverParents = new Set([...collectionIds, ...albumIds]);
  for (const parentId of expectedCoverParents) {
    if (!covers.some((cover) => cover.parent_id === parentId)) errors.push(`missing cover for ${parentId}`);
  }
  for (const cover of covers) {
    if (!expectedCoverParents.has(cover.parent_id)) errors.push(`${cover.id} references unknown cover parent ${cover.parent_id}`);
  }

  const entryIds = new Set(entries.map((entry) => entry.id));
  const runtimeIds = new Set(runtime.map((template) => template.id));
  for (const entry of entries) {
    if (!collectionIds.has(entry.collection_id)) errors.push(`${entry.id} references missing collection ${entry.collection_id}`);
    if (!albumIds.has(entry.album_id)) errors.push(`${entry.id} references missing album ${entry.album_id}`);
    if (!['free', 'premium'].includes(entry.access)) errors.push(`${entry.id} has invalid access ${entry.access}`);
    assertAssetPath(entry.source_asset, `${entry.id}.source_asset`, errors);
    assertAssetPath(entry.optimized_asset, `${entry.id}.optimized_asset`, errors);
    assertAssetPath(entry.preview_asset, `${entry.id}.preview_asset`, errors);
    if (!String(entry.preview_asset || '').endsWith('-pixel.png')) errors.push(`${entry.id} preview_asset is not a pixel preview`);
  }
  for (const cover of covers) {
    if (!cover.parent_id) errors.push(`${cover.id} has no parent_id`);
    assertAssetPath(cover.source_asset, `${cover.id}.source_asset`, errors);
    assertAssetPath(cover.optimized_asset, `${cover.id}.optimized_asset`, errors);
  }
  assertUnique(entries.map((entry) => entry.preview_asset), 'preview asset paths', errors);
  if (runtime.some((template) => !entryIds.has(template.id))) errors.push('runtime contains ids absent from manifest');
  if (entries.some((entry) => !runtimeIds.has(entry.id))) errors.push('manifest contains ids absent from runtime template data');
  for (const template of runtime) {
    if (!Number.isInteger(template.width) || !Number.isInteger(template.height)) {
      errors.push(`${template.id} runtime payload has invalid dimensions`);
      continue;
    }
    if (!Array.isArray(template.palette) || template.palette.length < 2 || template.palette.length > 32
      || template.palette.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) {
      errors.push(`${template.id} runtime payload has an invalid palette`);
      continue;
    }
    if (template.storage_mode === 'tiled') {
      const tileSize = Number(template.tile_size || 32);
      if (template.width < 8 || template.height < 8 || template.width > 1200 || template.height > 1200
        || !Number.isInteger(tileSize) || tileSize < 8 || tileSize > 128) {
        errors.push(`${template.id} has invalid tiled dimensions or tile_size`);
      }
      if (!String(template.cell_map_asset || '').endsWith('.u8.gz')) {
        errors.push(`${template.id} tiled runtime payload has no .u8.gz cell_map_asset`);
      }
      assertAssetPath(template.cell_map_asset, `${template.id}.cell_map_asset`, errors);
      if (!/^[a-f0-9]{64}$/i.test(String(template.cell_map_sha256 || ''))) {
        errors.push(`${template.id} tiled runtime payload has no SHA-256 checksum`);
      }
      if (Array.isArray(template.cells) && template.cells.length > 0) {
        errors.push(`${template.id} tiled runtime payload must not embed a full cells array`);
      }
      try {
        readCatalogGridBytes(template, gridRoot);
      } catch (error) {
        errors.push(`${template.id} cell map validation failed: ${error.message}`);
      }
    } else if ((template.storage_mode !== undefined && template.storage_mode !== 'legacy')
      || template.width < 8 || template.height < 8 || template.width > 160 || template.height > 160
      || !Array.isArray(template.cells) || template.cells.length !== template.width * template.height
      || template.cells.some((color) => !Number.isInteger(color) || color < 0 || color >= template.palette.length)) {
      errors.push(`${template.id} runtime payload has invalid legacy cells`);
    }
  }

  const counts = {
    collections: collections.length,
    albums: albumIds.size,
    colorings: entries.length,
    free: entries.filter((entry) => entry.access === 'free').length,
    premium: entries.filter((entry) => entry.access === 'premium').length,
  };
  for (const key of Object.keys(counts)) {
    if (manifest.catalog?.[key] !== undefined && Number(manifest.catalog[key]) !== counts[key]) {
      errors.push(`manifest.catalog.${key}=${manifest.catalog[key]}; derived=${counts[key]}`);
    }
  }
  if (errors.length) {
    const error = new Error(`Canonical catalog validation failed:\n- ${errors.slice(0, 20).join('\n- ')}`);
    error.code = 'CATALOG_MANIFEST_INVALID';
    error.validationErrors = errors;
    throw error;
  }

  return {
    manifest,
    entries,
    collections,
    covers,
    runtimeTemplates,
    runtimeById: new Map(runtime.map((template) => [template.id, template])),
    collectionById: new Map(collections.map((collection) => [collection.id, collection])),
    coverByParent: new Map(covers.map((cover) => [cover.parent_id, cover])),
    loadTiledTiles: (template) => buildTilesFromGridBytes(template, readCatalogGridBytes(template, gridRoot)),
    counts,
    assetRecords: buildCatalogAssetRecords(manifest),
  };
}

function buildZones(width, height) {
  const rows = 3;
  const cols = 2;
  const zoneHeight = Math.ceil(height / rows);
  const zoneWidth = Math.ceil(width / cols);
  const zones = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const x0 = column * zoneWidth;
      const y0 = row * zoneHeight;
      const x1 = Math.min(width, x0 + zoneWidth);
      const y1 = Math.min(height, y0 + zoneHeight);
      const indices = [];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) indices.push(y * width + x);
      }
      zones.push({ title: `Участок ${zones.length + 1}`, indices });
    }
  }
  return zones;
}

function json(value) {
  return JSON.stringify(value ?? []);
}

function runtimeMetadata(entry, collection, album, runtime, collectionIndex, albumIndex) {
  return {
    collection_id: entry.collection_id,
    album_id: entry.album_id,
    album_title: album?.title || entry.album_title || entry.album_id,
    access_type: entry.access,
    tags_json: json(entry.tags || []),
    season_json: json(entry.season || []),
    audience_json: json(entry.audience || []),
    featured_rank: collectionIndex * 100 + albumIndex * 10 + (String(entry.id).endsWith('_01') ? 0 : 1),
    daily_featured: Number(runtime?.daily_featured || 0),
    is_new: Number(runtime?.is_new || (String(collection?.id || '').includes('phase2') ? 1 : 0)),
  };
}

function numberValue(row, key) {
  return Number(row?.[key] || 0);
}

export async function publishCatalog({ db, catalog = readCanonicalCatalog(), now = new Date().toISOString() } = {}) {
  if (!db?.withDbTransaction || !db?.run || !db?.get || !db?.all) throw new Error('publishCatalog requires database helpers');
  const { entries, collections, coverByParent, collectionById, runtimeById, loadTiledTiles, counts } = catalog;
  const entryIds = entries.map((entry) => entry.id);

  return db.withDbTransaction(async (transaction) => {
    const q = transaction || db;
    for (const [collectionIndex, collection] of collections.entries()) {
      const collectionEntries = entries.filter((entry) => entry.collection_id === collection.id);
      const cover = coverByParent.get(collection.id);
      const imageUrl = catalogAssetUrl(cover?.optimized_asset || cover?.source_asset);
      const tags = [...new Set(collectionEntries.flatMap((entry) => entry.tags || []))];
      await q.run(`INSERT INTO collections
        (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,
         catalog_scope,catalog_slug,catalog_theme,catalog_mood,catalog_tags_json,
         catalog_rank,catalog_cover_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          title=CASE WHEN collections.catalog_managed THEN collections.title ELSE excluded.title END,
          pack_type=CASE WHEN collections.catalog_managed THEN collections.pack_type ELSE excluded.pack_type END,
          rarity=CASE WHEN collections.catalog_managed THEN collections.rarity ELSE excluded.rarity END,
          total_artworks=CASE WHEN collections.catalog_managed THEN collections.total_artworks ELSE excluded.total_artworks END,
          price_in_stars=CASE WHEN collections.catalog_managed THEN collections.price_in_stars ELSE excluded.price_in_stars END,
          image_url=CASE WHEN collections.catalog_managed THEN collections.image_url ELSE excluded.image_url END,
          catalog_scope=CASE WHEN collections.catalog_managed THEN collections.catalog_scope ELSE excluded.catalog_scope END,
          catalog_slug=CASE WHEN collections.catalog_managed THEN collections.catalog_slug ELSE excluded.catalog_slug END,
          catalog_theme=CASE WHEN collections.catalog_managed THEN collections.catalog_theme ELSE excluded.catalog_theme END,
          catalog_mood=CASE WHEN collections.catalog_managed THEN collections.catalog_mood ELSE excluded.catalog_mood END,
          catalog_tags_json=CASE WHEN collections.catalog_managed THEN collections.catalog_tags_json ELSE excluded.catalog_tags_json END,
          catalog_rank=CASE WHEN collections.catalog_managed THEN collections.catalog_rank ELSE excluded.catalog_rank END,
          catalog_cover_url=CASE WHEN collections.catalog_managed THEN collections.catalog_cover_url ELSE excluded.catalog_cover_url END`,
      [collection.id, collection.title, 'free', collection.access === 'premium' ? 'epic' : 'common',
        collectionEntries.length, 0, imageUrl, 'merchandising', collection.slug, collection.theme || 'featured',
        collection.mood || 'calm', json(tags), collectionIndex, imageUrl]);
    }

    for (const [collectionIndex, collection] of collections.entries()) {
      const collectionCover = coverByParent.get(collection.id);
      const collectionCoverUrl = catalogAssetUrl(collectionCover?.optimized_asset || collectionCover?.source_asset);
      for (const [albumIndex, album] of (collection.albums || []).entries()) {
        const albumCover = coverByParent.get(album.id);
        const coverUrl = catalogAssetUrl(albumCover?.optimized_asset || albumCover?.source_asset) || collectionCoverUrl;
        const albumEntries = entries.filter((entry) => entry.album_id === album.id);
        await q.run(`INSERT INTO catalog_albums
          (id,collection_id,slug,title,description,visibility,status,cover_url,sort_rank,featured,is_new,tags_json,editor_managed,created_at,updated_at)
          VALUES (?,?,?,?,?,'public','active',?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            collection_id=excluded.collection_id,
            slug=excluded.slug,
            title=excluded.title,
            description=excluded.description,
            visibility=excluded.visibility,
            status=excluded.status,
            cover_url=excluded.cover_url,
            sort_rank=excluded.sort_rank,
            featured=excluded.featured,
            is_new=excluded.is_new,
            tags_json=excluded.tags_json,
            updated_at=excluded.updated_at
          WHERE catalog_albums.editor_managed=FALSE`,
        [album.id, collection.id, album.slug || album.id, album.title || album.id, '', coverUrl,
          collectionIndex * 100 + albumIndex * 10, albumEntries.some((entry) => entry.id.endsWith('_01')) ? 1 : 0,
          collection.id.includes('phase2') ? 1 : 0, json([...new Set(albumEntries.flatMap((entry) => entry.tags || []))]), false, now, now]);
      }
    }

    for (const [shelfIndex, shelf] of CATALOG_SHELF_DEFINITIONS.entries()) {
      await q.run(`INSERT INTO catalog_shelves
        (id,title,description,filter_json,status,sort_rank,cover_url,created_at,updated_at)
        VALUES (?,?,?,?,'active',?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      [shelf.id, shelf.label, shelf.description || '', json({ definition_id: shelf.id }), shelfIndex, null, now, now]);
    }

    const stale = await q.run(
      `UPDATE coloring_templates SET status='hidden',updated_at=?
       WHERE source_type='catalog' AND catalog_managed=FALSE AND id NOT IN (${entryIds.map(() => '?').join(',')})`,
      [now, ...entryIds],
    );
    const existingZoneCounts = new Map((await q.all('SELECT template_id,COUNT(*) AS c FROM coloring_zones GROUP BY template_id'))
      .map((row) => [row.template_id, numberValue(row, 'c')]));

    const templateSql = `INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,mood,theme,est_minutes,collection_id,daily_featured,added_at,created_at,updated_at,
       album_id,album_title,access_type,tags_json,season_json,audience_json,featured_rank,is_new,storage_mode,tile_size)
      VALUES (${Array.from({ length: 33 }, () => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET
        title=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.title ELSE excluded.title END,
        description=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.description ELSE excluded.description END,
        category=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.category ELSE excluded.category END,
        difficulty=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.difficulty ELSE excluded.difficulty END,
        width=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.width ELSE excluded.width END,
        height=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.height ELSE excluded.height END,
        palette_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.palette_json ELSE excluded.palette_json END,
        cells_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.cells_json ELSE excluded.cells_json END,
        preview_url=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.preview_url ELSE excluded.preview_url END,
        visibility=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.visibility ELSE 'public' END,
        status=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.status ELSE 'active' END,
        mood=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.mood ELSE excluded.mood END,
        theme=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.theme ELSE excluded.theme END,
        est_minutes=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.est_minutes ELSE excluded.est_minutes END,
        collection_id=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.collection_id ELSE excluded.collection_id END,
        daily_featured=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.daily_featured ELSE excluded.daily_featured END,
        added_at=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.added_at ELSE excluded.added_at END,
        updated_at=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.updated_at ELSE excluded.updated_at END,
        album_id=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.album_id ELSE excluded.album_id END,
        album_title=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.album_title ELSE excluded.album_title END,
        access_type=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.access_type ELSE excluded.access_type END,
        tags_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.tags_json ELSE excluded.tags_json END,
        season_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.season_json ELSE excluded.season_json END,
        audience_json=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.audience_json ELSE excluded.audience_json END,
        featured_rank=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.featured_rank ELSE excluded.featured_rank END,
        is_new=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.is_new ELSE excluded.is_new END,
        storage_mode=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.storage_mode ELSE excluded.storage_mode END,
        tile_size=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.tile_size ELSE excluded.tile_size END`;

    let tiledTemplatesPublished = 0;
    let tiledTemplateTilesPublished = 0;

    for (const entry of entries) {
      const runtime = runtimeById.get(entry.id);
      const collection = collectionById.get(entry.collection_id);
      const album = (collection?.albums || []).find((candidate) => candidate.id === entry.album_id);
      const collectionIndex = collections.findIndex((candidate) => candidate.id === entry.collection_id);
      const albumIndex = (collection?.albums || []).findIndex((candidate) => candidate.id === entry.album_id);
      const metadata = runtimeMetadata(entry, collection, album, runtime, collectionIndex, albumIndex);
      const addedAt = entry.added_at || now;
      const existingZoneCount = existingZoneCounts.get(entry.id) || 0;
      const existing = await q.get(`SELECT width,height,palette_json,cells_json,storage_mode,tile_size,catalog_managed
        FROM coloring_templates WHERE id=?`, [entry.id]);
      const catalogManaged = existing?.catalog_managed === true
        || existing?.catalog_managed === 1
        || existing?.catalog_managed === '1';
      const tiled = runtime.storage_mode === 'tiled';
      let tiles = null;
      let gridChanged = !existing;
      if (!catalogManaged) {
        if (tiled) {
          if (typeof loadTiledTiles !== 'function') {
            throw new Error(`CATALOG_TILED_LOADER_MISSING: ${entry.id}`);
          }
          tiles = validatePublisherTiles(runtime, loadTiledTiles(runtime));
          if (existing) {
            existing.tiles = await q.all(`SELECT tile_x,tile_y,width,height,cells_json
              FROM coloring_template_tiles WHERE template_id=? ORDER BY tile_y,tile_x`, [entry.id]);
          }
          gridChanged = !sameTemplateMap(existing, runtime, tiles);
        } else {
          gridChanged = !sameTemplateMap(existing, runtime);
        }
        if (existing && gridChanged && await templateHasProgress(q, entry.id)) {
          const error = new Error(`Catalog grid change would invalidate existing painting progress: ${entry.id}`);
          error.code = 'CATALOG_GRID_CHANGE_WITH_PROGRESS';
          throw error;
        }
        if (existing && gridChanged) await clearStoredGrid(q, entry.id);
      }
      await q.run(templateSql, [
        entry.id, null, entry.title, entry.description || '', entry.category || 'featured', entry.difficulty || 'easy',
        runtime.width, runtime.height, json(runtime.palette), tiled ? json([]) : json(runtime.cells), catalogAssetUrl(entry.preview_asset), null,
        'catalog', 'public', 'active', entry.mood || 'calm', entry.theme || collection?.theme || 'featured', entry.est_minutes || 3,
        metadata.collection_id, metadata.daily_featured, addedAt, now, now, metadata.album_id, metadata.album_title,
        metadata.access_type, metadata.tags_json, metadata.season_json, metadata.audience_json, metadata.featured_rank, metadata.is_new,
        tiled ? 'tiled' : 'legacy', tiled ? Number(runtime.tile_size || 32) : 32,
      ]);

      if (!catalogManaged && tiled) {
        await q.run('DELETE FROM coloring_zones WHERE template_id=?', [entry.id]);
        if (!existing || gridChanged) {
          await insertTemplateTiles(q, entry.id, tiles, now);
          tiledTemplatesPublished += 1;
          tiledTemplateTilesPublished += tiles.length;
        }
      } else if (!catalogManaged && (existingZoneCount === 0 || gridChanged)) {
        for (const [zoneIndex, zone] of buildZones(runtime.width, runtime.height).entries()) {
          await q.run('INSERT INTO coloring_zones (id,template_id,title,cell_indices_json,created_at) VALUES (?,?,?,?,?)',
            [`zone_${entry.id}_${zoneIndex}`, entry.id, zone.title, json(zone.indices), now]);
        }
      }
    }

    const [catalogCount, publishedCollections, publishedAlbums, accessCounts, managedStale] = await Promise.all([
      q.get("SELECT COUNT(*) AS c FROM coloring_templates WHERE source_type='catalog' AND status='active' AND visibility='public'"),
      q.get("SELECT COUNT(*) AS c FROM collections WHERE catalog_scope='merchandising' AND status <> 'archived'"),
      q.get("SELECT COUNT(*) AS c FROM catalog_albums WHERE status='active' AND visibility='public'"),
      q.all("SELECT access_type,COUNT(*) AS c FROM coloring_templates WHERE source_type='catalog' AND status='active' AND visibility='public' GROUP BY access_type"),
      q.get(`SELECT COUNT(*) AS c FROM coloring_templates WHERE source_type='catalog' AND catalog_managed=TRUE AND id NOT IN (${entryIds.map(() => '?').join(',')})`, entryIds),
    ]);
    return {
      manifest_count: counts.colorings,
      manifest_collections: counts.collections,
      manifest_albums: counts.albums,
      manifest_free: counts.free,
      manifest_premium: counts.premium,
      production_catalog_count: numberValue(catalogCount, 'c'),
      production_collections: numberValue(publishedCollections, 'c'),
      production_albums: numberValue(publishedAlbums, 'c'),
      production_free: numberValue(accessCounts.find((row) => row.access_type === 'free'), 'c'),
      production_premium: numberValue(accessCounts.find((row) => row.access_type === 'premium'), 'c'),
      hidden_stale_catalog_rows: numberValue(stale, 'changes'),
      managed_stale_catalog_rows: numberValue(managedStale, 'c'),
      tiled_templates_published: tiledTemplatesPublished,
      tiled_template_tiles_published: tiledTemplateTilesPublished,
      user_progress_touched: false,
      ownership_touched: false,
      stars_semantics_touched: false,
    };
  });
}

export function buildCatalogAssetInventory(catalog = readCanonicalCatalog()) {
  return catalog.assetRecords.map((record) => ({
    ...record,
    absolute_source: join(serviceRoot, record.source_asset),
  }));
}

export function normalizeCatalogAssetInventory(records, assets) {
  if (!Array.isArray(assets)) throw new Error('inventory.assets must be an array');
  const byKey = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset.key !== 'string' || byKey.has(asset.key)) {
      throw new Error('inventory contains an invalid or duplicate asset key');
    }
    byKey.set(asset.key, asset);
  }
  if (byKey.size !== records.length) throw new Error('inventory asset count does not match canonical catalog');
  return records.map((record) => {
    const expected = byKey.get(record.key);
    if (!expected
      || expected.id !== record.id
      || expected.kind !== record.kind
      || expected.source_asset !== record.source_asset
      || !Number.isSafeInteger(Number(expected.bytes))
      || Number(expected.bytes) < 0
      || !/^[a-f0-9]{64}$/i.test(String(expected.sha256 || ''))) {
      throw new Error(`inventory does not match canonical catalog at ${record.key}`);
    }
    return { ...record, bytes: Number(expected.bytes), sha256: String(expected.sha256).toLowerCase() };
  });
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export const catalogConstants = Object.freeze({ EXPECTED_CATALOG_COUNT, EXPECTED_COVER_COUNT });
