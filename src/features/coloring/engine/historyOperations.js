export function createHistoryOperation({ type, changes, color }) {
  const op = { type, timestamp: Date.now(), changes };
  if (color !== undefined) op.color = color;
  return op;
}

export function applyChanges(filled, changes, key) {
  const next = [...filled];
  for (const change of changes) {
    next[change.index] = change[key];
  }
  return next;
}

export const MAX_HISTORY = 100;
