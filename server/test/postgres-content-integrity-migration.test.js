import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(serverDir, 'migrations');

function migrationSql(version, name) {
  return readFileSync(join(migrationsDir, `${version}_${name}.sql`), 'utf8')
    .replace(/^\s*BEGIN\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;?\s*$/i, '');
}

async function count(pool, table) {
  return Number((await pool.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count);
}

test('PostgreSQL migration 006 rehearses legacy content without record loss', { skip: !databaseUrl }, async (t) => {
  const pg = (await import('pg')).default;
  const schema = `content_rehearsal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path="${schema}",public`,
  });

  t.after(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  for (const [version, name] of [
    ['001', 'initial'],
    ['002', 'meta'],
    ['003', 'auth_roles'],
    ['004', 'database_safety'],
    ['005', 'stars_transactions'],
  ]) {
    await pool.query(migrationSql(version, name));
  }

  const now = new Date().toISOString();
  await pool.query(`INSERT INTO users (id,nickname,created_at,updated_at)
    VALUES ('owner','Owner',$1,$1),('reporter','Reporter',$1,$1)`, [now]);
  await pool.query(`INSERT INTO collections (id,title,pack_type,price_in_stars)
    VALUES ('col_real','Real','free',0),('shared_id','Shared collection','free',0)`);
  await pool.query(`INSERT INTO coloring_templates
    (id,title,width,height,palette_json,cells_json,collection_id,created_at,updated_at)
    VALUES
    ('tmpl_legacy','Legacy',8,8,'[]','[]','col_real',$1,$1),
    ('shared_id','Colliding template',8,8,'[]','[]','col_real',$1,$1)`, [now]);

  await pool.query(`INSERT INTO artworks
    (id,owner_id,source_type,title,collection_id,is_completed,created_at,updated_at)
    VALUES
    ('legacy_coloring','owner','coloring','Legacy coloring','tmpl_legacy',1,$1,$1),
    ('collision_collection','owner','collection','Purchased collection','shared_id',1,$1,$1),
    ('orphan_collection','owner','collection','Orphan','missing_collection',1,$1,$1),
    ('user_artwork','owner','user','User artwork',NULL,1,$1,$1)`, [now]);

  await pool.query(`INSERT INTO posts
    (id,author_id,post_type,title,status,published_at,created_at,updated_at)
    VALUES
    ('hidden_post','owner','user_art','Hidden','hidden',$1,$1,$1),
    ('deleted_post','owner','user_art','Deleted','deleted',$1,$1,$1)`, [now]);
  await pool.query(`INSERT INTO comments
    (id,post_id,author_id,text,status,created_at,updated_at)
    VALUES
    ('hidden_comment','hidden_post','reporter','hidden','hidden',$1,$1),
    ('deleted_comment','deleted_post','reporter','deleted','deleted',$1,$1)`, [now]);
  await pool.query(`INSERT INTO reports
    (id,reporter_id,target_type,target_id,reason,status,created_at)
    VALUES
    ('report_old','reporter','post','hidden_post','other','pending',$1),
    ('report_new','reporter','post','hidden_post','spam','pending',$2)`,
    [new Date(Date.now() - 1_000).toISOString(), now]);

  const before = {
    artworks: await count(pool, 'artworks'),
    posts: await count(pool, 'posts'),
    comments: await count(pool, 'comments'),
    reports: await count(pool, 'reports'),
    ownerships: await count(pool, 'collection_ownerships'),
  };

  await pool.query(migrationSql('006', 'content_integrity'));

  const after = {
    artworks: await count(pool, 'artworks'),
    posts: await count(pool, 'posts'),
    comments: await count(pool, 'comments'),
    reports: await count(pool, 'reports'),
    ownerships: await count(pool, 'collection_ownerships'),
  };

  assert.deepStrictEqual(
    { artworks: after.artworks, posts: after.posts, comments: after.comments },
    { artworks: before.artworks, posts: before.posts, comments: before.comments },
    'Content records must not disappear during backfill',
  );
  assert.equal(before.reports, 2);
  assert.equal(after.reports, 1, 'Only duplicate reports are intentionally deduplicated');
  assert.equal(before.ownerships, 0);
  assert.equal(after.ownerships, 2);

  const rows = await pool.query('SELECT id,template_id,collection_id FROM artworks ORDER BY id');
  const artworks = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
  assert.deepStrictEqual(
    { template_id: artworks.legacy_coloring.template_id, collection_id: artworks.legacy_coloring.collection_id },
    { template_id: 'tmpl_legacy', collection_id: 'col_real' },
  );
  assert.deepStrictEqual(
    { template_id: artworks.collision_collection.template_id, collection_id: artworks.collision_collection.collection_id },
    { template_id: null, collection_id: 'shared_id' },
    'A collection artwork must survive an id collision with a template',
  );
  assert.equal(artworks.orphan_collection.collection_id, null);
  assert.equal(artworks.user_artwork.template_id, null);
  assert.equal(artworks.user_artwork.collection_id, null);

  const invariants = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE a.template_id IS NOT NULL AND t.id IS NULL) AS orphan_templates,
      COUNT(*) FILTER (WHERE a.collection_id IS NOT NULL AND c.id IS NULL) AS orphan_collections
    FROM artworks a
    LEFT JOIN coloring_templates t ON t.id=a.template_id
    LEFT JOIN collections c ON c.id=a.collection_id
  `);
  assert.equal(Number(invariants.rows[0].orphan_templates), 0);
  assert.equal(Number(invariants.rows[0].orphan_collections), 0);

  const constraints = await pool.query(`
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conrelid='artworks'::regclass
      AND conname IN ('artworks_template_id_fkey','artworks_collection_id_fkey')
    ORDER BY conname
  `);
  assert.deepStrictEqual(
    constraints.rows,
    [
      { conname: 'artworks_collection_id_fkey', convalidated: true },
      { conname: 'artworks_template_id_fkey', convalidated: true },
    ],
  );

  await assert.rejects(
    pool.query(`INSERT INTO artworks
      (id,owner_id,source_type,title,template_id,is_completed,created_at,updated_at)
      VALUES ('bad_fk','owner','coloring','Bad','missing_template',1,$1,$1)`, [now]),
    /foreign key/i,
  );
});
