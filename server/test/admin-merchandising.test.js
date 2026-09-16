import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createFreshSqliteDbAsync, serverDir } from './helpers/database.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import {
  ADMIN_PERMISSIONS,
  getAdminContext,
  hasAdminPermission,
  normalizePermissionList,
} from '../services/admin-acl.js';
import {
  applyDraft,
  assertDraftPermission,
  normalizeAdminChanges,
  validateDraftAgainstCatalog,
  writeAudit,
} from '../services/admin-merchandising.js';

const MIGRATIONS_DIR = join(serverDir, 'migrations', 'sqlite');
const NOW = '2026-09-16T00:00:00.000Z';

async function createDb() {
  const db = await createFreshSqliteDbAsync();
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: MIGRATIONS_DIR });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    for (const [id, telegramId, nickname] of [
      ['u_owner', 700001, 'Owner'],
      ['u_merch', 700002, 'Merch'],
      ['u_viewer', 700003, 'Viewer'],
    ]) {
      await tx.run(
        `INSERT INTO users (id,telegram_id,nickname,role,created_at,updated_at)
         VALUES (?,?,?,'user',?,?)`,
        [id, telegramId, nickname, NOW, NOW],
      );
    }

    for (const [id, title, packType, price, status, visibility] of [
      ['col_blockbound-worlds', 'Blockbound Worlds', 'free', 0, 'published', 'public'],
      ['col_premium-gallery', 'Premium Gallery', 'premium', 120, 'published', 'public'],
      ['col_other', 'Other', 'free', 0, 'published', 'public'],
    ]) {
      await tx.run(
        `INSERT INTO collections
          (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description,
           catalog_scope,catalog_slug,catalog_theme,catalog_mood,catalog_tags_json,catalog_rank,catalog_cover_url,catalog_managed)
         VALUES (?,?,?,'common',1,?,NULL,NULL,?,?,?,'merchandising',?,?,?,'[]',1,NULL,0)`,
        [id, title, packType, price, status, visibility, '', id.replace(/^col_/, ''), 'featured', 'calm'],
      );
    }

    await tx.run(
      `INSERT INTO catalog_albums
        (id,collection_id,slug,title,description,visibility,status,cover_url,sort_rank,featured,is_new,tags_json,created_at,updated_at)
       VALUES ('alb_blockbound-main','col_blockbound-worlds','main','Main Album','', 'public','active',NULL,1,0,0,'[]',?,?)`,
      [NOW, NOW],
    );
    await tx.run(
      `INSERT INTO catalog_albums
        (id,collection_id,slug,title,description,visibility,status,cover_url,sort_rank,featured,is_new,tags_json,created_at,updated_at)
       VALUES ('alb_blockbound-other','col_blockbound-worlds','other','Other Album','', 'public','active',NULL,2,0,0,'[]',?,?)`,
      [NOW, NOW],
    );
    await tx.run(
      `INSERT INTO coloring_templates
        (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,
         source_type,visibility,status,created_at,updated_at,collection_id,album_id,album_title,access_type,tags_json,season_json,audience_json,featured_rank,is_new,catalog_managed)
       VALUES ('tpl_admin','u_owner','Admin Coloring','', 'featured','easy',8,8,'["#000000","#ffffff"]','[]',NULL,NULL,
         'catalog','public','active',?,?, 'col_blockbound-worlds','alb_blockbound-main','Main Album','free','[]','[]','[]',1,0,0)`,
      [NOW, NOW],
    );
    await tx.run(
      `INSERT INTO catalog_shelves
        (id,title,description,filter_json,status,sort_rank,cover_url,created_at,updated_at)
       VALUES ('shelf_main','Main Shelf','', '{}','active',1,NULL,?,?)`,
      [NOW, NOW],
    );
    await tx.run(
      `INSERT INTO catalog_product_prices (product_id,price_xtr,price_version,updated_at)
       VALUES ('col_premium-gallery',120,1,?)`,
      [NOW],
    );
    await tx.run(
      `INSERT INTO admin_acl (user_id,role,permissions_json,created_at,updated_at)
       VALUES ('u_owner','owner',?,?,?)`,
      [JSON.stringify(ADMIN_PERMISSIONS), NOW, NOW],
    );
    await tx.run(
      `INSERT INTO admin_acl (user_id,role,permissions_json,created_at,updated_at)
       VALUES ('u_merch','admin',?,?,?)`,
      [JSON.stringify(['catalog.read', 'merchandising.write', 'collection.write', 'album.write']), NOW, NOW],
    );
  });

  return db;
}

