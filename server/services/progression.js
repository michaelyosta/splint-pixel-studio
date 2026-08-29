import { v4 as uuid } from 'uuid';

export const XP_PER_LEVEL = 1_000;
export const XP_REWARDS = Object.freeze({
  correct_cell: 1,
  template_complete: 40,
  daily_challenge: 30,
  weekly_challenge: 100,
});
export const WEEKLY_CHALLENGE_TARGET = 100;

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function utcWeekKey(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current - yearStart) / 86_400_000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function stableIndex(value, size) {
  let hash = 0;
  for (const char of value) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash % size;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function countCorrectCells(template, filled) {
  if (!Array.isArray(template?.cells) || !Array.isArray(filled)) return 0;
  return filled.reduce((total, color, index) => total + (color === template.cells[index] ? 1 : 0), 0);
}

function deltaProgressInsertSql() {
  return 'CASE WHEN ? > ? THEN ? WHEN ? < 0 THEN 0 ELSE ? END';
}

function deltaProgressUpdateSql(column) {
  return `CASE WHEN ${column} + ? > ? THEN ? WHEN ${column} + ? < 0 THEN 0 ELSE ${column} + ? END`;
}

function dailyTemplateEligibilitySql(alias = 't') {
  const table = alias;
  return `${table}.status='active' AND ${table}.visibility='public'
    AND ${table}.source_type <> 'unlockable'
    AND NOT EXISTS (
      SELECT 1 FROM unlock_rules r
      WHERE r.subject_type='template' AND r.subject_id=${table}.id
    )
    AND (${table}.collection_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM collections c
      WHERE c.id=${table}.collection_id
        AND (c.pack_type='premium'
          OR EXISTS (
            SELECT 1 FROM unlock_rules r
            WHERE r.subject_type='collection' AND r.subject_id=c.id
          ))
    ))`;
}

async function loadEligibleDailyChallenge(tx, dateKey) {
  return tx.get(`SELECT d.*, t.title AS template_title
    FROM daily_challenges d
    JOIN coloring_templates t ON t.id=d.template_id
    WHERE d.date_key=? AND ${dailyTemplateEligibilitySql('t')}`, [dateKey]);
}

function normalizeDailyChallenge(row, progress = null) {
  if (!row) return null;
  const targetCells = toNumber(row.target_cells, 0);
  const progressCells = Math.min(targetCells, Math.max(0, toNumber(progress?.progress_cells, 0)));
  return {
    date_key: row.date_key,
    template_id: row.template_id,
    template_title: row.template_title || null,
    target_cells: targetCells,
    progress_cells: progressCells,
    remaining_cells: Math.max(0, targetCells - progressCells),
    xp_reward: toNumber(row.xp_reward, XP_REWARDS.daily_challenge),
    completed: Boolean(progress?.completed_at),
    completed_at: progress?.completed_at || null,
  };
}

function normalizeWeeklyChallenge(row, progress = null) {
  if (!row) return null;
  const targetCells = toNumber(row.target_cells, WEEKLY_CHALLENGE_TARGET);
  const progressCells = Math.min(targetCells, Math.max(0, toNumber(progress?.progress_cells, 0)));
  return {
    period_key: row.period_key,
    target_cells: targetCells,
    progress_cells: progressCells,
    remaining_cells: Math.max(0, targetCells - progressCells),
    xp_reward: toNumber(row.xp_reward, XP_REWARDS.weekly_challenge),
    completed: Boolean(progress?.completed_at),
    completed_at: progress?.completed_at || null,
  };
}

/**
 * Grant XP from a server-verified event. The unique (user, dedupe_key)
 * constraint makes retrying or replaying an action harmless.
 */
export async function awardXp(tx, {
  userId,
  eventType,
  dedupeKey,
  amount,
  metadata = {},
  now = new Date().toISOString(),
}) {
  const xpAmount = Number(amount);
  if (!userId || !eventType || !dedupeKey || !Number.isInteger(xpAmount) || xpAmount <= 0) {
    throw new Error('Invalid server XP award');
  }

  const insert = await tx.run(`INSERT INTO user_xp_events
    (id,user_id,event_type,dedupe_key,xp_amount,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT (user_id,dedupe_key) DO NOTHING`,
  [uuid(), userId, eventType, dedupeKey.slice(0, 180), xpAmount, JSON.stringify(metadata), now]);

  if (!insert.changes) {
    return { awarded: false, amount: 0, progression: await getUserProgression(tx, userId) };
  }

  await tx.run(`UPDATE users
    SET xp_total=xp_total+?, level=((xp_total+?)/?)+1, updated_at=?
    WHERE id=?`, [xpAmount, xpAmount, XP_PER_LEVEL, now, userId]);

  return { awarded: true, amount: xpAmount, progression: await getUserProgression(tx, userId) };
}

export async function getUserProgression(tx, userId) {
  const user = await tx.get('SELECT xp_total,level FROM users WHERE id=?', [userId]);
  const xpTotal = Math.max(0, toNumber(user?.xp_total, 0));
  return {
    xp_total: xpTotal,
    level: Math.max(1, toNumber(user?.level, Math.floor(xpTotal / XP_PER_LEVEL) + 1)),
    xp_to_next_level: XP_PER_LEVEL - (xpTotal % XP_PER_LEVEL),
    xp_per_level: XP_PER_LEVEL,
  };
}

/**
 * Assign a deterministic public catalog template for the current UTC day.
 * The persisted row protects the assignment against catalog edits and race
 * conditions after the first request.
 */
export async function ensureDailyChallenge(tx, { date = new Date() } = {}) {
  const dateKey = utcDateKey(date);
  const eligibleExisting = await loadEligibleDailyChallenge(tx, dateKey);
  if (eligibleExisting) return eligibleExisting;

  const templates = await tx.all(`SELECT id,title,width,height
    FROM coloring_templates t
    WHERE ${dailyTemplateEligibilitySql()}
    ORDER BY id ASC`);
  if (!templates.length) return null;

  const selected = templates[stableIndex(dateKey, templates.length)];
  const cellCount = Math.max(1, toNumber(selected.width, 1) * toNumber(selected.height, 1));
  const targetCells = Math.min(20, cellCount);
  const now = new Date().toISOString();

  // A persisted assignment can point at a template that was later hidden,
  // deleted, moved to premium, or gated by unlock rules. Repair that row with
  // a CAS instead of letting ON CONFLICT DO NOTHING keep the stale value.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const raw = await tx.get('SELECT template_id FROM daily_challenges WHERE date_key=?', [dateKey]);
    if (raw) {
      const updated = await tx.run(`UPDATE daily_challenges
        SET template_id=?, target_cells=?, xp_reward=?
        WHERE date_key=? AND template_id=?`,
      [selected.id, targetCells, XP_REWARDS.daily_challenge, dateKey, raw.template_id]);
      if (updated.changes) break;
      const repaired = await loadEligibleDailyChallenge(tx, dateKey);
      if (repaired) return repaired;
      continue;
    }

    const inserted = await tx.run(`INSERT INTO daily_challenges
      (date_key,template_id,target_cells,xp_reward,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT (date_key) DO NOTHING`,
    [dateKey, selected.id, targetCells, XP_REWARDS.daily_challenge, now]);
    if (inserted.changes) break;
    const raced = await loadEligibleDailyChallenge(tx, dateKey);
    if (raced) return raced;
  }

  return loadEligibleDailyChallenge(tx, dateKey);
}

