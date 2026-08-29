import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL progression semantics skipped (no DATABASE_URL)', { skip: true }, () => {});
}

test('PostgreSQL concurrent streak, achievement, and weekly progression writes stay atomic', { skip: !databaseUrl }, async (t) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { withTransaction } = await import('../database/transaction.js');
  const achievements = await import('../services/progression-achievements.js');
  const progression = await import('../services/progression.js');

  const runId = `pgprog_${Date.now()}`;
  const userId = `${runId}_user`;
  const templateA = `${runId}_tpl_a`;
  const templateB = `${runId}_tpl_b`;
  const achievementId = 'ach_first_pixel';
  const now = '2026-08-07T10:00:00.000Z';

  t.after(async () => {
    const ids = [userId, `${runId}_tpl_a`, `${runId}_tpl_b`];
    try {
      await pool.query('DELETE FROM user_xp_events WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM user_template_xp_cells WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM user_achievements WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM daily_streaks WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM weekly_challenge_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM daily_challenge_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM artworks WHERE owner_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_tiled_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id = ANY($1::text[])', [ids]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } catch { /* best-effort cleanup */ }
    await pool.end();
  });

  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES (?,?, 'user', ?, ?)`,
      [userId, 'Postgres Progression', now, now]);
    for (const [id, title] of [
      ['ach_first_pixel', 'Первый мазок'],
      ['ach_first_zone', 'Зона закрыта'],
      ['ach_daily_3', 'Трёхдневка'],
      ['ach_daily_7', 'Неделя ритма'],
      ['ach_style_night', 'Ночной страж'],
      ['ach_style_forest', 'Лесной след'],
      ['ach_style_space', 'Космический дальнобойщик'],
      ['ach_collector', 'Коллекционер'],
      ['ach_complete_5', 'Пять шедевров'],
    ]) {
      await tx.run(`INSERT INTO achievements (id,title,description,category,icon,rarity,created_at)
        VALUES (?,?,?, 'ritual', 'star', 'common', ?) ON CONFLICT (id) DO NOTHING`,
      [id, title, title, now]);
    }
    for (const [id, theme, collectionId] of [
      [templateA, 'night-city', 'col_night-city'],
      [templateB, 'space', 'col_space'],
    ]) {
      await tx.run(`INSERT INTO coloring_templates
        (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
        VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, ?, ?)`,
      [id, null, id, id, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now, now, theme, collectionId]);
    }
  });

  await Promise.all([
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await achievements.touchDailyStreak(tx, { userId, now });
      await achievements.grantPaintingAchievements(tx, {
        userId,
        template: { id: templateA, theme: 'night-city', collection_id: 'col_night-city' },
        painted: true,
        firstPaint: true,
        now,
      });
      await progression.recordWeeklyChallengeProgress(tx, { userId, deltaCorrectCells: 60, now });
    }),
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await achievements.touchDailyStreak(tx, { userId, now });
      await achievements.grantPaintingAchievements(tx, {
        userId,
        template: { id: templateB, theme: 'space', collection_id: 'col_space' },
        painted: true,
        firstPaint: true,
        now,
      });
      await progression.recordWeeklyChallengeProgress(tx, { userId, deltaCorrectCells: 60, now });
    }),
  ]);

  const rows = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM daily_streaks WHERE user_id=$1) AS streaks,
      (SELECT COUNT(*) FROM user_achievements WHERE user_id=$1 AND achievement_id=$2) AS achievements,
      (SELECT COUNT(*) FROM user_xp_events WHERE user_id=$1 AND event_type='weekly_challenge_complete') AS weekly_awards,
      (SELECT progress_cells FROM weekly_challenge_progress WHERE user_id=$1 LIMIT 1) AS weekly_cells
  `, [userId, achievementId]);
  const result = rows.rows[0];
  assert.equal(Number(result.streaks), 1, 'one PostgreSQL streak row across concurrent touches');
  assert.equal(Number(result.achievements), 1, 'one first pixel grant across concurrent PostgreSQL transactions');
  assert.equal(Number(result.weekly_awards), 1, 'weekly XP awarded once across concurrent PostgreSQL templates');
  assert.equal(Number(result.weekly_cells), 100, 'weekly cells capped at 100, never 120');
});