test('admin ACL is server-derived and owner receives the complete permission set', async () => {
  const db = await createDb();
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const owner = await getAdminContext('u_owner', { dbGet: (sql, params) => tx.get(sql, params) });
    const merch = await getAdminContext('u_merch', { dbGet: (sql, params) => tx.get(sql, params) });
    const viewer = await getAdminContext('u_viewer', { dbGet: (sql, params) => tx.get(sql, params) });

    assert.deepEqual(owner.permissions, ADMIN_PERMISSIONS);
    assert.equal(hasAdminPermission(owner, 'admin.manage'), true);
    assert.equal(hasAdminPermission(merch, 'collection.write'), true);
    assert.equal(hasAdminPermission(merch, 'pricing.write'), false);
    assert.equal(viewer, null);
    assert.equal(normalizePermissionList(['catalog.read', 'catalog.read']), null);
    assert.equal(normalizePermissionList(['catalog.read', 'pricing.write']).length, 2);
  });
});

test('admin input rejects identity and content payload tampering', async () => {
  assert.throws(
    () => normalizeAdminChanges('coloring', { id: 'other', cells_json: '[]' }),
    (error) => error.code === 'ADMIN_FIELD_FORBIDDEN',
  );
  assert.throws(
    () => normalizeAdminChanges('product', { price_xtr: 0 }),
    (error) => error.code === 'ADMIN_INVALID_INPUT',
  );
  const db = await createDb();
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const changes = normalizeAdminChanges('collection', { catalog_cover_url: 'https://external.example/cover.png' });
    await assert.rejects(
      () => validateDraftAgainstCatalog(tx, 'collection', 'col_blockbound-worlds', changes),
      (error) => error.code === 'ADMIN_INVALID_COVER',
    );
  });
});

test('merchandising validates references, applies changes, and writes append-only audit evidence', async () => {
  const db = await createDb();
  const actor = { userId: 'u_owner', telegramId: '700001', role: 'owner' };

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const changes = normalizeAdminChanges('collection', {
      title: 'Blockbound Worlds — Curated',
      catalog_tags: ['voxel', 'featured'],
    });
    const owner = await getAdminContext('u_owner', { dbGet: (sql, params) => tx.get(sql, params) });
    assert.doesNotThrow(() => assertDraftPermission(owner, 'collection', changes, hasAdminPermission));

    const applied = await applyDraft(tx, {
      entityType: 'collection',
      entityId: 'col_blockbound-worlds',
      changes,
      actor,
    });
    await writeAudit(tx, {
      actor,
      action: 'merchandising.publish',
      entityType: 'collection',
      entityId: 'col_blockbound-worlds',
      before: applied.before,
      after: applied.after,
      correlationId: applied.audit.correlationId,
    });

    const collection = await tx.get('SELECT title,catalog_managed,catalog_tags_json FROM collections WHERE id=?', ['col_blockbound-worlds']);
    assert.equal(collection.title, 'Blockbound Worlds — Curated');
    assert.equal(Number(collection.catalog_managed), 1);
    assert.deepEqual(JSON.parse(collection.catalog_tags_json), ['voxel', 'featured']);
    assert.equal((await tx.get('SELECT COUNT(*) AS c FROM admin_audit_log')).c, 1);
    assert.throws(
      () => tx.run('UPDATE admin_audit_log SET action=?', ['tampered']),
      /append-only/,
    );
  });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await assert.rejects(
      () => validateDraftAgainstCatalog(tx, 'album', 'alb_blockbound-main', { slug: 'other' }),
      (error) => error.code === 'ADMIN_DUPLICATE_SLUG',
    );
    await assert.rejects(
      () => validateDraftAgainstCatalog(tx, 'coloring', 'tpl_admin', { album_id: 'alb_missing' }),
      (error) => error.code === 'ADMIN_BROKEN_REFERENCE',
    );
  });
});

test('admin pricing increments price version and preserves the product snapshot boundary', async () => {
  const db = await createDb();
  const actor = { userId: 'u_owner', telegramId: '700001', role: 'owner' };

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const changes = normalizeAdminChanges('product', { price_xtr: 150 });
    const applied = await applyDraft(tx, {
      entityType: 'product',
      entityId: 'col_premium-gallery',
      changes,
      actor,
    });
    assert.equal(applied.before.price_xtr, 120);
    assert.equal(applied.after.price_xtr, 150);
    assert.equal(applied.after.price_version, 2);

    const price = await tx.get('SELECT price_xtr,price_version FROM catalog_product_prices WHERE product_id=?', ['col_premium-gallery']);
    const collection = await tx.get('SELECT price_in_stars FROM collections WHERE id=?', ['col_premium-gallery']);
    assert.deepEqual({ price_xtr: Number(price.price_xtr), price_version: Number(price.price_version) }, { price_xtr: 150, price_version: 2 });
    assert.equal(Number(collection.price_in_stars), 150);
  });
});
