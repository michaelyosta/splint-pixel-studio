import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createFreshSqliteDbAsync, serverDir } from './helpers/database.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import {
  assertCollectionAccessible,
  assertTemplateAccessible,
  attachUnlockFlags,
  getCollectionUnlockState,
  getNextActionableUnlocks,
  getTemplateUnlockState,
  getUserUnlockSnapshot,
  grantCollectionUnlock,
  grantTemplateUnlock,
  STATE_AVAILABLE,
  STATE_OWNED,
  STATE_PREMIUM_LOCKED,
  STATE_PROGRESSION_LOCKED,
} from '../services/unlock-service.js';

const MIGRATIONS_DIR = join(serverDir, 'migrations', 'sqlite');
const NOW = '2026-08-07T10:00:00.000Z';

async function createDb() {
  const db = await createFreshSqliteDbAsync();
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: MIGRATIONS_DIR });
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const users = ['u_free', 'u_locked', 'u_eligible', 'u_concurrent', 'u_premium', 'u_snapshot', 'u_boundary'];
    for (const userId of users) {
      await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
        VALUES (?,?, 'user', ?, ?)`, [userId, userId, NOW, NOW]);
    }
    await tx.run(`INSERT INTO achievements (id,title,description,category,icon,rarity,created_at)
      VALUES ('ach_first_zone','Первая зона','Описание','ritual','star','common',?)`, [NOW]);
  });
  return db;
}

async function insertCollection(db, id, { packType = 'free', price = 0 } = {}) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO collections
      (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
      VALUES (?,?,?, 'common', 1, ?, NULL, NULL, 'published', 'public', '')`,
    [id, id, packType, price]);
  });
  return id;
}

async function insertTemplate(db, id, { collectionId = null, ownerId = null, hidden = false } = {}) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const cells = JSON.stringify(Array(64).fill(0));
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
      VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, NULL, NULL, 'catalog', 'public', ?, ?, ?, 'legacy', 32, 'featured', ?)`,
    [id, ownerId, id, id, JSON.stringify(['#000000', '#ffffff']), cells, hidden ? 'hidden' : 'active', NOW, NOW, collectionId]);
  });
  return id;
}

async function insertRule(db, subjectType, subjectId, ruleType, targetValue, order = 1) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO unlock_rules
      (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
      VALUES (?,?,?,?,?,?)`,
    [subjectType, subjectId, ruleType, targetValue, order, NOW]);
  });
}

async function setFacts(db, userId, { level = 1, xp = 0, streak = 0, achievements = [], completedArtworks = [] } = {}) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run('UPDATE users SET level=?, xp_total=? WHERE id=?', [level, xp, userId]);
    if (streak > 0) {
      await tx.run(`INSERT INTO daily_streaks
        (user_id,current_streak,longest_streak,total_days,last_active_date,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT (user_id) DO UPDATE SET
          current_streak=excluded.current_streak,
          longest_streak=excluded.longest_streak,
          total_days=excluded.total_days,
          last_active_date=excluded.last_active_date,
          updated_at=excluded.updated_at`,
      [userId, streak, streak, streak, '2026-08-07', NOW, NOW]);
    }
    for (const achievementId of achievements) {
      await tx.run(`INSERT INTO user_achievements (user_id,achievement_id,unlocked_at)
        VALUES (?,?,?) ON CONFLICT (user_id,achievement_id) DO NOTHING`, [userId, achievementId, NOW]);
    }
    for (let index = 0; index < completedArtworks.length; index += 1) {
      const templateId = completedArtworks[index];
      const collectionId = typeof templateId === 'object' ? templateId.collectionId : null;
      const id = typeof templateId === 'object' ? templateId.id : templateId;
      await tx.run(`INSERT INTO artworks
        (id,owner_id,source_type,image_url,title,template_id,collection_id,is_completed,created_at,updated_at)
        VALUES (?,?, 'coloring', '/media/x.png', ?, ?, ?, 1, ?, ?)
        ON CONFLICT (id) DO NOTHING`,
      [`art_${userId}_${id}_${index}`, userId, `${id}_${index}`, id, collectionId, NOW, NOW]);
    }
  });
}

