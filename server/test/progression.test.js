import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createFreshSqliteDbAsync, serverDir } from './helpers/database.js';
import { runMigrations } from '../database/migrations.js';
import { withTransaction } from '../database/transaction.js';
import {
  grantPaintingAchievements,
  touchDailyStreak,
  unlockAchievement,
} from '../services/progression-achievements.js';
import {
  ensureDailyChallenge,
  getUserProgression,
  recordDailyChallengeProgress,
  recordWeeklyChallengeProgress,
  rewardVerifiedPainting,
  rewardVerifiedTiledPainting,
} from '../services/progression.js';

const MIGRATIONS_DIR = join(serverDir, 'migrations', 'sqlite');
const NOW = '2026-08-07T10:00:00.000Z';

const ACHIEVEMENTS = [
  ['ach_first_pixel', 'Первый мазок'],
  ['ach_first_zone', 'Зона закрыта'],
  ['ach_daily_3', 'Трёхдневка'],
  ['ach_daily_7', 'Неделя ритма'],
  ['ach_style_night', 'Ночной страж'],
  ['ach_style_forest', 'Лесной след'],
  ['ach_style_space', 'Космический дальнобойщик'],
  ['ach_collector', 'Коллекционер'],
  ['ach_complete_5', 'Пять шедевров'],
];

async function createDb() {
  const db = await createFreshSqliteDbAsync();
  await runMigrations({ mode: 'sqlite', pool: null, sqlite: db, persistFn: null, migrationsDir: MIGRATIONS_DIR });
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const users = ['u_legacy', 'u_tiled', 'u_concurrent', 'u_streak', 'u_collector', 'u_negative'];
    for (const userId of users) {
      await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at)
        VALUES (?,?, 'user', ?, ?)`, [userId, userId, NOW, NOW]);
    }
    for (const [id, title] of ACHIEVEMENTS) {
      await tx.run(`INSERT INTO achievements (id,title,description,category,icon,rarity,created_at)
        VALUES (?,?,?, 'ritual', 'star', 'common', ?)`, [id, title, title, NOW]);
    }
    for (const [id, title] of [['col_night-city', 'Ночной город'], ['col_space', 'Космос'], ['col_cozy-forest', 'Лес']]) {
      await tx.run(`INSERT INTO collections (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url)
        VALUES (?,?, 'free', 'common', 3, 0, NULL)`, [id, title]);
    }
  });
  return db;
}

async function insertTemplate(db, id, { theme = 'featured', collectionId = null } = {}) {
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const cells = Array(64).fill(0);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,preview_url,original_media_key,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size)
      VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, NULL, NULL, 'catalog', 'public', 'active', ?, ?, 'legacy', 32)`,
    [id, null, id, id, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(cells), NOW, NOW]);
    await tx.run('UPDATE coloring_templates SET theme=?, collection_id=? WHERE id=?', [theme, collectionId, id]);
  });
  return id;
}

async function insertArtworkTx(tx, { id, userId, templateId, collectionId = null, isCompleted = 1 }) {
  await tx.run(`INSERT INTO artworks
    (id,owner_id,source_type,image_url,title,template_id,collection_id,is_completed,created_at,updated_at)
    VALUES (?,?, 'coloring', '/media/x.png', ?, ?, ?, ?, ?, ?)`,
  [id, userId, id, templateId, collectionId, isCompleted, NOW, NOW]);
}

function template(id, theme = 'featured', collectionId = null) {
  return { id, theme, collection_id: collectionId, cells: Array(64).fill(0), width: 8, height: 8, palette: ['#000000', '#ffffff'] };
}

async function countRows(db, sql, params = []) {
  let result;
  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    result = await tx.get(`SELECT COUNT(*) AS c FROM (${sql})`, params);
  });
  return Number(result?.c || 0);
}

