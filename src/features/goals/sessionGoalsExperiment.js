export const SESSION_GOALS_MODES = Object.freeze({
  HIDDEN: 'hidden',
  CONTROL: 'control',
});

/**
 * Resolves the Canvas goal-card treatment without depending on core-feel.
 *
 * Recovery defaults to the no-goals treatment. The existing goal loop remains
 * available as an explicit control so visual and behavioral comparisons can
 * use deterministic URLs (/?sessionGoals=control or /?sessionGoals=hidden).
 */
export function resolveSessionGoalsExperiment(search = globalThis.location?.search || '') {
  const rawMode = new URLSearchParams(search).get('sessionGoals');
  const normalizedMode = String(rawMode || '').trim().toLowerCase();
  const mode = normalizedMode === SESSION_GOALS_MODES.CONTROL
    ? SESSION_GOALS_MODES.CONTROL
    : SESSION_GOALS_MODES.HIDDEN;

  return {
    mode,
    showGoals: mode === SESSION_GOALS_MODES.CONTROL,
    source: rawMode == null ? 'default' : 'query',
  };
}

/** Core-feel owns the full first-minute HUD and always suppresses this card. */
export function shouldShowSessionGoals(experiment, coreFeelActive = false) {
  return Boolean(experiment?.showGoals && !coreFeelActive);
}
