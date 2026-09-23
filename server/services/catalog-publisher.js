import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export function readCanonicalCatalog({ manifestPath = defaultManifestPath, runtimePath = defaultRuntimePath } = {}) {
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
    if (!Array.isArray(template.palette) || !Array.isArray(template.cells)) errors.push(`${template.id} runtime payload is missing palette or cells`);
    if (!Number.isInteger(template.width) || !Number.isInteger(template.height)) errors.push(`${template.id} runtime payload has invalid dimensions`);
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
  if (!db?.withDbTransaction || !db?.run || !db?.all) throw new Error('publishCatalog requires database helpers');
  const { entries, collections, coverByParent, collectionById, runtimeById, counts } = catalog;
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
          (id,collection_id,slug,title,description,visibility,status,cover_url,sort_rank,featured,is_new,tags_json,created_at,updated_at)
          VALUES (?,?,?,?,?,'public','active',?,?,?,?,?,?,?)
          ON CONFLICT(id) DO NOTHING`,
        [album.id, collection.id, album.slug || album.id, album.title || album.id, '', coverUrl,
          collectionIndex * 100 + albumIndex * 10, albumEntries.some((entry) => entry.id.endsWith('_01')) ? 1 : 0,
          collection.id.includes('phase2') ? 1 : 0, json([...new Set(albumEntries.flatMap((entry) => entry.tags || []))]), now, now]);
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
       album_id,album_title,access_type,tags_json,season_json,audience_json,featured_rank,is_new)
      VALUES (${Array.from({ length: 31 }, () => '?').join(',')})
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
        is_new=CASE WHEN coloring_templates.catalog_managed THEN coloring_templates.is_new ELSE excluded.is_new END`;

    for (const entry of entries) {
      const runtime = runtimeById.get(entry.id);
      const collection = collectionById.get(entry.collection_id);
      const album = (collection?.albums || []).find((candidate) => candidate.id === entry.album_id);
      const collectionIndex = collections.findIndex((candidate) => candidate.id === entry.collection_id);
      const albumIndex = (collection?.albums || []).findIndex((candidate) => candidate.id === entry.album_id);
      const metadata = runtimeMetadata(entry, collection, album, runtime, collectionIndex, albumIndex);
      const addedAt = entry.added_at || now;
      const existingZoneCount = existingZoneCounts.get(entry.id) || 0;
      await q.run(templateSql, [
        entry.id, null, entry.title, entry.description || '', entry.category || 'featured', entry.difficulty || 'easy',
        runtime.width, runtime.height, json(runtime.palette), json(runtime.cells), catalogAssetUrl(entry.preview_asset), null,
        'catalog', 'public', 'active', entry.mood || 'calm', entry.theme || collection?.theme || 'featured', entry.est_minutes || 3,
        metadata.collection_id, metadata.daily_featured, addedAt, now, now, metadata.album_id, metadata.album_title,
        metadata.access_type, metadata.tags_json, metadata.season_json, metadata.audience_json, metadata.featured_rank, metadata.is_new,
      ]);
      if (existingZoneCount === 0) {
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

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export const catalogConstants = Object.freeze({ EXPECTED_CATALOG_COUNT, EXPECTED_COVER_COUNT });