test('all nine seeded achievements have deterministic grant paths', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_pixel', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertTemplate(db, 'tpl_zone', { theme: 'night-city', collectionId: 'col_night-city' });
  for (let index = 1; index <= 4; index += 1) {
    await insertTemplate(db, `tpl_count_${index}`, { theme: 'night-city', collectionId: 'col_night-city' });
  }
  for (let index = 1; index <= 3; index += 1) {
    await insertTemplate(db, `tpl_forest_${index}`, { theme: 'forest', collectionId: 'col_cozy-forest' });
    await insertTemplate(db, `tpl_space_${index}`, { theme: 'sea', collectionId: 'col_space' });
  }

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const pixel = await grantPaintingAchievements(tx, {
      userId: 'u_legacy', template: template('tpl_pixel'), painted: true, firstPaint: true, now: NOW,
    });
    assert.deepEqual(pixel.map((entry) => entry.achievementId), ['ach_first_pixel']);
    const pixelAgain = await grantPaintingAchievements(tx, {
      userId: 'u_legacy', template: template('tpl_pixel'), painted: true, firstPaint: true, now: NOW,
    });
    assert.equal(pixelAgain.filter((entry) => entry.granted).length, 0, 'first pixel cannot double grant');

    await insertArtworkTx(tx, { id: 'art_zone', userId: 'u_legacy', templateId: 'tpl_zone', collectionId: 'col_night-city' });
    const zone = await grantPaintingAchievements(tx, {
      userId: 'u_legacy', template: template('tpl_zone', 'night-city', 'col_night-city'), justCompleted: true, now: NOW,
    });
    assert.ok(zone.some((entry) => entry.achievementId === 'ach_first_zone' && entry.granted));

    for (let index = 1; index <= 3; index += 1) {
      await insertArtworkTx(tx, { id: `art_count_${index}`, userId: 'u_legacy', templateId: `tpl_count_${index}`, collectionId: 'col_night-city' });
    }
    const fifth = await grantPaintingAchievements(tx, {
      userId: 'u_legacy', template: template('tpl_count_4', 'night-city', 'col_night-city'), justCompleted: true, now: NOW,
    });
    assert.ok(fifth.some((entry) => entry.achievementId === 'ach_complete_5' && entry.granted));
    assert.ok(fifth.some((entry) => entry.achievementId === 'ach_style_night' && entry.granted));

    for (let index = 1; index <= 3; index += 1) {
      await insertArtworkTx(tx, { id: `art_forest_${index}`, userId: 'u_legacy', templateId: `tpl_forest_${index}`, collectionId: 'col_cozy-forest' });
    }
    const forest = await grantPaintingAchievements(tx, {
      userId: 'u_legacy', template: template('tpl_forest_3', 'forest', 'col_cozy-forest'), justCompleted: true, now: NOW,
    });
    assert.ok(forest.some((entry) => entry.achievementId === 'ach_style_forest' && entry.granted));

    for (let index = 1; index <= 3; index += 1) {
      await insertArtworkTx(tx, { id: `art_space_${index}`, userId: 'u_legacy', templateId: `tpl_space_${index}`, collectionId: 'col_space' });
    }
    const space = await grantPaintingAchievements(tx, {
      userId: 'u_legacy', template: template('tpl_space_3', 'sea', 'col_space'), justCompleted: true, now: NOW,
    });
    assert.ok(space.some((entry) => entry.achievementId === 'ach_style_space' && entry.granted));
  });

  const streakDays = [
    '2026-08-01T10:00:00.000Z',
    '2026-08-02T10:00:00.000Z',
    '2026-08-03T10:00:00.000Z',
  ];
  for (const day of streakDays) {
    await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
      await touchDailyStreak(tx, { userId: 'u_streak', now: day });
    });
  }
  assert.equal(await countRows(db, 'SELECT * FROM user_achievements WHERE user_id=? AND achievement_id=?', ['u_streak', 'ach_daily_3']), 1);
  for (const day of ['2026-08-04T10:00:00.000Z', '2026-08-05T10:00:00.000Z', '2026-08-06T10:00:00.000Z', '2026-08-07T10:00:00.000Z']) {
    await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
      await touchDailyStreak(tx, { userId: 'u_streak', now: day });
    });
  }
  assert.equal(await countRows(db, 'SELECT * FROM user_achievements WHERE user_id=? AND achievement_id=?', ['u_streak', 'ach_daily_7']), 1);

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const completed = await grantPaintingAchievements(tx, {
      userId: 'u_collector', template: template('tpl_pixel', 'night-city', 'col_night-city'), justCompleted: true, now: NOW,
    });
    assert.ok(completed.some((entry) => entry.achievementId === 'ach_collector' && entry.granted));
    await tx.run(`INSERT INTO collection_ownerships
      (user_id,collection_id,acquisition_type,price_paid,created_at)
      VALUES (?,?, 'legacy', 0, ?)`, ['u_collector', 'col_space', NOW]);
    const membership = await grantPaintingAchievements(tx, {
      userId: 'u_collector', template: template('tpl_count_1', 'night-city', 'col_night-city'), justCompleted: true, now: NOW,
    });
    assert.ok(membership.some((entry) => entry.achievementId === 'ach_collector'));
    const collectorCount = await tx.get('SELECT COUNT(*) AS c FROM user_achievements WHERE user_id=? AND achievement_id=?', ['u_collector', 'ach_collector']);
    assert.equal(Number(collectorCount.c), 1, 'collector membership never double grants');
  });
});

