export function applyStroke(state, stroke) {
  if (!stroke.indices.length) return state;
  const next = [...state];
  for (const idx of stroke.indices) {
    next[idx] = stroke.color;
  }
  return next;
}

export function undoStroke(filled, history) {
  if (!history.length) return { filled, history, undone: null };
  const last = history[history.length - 1];
  const next = [...filled];
  for (const change of last.changes) {
    next[change.index] = change.from;
  }
  return {
    filled: next,
    history: history.slice(0, -1),
    undone: last,
  };
}

export function redoStroke(filled, future) {
  if (!future.length) return { filled, future, redone: null };
  const next = future[future.length - 1];
  const result = [...filled];
  for (const change of next.changes) {
    result[change.index] = change.to;
  }
  return {
    filled: result,
    future: future.slice(0, -1),
    redone: next,
  };
}

export function createStrokeOperation(stroke, prevFilled) {
  const changes = [];
  for (const idx of stroke.indices) {
    changes.push({ index: idx, from: prevFilled[idx], to: stroke.color });
  }
  return {
    type: 'stroke',
    color: stroke.color,
    timestamp: Date.now(),
    changes,
  };
}