export async function getDailyChallengeStatus(tx, userId, options = {}) {
  const challenge = await ensureDailyChallenge(tx, options);
  if (!challenge) return null;
  const progress = await tx.get(`SELECT * FROM daily_challenge_progress
    WHERE user_id=? AND date_key=?`, [userId, challenge.date_key]);
  return normalizeDailyChallenge(challenge, progress);
}

export async function ensureWeeklyChallenge(tx, { date = new Date() } = {}) {
  const periodKey = utcWeekKey(date);
  const existing = await tx.get('SELECT * FROM weekly_challenges WHERE period_key=?', [periodKey]);
  if (existing) return existing;
  const now = new Date().toISOString();
  await tx.run(`INSERT INTO weekly_challenges (period_key,target_cells,xp_reward,created_at)
    VALUES (?,?,?,?) ON CONFLICT (period_key) DO NOTHING`,
  [periodKey, WEEKLY_CHALLENGE_TARGET, XP_REWARDS.weekly_challenge, now]);
  return tx.get('SELECT * FROM weekly_challenges WHERE period_key=?', [periodKey]);
}

export async function getWeeklyChallengeStatus(tx, userId, options = {}) {
  const challenge = await ensureWeeklyChallenge(tx, options);
  if (!challenge) return null;
  const progress = await tx.get(`SELECT * FROM weekly_challenge_progress
    WHERE user_id=? AND period_key=?`, [userId, challenge.period_key]);
  return normalizeWeeklyChallenge(challenge, progress);
}