test('negative non-grant cases stay unclaimed', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_plain');
  await insertTemplate(db, 'tpl_night_1', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertTemplate(db, 'tpl_night_2', { theme: 'night-city', collectionId: 'col_night-city' });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const noPaint = await grantPaintingAchievements(tx, {
      userId: 'u_negative', template: template('tpl_plain'), painted: false, firstPaint: false, now: NOW,
    });
    assert.equal(noPaint.filter((entry) => entry.granted).length, 0);

    const noCompletion = await grantPaintingAchievements(tx, {
      userId: 'u_negative', template: template('tpl_plain'), painted: true, firstPaint: true, now: NOW,
    });
    assert.deepEqual(noCompletion.map((entry) => entry.achievementId), ['ach_first_pixel']);
    const unlocked = await tx.get('SELECT COUNT(*) AS c FROM user_achievements WHERE user_id=?', ['u_negative']);
    assert.equal(Number(unlocked.c), 1);

    for (let index = 1; index <= 2; index += 1) {
      await insertArtworkTx(tx, { id: `art_night_${index}`, userId: 'u_negative', templateId: `tpl_night_${index}`, collectionId: 'col_night-city' });
    }
    const belowThreshold = await grantPaintingAchievements(tx, {
      userId: 'u_negative', template: template('tpl_night_2', 'night-city', 'col_night-city'), justCompleted: true, now: NOW,
    });
    assert.equal(belowThreshold.filter((entry) => entry.achievementId === 'ach_style_night' && entry.granted).length, 0);
    assert.equal(belowThreshold.filter((entry) => entry.achievementId === 'ach_complete_5' && entry.granted).length, 0);

    await touchDailyStreak(tx, { userId: 'u_negative', now: '2026-08-06T10:00:00.000Z' });
    await touchDailyStreak(tx, { userId: 'u_negative', now: '2026-08-06T10:00:00.000Z' });
    await touchDailyStreak(tx, { userId: 'u_negative', now: '2026-08-07T10:00:00.000Z' });
    const streak = await tx.get('SELECT * FROM daily_streaks WHERE user_id=?', ['u_negative']);
    assert.equal(streak.current_streak, 2, 'same-day touches do not advance the streak');
    assert.equal(streak.total_days, 2);
    const daily3 = await tx.get('SELECT 1 FROM user_achievements WHERE user_id=? AND achievement_id=?', ['u_negative', 'ach_daily_3']);
    assert.equal(daily3, null, 'two consecutive days do not grant ach_daily_3');

    const unknown = await unlockAchievement(tx, { userId: 'u_negative', achievementId: 'ach_does_not_exist', now: NOW });
    assert.equal(unknown.exists, false);
    assert.equal(unknown.granted, false);
  });
});

