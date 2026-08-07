// server/services/progression-achievements.js
//
// Server-verified achievement and streak rules. Every write is an atomic
// UPSERT/CAS so concurrent painting actions can never double-grant or corrupt
// a streak. These helpers must only be called with the caller's transaction.

const STYLE_ACHIEVEMENT_GROUPS = Object.freeze([
  { id: 'ach_style_night', themes: ['night-city', 'space'] },
  { id: 'ach_style_forest', themes: ['forest', 'cozy'] },
  { id: 'ach_style_space', themes: ['space', 'sea'] },
]);

/**
 * Idempotently unlock one achievement. The primary key on
 * (user_id, achievement_id) is the concurrency guard; a second transaction
 * that reaches the same rule is a no-op.
 */
export async function unlockAchievement(tx, {
  userId,
  achievementId,
  now = new Date().toISOString(),
} = {}) {
  const def = await tx.get('SELECT 1 FROM achievements WHERE id=?', [achievementId]);
  if (!def) return { granted: false, exists: false, achievementId };
  const result = await tx.run(`INSERT INTO user_achievements (user_id,achievement_id,unlocked_at)
    VALUES (?,?,?) ON CONFLICT (user_id,achievement_id) DO NOTHING`, [userId, achievementId, now]);
  return { granted: Boolean(result.changes), exists: true, achievementId };
}

function utcDateKey(now) {
  return String(now || new Date().toISOString()).slice(0, 10);
}

function dayGap(today, lastActiveDate) {
  if (!lastActiveDate) return 999;
  return Math.round((Date.parse(today) - Date.parse(lastActiveDate)) / 86_400_000);
}

/**
 * Register a painted day exactly once per UTC date using CAS semantics.
 * If another transaction wins the INSERT or changes the row between our read
 * and write, we retry against the new state instead of double-counting.
 * Streak achievements are granted from the resulting authoritative streak.
 */
export async function touchDailyStreak(tx, {
  userId,
  now = new Date().toISOString(),
} = {}) {
  const today = utcDateKey(now);
  let streak = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await tx.get('SELECT * FROM daily_streaks WHERE user_id=?', [userId]);

    if (!existing) {
      const inserted = await tx.run(`INSERT INTO daily_streaks
        (user_id,current_streak,longest_streak,total_days,last_active_date,created_at,updated_at)
        VALUES (?,1,1,1,?,?,?) ON CONFLICT (user_id) DO NOTHING`,
      [userId, today, now, now]);
      if (inserted.changes) {
        streak = {
          user_id: userId,
          current_streak: 1,
          longest_streak: 1,
          total_days: 1,
          last_active_date: today,
          created_at: now,
          updated_at: now,
        };
        break;
      }
      continue;
    }

    if (existing.last_active_date === today) {
      streak = existing;
      break;
    }

    const gap = dayGap(today, existing.last_active_date);
    const nextCurrent = gap === 1 ? Number(existing.current_streak || 0) + 1 : 1;
    const longest = Math.max(Number(existing.longest_streak || 0), nextCurrent);
    const nullGuard = existing.last_active_date == null ? 'last_active_date IS NULL' : 'last_active_date=?';
    const baseParams = [nextCurrent, longest, today, now, userId];
    const params = nullGuard.includes('?')
      ? [...baseParams, existing.last_active_date]
      : baseParams;
    const updated = await tx.run(`UPDATE daily_streaks
      SET current_streak=?, longest_streak=?, total_days=total_days+1, last_active_date=?, updated_at=?
      WHERE user_id=? AND ${nullGuard}`, params);
    if (updated.changes) {
      streak = {
        ...existing,
        current_streak: nextCurrent,
        longest_streak: longest,
        total_days: Number(existing.total_days || 0) + 1,
        last_active_date: today,
        updated_at: now,
      };
      break;
    }
  }

  if (!streak) throw new Error('Daily streak update failed after concurrent retries');

  const grants = [];
  if (Number(streak.current_streak) >= 3) {
    grants.push(await unlockAchievement(tx, { userId, achievementId: 'ach_daily_3', now }));
  }
  if (Number(streak.current_streak) >= 7) {
    grants.push(await unlockAchievement(tx, { userId, achievementId: 'ach_daily_7', now }));
  }
  return { streak, grants };
}

async function completedArtworkCount(tx, userId, { theme = null } = {}) {
  const join = theme ? ' JOIN coloring_templates t ON a.template_id=t.id' : '';
  const where = theme ? ' AND t.theme IN (?,?,?)' : '';
  const row = await tx.get(`SELECT COUNT(*) AS c FROM artworks a${join}
    WHERE a.owner_id=? AND a.is_completed=1${where}`, theme ? [userId, ...theme] : [userId]);
  return Number(row?.c || 0);
}

async function collectorEligible(tx, userId, { template, includeCurrent }) {
  const owned = await tx.get('SELECT 1 FROM collection_ownerships WHERE user_id=? LIMIT 1', [userId]);
  if (owned) return true;
  const completed = await tx.get('SELECT 1 FROM artworks WHERE owner_id=? AND is_completed=1 AND collection_id IS NOT NULL LIMIT 1', [userId]);
  if (completed) return true;
  return Boolean(includeCurrent && template.collection_id);
}

/**
 * Evaluate painting achievements from server state. `firstPaint` and
 * `justCompleted` are derived by the caller from the validated progress
 * transition; thresholds are counted from the authoritative artworks table
 * so legacy and tiled completion behave identically.
 */
export async function grantPaintingAchievements(tx, {
  userId,
  template,
  painted = false,
  firstPaint = false,
  justCompleted = false,
  now = new Date().toISOString(),
} = {}) {
  const grants = [];

  if (painted && firstPaint) {
    grants.push(await unlockAchievement(tx, { userId, achievementId: 'ach_first_pixel', now }));
  }

  if (!justCompleted) return grants;

  const alreadyCounted = await tx.get(
    'SELECT 1 FROM artworks WHERE owner_id=? AND template_id=? AND is_completed=1',
    [userId, template.id],
  );
  const includeCurrent = !alreadyCounted;
  const total = (await completedArtworkCount(tx, userId)) + (includeCurrent ? 1 : 0);

  if (total >= 1) {
    grants.push(await unlockAchievement(tx, { userId, achievementId: 'ach_first_zone', now }));
  }
  if (total >= 5) {
    grants.push(await unlockAchievement(tx, { userId, achievementId: 'ach_complete_5', now }));
  }

  for (const group of STYLE_ACHIEVEMENT_GROUPS) {
    if (!group.themes.includes(template.theme)) continue;
    const count = (await completedArtworkCount(tx, userId, { theme: group.themes })) + (includeCurrent ? 1 : 0);
    if (count >= 3) {
      grants.push(await unlockAchievement(tx, { userId, achievementId: group.id, now }));
    }
  }

  if (await collectorEligible(tx, userId, { template, includeCurrent })) {
    grants.push(await unlockAchievement(tx, { userId, achievementId: 'ach_collector', now }));
  }

  return grants;
}