export async function recordWeeklyChallengeProgress(tx, {
  userId,
  deltaCorrectCells = 0,
  now = new Date().toISOString(),
}) {
  const challenge = await ensureWeeklyChallenge(tx, { date: new Date(now) });
  if (!challenge) return null;
  const delta = Math.max(0, Math.floor(toNumber(deltaCorrectCells, 0)));
  const targetCells = toNumber(challenge.target_cells, WEEKLY_CHALLENGE_TARGET);

  await tx.run(`INSERT INTO weekly_challenge_progress
    (user_id,period_key,progress_cells,completed_at,updated_at)
    VALUES (?,?,${deltaProgressInsertSql()},NULL,?)
    ON CONFLICT (user_id,period_key) DO UPDATE SET
      progress_cells=${deltaProgressUpdateSql('weekly_challenge_progress.progress_cells')},
      updated_at=excluded.updated_at`,
  [
    userId, challenge.period_key,
    delta, targetCells, targetCells, delta, delta, now,
    delta, targetCells, targetCells, delta, delta,
  ]);

  const progress = await tx.get(`SELECT * FROM weekly_challenge_progress
    WHERE user_id=? AND period_key=?`, [userId, challenge.period_key]);
  const progressCells = Number(progress?.progress_cells || 0);
  const isComplete = progressCells >= targetCells;
  const justCompleted = isComplete && !progress?.completed_at;
  let award = null;
  if (justCompleted) {
    await tx.run(`UPDATE weekly_challenge_progress
      SET completed_at=?, updated_at=?
      WHERE user_id=? AND period_key=? AND completed_at IS NULL`,
    [now, now, userId, challenge.period_key]);
    award = await awardXp(tx, {
      userId,
      eventType: 'weekly_challenge_complete',
      dedupeKey: `weekly-challenge:${challenge.period_key}`,
      amount: toNumber(challenge.xp_reward, XP_REWARDS.weekly_challenge),
      metadata: { period_key: challenge.period_key },
      now,
    });
  }
  const returnedProgress = justCompleted ? { ...progress, completed_at: now } : progress;
  return {
    ...normalizeWeeklyChallenge(challenge, returnedProgress),
    just_completed: justCompleted,
    xp_awarded: award?.amount || 0,
  };
}

/**
 * Recalculate the daily progress from the server's persisted coloring map.
 * This prevents a client from claiming progress with a fabricated counter.
 */
export async function recordDailyChallengeProgress(tx, {
  userId,
  template,
  filled,
  deltaCorrectCells,
  now = new Date().toISOString(),
}) {
  const challenge = await ensureDailyChallenge(tx, { date: new Date(now) });
  if (!challenge || challenge.template_id !== template.id) return null;

  const targetCells = toNumber(challenge.target_cells, 0);
  if (deltaCorrectCells === undefined) {
    const progressCells = Math.min(targetCells, countCorrectCells(template, filled));
    await tx.run(`INSERT INTO daily_challenge_progress
      (user_id,date_key,progress_cells,completed_at,updated_at)
      VALUES (?,?,?,NULL,?)
      ON CONFLICT (user_id,date_key) DO UPDATE SET
        progress_cells=excluded.progress_cells,
        updated_at=excluded.updated_at`,
    [userId, challenge.date_key, progressCells, now]);
  } else {
    const delta = Math.max(-targetCells, Math.min(targetCells, Math.floor(toNumber(deltaCorrectCells, 0))));
    await tx.run(`INSERT INTO daily_challenge_progress
      (user_id,date_key,progress_cells,completed_at,updated_at)
      VALUES (?,?,${deltaProgressInsertSql()},NULL,?)
      ON CONFLICT (user_id,date_key) DO UPDATE SET
        progress_cells=${deltaProgressUpdateSql('daily_challenge_progress.progress_cells')},
        updated_at=excluded.updated_at`,
    [
      userId, challenge.date_key,
      delta, targetCells, targetCells, delta, delta, now,
      delta, targetCells, targetCells, delta, delta,
    ]);
  }

  const progress = await tx.get(`SELECT * FROM daily_challenge_progress
    WHERE user_id=? AND date_key=?`, [userId, challenge.date_key]);
  const progressCells = Number(progress?.progress_cells || 0);
  const isComplete = progressCells >= targetCells;
  const justCompleted = isComplete && !progress?.completed_at;
  let award = null;
  if (justCompleted) {
    await tx.run(`UPDATE daily_challenge_progress
      SET completed_at=?, updated_at=?
      WHERE user_id=? AND date_key=? AND completed_at IS NULL`,
    [now, now, userId, challenge.date_key]);
    award = await awardXp(tx, {
      userId,
      eventType: 'daily_challenge_complete',
      dedupeKey: `daily-challenge:${challenge.date_key}`,
      amount: toNumber(challenge.xp_reward, XP_REWARDS.daily_challenge),
      metadata: { date_key: challenge.date_key, template_id: template.id },
      now,
    });
  }

  const returnedProgress = justCompleted ? { ...progress, completed_at: now } : progress;
  return {
    ...normalizeDailyChallenge(challenge, returnedProgress),
    just_completed: justCompleted,
    xp_awarded: award?.amount || 0,
  };
}