test('undo, repaint, and replay cannot farm XP or progression', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_farm', { theme: 'featured', collectionId: null });
  const userId = 'u_legacy';
  const tpl = template('tpl_farm');

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await ensureDailyChallenge(tx);
    const first = await rewardVerifiedPainting(tx, {
      userId,
      template: tpl,
      previousFilled: Array(64).fill(-1),
      filled: [0, ...Array(63).fill(-1)],
      revision: 1,
      justCompleted: false,
      now: NOW,
    });
    assert.equal(first.xp_awarded, 1);

    const undo = await rewardVerifiedPainting(tx, {
      userId,
      template: tpl,
      previousFilled: [0, ...Array(63).fill(-1)],
      filled: Array(64).fill(-1),
      revision: 2,
      justCompleted: false,
      now: NOW,
    });
    assert.equal(undo.xp_awarded, 0);

    const repaint = await rewardVerifiedPainting(tx, {
      userId,
      template: tpl,
      previousFilled: Array(64).fill(-1),
      filled: [0, ...Array(63).fill(-1)],
      revision: 3,
      justCompleted: false,
      now: NOW,
    });
    assert.equal(repaint.xp_awarded, 0, 'repainting an already-awarded cell cannot farm XP');

    const replay = await rewardVerifiedPainting(tx, {
      userId,
      template: tpl,
      previousFilled: Array(64).fill(-1),
      filled: [0, ...Array(63).fill(-1)],
      revision: 1,
      justCompleted: false,
      now: NOW,
    });
    assert.equal(replay.xp_awarded, 0, 'replaying an old revision cannot award XP again');

    const daily = await recordDailyChallengeProgress(tx, { userId, template: tpl, filled: [0, ...Array(63).fill(-1)], now: NOW });
    assert.equal(daily.progress_cells, 1);
    const dailyReplay = await recordDailyChallengeProgress(tx, { userId, template: tpl, filled: [0, ...Array(63).fill(-1)], now: NOW });
    assert.equal(dailyReplay.progress_cells, 1);
    assert.equal(dailyReplay.xp_awarded, 0);

    const weekly = await recordWeeklyChallengeProgress(tx, { userId, deltaCorrectCells: 0, now: NOW });
    assert.equal(weekly.progress_cells, 1);
    assert.equal(weekly.xp_awarded, 0);
    const weeklyReplay = await recordWeeklyChallengeProgress(tx, { userId, deltaCorrectCells: 0, now: NOW });
    assert.equal(weeklyReplay.progress_cells, 1);
    assert.equal(weeklyReplay.xp_awarded, 0);

    const progression = await getUserProgression(tx, userId);
    assert.equal(progression.xp_total, 1, 'cell XP is awarded once across undo/repaint/replay');
  });

  assert.equal(await countRows(db, 'SELECT * FROM user_xp_events WHERE user_id=?', [userId]), 1);
  assert.equal(await countRows(db, 'SELECT * FROM user_template_xp_cells WHERE user_id=?', [userId]), 1);
});

test('SQLite concurrent first streak, achievement, and progression writes stay atomic', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_concurrent_a', { theme: 'night-city', collectionId: 'col_night-city' });
  await insertTemplate(db, 'tpl_concurrent_b', { theme: 'space', collectionId: 'col_space' });

  await Promise.all([
    withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
      await touchDailyStreak(tx, { userId: 'u_concurrent', now: NOW });
      await grantPaintingAchievements(tx, {
        userId: 'u_concurrent', template: template('tpl_concurrent_a'), painted: true, firstPaint: true, now: NOW,
      });
      await recordWeeklyChallengeProgress(tx, { userId: 'u_concurrent', deltaCorrectCells: 60, now: NOW });
    }),
    withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
      await touchDailyStreak(tx, { userId: 'u_concurrent', now: NOW });
      await grantPaintingAchievements(tx, {
        userId: 'u_concurrent', template: template('tpl_concurrent_b'), painted: true, firstPaint: true, now: NOW,
      });
      await recordWeeklyChallengeProgress(tx, { userId: 'u_concurrent', deltaCorrectCells: 60, now: NOW });
    }),
  ]);

  const streak = await countRows(db, 'SELECT * FROM daily_streaks WHERE user_id=?', ['u_concurrent']);
  const achievements = await countRows(db, 'SELECT * FROM user_achievements WHERE user_id=? AND achievement_id=?', ['u_concurrent', 'ach_first_pixel']);
  const weeklyAwards = await countRows(db, "SELECT * FROM user_xp_events WHERE user_id=? AND event_type='weekly_challenge_complete'", ['u_concurrent']);
  const weeklyProgress = await countRows(db, 'SELECT * FROM weekly_challenge_progress WHERE user_id=? AND progress_cells=100', ['u_concurrent']);
  assert.equal(streak, 1, 'one streak row across concurrent touches');
  assert.equal(achievements, 1, 'one first pixel grant across concurrent paints');
  assert.equal(weeklyAwards, 1, 'weekly XP is awarded once across concurrent templates');
  assert.equal(weeklyProgress, 1, 'weekly progress is capped at 100, not double counted');
});