async function countRows(db, sql, params = []) {
  let result;
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    result = await tx.get(`SELECT COUNT(*) AS c FROM (${sql})`, params);
  });
  return Number(result?.c || 0);
}

function templateRow(id, collectionId = null) {
  return { id, owner_id: null, title: id, collection_id: collectionId };
}

test('free templates stay available and premium content stays purchase-only', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_free');
  await insertCollection(db, 'col_premium', { packType: 'premium', price: 50 });
  await insertTemplate(db, 'tpl_premium', { collectionId: 'col_premium' });
  await setFacts(db, 'u_premium', { level: 99, xp: 999_999, streak: 30, completedArtworks: ['tpl_free'] });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const free = await getTemplateUnlockState(tx, 'u_free', templateRow('tpl_free'));
    assert.equal(free.state, STATE_AVAILABLE);
    assert.equal(free.locked, false);
    assert.equal(free.owned, false);

    const premium = await getTemplateUnlockState(tx, 'u_premium', templateRow('tpl_premium', 'col_premium'));
    assert.equal(premium.state, STATE_PREMIUM_LOCKED);
    assert.equal(premium.locked, true);
    assert.equal(premium.reason_code, 'PREMIUM_REQUIRED');

    const collectionGrant = await grantCollectionUnlock(tx, 'u_premium', 'col_premium', { now: NOW });
    assert.equal(collectionGrant.granted, false, 'progression can never grant a premium collection');
    const templateGrant = await grantTemplateUnlock(tx, 'u_premium', 'tpl_premium', { now: NOW });
    assert.equal(templateGrant.granted, false, 'premium templates are never granted by progression');
    const enforced = await assertTemplateAccessible(tx, 'u_premium', templateRow('tpl_premium', 'col_premium'), { grant: true });
    assert.equal(enforced.locked, true, 'read/start enforcement rejects premium content');
    assert.equal(enforced.state, STATE_PREMIUM_LOCKED);
  });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO collection_ownerships
      (user_id,collection_id,acquisition_type,price_paid,stars_operation_id,created_at)
      VALUES (?,?, 'premium', 50, NULL, ?)`, ['u_premium', 'col_premium', NOW]);
    const owned = await getTemplateUnlockState(tx, 'u_premium', templateRow('tpl_premium', 'col_premium'));
    assert.equal(owned.state, STATE_OWNED);
    assert.equal(owned.owned, true);
  });
});

test('all rule types enforce exact boundaries and report progress', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_level');
  await insertTemplate(db, 'tpl_xp');
  await insertTemplate(db, 'tpl_achievement');
  await insertTemplate(db, 'tpl_streak');
  await insertTemplate(db, 'tpl_completions');
  await insertCollection(db, 'col_base');
  await insertTemplate(db, 'tpl_base_1', { collectionId: 'col_base' });
  await insertTemplate(db, 'tpl_base_2', { collectionId: 'col_base' });
  await insertTemplate(db, 'tpl_base_3', { collectionId: 'col_base' });
  await insertCollection(db, 'col_after');
  await insertTemplate(db, 'tpl_after', { collectionId: 'col_after' });

  await insertRule(db, 'template', 'tpl_level', 'level', '2');
  await insertRule(db, 'template', 'tpl_xp', 'xp', '1000');
  await insertRule(db, 'template', 'tpl_achievement', 'achievement', 'ach_first_zone');
  await insertRule(db, 'template', 'tpl_streak', 'streak', '3');
  await insertRule(db, 'template', 'tpl_completions', 'completed_artworks', '2');
  await insertRule(db, 'collection', 'col_after', 'collection_completion', 'col_base');

  await setFacts(db, 'u_boundary', {
    level: 1,
    xp: 999,
    streak: 2,
    completedArtworks: ['tpl_level'],
  });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const level = await getTemplateUnlockState(tx, 'u_boundary', templateRow('tpl_level'));
    assert.equal(level.state, STATE_PROGRESSION_LOCKED);
    assert.equal(level.requirements[0].target, 2);
    assert.equal(level.requirements[0].current, 1);
    assert.equal(level.requirements[0].progress, 0.5);
    assert.equal(level.requirements[0].reason_code, 'LEVEL_REQUIRED');

    const xp = await getTemplateUnlockState(tx, 'u_boundary', templateRow('tpl_xp'));
    assert.equal(xp.requirements[0].reason_code, 'XP_REQUIRED');
    assert.equal(xp.requirements[0].satisfied, false);
    const achievement = await getTemplateUnlockState(tx, 'u_boundary', templateRow('tpl_achievement'));
    assert.equal(achievement.requirements[0].reason_code, 'ACHIEVEMENT_REQUIRED');
    const streak = await getTemplateUnlockState(tx, 'u_boundary', templateRow('tpl_streak'));
    assert.equal(streak.requirements[0].reason_code, 'STREAK_REQUIRED');
    const completions = await getTemplateUnlockState(tx, 'u_boundary', templateRow('tpl_completions'));
    assert.equal(completions.requirements[0].reason_code, 'COMPLETIONS_REQUIRED');
    assert.equal(completions.requirements[0].current, 1);

    const collection = await getCollectionUnlockState(tx, 'u_boundary', { id: 'col_after', title: 'after', pack_type: 'free', price_in_stars: 0 });
    assert.equal(collection.state, STATE_PROGRESSION_LOCKED);
    assert.equal(collection.requirements[0].reason_code, 'COLLECTION_REQUIRED');
    assert.equal(collection.requirements[0].collection_total, 3);
    assert.equal(collection.requirements[0].current, 0);
    assert.equal(collection.requirements[0].progress, 0);
  });

  await setFacts(db, 'u_boundary', {
    level: 2,
    xp: 1_000,
    streak: 3,
    achievements: ['ach_first_zone'],
    completedArtworks: [
      'tpl_level',
      'tpl_xp',
      { id: 'tpl_base_1', collectionId: 'col_base' },
      { id: 'tpl_base_2', collectionId: 'col_base' },
      { id: 'tpl_base_3', collectionId: 'col_base' },
    ],
  });
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    for (const id of ['tpl_level', 'tpl_xp', 'tpl_achievement', 'tpl_streak', 'tpl_completions']) {
      const state = await getTemplateUnlockState(tx, 'u_boundary', templateRow(id));
      assert.equal(state.state, STATE_AVAILABLE, `${id} becomes unlockable at the boundary`);
      assert.equal(state.grant_required, true);
    }
    const collection = await getCollectionUnlockState(tx, 'u_boundary', { id: 'col_after', title: 'after', pack_type: 'free', price_in_stars: 0 });
    assert.equal(collection.state, STATE_AVAILABLE, 'completed base collection unlocks the next one');
    assert.equal(collection.requirements[0].satisfied, true);
  });
});

test('old eligible users are backfilled lazily on first access, never on replay', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_free');
  await insertCollection(db, 'col_starter', { packType: 'free' });
  await insertTemplate(db, 'tpl_starter', { collectionId: 'col_starter' });
  await insertRule(db, 'collection', 'col_starter', 'level', '2');
  await insertTemplate(db, 'tpl_badge');
  await insertRule(db, 'template', 'tpl_badge', 'streak', '3');

  await setFacts(db, 'u_eligible', { level: 2, streak: 5, completedArtworks: ['tpl_free'] });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const before = await getTemplateUnlockState(tx, 'u_eligible', templateRow('tpl_starter', 'col_starter'));
    assert.equal(before.state, STATE_AVAILABLE);
    assert.equal(before.grant_required, true, 'satisfied old users are unlock_ready without materialization');

    const first = await assertTemplateAccessible(tx, 'u_eligible', templateRow('tpl_starter', 'col_starter'), { grant: true, now: NOW });
    assert.equal(first.state, STATE_OWNED);
    assert.equal(first.granted, true);

    const replay = await assertTemplateAccessible(tx, 'u_eligible', templateRow('tpl_starter', 'col_starter'), { grant: true, now: NOW });
    assert.equal(replay.state, STATE_OWNED);
    assert.equal(replay.granted, false, 'replay cannot double grant');

    const badgeFirst = await assertTemplateAccessible(tx, 'u_eligible', templateRow('tpl_badge'), { grant: true, now: NOW });
    assert.equal(badgeFirst.granted, true);
    const badgeReplay = await assertTemplateAccessible(tx, 'u_eligible', templateRow('tpl_badge'), { grant: true, now: NOW });
    assert.equal(badgeReplay.granted, false);
  });

  assert.equal(await countRows(db, 'SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', ['u_eligible', 'col_starter']), 1);
  assert.equal(await countRows(db, 'SELECT * FROM template_entitlements WHERE user_id=? AND template_id=?', ['u_eligible', 'tpl_badge']), 1);
});

test('concurrent first unlock on SQLite collapses to one entitlement and ownership', async () => {
  const db = await createDb();
  await insertCollection(db, 'col_concurrent', { packType: 'free' });
  await insertTemplate(db, 'tpl_concurrent', { collectionId: 'col_concurrent' });
  await insertRule(db, 'collection', 'col_concurrent', 'level', '2');
  await insertTemplate(db, 'tpl_concurrent_badge');
  await insertRule(db, 'template', 'tpl_concurrent_badge', 'achievement', 'ach_first_zone');
  await setFacts(db, 'u_concurrent', {
    level: 2,
    achievements: ['ach_first_zone'],
  });

  const results = await Promise.all([
    withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
      await assertTemplateAccessible(tx, 'u_concurrent', templateRow('tpl_concurrent', 'col_concurrent'), { grant: true, now: NOW });
      await assertTemplateAccessible(tx, 'u_concurrent', templateRow('tpl_concurrent_badge'), { grant: true, now: NOW });
    }),
    withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
      await assertTemplateAccessible(tx, 'u_concurrent', templateRow('tpl_concurrent', 'col_concurrent'), { grant: true, now: NOW });
      await assertTemplateAccessible(tx, 'u_concurrent', templateRow('tpl_concurrent_badge'), { grant: true, now: NOW });
    }),
  ]);
  assert.equal(results.length, 2);

  assert.equal(await countRows(db, 'SELECT * FROM collection_ownerships WHERE user_id=? AND collection_id=?', ['u_concurrent', 'col_concurrent']), 1);
  assert.equal(await countRows(db, 'SELECT * FROM template_entitlements WHERE user_id=? AND template_id=?', ['u_concurrent', 'tpl_concurrent_badge']), 1);
});

test('snapshot, next actionable, and batch flags stay bounded and deterministic', async () => {
  const db = await createDb();
  await insertCollection(db, 'col_starter', { packType: 'free' });
  await insertTemplate(db, 'tpl_starter', { collectionId: 'col_starter' });
  await insertRule(db, 'collection', 'col_starter', 'level', '2');
  await insertCollection(db, 'col_premium', { packType: 'premium', price: 50 });
  await insertTemplate(db, 'tpl_premium', { collectionId: 'col_premium' });
  await insertTemplate(db, 'tpl_badge');
  await insertRule(db, 'template', 'tpl_badge', 'streak', '3');
  await insertTemplate(db, 'tpl_hidden', { hidden: true });
  await insertRule(db, 'template', 'tpl_hidden', 'level', '5');

  await setFacts(db, 'u_snapshot', { level: 1, completedArtworks: ['tpl_badge'] });
  const snapshot = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, (tx) => getUserUnlockSnapshot(tx, 'u_snapshot'));

  assert.equal(snapshot.user_id, 'u_snapshot');
  assert.equal(snapshot.summary.total_subjects, 5);
  assert.equal(snapshot.summary.premium_locked, 2);
  assert.ok(snapshot.next_actionable.length >= 2, 'progression subjects are actionable');
  assert.equal(snapshot.next_actionable[0].subject_type, 'collection');
  assert.equal(snapshot.next_actionable[0].subject_id, 'col_starter', 'highest progress ratio ranks first');
  assert.ok(snapshot.next_actionable.every((item) => item.reason_code === 'PROGRESSION_REQUIRED' || item.reason_code === 'UNLOCK_READY'));
  const badge = snapshot.templates.find((item) => item.subject_id === 'tpl_badge');
  assert.equal(badge.state, STATE_PROGRESSION_LOCKED);
  assert.equal(badge.requirements[0].reason_code, 'STREAK_REQUIRED');
  const premium = snapshot.collections.find((item) => item.subject_id === 'col_premium');
  assert.equal(premium.state, STATE_PREMIUM_LOCKED);

  const next = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, (tx) => getNextActionableUnlocks(tx, 'u_snapshot', { limit: 5 }));
  assert.ok(next.length <= 5);
  assert.deepEqual(next.map((item) => item.subject_id).sort(), ['col_starter', 'tpl_badge', 'tpl_hidden']);

  const flagged = await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const rows = await tx.all("SELECT id, title, owner_id, collection_id FROM coloring_templates WHERE id IN ('tpl_starter','tpl_premium','tpl_badge','tpl_hidden')");
    return attachUnlockFlags(tx, rows, 'u_snapshot');
  });
  const byId = new Map(flagged.map((row) => [row.id, row]));
  assert.equal(byId.get('tpl_starter').unlock_state, STATE_PROGRESSION_LOCKED);
  assert.equal(byId.get('tpl_premium').unlock_state, STATE_PREMIUM_LOCKED);
  assert.equal(byId.get('tpl_badge').unlock_state, STATE_PROGRESSION_LOCKED);
  assert.equal(byId.get('tpl_hidden').unlock_state, STATE_PROGRESSION_LOCKED, 'hidden rows still evaluate their rules');
  assert.ok(flagged.every((row) => !Object.hasOwn(row, 'cells_json')), 'no cell payloads are attached');
  assert.ok(flagged.length === 4, 'batch flags stay bounded to the input rows');
});

test('collection-level enforcement grants and replays idempotently', async () => {
  const db = await createDb();
  await insertCollection(db, 'col_starter', { packType: 'free' });
  await insertTemplate(db, 'tpl_starter', { collectionId: 'col_starter' });
  await insertRule(db, 'collection', 'col_starter', 'completed_artworks', '1');
  await setFacts(db, 'u_locked', { level: 1, completedArtworks: ['tpl_starter'] });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const locked = await getCollectionUnlockState(tx, 'u_locked', { id: 'col_starter', title: 'starter', pack_type: 'free', price_in_stars: 0 });
    assert.equal(locked.state, STATE_AVAILABLE);
    const granted = await assertCollectionAccessible(tx, 'u_locked', { id: 'col_starter', title: 'starter', pack_type: 'free', price_in_stars: 0 }, { grant: true, now: NOW });
    assert.equal(granted.state, STATE_OWNED);
    const replay = await assertCollectionAccessible(tx, 'u_locked', { id: 'col_starter', title: 'starter', pack_type: 'free', price_in_stars: 0 }, { grant: true, now: NOW });
    assert.equal(replay.granted, false);
  });
  assert.equal(await countRows(db, 'SELECT * FROM collection_ownerships WHERE user_id=?', ['u_locked']), 1);
});