/**
 * Called only after the server validates and persists a progress batch.
 */
export async function rewardVerifiedPainting(tx, {
  userId,
  template,
  previousFilled,
  filled,
  revision,
  justCompleted,
  now = new Date().toISOString(),
}) {
  const newlyCorrectIndices = filled.reduce((indices, color, index) => {
    if (color === template.cells[index] && previousFilled[index] !== template.cells[index]) indices.push(index);
    return indices;
  }, []);
  let newCorrectCells = 0;
  for (const cellIndex of newlyCorrectIndices) {
    const claim = await tx.run(`INSERT INTO user_template_xp_cells
      (user_id,template_id,cell_index,earned_at)
      VALUES (?,?,?,?) ON CONFLICT (user_id,template_id,cell_index) DO NOTHING`,
    [userId, template.id, cellIndex, now]);
    newCorrectCells += Number(claim.changes || 0);
  }

  let paintingAward = null;
  if (newCorrectCells > 0) {
    paintingAward = await awardXp(tx, {
      userId,
      eventType: 'correct_cells',
      dedupeKey: `paint:${template.id}:${revision}`,
      amount: newCorrectCells * XP_REWARDS.correct_cell,
      metadata: { template_id: template.id, revision, correct_cells: newCorrectCells },
      now,
    });
  }

  let completionAward = null;
  if (justCompleted) {
    completionAward = await awardXp(tx, {
      userId,
      eventType: 'template_complete',
      dedupeKey: `template-complete:${template.id}`,
      amount: XP_REWARDS.template_complete,
      metadata: { template_id: template.id },
      now,
    });
  }

  const daily = await recordDailyChallengeProgress(tx, { userId, template, filled, now });
  const weekly = await recordWeeklyChallengeProgress(tx, { userId, deltaCorrectCells: newCorrectCells, now });
  // Daily completion can be the final award in this transaction, so re-read
  // after every server-side reward rather than returning a stale interim XP.
  const progression = await getUserProgression(tx, userId);
  return {
    progression,
    daily_challenge: daily,
    weekly_challenge: weekly,
    xp_awarded: (paintingAward?.amount || 0) + (completionAward?.amount || 0) + (daily?.xp_awarded || 0) + (weekly?.xp_awarded || 0),
  };
}

/**
 * Tiled equivalent of rewardVerifiedPainting. It accepts only the bounded
 * delta from the affected tiles, so rewarding a 1200×1200 action never
 * materializes a full filled map in the server process.
 */
export async function rewardVerifiedTiledPainting(tx, {
  userId,
  template,
  newlyCorrectIndices = [],
  completedCells = 0,
  deltaCorrectCells = 0,
  revision,
  justCompleted,
  now = new Date().toISOString(),
}) {
  let newCorrectCells = 0;
  for (const cellIndex of newlyCorrectIndices) {
    const claim = await tx.run(`INSERT INTO user_template_xp_cells
      (user_id,template_id,cell_index,earned_at)
      VALUES (?,?,?,?) ON CONFLICT (user_id,template_id,cell_index) DO NOTHING`,
    [userId, template.id, cellIndex, now]);
    newCorrectCells += Number(claim.changes || 0);
  }

  let paintingAward = null;
  if (newCorrectCells > 0) {
    paintingAward = await awardXp(tx, {
      userId,
      eventType: 'correct_cells',
      dedupeKey: `paint:${template.id}:${revision}`,
      amount: newCorrectCells * XP_REWARDS.correct_cell,
      metadata: { template_id: template.id, revision, correct_cells: newCorrectCells },
      now,
    });
  }

  let completionAward = null;
  if (justCompleted) {
    completionAward = await awardXp(tx, {
      userId,
      eventType: 'template_complete',
      dedupeKey: `template-complete:${template.id}`,
      amount: XP_REWARDS.template_complete,
      metadata: { template_id: template.id },
      now,
    });
  }

  const daily = await recordDailyChallengeProgress(tx, {
    userId,
    template,
    deltaCorrectCells,
    now,
  });

  const weekly = await recordWeeklyChallengeProgress(tx, { userId, deltaCorrectCells: newCorrectCells, now });

  return {
    progression: await getUserProgression(tx, userId),
    daily_challenge: daily,
    weekly_challenge: weekly,
    xp_awarded: (paintingAward?.amount || 0) + (completionAward?.amount || 0) + (daily?.xp_awarded || 0) + (weekly?.xp_awarded || 0),
    completed_cells: completedCells,
  };
}

export { countCorrectCells, utcDateKey };
