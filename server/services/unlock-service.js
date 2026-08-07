// server/services/unlock-service.js
//
// Server-authoritative unlock evaluation and grant. Every rule reads facts
// already persisted by the server (level/XP, achievements, streak, completed
// artworks/collections) and never accepts a client-supplied claim. Grants are
// materialized with primary-key idempotence: a losing concurrent transaction
// is a no-op. All helpers expect a db-like object (global db or tx adapter).

export const SUBJECT_TEMPLATE = 'template';
export const SUBJECT_COLLECTION = 'collection';

export const STATE_AVAILABLE = 'available';
export const STATE_OWNED = 'owned';
export const STATE_PROGRESSION_LOCKED = 'progression_locked';
export const STATE_PREMIUM_LOCKED = 'premium_locked';

export const REASON_CODES = Object.freeze({
  AVAILABLE: 'CONTENT_AVAILABLE',
  OWNED: 'CONTENT_OWNED',
  PROGRESSION_REQUIRED: 'PROGRESSION_REQUIRED',
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
  UNLOCK_READY: 'UNLOCK_READY',
  LEVEL_REQUIRED: 'LEVEL_REQUIRED',
  XP_REQUIRED: 'XP_REQUIRED',
  ACHIEVEMENT_REQUIRED: 'ACHIEVEMENT_REQUIRED',
  STREAK_REQUIRED: 'STREAK_REQUIRED',
  COMPLETIONS_REQUIRED: 'COMPLETIONS_REQUIRED',
  COLLECTION_REQUIRED: 'COLLECTION_REQUIRED',
});

const RULE_LABELS = Object.freeze({
  level: 'Уровень',
  xp: 'Опыт (XP)',
  achievement: 'Достижение',
  streak: 'Серия дней',
  completed_artworks: 'Завершённые раскраски',
  collection_completion: 'Завершённая коллекция',
});

const RULE_REASON_CODES = Object.freeze({
  level: REASON_CODES.LEVEL_REQUIRED,
  xp: REASON_CODES.XP_REQUIRED,
  achievement: REASON_CODES.ACHIEVEMENT_REQUIRED,
  streak: REASON_CODES.STREAK_REQUIRED,
  completed_artworks: REASON_CODES.COMPLETIONS_REQUIRED,
  collection_completion: REASON_CODES.COLLECTION_REQUIRED,
});

