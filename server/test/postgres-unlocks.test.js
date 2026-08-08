import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL unlock semantics skipped (no DATABASE_URL)', { skip: true }, () => {});
}

test('PostgreSQL concurrent first unlock grants one entitlement and one ownership', { skip: !databaseUrl }, async (t) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { withTransaction } = await import('../database/transaction.js');
  const unlocks = await import('../services/unlock-service.js');

  const runId = `pgunlock_${Date.now()}`;
  const userId = `${runId}_user`;
  const collectionId = `${runId}_col`;
  const collectionTemplate = `${runId}_tpl_col`;
  const badgeTemplate = `${runId}_tpl_badge`;
  const now = '2026-08-07T10:00:00.000Z';

  t.after(async () => {
    try {
      await pool.query('DELETE FROM template_entitlements WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM collection_ownerships WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM user_achievements WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM artworks WHERE owner_id=$1', [userId]);
      await pool.query('DELETE FROM daily_streaks WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM unlock_rules WHERE subject_id LIKE $1', [`${runId}%`]);
      await pool.query('DELETE FROM coloring_templates WHERE id = ANY($1::text[])', [[collectionTemplate, badgeTemplate, collectionId]]);
      await pool.query('DELETE FROM collections WHERE id=$1', [collectionId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } catch { /* best-effort cleanup */ }
    await pool.end();
  });

  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,level,xp_total,created_at,updated_at)
      VALUES (?,?, 'user', 2, 1000, ?, ?)`, [userId, 'Postgres Unlock', now, now]);
    await tx.run(`INSERT INTO collections
      (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
      VALUES (?,?, 'free', 'common', 1, 0, NULL, NULL, 'published', 'public', '')`,
    [collectionId, collectionId]);
    for (const [id, theme, collection] of [[collectionTemplate, 'night-city', collectionId], [badgeTemplate, 'featured', null]]) {
      await tx.run(`INSERT INTO coloring_templates
        (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
        VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, ?, ?)`,
      [id, null, id, id, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now, now, theme, collection]);
    }
    await tx.run(`INSERT INTO unlock_rules (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
      VALUES ('collection', ?, 'level', '2', 1, ?)`, [collectionId, now]);
    await tx.run(`INSERT INTO unlock_rules (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
      VALUES ('template', ?, 'level', '2', 1, ?)`, [badgeTemplate, now]);
  });

  const results = await Promise.all([
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await unlocks.assertTemplateAccessible(tx, userId, { id: collectionTemplate, owner_id: null, collection_id: collectionId }, { grant: true, now });
      await unlocks.assertTemplateAccessible(tx, userId, { id: badgeTemplate, owner_id: null, collection_id: null }, { grant: true, now });
    }),
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await unlocks.assertTemplateAccessible(tx, userId, { id: collectionTemplate, owner_id: null, collection_id: collectionId }, { grant: true, now });
      await unlocks.assertTemplateAccessible(tx, userId, { id: badgeTemplate, owner_id: null, collection_id: null }, { grant: true, now });
    }),
  ]);
  assert.equal(results.length, 2);

  const ownership = await pool.query(
    'SELECT COUNT(*) AS c FROM collection_ownerships WHERE user_id=$1',
    [userId],
  );
  const entitlement = await pool.query(
    'SELECT COUNT(*) AS c FROM template_entitlements WHERE user_id=$1',
    [userId],
  );
  assert.equal(Number(ownership.rows[0].c), 1, 'concurrent PostgreSQL collection grant collapses to one row');
  assert.equal(Number(entitlement.rows[0].c), 1, 'concurrent PostgreSQL template grant collapses to one row');
});

test('PostgreSQL progression never grants premium content, even concurrently', { skip: !databaseUrl }, async (t) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { withTransaction } = await import('../database/transaction.js');
  const unlocks = await import('../services/unlock-service.js');

  const runId = `pgprem_${Date.now()}`;
  const userId = `${runId}_user`;
  const collectionId = `${runId}_col`;
  const templateId = `${runId}_tpl`;
  const now = '2026-08-07T10:00:00.000Z';

  t.after(async () => {
    try {
      await pool.query('DELETE FROM template_entitlements WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM collection_ownerships WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM artworks WHERE owner_id=$1', [userId]);
      await pool.query('DELETE FROM unlock_rules WHERE subject_id LIKE $1', [`${runId}%`]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM collections WHERE id=$1', [collectionId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } catch { /* best-effort cleanup */ }
    await pool.end();
  });

  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,level,xp_total,created_at,updated_at)
      VALUES (?,?, 'user', 99, 99000, ?, ?)`, [userId, 'Postgres Premium', now, now]);
    await tx.run(`INSERT INTO collections
      (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
      VALUES (?,?, 'premium', 'epic', 1, 50, NULL, NULL, 'published', 'public', '')`,
    [collectionId, collectionId]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
      VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, 'space', ?)`,
    [templateId, null, templateId, templateId, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now, now, collectionId]);
  });

  const states = await Promise.all([
    withTransaction({ mode: 'postgres', pool }, async (tx) => unlocks.assertTemplateAccessible(tx, userId, { id: templateId, owner_id: null, collection_id: collectionId }, { grant: true, now })),
    withTransaction({ mode: 'postgres', pool }, async (tx) => unlocks.assertTemplateAccessible(tx, userId, { id: templateId, owner_id: null, collection_id: collectionId }, { grant: true, now })),
  ]);
  assert.ok(states.every((state) => state.locked && state.state === 'premium_locked'));

  const ownership = await pool.query(
    'SELECT COUNT(*) AS c FROM collection_ownerships WHERE user_id=$1',
    [userId],
  );
  const entitlement = await pool.query(
    'SELECT COUNT(*) AS c FROM template_entitlements WHERE user_id=$1',
    [userId],
  );
  assert.equal(Number(ownership.rows[0].c), 0, 'premium ownership is never created by progression');
  assert.equal(Number(entitlement.rows[0].c), 0, 'premium template entitlement is never created by progression');
});