test('PostgreSQL concurrent daily challenge progress is capped and single-awarded', { skip: !databaseUrl }, async (t) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { withTransaction } = await import('../database/transaction.js');
  const progression = await import('../services/progression.js');

  const runId = `pgdaily_${Date.now()}`;
  const userId = `${runId}_user`;
  const templateId = `${runId}_tpl`;
  const now = '2026-08-07T10:00:00.000Z';

  t.after(async () => {
    try {
      await pool.query('DELETE FROM user_xp_events WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM user_achievements WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM daily_challenge_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM daily_challenges WHERE date_key=$1 AND template_id=$2', ['2026-08-07', templateId]);
      await pool.query('DELETE FROM coloring_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM coloring_templates WHERE id=$1', [templateId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } catch { /* best-effort cleanup */ }
    await pool.end();
  });

  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES (?,?, 'user', ?, ?)`,
      [userId, 'Postgres Daily', now, now]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
      VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, 'featured', NULL)`,
    [templateId, null, templateId, templateId, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now, now]);
  });

  let challenge;
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    challenge = await progression.ensureDailyChallenge(tx, { date: new Date(now) });
    await tx.run(`INSERT INTO daily_challenges (date_key,template_id,target_cells,xp_reward,created_at)
      VALUES (?,?,20,30,?)
      ON CONFLICT (date_key) DO UPDATE SET template_id=excluded.template_id, target_cells=excluded.target_cells`,
    [challenge.date_key, templateId, now]);
  });
  const template = { id: templateId, cells: Array(64).fill(0) };

  await Promise.all([
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await progression.recordDailyChallengeProgress(tx, { userId, template, filled: Array.from({ length: 64 }, (_, index) => (index < 15 ? 0 : -1)), now });
    }),
    withTransaction({ mode: 'postgres', pool }, async (tx) => {
      await progression.recordDailyChallengeProgress(tx, { userId, template, filled: Array.from({ length: 64 }, (_, index) => (index < 15 ? 0 : -1)), now });
    }),
  ]);

  const rows = await pool.query(
    `SELECT progress_cells, completed_at FROM daily_challenge_progress WHERE user_id=$1`,
    [userId],
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(Number(rows.rows[0].progress_cells), 15, 'identical concurrent daily batches do not double count');
  assert.equal(rows.rows[0].completed_at, null);
});

test('PostgreSQL daily challenge repairs a stale seeded assignment', { skip: !databaseUrl }, async (t) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { withTransaction } = await import('../database/transaction.js');
  const progression = await import('../services/progression.js');

  const runId = `pgstale_${Date.now()}`;
  const userId = `${runId}_user`;
  const staleTemplateId = `${runId}_stale_tpl`;
  const eligibleTemplateId = `${runId}_eligible_tpl`;
  const now = '2026-08-09T10:00:00.000Z';
  const dateKey = now.slice(0, 10);

  t.after(async () => {
    try {
      await pool.query('DELETE FROM daily_challenge_progress WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM daily_challenges WHERE date_key=$1', [dateKey]);
      await pool.query('DELETE FROM coloring_templates WHERE id = ANY($1::text[])', [[staleTemplateId, eligibleTemplateId]]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } catch { /* best-effort cleanup */ }
    await pool.end();
  });

  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    await tx.run(`INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES (?,?, 'user', ?, ?)`,
      [userId, 'Postgres Stale Daily', now, now]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
      VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, 'featured', NULL)`,
    [staleTemplateId, null, staleTemplateId, staleTemplateId, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now, now]);
    await tx.run(`INSERT INTO coloring_templates
      (id,owner_id,title,description,category,difficulty,width,height,palette_json,cells_json,source_type,visibility,status,created_at,updated_at,storage_mode,tile_size,theme,collection_id)
      VALUES (?,?,?,?, 'test', 'easy', 8, 8, ?, ?, 'catalog', 'public', 'active', ?, ?, 'legacy', 32, 'featured', NULL)`,
    [eligibleTemplateId, null, eligibleTemplateId, eligibleTemplateId, JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now, now]);
    await tx.run('UPDATE coloring_templates SET status=? WHERE id=?', ['hidden', staleTemplateId]);
    await tx.run('DELETE FROM daily_challenges WHERE date_key=?', [dateKey]);
    await tx.run(`INSERT INTO daily_challenges
      (date_key,template_id,target_cells,xp_reward,created_at)
      VALUES (?, ?, 5, 30, ?)`, [dateKey, staleTemplateId, now]);
  });

  let challenge;
  await withTransaction({ mode: 'postgres', pool }, async (tx) => {
    challenge = await progression.ensureDailyChallenge(tx, { date: new Date(now) });
  });

  assert.ok(challenge, 'a stale seeded daily_challenges row must be repaired');
  assert.equal(challenge.date_key, dateKey);
  assert.equal(challenge.template_id, eligibleTemplateId);
  const rows = await pool.query(
    `SELECT d.template_id, t.id AS joined_template, t.status, t.visibility
      FROM daily_challenges d
      LEFT JOIN coloring_templates t ON t.id=d.template_id
      WHERE d.date_key=$1`,
    [dateKey],
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].template_id, challenge.template_id);
  assert.equal(rows.rows[0].joined_template, challenge.template_id);
  assert.equal(rows.rows[0].status, 'active');
  assert.equal(rows.rows[0].visibility, 'public');
});