test('tiled progression uses the same atomic daily/weekly upserts and XP guards', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_tiled_daily', { theme: 'night-city', collectionId: 'col_night-city' });

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    const challenge = await ensureDailyChallenge(tx);
    const tiledTemplate = { id: challenge.template_id };
    const result = await rewardVerifiedTiledPainting(tx, {
      userId: 'u_tiled',
      template: tiledTemplate,
      newlyCorrectIndices: [0, 1],
      completedCells: 2,
      deltaCorrectCells: 2,
      revision: 1,
      justCompleted: false,
      now: NOW,
    });
    assert.equal(result.xp_awarded, 2);
    assert.equal(result.daily_challenge.progress_cells, 2);

    const replay = await rewardVerifiedTiledPainting(tx, {
      userId: 'u_tiled',
      template: tiledTemplate,
      newlyCorrectIndices: [],
      completedCells: 2,
      deltaCorrectCells: 0,
      revision: 2,
      justCompleted: false,
      now: NOW,
    });
    assert.equal(replay.xp_awarded, 0, 'already awarded tiled cells cannot farm XP');
    assert.equal(replay.daily_challenge.progress_cells, 2, 'daily progress is capped, not accumulated');
  });

  assert.equal(await countRows(db, 'SELECT * FROM user_xp_events WHERE user_id=?', ['u_tiled']), 1);
});

test('ensureDailyChallenge repairs stale persisted assignments and skips ineligible content', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_hidden');
  await insertTemplate(db, 'tpl_gated');
  await insertTemplate(db, 'tpl_premium', { collectionId: 'col_premium_daily' });
  await insertTemplate(db, 'tpl_eligible');
  const dateKey = NOW.slice(0, 10);

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run(`INSERT INTO collections
      (id,title,pack_type,rarity,total_artworks,price_in_stars,image_url,owner_id,status,visibility,description)
      VALUES ('col_premium_daily','Premium daily','premium','epic',1,50,NULL,NULL,'published','public','')`);
    await tx.run("UPDATE coloring_templates SET status='hidden' WHERE id='tpl_hidden'");
    await tx.run(`INSERT INTO unlock_rules
      (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
      VALUES ('template','tpl_gated','level','99',1,?)`, [NOW]);
    await tx.run(`INSERT INTO daily_challenges
      (date_key,template_id,target_cells,xp_reward,created_at)
      VALUES (?, 'tpl_hidden', 5, 30, ?)`, [dateKey, NOW]);

    const challenge = await ensureDailyChallenge(tx, { date: new Date(NOW) });
    assert.ok(challenge, 'stale persisted assignment must be repaired');
    assert.equal(challenge.date_key, dateKey);
    assert.equal(challenge.template_id, 'tpl_eligible', 'only eligible free content may be selected');
    const row = await tx.get('SELECT template_id FROM daily_challenges WHERE date_key=?', [dateKey]);
    assert.equal(row.template_id, 'tpl_eligible', 'repair replaces the stale row, not just the response');
  });
});

test('ensureDailyChallenge returns null only when no eligible content exists', async () => {
  const db = await createDb();
  await insertTemplate(db, 'tpl_hidden_only');
  await insertTemplate(db, 'tpl_gated_only');
  const dateKey = NOW.slice(0, 10);

  await withTransaction({ mode: 'sqlite', sqlite: db, persistFn: null }, async (tx) => {
    await tx.run("UPDATE coloring_templates SET status='hidden' WHERE id='tpl_hidden_only'");
    await tx.run(`INSERT INTO unlock_rules
      (subject_type,subject_id,rule_type,target_value,rule_order,created_at)
      VALUES ('template','tpl_gated_only','level','99',1,?)`, [NOW]);
    assert.equal(await ensureDailyChallenge(tx, { date: new Date(NOW) }), null);
    const stale = await tx.run(`INSERT INTO daily_challenges
      (date_key,template_id,target_cells,xp_reward,created_at)
      VALUES (?, 'tpl_hidden_only', 5, 30, ?) ON CONFLICT (date_key) DO NOTHING`, [dateKey, NOW]);
    assert.equal(await ensureDailyChallenge(tx, { date: new Date(NOW) }), null, 'no eligible content means no daily challenge');
    assert.equal(stale.changes, 1);
  });
});