export class UnlockLockedError extends Error {
  constructor(message, code, unlock) {
    super(message);
    this.name = 'UnlockLockedError';
    this.code = code;
    this.status = 403;
    this.unlock = unlock;
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampProgress(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000) / 1_000;
}

function placeholderList(values) {
  return values.map(() => '?').join(',');
}

/**
 * Gather every fact used by unlock rules. All queries are bounded aggregates;
 * no per-cell arrays are read.
 */
export async function collectProgressionFacts(db, userId) {
  const user = await db.get('SELECT level, xp_total FROM users WHERE id=?', [userId]);
  const streak = await db.get('SELECT longest_streak FROM daily_streaks WHERE user_id=?', [userId]);
  const achievementRows = await db.all('SELECT achievement_id FROM user_achievements WHERE user_id=?', [userId]);
  const completedArtworks = await db.get(
    'SELECT COUNT(*) AS c FROM artworks WHERE owner_id=? AND is_completed=1',
    [userId],
  );
  const completedByCollection = await db.all(
    `SELECT collection_id, COUNT(*) AS c FROM artworks
      WHERE owner_id=? AND is_completed=1 AND collection_id IS NOT NULL
      GROUP BY collection_id`,
    [userId],
  );
  const collectionTotals = await db.all(
    `SELECT collection_id, COUNT(*) AS c FROM coloring_templates
      WHERE collection_id IS NOT NULL AND status='active'
      GROUP BY collection_id`,
  );
  const ownershipRows = await db.all(
    'SELECT collection_id FROM collection_ownerships WHERE user_id=?',
    [userId],
  );
  const entitlementRows = await db.all(
    'SELECT template_id FROM template_entitlements WHERE user_id=?',
    [userId],
  );
  const completedTemplates = await db.all(
    'SELECT template_id FROM artworks WHERE owner_id=? AND is_completed=1 AND template_id IS NOT NULL',
    [userId],
  );

  const collectionProgress = new Map();
  for (const row of completedByCollection) {
    collectionProgress.set(row.collection_id, {
      completed: toNumber(row.c, 0),
      total: toNumber(collectionTotals.find((item) => item.collection_id === row.collection_id)?.c, 0),
    });
  }
  for (const row of collectionTotals) {
    const existing = collectionProgress.get(row.collection_id);
    if (!existing) {
      collectionProgress.set(row.collection_id, { completed: 0, total: toNumber(row.c, 0) });
    } else {
      existing.total = toNumber(row.c, 0);
    }
  }

  return {
    userId,
    level: Math.max(1, toNumber(user?.level, 1)),
    xp_total: Math.max(0, toNumber(user?.xp_total, 0)),
    longest_streak: Math.max(0, toNumber(streak?.longest_streak, 0)),
    achievements: new Set(achievementRows.map((row) => row.achievement_id)),
    completed_artworks: Math.max(0, toNumber(completedArtworks?.c, 0)),
    collection_progress: collectionProgress,
    owned_collections: new Set(ownershipRows.map((row) => row.collection_id)),
    owned_templates: new Set(entitlementRows.map((row) => row.template_id)),
    completed_templates: new Set(completedTemplates.map((row) => row.template_id)),
  };
}

export async function getUnlockRules(db, subjectType, subjectId) {
  if (subjectId === null || subjectId === undefined) return [];
  return db.all(
    'SELECT * FROM unlock_rules WHERE subject_type=? AND subject_id=? ORDER BY rule_order ASC, rule_type ASC',
    [subjectType, subjectId],
  );
}

function ruleRequirement(rule, facts) {
  const type = rule.rule_type;
  const target = String(rule.target_value || '');
  const base = {
    rule_type: type,
    target_value: target,
    label: RULE_LABELS[type] || type,
    reason_code: RULE_REASON_CODES[type] || REASON_CODES.PROGRESSION_REQUIRED,
  };

  if (type === 'level') {
    const numericTarget = toNumber(target, 1);
    const current = facts.level;
    return {
      ...base,
      target: numericTarget,
      current,
      satisfied: current >= numericTarget,
      progress: clampProgress(current / numericTarget),
    };
  }
  if (type === 'xp') {
    const numericTarget = toNumber(target, 1);
    const current = facts.xp_total;
    return {
      ...base,
      target: numericTarget,
      current,
      satisfied: current >= numericTarget,
      progress: clampProgress(current / numericTarget),
    };
  }
  if (type === 'achievement') {
    const satisfied = facts.achievements.has(target);
    return {
      ...base,
      target: target,
      current: satisfied ? 1 : 0,
      satisfied,
      progress: satisfied ? 1 : 0,
    };
  }
  if (type === 'streak') {
    const numericTarget = toNumber(target, 1);
    const current = facts.longest_streak;
    return {
      ...base,
      target: numericTarget,
      current,
      satisfied: current >= numericTarget,
      progress: clampProgress(current / numericTarget),
    };
  }
  if (type === 'completed_artworks') {
    const numericTarget = toNumber(target, 1);
    const current = facts.completed_artworks;
    return {
      ...base,
      target: numericTarget,
      current,
      satisfied: current >= numericTarget,
      progress: clampProgress(current / numericTarget),
    };
  }
  if (type === 'collection_completion') {
    const progress = facts.collection_progress.get(target) || { completed: 0, total: 0 };
    const satisfied = progress.total > 0 && progress.completed >= progress.total;
    return {
      ...base,
      target: target,
      collection_completed: progress.completed,
      collection_total: progress.total,
      current: progress.completed,
      total: progress.total,
      satisfied,
      progress: progress.total > 0 ? clampProgress(progress.completed / progress.total) : 0,
    };
  }
  return { ...base, target, current: 0, satisfied: false, progress: 0 };
}

export function evaluateRuleSet(rules, facts) {
  if (!rules || rules.length === 0) {
    return { satisfied: true, requirements: [] };
  }
  const requirements = rules.map((rule) => ruleRequirement(rule, facts));
  return {
    satisfied: requirements.every((requirement) => requirement.satisfied),
    requirements,
  };
}

/**
 * Free/progression collections may be granted only when every rule is
 * satisfied and the collection is not premium. The primary key on
 * (user_id, collection_id) makes concurrent first grants collapse.
 */
export async function grantCollectionUnlock(db, userId, collectionId, { now = new Date().toISOString() } = {}) {
  if (!collectionId) return { granted: false, reason: 'NOT_FOUND' };
  const collection = await db.get('SELECT id, pack_type FROM collections WHERE id=?', [collectionId]);
  if (!collection) return { granted: false, reason: 'NOT_FOUND' };
  if (collection.pack_type === 'premium') return { granted: false, reason: REASON_CODES.PREMIUM_REQUIRED };

  const rules = await getUnlockRules(db, SUBJECT_COLLECTION, collectionId);
  if (rules.length) {
    const facts = await collectProgressionFacts(db, userId);
    const evaluation = evaluateRuleSet(rules, facts);
    if (!evaluation.satisfied) return { granted: false, reason: REASON_CODES.PROGRESSION_REQUIRED };
  }

  const result = await db.run(
    `INSERT INTO collection_ownerships
      (user_id, collection_id, acquisition_type, price_paid, stars_operation_id, created_at)
      VALUES (?,?, 'free', 0, NULL, ?)
      ON CONFLICT (user_id, collection_id) DO NOTHING`,
    [userId, collectionId, now],
  );
  return {
    granted: Boolean(result.changes),
    reason: result.changes ? 'GRANTED' : 'ALREADY_OWNED',
  };
}

/**
 * Template entitlements are granted only after the same server-side rule
 * evaluation used by reads. ON CONFLICT DO NOTHING prevents double grants.
 */
export async function grantTemplateUnlock(db, userId, templateId, { now = new Date().toISOString() } = {}) {
  if (!templateId) return { granted: false, reason: 'NOT_FOUND' };
  const template = await db.get('SELECT id, collection_id FROM coloring_templates WHERE id=?', [templateId]);
  if (!template) return { granted: false, reason: 'NOT_FOUND' };

  if (template.collection_id) {
    const collection = await db.get('SELECT id, pack_type FROM collections WHERE id=?', [template.collection_id]);
    if (collection?.pack_type === 'premium') {
      const facts = await collectProgressionFacts(db, userId);
      if (!facts.owned_collections.has(template.collection_id)) {
        return { granted: false, reason: REASON_CODES.PREMIUM_REQUIRED };
      }
    }
  }

  const rules = await getUnlockRules(db, SUBJECT_TEMPLATE, templateId);
  if (rules.length) {
    const facts = await collectProgressionFacts(db, userId);
    const evaluation = evaluateRuleSet(rules, facts);
    if (!evaluation.satisfied) return { granted: false, reason: REASON_CODES.PROGRESSION_REQUIRED };
  }

  const result = await db.run(
    `INSERT INTO template_entitlements (user_id, template_id, source, granted_at)
      VALUES (?,?,?,?)
      ON CONFLICT (user_id, template_id) DO NOTHING`,
    [userId, templateId, rules.length ? 'progression' : 'free', now],
  );
  return {
    granted: Boolean(result.changes),
    reason: result.changes ? 'GRANTED' : 'ALREADY_OWNED',
  };
}

async function loadCollectionForTemplate(db, collectionId) {
  if (!collectionId) return null;
  return db.get('SELECT id, title, pack_type, price_in_stars FROM collections WHERE id=?', [collectionId]);
}

function evaluateTemplateState({
  userId,
  template,
  collection,
  templateRules,
  collectionRules,
  facts,
  entitlementOwned,
  collectionOwned,
}) {
  if (template.owner_id === userId) {
    return {
      state: STATE_OWNED,
      owned: true,
      locked: false,
      reason_code: REASON_CODES.OWNED,
      requirements: [],
      grant_required: false,
      grant_target: null,
    };
  }

  if (collection && !collectionOwned) {
    if (collection.pack_type === 'premium') {
      return {
        state: STATE_PREMIUM_LOCKED,
        owned: false,
        locked: true,
        reason_code: REASON_CODES.PREMIUM_REQUIRED,
        requirements: [{
          rule_type: 'premium',
          target_value: collection.id,
          label: 'Премиум-коллекция',
          reason_code: REASON_CODES.PREMIUM_REQUIRED,
          target: collection.price_in_stars || 0,
          current: 0,
          satisfied: false,
          progress: 0,
        }],
        grant_required: false,
        grant_target: null,
      };
    }
    if (collectionRules.length) {
      const evaluation = evaluateRuleSet(collectionRules, facts);
      if (!evaluation.satisfied) {
        return {
          state: STATE_PROGRESSION_LOCKED,
          owned: false,
          locked: true,
          reason_code: REASON_CODES.PROGRESSION_REQUIRED,
          requirements: evaluation.requirements,
          grant_required: false,
          grant_target: null,
        };
      }
      return {
        state: STATE_AVAILABLE,
        owned: false,
        locked: false,
        reason_code: REASON_CODES.UNLOCK_READY,
        requirements: evaluation.requirements,
        grant_required: true,
        grant_target: SUBJECT_COLLECTION,
      };
    }
  }

  if (templateRules.length) {
    const evaluation = evaluateRuleSet(templateRules, facts);
    if (!evaluation.satisfied) {
      return {
        state: STATE_PROGRESSION_LOCKED,
        owned: false,
        locked: true,
        reason_code: REASON_CODES.PROGRESSION_REQUIRED,
        requirements: evaluation.requirements,
        grant_required: false,
        grant_target: null,
      };
    }
    if (!entitlementOwned) {
      return {
        state: STATE_AVAILABLE,
        owned: false,
        locked: false,
        reason_code: REASON_CODES.UNLOCK_READY,
        requirements: evaluation.requirements,
        grant_required: true,
        grant_target: SUBJECT_TEMPLATE,
      };
    }
  }

  if (collectionOwned) {
    return {
      state: STATE_OWNED,
      owned: true,
      locked: false,
      reason_code: REASON_CODES.OWNED,
      requirements: [],
      grant_required: false,
      grant_target: null,
    };
  }

  return {
    state: STATE_AVAILABLE,
    owned: false,
    locked: false,
    reason_code: REASON_CODES.AVAILABLE,
    requirements: [],
    grant_required: false,
    grant_target: null,
  };
}

export async function getTemplateUnlockState(db, userId, template, options = {}) {
  if (!template) return null;
  const facts = options.facts || await collectProgressionFacts(db, userId);
  const collection = options.collection !== undefined
    ? options.collection
    : await loadCollectionForTemplate(db, template.collection_id);
  const collectionOwned = options.collectionOwned !== undefined
    ? options.collectionOwned
    : Boolean(collection && facts.owned_collections.has(collection.id));
  const entitlementOwned = options.entitlementOwned !== undefined
    ? options.entitlementOwned
    : facts.owned_templates.has(template.id);
  const collectionRules = (!collectionOwned && collection)
    ? await getUnlockRules(db, SUBJECT_COLLECTION, collection.id)
    : [];
  const templateRules = await getUnlockRules(db, SUBJECT_TEMPLATE, template.id);

  return evaluateTemplateState({
    userId,
    template,
    collection,
    templateRules,
    collectionRules,
    facts,
    entitlementOwned,
    collectionOwned,
  });
}

/**
 * Enforce the authoritative read/start gate. When grant=true and rules are
 * satisfied, entitlement materialization happens in the caller's transaction
 * (callers must pass a tx adapter on write paths).
 */
export async function assertTemplateAccessible(db, userId, template, {
  grant = true,
  now = new Date().toISOString(),
} = {}) {
  const state = await getTemplateUnlockState(db, userId, template);
  if (state.locked) return { ...state, granted: false };
  if (!grant || !state.grant_required) return { ...state, granted: false };

  let grantResult = null;
  if (state.grant_target === SUBJECT_TEMPLATE) {
    grantResult = await grantTemplateUnlock(db, userId, template.id, { now });
  } else if (state.grant_target === SUBJECT_COLLECTION) {
    grantResult = await grantCollectionUnlock(db, userId, template.collection_id, { now });
  }

  return {
    ...state,
    state: STATE_OWNED,
    owned: true,
    locked: false,
    grant_required: false,
    granted: Boolean(grantResult?.granted),
    grant_reason: grantResult?.reason || null,
  };
}

export async function getCollectionUnlockState(db, userId, collection, options = {}) {
  if (!collection) return null;
  const facts = options.facts || await collectProgressionFacts(db, userId);
  const owned = options.owned !== undefined ? options.owned : facts.owned_collections.has(collection.id);
  if (owned) {
    return {
      state: STATE_OWNED,
      owned: true,
      locked: false,
      reason_code: REASON_CODES.OWNED,
      requirements: [],
      grant_required: false,
    };
  }
  if (collection.pack_type === 'premium') {
    return {
      state: STATE_PREMIUM_LOCKED,
      owned: false,
      locked: true,
      reason_code: REASON_CODES.PREMIUM_REQUIRED,
      requirements: [{
        rule_type: 'premium',
        target_value: collection.id,
        label: 'Премиум-коллекция',
        reason_code: REASON_CODES.PREMIUM_REQUIRED,
        target: toNumber(collection.price_in_stars, 0),
        current: 0,
        satisfied: false,
        progress: 0,
      }],
      grant_required: false,
    };
  }

  const rules = await getUnlockRules(db, SUBJECT_COLLECTION, collection.id);
  if (rules.length) {
    const evaluation = evaluateRuleSet(rules, facts);
    if (!evaluation.satisfied) {
      return {
        state: STATE_PROGRESSION_LOCKED,
        owned: false,
        locked: true,
        reason_code: REASON_CODES.PROGRESSION_REQUIRED,
        requirements: evaluation.requirements,
        grant_required: false,
      };
    }
    return {
      state: STATE_AVAILABLE,
      owned: false,
      locked: false,
      reason_code: REASON_CODES.UNLOCK_READY,
      requirements: evaluation.requirements,
      grant_required: true,
    };
  }
  return {
    state: STATE_AVAILABLE,
    owned: false,
    locked: false,
    reason_code: REASON_CODES.AVAILABLE,
    requirements: [],
    grant_required: false,
  };
}

export async function assertCollectionAccessible(db, userId, collection, {
  grant = true,
  now = new Date().toISOString(),
} = {}) {
  const state = await getCollectionUnlockState(db, userId, collection);
  if (state.locked) return { ...state, granted: false };
  if (!grant || !state.grant_required) return { ...state, granted: false };
  const grantResult = await grantCollectionUnlock(db, userId, collection.id, { now });
  return {
    ...state,
    state: STATE_OWNED,
    owned: true,
    locked: false,
    grant_required: false,
    granted: Boolean(grantResult?.granted),
    grant_reason: grantResult?.reason || null,
  };
}

function lockedErrorFor(state) {
  return new UnlockLockedError(
    state.state === STATE_PREMIUM_LOCKED
      ? 'Контент доступен после покупки премиум-коллекции'
      : 'Контент ещё не открыт',
    state.reason_code,
    state,
  );
}

export function throwIfLocked(state) {
  if (state?.locked) throw lockedErrorFor(state);
  return state;
}

/**
 * Batch unlock flags for catalog-like rows. This is read-only and bounded:
 * facts, rules, entitlements, and ownerships are loaded per batch, never per
 * cell or per row.
 */
export async function attachUnlockFlags(db, rows, userId, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const facts = options.facts || await collectProgressionFacts(db, userId);
  const templateIds = [...new Set(rows.map((row) => row.id).filter(Boolean))];
  const collectionIds = [...new Set(rows.map((row) => row.collection_id).filter(Boolean))];
  if (!templateIds.length) return rows;

  const templatePlaceholders = placeholderList(templateIds);
  const collectionPlaceholders = collectionIds.length ? placeholderList(collectionIds) : null;
  const clauses = [
    `(subject_type='template' AND subject_id IN (${templatePlaceholders}))`,
  ];
  const params = [...templateIds];
  if (collectionPlaceholders) {
    clauses.push(`(subject_type='collection' AND subject_id IN (${collectionPlaceholders}))`);
    params.push(...collectionIds);
  }
  const ruleRows = await db.all(
    `SELECT * FROM unlock_rules WHERE ${clauses.join(' OR ')} ORDER BY subject_type, subject_id, rule_order, rule_type`,
    params,
  );
  const rulesBySubject = new Map();
  for (const rule of ruleRows) {
    const key = `${rule.subject_type}:${rule.subject_id}`;
    if (!rulesBySubject.has(key)) rulesBySubject.set(key, []);
    rulesBySubject.get(key).push(rule);
  }

  const entitlementRows = await db.all(
    `SELECT template_id FROM template_entitlements
      WHERE user_id=? AND template_id IN (${templatePlaceholders})`,
    [userId, ...templateIds],
  );
  const entitlementSet = new Set(entitlementRows.map((row) => row.template_id));

  const collectionMap = new Map();
  if (collectionIds.length) {
    const collectionRows = await db.all(
      `SELECT id, title, pack_type, price_in_stars FROM collections
        WHERE id IN (${collectionPlaceholders})`,
      collectionIds,
    );
    for (const row of collectionRows) collectionMap.set(row.id, row);
  }

  return rows.map((row) => {
    const collection = row.collection_id ? (collectionMap.get(row.collection_id) || null) : null;
    const collectionOwned = Boolean(collection && facts.owned_collections.has(collection.id));
    const state = evaluateTemplateState({
      userId,
      template: row,
      collection,
      templateRules: rulesBySubject.get(`${SUBJECT_TEMPLATE}:${row.id}`) || [],
      collectionRules: collection ? (rulesBySubject.get(`${SUBJECT_COLLECTION}:${collection.id}`) || []) : [],
      facts,
      entitlementOwned: entitlementSet.has(row.id),
      collectionOwned,
    });
    if (state.state === STATE_AVAILABLE) return row;
    return {
      ...row,
      unlock_state: state.state,
      unlock_reason_code: state.reason_code,
    };
  });
}

async function gatedSubjects(db) {
  const rows = await db.all(
    'SELECT subject_type, subject_id FROM unlock_rules GROUP BY subject_type, subject_id ORDER BY subject_type, subject_id',
  );
  const premiumCollections = await db.all(
    `SELECT id AS subject_id FROM collections
      WHERE pack_type='premium' AND owner_id IS NULL AND status='published' AND visibility='public'
      ORDER BY title`,
  );
  const premiumTemplates = await db.all(
    `SELECT t.id AS subject_id FROM coloring_templates t
      JOIN collections c ON c.id=t.collection_id
      WHERE c.pack_type='premium' AND t.status='active' AND t.visibility='public'
      ORDER BY t.title`,
  );
  const subjects = rows.map((row) => ({ subject_type: row.subject_type, subject_id: row.subject_id }));
  for (const row of premiumCollections) subjects.push({ subject_type: SUBJECT_COLLECTION, subject_id: row.subject_id });
  for (const row of premiumTemplates) subjects.push({ subject_type: SUBJECT_TEMPLATE, subject_id: row.subject_id });
  return subjects;
}

async function subjectTitle(db, subjectType, subjectId) {
  const table = subjectType === SUBJECT_COLLECTION ? 'collections' : 'coloring_templates';
  const row = await db.get(`SELECT title FROM ${table} WHERE id=?`, [subjectId]);
  return row?.title || subjectId;
}

/**
 * Bounded snapshot of all gated content. Only rules, premium subjects, and
 * aggregate facts are loaded; cell maps are never read.
 */
export async function getUserUnlockSnapshot(db, userId) {
  const facts = await collectProgressionFacts(db, userId);
  const subjects = await gatedSubjects(db);
  const collections = [];
  const templates = [];

  for (const subject of subjects) {
    const title = await subjectTitle(db, subject.subject_type, subject.subject_id);
    if (subject.subject_type === SUBJECT_COLLECTION) {
      const collection = await db.get('SELECT * FROM collections WHERE id=?', [subject.subject_id]);
      if (!collection) continue;
      const state = await getCollectionUnlockState(db, userId, collection, { facts });
      collections.push({ subject_type: subject.subject_type, subject_id: subject.subject_id, title, ...state });
    } else {
      const template = await db.get('SELECT * FROM coloring_templates WHERE id=?', [subject.subject_id]);
      if (!template) continue;
      const state = await getTemplateUnlockState(db, userId, template, { facts });
      templates.push({ subject_type: subject.subject_type, subject_id: subject.subject_id, title, ...state });
    }
  }

  const nextActionable = await getNextActionableUnlocks(db, userId, { facts, limit: 3 });
  const allSubjects = [...collections, ...templates];
  const count = (state) => allSubjects.filter((subject) => subject.state === state).length;
  const completedCollections = [...facts.collection_progress.entries()]
    .filter(([, progress]) => progress.total > 0 && progress.completed >= progress.total)
    .map(([collectionId, progress]) => ({ collection_id: collectionId, ...progress }));

  return {
    user_id: userId,
    progression_facts: {
      level: facts.level,
      xp_total: facts.xp_total,
      longest_streak: facts.longest_streak,
      achievements_unlocked: facts.achievements.size,
      completed_artworks: facts.completed_artworks,
      completed_collections: completedCollections,
      owned_collections: facts.owned_collections.size,
      owned_templates: facts.owned_templates.size,
    },
    summary: {
      total_subjects: allSubjects.length,
      available: count(STATE_AVAILABLE),
      owned: count(STATE_OWNED),
      progression_locked: count(STATE_PROGRESSION_LOCKED),
      premium_locked: count(STATE_PREMIUM_LOCKED),
    },
    collections,
    templates,
    next_actionable: nextActionable,
  };
}

/**
 * Closest progression unlocks. Satisfied-but-not-granted subjects come first,
 * then subjects with the fewest unmet rules and the highest progress ratio.
 */
export async function getNextActionableUnlocks(db, userId, options = {}) {
  const limit = Math.min(10, Math.max(1, toNumber(options.limit, 3)));
  const facts = options.facts || await collectProgressionFacts(db, userId);
  const subjects = await gatedSubjects(db);
  const actionable = [];

  for (const subject of subjects) {
    const title = await subjectTitle(db, subject.subject_type, subject.subject_id);
    let state;
    if (subject.subject_type === SUBJECT_COLLECTION) {
      const collection = await db.get('SELECT * FROM collections WHERE id=?', [subject.subject_id]);
      if (!collection) continue;
      state = await getCollectionUnlockState(db, userId, collection, { facts });
    } else {
      const template = await db.get('SELECT * FROM coloring_templates WHERE id=?', [subject.subject_id]);
      if (!template) continue;
      state = await getTemplateUnlockState(db, userId, template, { facts });
    }
    if (state.state === STATE_PREMIUM_LOCKED || state.state === STATE_OWNED) continue;
    const unmet = state.requirements.filter((requirement) => !requirement.satisfied);
    const minProgress = unmet.length
      ? Math.min(...unmet.map((requirement) => toNumber(requirement.progress, 0)))
      : 1;
    actionable.push({
      subject_type: subject.subject_type,
      subject_id: subject.subject_id,
      title,
      state: state.state,
      reason_code: state.reason_code,
      requirements: state.requirements,
      unmet_rules: unmet.length,
      progress_ratio: minProgress,
      unlockable_now: state.state === STATE_AVAILABLE && state.grant_required,
    });
  }

  actionable.sort((a, b) => (
    (Number(b.unlockable_now) - Number(a.unlockable_now))
    || (a.unmet_rules - b.unmet_rules)
    || (b.progress_ratio - a.progress_ratio)
    || String(a.subject_type).localeCompare(String(b.subject_type))
    || String(a.subject_id).localeCompare(String(b.subject_id))
  ));
  return actionable.slice(0, limit);
}
