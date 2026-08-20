/**
 * Deterministic qualitative harness for the Phase 2 session slice.
 *
 * This is a bounded planning model, not a claim about human enjoyment and
 * not a replacement for the client/server implementation. It makes the
 * session contract inspectable before we have enough real-player telemetry:
 * manual versus assisted work, reveal/event cadence, interruption cost,
 * camera movement, and places where a player can naturally stop.
 *
 * Usage:
 *   node scripts/phase2-session-simulator.mjs
 *   node scripts/phase2-session-simulator.mjs --scenario 3m --variant treatment
 *   node scripts/phase2-session-simulator.mjs --json --seed 7
 */

const MS_PER_MINUTE = 60_000;

export const SESSION_SCENARIOS = Object.freeze({
  '30s': Object.freeze({ label: '30 seconds', durationMs: 30_000, seed: 30 }),
  '3m': Object.freeze({ label: '3 minutes', durationMs: 180_000, seed: 300 }),
  '15m': Object.freeze({ label: '15 minutes', durationMs: 900_000, seed: 1_500 }),
});

export const SESSION_VARIANTS = Object.freeze(['control', 'treatment']);

/**
 * A small, explicit workload fixture. The values are intentionally in the
 * same units that can later be replaced with observed Smart Director target
 * distributions. They are not production balance thresholds.
 */
export const PHASE2_REFERENCE_WORKLOAD = Object.freeze([
  Object.freeze({ id: 'contour', effortCells: 9, strokes: 3, fragmentation: 1, manualMs: 17_000, cameraShift: 0.12 }),
  Object.freeze({ id: 'cluster', effortCells: 13, strokes: 4, fragmentation: 2, manualMs: 23_000, cameraShift: 0.2 }),
  Object.freeze({ id: 'accent', effortCells: 7, strokes: 3, fragmentation: 1, manualMs: 13_000, cameraShift: 0.08 }),
  Object.freeze({ id: 'edge', effortCells: 16, strokes: 5, fragmentation: 3, manualMs: 28_000, cameraShift: 0.26 }),
  Object.freeze({ id: 'shape', effortCells: 11, strokes: 4, fragmentation: 2, manualMs: 20_000, cameraShift: 0.16 }),
  Object.freeze({ id: 'texture', effortCells: 18, strokes: 6, fragmentation: 4, manualMs: 31_000, cameraShift: 0.32 }),
]);

/**
 * Defaults are deliberately conservative. The simulator exposes the policy
 * so a later telemetry-backed profile can be compared without changing the
 * model or gameplay runtime.
 */
export const DEFAULT_SESSION_POLICY = Object.freeze({
  strokeOverheadMs: 420,
  revealSettleMs: 520,
  cameraTransitionMs: 360,
  spark: Object.freeze({
    // Phase 2 must prove one player-authored reveal before introducing an
    // assisted spectacle. This is a simulator contract, not a production
    // balance claim.
    firstTargetPity: false,
    minTargetsBeforeEvent: 2,
    minElapsedMsBeforeEvent: 45_000,
    cooldownMs: 180_000,
    minEffortScore: 10,
    everyTarget: 5,
    manualTriggerMs: 1_800,
    offerMs: 620,
    selectMs: 540,
    applyMs: 620,
    ownershipPauseMs: 900,
    assistedFraction: 0.72,
  }),
  artifact: Object.freeze({
    cooldownMs: 180_000,
    minEffortScore: 11,
    everyTarget: 7,
    discoveryMs: 440,
  }),
  stopPoint: Object.freeze({
    firstReveal: true,
    cadenceMs: 75_000,
    finalWindowMs: 12_000,
  }),
  idle: Object.freeze({
    reportThresholdMs: 700,
  }),
});

const EVENT_ACTIVITY = new Set(['manual_stroke', 'special_applied']);
const EVENT_SPECIAL = new Set(['special_applied', 'artifact_discovered']);

function integerSeed(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(Math.abs(parsed)) || fallback);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function mergePolicy(base, override) {
  if (!override) return base;
  return {
    ...base,
    ...override,
    spark: { ...base.spark, ...(override.spark || {}) },
    artifact: { ...base.artifact, ...(override.artifact || {}) },
    stopPoint: { ...base.stopPoint, ...(override.stopPoint || {}) },
    idle: { ...base.idle, ...(override.idle || {}) },
  };
}

function normalizeVariant(variant) {
  const normalized = String(variant || 'treatment').trim().toLowerCase();
  return SESSION_VARIANTS.includes(normalized) ? normalized : 'treatment';
}

function resolveScenario(scenario) {
  if (typeof scenario === 'object' && scenario && Number.isFinite(scenario.durationMs)) {
    return {
      id: String(scenario.id || 'custom'),
      label: String(scenario.label || scenario.id || 'Custom'),
      durationMs: Math.max(1, Math.floor(scenario.durationMs)),
      seed: integerSeed(scenario.seed, 1),
    };
  }
  const id = String(scenario || 'all');
  if (SESSION_SCENARIOS[id]) return { id, ...SESSION_SCENARIOS[id] };
  throw new Error(`Unknown session scenario: ${id}. Expected 30s, 3m or 15m.`);
}

function targetEffortScore(target, recentWorkloadMs = 0) {
  // Cells and strokes describe work; fragmentation describes search/context
  // switching; recent workload prevents a special from clustering too tightly.
  return round(
    target.effortCells * 0.52
      + target.strokes * 1.3
      + target.fragmentation * 1.8
      + target.manualMs / 10_000
      + Math.min(2, recentWorkloadMs / 120_000),
    2,
  );
}

function targetAt(workload, index, seed) {
  const offset = (integerSeed(seed) - 1) % workload.length;
  const source = workload[index === 0 ? 0 : (index + offset) % workload.length];
  return {
    ...source,
    targetIndex: index,
    id: `${source.id}-${index + 1}`,
    effortScore: targetEffortScore(source),
  };
}

function incrementCost(cost, delta = {}) {
  for (const key of Object.keys(cost)) cost[key] += Number(delta[key] || 0);
}

function createEvent(type, atMs, details = {}) {
  return {
    type,
    atMs: Math.max(0, Math.round(atMs)),
    ...details,
  };
}

function createSimulationState(scenario, variant, seed, policy) {
  return {
    scenario,
    variant,
    seed,
    policy,
    nowMs: 0,
    events: [],
    targetIndex: 0,
    lastRevealMs: null,
    lastSpecialMs: null,
    lastArtifactMs: null,
    lastStopPointMs: null,
    recentWorkloadMs: 0,
    cost: {
      taps: 0,
      modalInterruptions: 0,
      pauses: 0,
      cameraChanges: 0,
      cognitiveSwitches: 0,
    },
  };
}

function addEvent(state, type, details = {}) {
  if (state.nowMs > state.scenario.durationMs) return false;
  state.events.push(createEvent(type, state.nowMs, details));
  return true;
}

function advance(state, durationMs) {
  const duration = Math.max(0, Number(durationMs) || 0);
  const remaining = Math.max(0, state.scenario.durationMs - state.nowMs);
  const actual = Math.min(duration, remaining);
  state.nowMs += actual;
  return actual === duration;
}

function shouldOfferSpark(state, target) {
  const { spark } = state.policy;
  if (state.variant !== 'treatment') return false;
  if (target.targetIndex === 0 && spark.firstTargetPity) return true;
  if (target.targetIndex < spark.minTargetsBeforeEvent) return false;
  if (state.nowMs < spark.minElapsedMsBeforeEvent || target.targetIndex % spark.everyTarget !== 0) return false;
  if (state.lastSpecialMs != null && state.nowMs - state.lastSpecialMs < spark.cooldownMs) return false;
  return targetEffortScore(target, state.recentWorkloadMs) >= spark.minEffortScore;
}

function shouldDiscoverArtifact(state, target) {
  const { artifact } = state.policy;
  if (state.variant !== 'treatment') return false;
  if (target.targetIndex === 0 || target.targetIndex % artifact.everyTarget !== 0) return false;
  if (state.lastArtifactMs != null && state.nowMs - state.lastArtifactMs < artifact.cooldownMs) return false;
  return targetEffortScore(target, state.recentWorkloadMs) >= artifact.minEffortScore;
}

function shouldOfferStopPoint(state) {
  const { stopPoint } = state.policy;
  if (state.lastRevealMs == null) return Boolean(stopPoint.firstReveal);
  if (state.nowMs - (state.lastStopPointMs ?? -Infinity) >= stopPoint.cadenceMs) return true;
  return state.scenario.durationMs - state.nowMs <= stopPoint.finalWindowMs;
}

function addStopPoint(state, reason, target) {
  if (!shouldOfferStopPoint(state)) return false;
  addEvent(state, 'stop_point', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    reason,
    choices: ['continue', 'pause'],
  });
  state.lastStopPointMs = state.nowMs;
  return true;
}

function emitCameraTransition(state, target, mode) {
  if (!advance(state, state.policy.cameraTransitionMs)) return false;
  incrementCost(state.cost, { cameraChanges: 1 });
  addEvent(state, 'camera_transition', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    mode,
    cameraShift: target.cameraShift,
    durationMs: state.policy.cameraTransitionMs,
    idleReason: 'camera-transition',
  });
  return true;
}

function emitManualStrokes(state, target) {
  const cellsPerStroke = Math.floor(target.effortCells / target.strokes);
  let remainingCells = target.effortCells;
  const strokeMs = target.manualMs / target.strokes;
  for (let strokeIndex = 0; strokeIndex < target.strokes; strokeIndex += 1) {
    const isLast = strokeIndex === target.strokes - 1;
    const cells = isLast ? remainingCells : Math.max(1, cellsPerStroke);
    if (!advance(state, strokeMs)) return false;
    remainingCells -= cells;
    addEvent(state, 'manual_stroke', {
      targetIndex: target.targetIndex,
      targetId: target.id,
      strokeIndex,
      cells,
      source: 'player',
    });
  }
  return true;
}

function emitManualSparkTrigger(state, target) {
  const { spark } = state.policy;
  if (!advance(state, spark.manualTriggerMs)) return false;
  addEvent(state, 'manual_stroke', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    strokeIndex: 0,
    cells: 1,
    source: 'player',
    specialTrigger: 'spark',
  });
  return true;
}

function emitSpark(state, target) {
  const { spark } = state.policy;
  if (!emitManualSparkTrigger(state, target)) return false;

  if (!advance(state, spark.offerMs)) return false;
  addEvent(state, 'special_offered', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    special: 'spark',
    optionCount: 2,
    options: ['scene', 'nearby'],
    durationMs: spark.offerMs,
    idleReason: 'special-offer',
  });
  incrementCost(state.cost, { modalInterruptions: 1, cognitiveSwitches: 1 });

  if (!advance(state, spark.selectMs)) return false;
  addEvent(state, 'special_selected', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    special: 'spark',
    optionId: target.targetIndex % 2 === 0 ? 'scene' : 'nearby',
    durationMs: spark.selectMs,
    idleReason: 'special-select',
  });
  incrementCost(state.cost, { taps: 1 });

  if (!advance(state, spark.applyMs)) return false;
  const assistedCells = Math.max(1, Math.min(target.effortCells - 1, Math.round(target.effortCells * spark.assistedFraction)));
  addEvent(state, 'special_applied', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    special: 'spark',
    cells: assistedCells,
    source: 'assisted',
  });
  state.lastSpecialMs = state.nowMs;
  incrementCost(state.cost, { cognitiveSwitches: 1 });

  if (!advance(state, state.policy.revealSettleMs)) return false;
  addEvent(state, 'fragment_reveal', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    source: 'assisted',
    special: 'spark',
    cells: assistedCells + 1,
  });
  state.lastRevealMs = state.nowMs;

  // Recovery's ownership pause is represented as an intentional stop point,
  // not a forced camera move.
  if (!advance(state, spark.ownershipPauseMs)) return false;
  addEvent(state, 'ownership_pause', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    reason: 'post-spark-reveal',
    action: 'continue-or-pause',
    durationMs: spark.ownershipPauseMs,
    idleReason: 'ownership-pause',
  });
  incrementCost(state.cost, { pauses: 1 });
  addStopPoint(state, 'post-spark-reveal', target);
  return true;
}

function emitArtifact(state, target) {
  const { artifact } = state.policy;
  if (!advance(state, artifact.discoveryMs)) return false;
  const fragment = (target.targetIndex / artifact.everyTarget) % 3 + 1;
  addEvent(state, 'artifact_discovered', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    special: 'artifact',
    fragments: fragment,
    source: 'player',
    durationMs: artifact.discoveryMs,
    idleReason: 'artifact-discovery',
  });
  state.lastArtifactMs = state.nowMs;
  incrementCost(state.cost, { cognitiveSwitches: 1 });
  return true;
}

function emitNormalReveal(state, target, source = 'player') {
  if (!advance(state, state.policy.revealSettleMs)) return false;
  addEvent(state, 'fragment_reveal', {
    targetIndex: target.targetIndex,
    targetId: target.id,
    source,
    cells: target.effortCells,
  });
  state.lastRevealMs = state.nowMs;
  return true;
}

function isActivityEvent(event) {
  return EVENT_ACTIVITY.has(event.type);
}

function buildMetrics(state) {
  const { events, scenario, variant } = state;
  const manualCells = sum(events.filter((event) => event.type === 'manual_stroke').map((event) => event.cells));
  const assistedCells = sum(events.filter((event) => event.type === 'special_applied').map((event) => event.cells));
  const manualActions = events.filter((event) => event.type === 'manual_stroke').length;
  const assistedActions = events.filter((event) => event.type === 'special_applied').length;
  const fragmentReveals = events.filter((event) => event.type === 'fragment_reveal');
  const specialEvents = events.filter((event) => EVENT_SPECIAL.has(event.type));
  const interruptions = events.filter((event) => ['special_offered', 'special_selected', 'ownership_pause', 'artifact_discovered'].includes(event.type));
  const cameraTransitions = events.filter((event) => event.type === 'camera_transition');
  const stopPoints = events.filter((event) => event.type === 'stop_point');
  const ownershipPauses = events.filter((event) => event.type === 'ownership_pause');
  const activeEvents = events.filter(isActivityEvent);
  // Report only explicit non-painting windows. The event timestamp is the
  // end of that window, so the start is reconstructed from durationMs.
  const idlePeriods = events
    .filter((event) => event.idleReason && Number(event.durationMs) >= state.policy.idle.reportThresholdMs)
    .map((event) => ({
      fromMs: Math.max(0, event.atMs - event.durationMs),
      toMs: event.atMs,
      durationMs: event.durationMs,
      reason: event.idleReason,
    }));

  const totalCells = manualCells + assistedCells;
  const sessionMinutes = scenario.durationMs / MS_PER_MINUTE;
  const revealIntervalsMs = fragmentReveals.slice(1).map((event, index) => event.atMs - fragmentReveals[index].atMs);
  const firstManual = activeEvents[0] || null;
  const firstReveal = fragmentReveals[0] || null;
  const lastReveal = fragmentReveals.at(-1) || null;

  return {
    durationMs: scenario.durationMs,
    simulatedUntilMs: state.nowMs,
    sessionMinutes: round(sessionMinutes, 3),
    firstManualActionMs: firstManual?.atMs ?? null,
    firstRevealMs: firstReveal?.atMs ?? null,
    firstPlayerAuthoredRevealMs: fragmentReveals.find((event) => event.source === 'player')?.atMs ?? null,
    lastRevealMs: lastReveal?.atMs ?? null,
    manualActions,
    assistedActions,
    manualCells,
    assistedCells,
    totalPaintedCells: totalCells,
    manualActionShare: round(manualActions / Math.max(1, manualActions + assistedActions)),
    assistedActionShare: round(assistedActions / Math.max(1, manualActions + assistedActions)),
    manualCellShare: round(manualCells / Math.max(1, totalCells)),
    assistedCellShare: round(assistedCells / Math.max(1, totalCells)),
    fragmentReveals: fragmentReveals.length,
    revealsPerMinute: round(fragmentReveals.length / Math.max(0.001, sessionMinutes)),
    revealIntervalsMs,
    specialEvents: specialEvents.length,
    specialEventsPerMinute: round(specialEvents.length / Math.max(0.001, sessionMinutes)),
    sparkApplied: events.filter((event) => event.type === 'special_applied' && event.special === 'spark').length,
    artifactsDiscovered: events.filter((event) => event.type === 'artifact_discovered').length,
    interruptions: interruptions.length,
    interruptionsPerMinute: round(interruptions.length / Math.max(0.001, sessionMinutes)),
    cameraTransitions: cameraTransitions.length,
    cameraTransitionsPerMinute: round(cameraTransitions.length / Math.max(0.001, sessionMinutes)),
    stopPoints: stopPoints.length,
    ownershipPauses: ownershipPauses.length,
    pauseOpportunities: stopPoints.length + ownershipPauses.length,
    idlePeriods: idlePeriods.length,
    idleMs: sum(idlePeriods.map((period) => period.durationMs)),
    interactionCost: { ...state.cost },
    activeEventCount: activeEvents.length,
    completedTargets: new Set(fragmentReveals.map((event) => event.targetIndex)).size,
    naturalStopPoints: stopPoints.map((event) => ({ atMs: event.atMs, reason: event.reason || event.action || event.type })),
    guardrails: {
      hasManualAction: manualActions > 0,
      hasReveal: fragmentReveals.length > 0,
      hasStopPoint: stopPoints.length > 0,
      hasPlayerAuthoredReveal: fragmentReveals.some((event) => event.source === 'player'),
      specialDisabled: variant === 'control' ? specialEvents.length === 0 : null,
      assistedShareWithinReferenceBudget: assistedCells / Math.max(1, totalCells) <= 0.35,
    },
  };
}

/**
 * Run one bounded scenario. `workload` and `policy` are injectable so the
 * simulator can later consume observed target distributions without a rewrite.
 */
export function simulateSession({
  scenario = '3m',
  variant = 'treatment',
  seed,
  workload = PHASE2_REFERENCE_WORKLOAD,
  policy: policyOverride,
} = {}) {
  const resolvedScenario = resolveScenario(scenario);
  const resolvedVariant = normalizeVariant(variant);
  const resolvedSeed = integerSeed(seed, resolvedScenario.seed);
  if (!Array.isArray(workload) || workload.length === 0) throw new Error('workload must contain at least one target profile');
  const policy = mergePolicy(DEFAULT_SESSION_POLICY, policyOverride);
  const state = createSimulationState(resolvedScenario, resolvedVariant, resolvedSeed, policy);
  addEvent(state, 'session_start', { variant: resolvedVariant, scenario: resolvedScenario.id });

  while (state.nowMs < resolvedScenario.durationMs) {
    const target = targetAt(workload, state.targetIndex, resolvedSeed);
    addEvent(state, 'target_proposed', {
      targetIndex: target.targetIndex,
      targetId: target.id,
      effortCells: target.effortCells,
      effortScore: targetEffortScore(target, state.recentWorkloadMs),
    });

    if (target.targetIndex > 0 && !emitCameraTransition(state, target, resolvedVariant === 'treatment' ? 'proposal' : 'guided')) break;

    const spark = shouldOfferSpark(state, target);
    const artifact = !spark && shouldDiscoverArtifact(state, target);
    const completed = spark
      ? emitSpark(state, target)
      : emitManualStrokes(state, target) && emitNormalReveal(state, target, 'player');
    if (!completed) break;

    if (artifact && !emitArtifact(state, target)) break;
    if (!spark) addStopPoint(state, artifact ? 'post-artifact-reveal' : 'post-reveal', target);

    state.recentWorkloadMs = Math.min(180_000, state.recentWorkloadMs + target.manualMs);
    state.targetIndex += 1;
    if (!advance(state, state.policy.strokeOverheadMs)) break;
  }

  addEvent(state, 'session_stop', {
    reason: state.nowMs >= resolvedScenario.durationMs ? 'scenario-window-ended' : 'insufficient-time-for-next-beat',
  });
  return {
    scenario: resolvedScenario.id,
    scenarioLabel: resolvedScenario.label,
    variant: resolvedVariant,
    seed: resolvedSeed,
    policy: {
      sparkCooldownMs: policy.spark.cooldownMs,
      artifactCooldownMs: policy.artifact.cooldownMs,
      stopCadenceMs: policy.stopPoint.cadenceMs,
    },
    metrics: buildMetrics(state),
    events: state.events,
  };
}

export function simulateMatrix({ scenarios = Object.keys(SESSION_SCENARIOS), variants = SESSION_VARIANTS, seed } = {}) {
  return scenarios.flatMap((scenario) => variants.map((variant) => simulateSession({ scenario, variant, seed })));
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function printTable(results) {
  const rows = results.map((result) => {
    const { metrics } = result;
    return {
      scenario: result.scenario,
      variant: result.variant,
      'first reveal': metrics.firstRevealMs == null ? '-' : `${(metrics.firstRevealMs / 1000).toFixed(1)}s`,
      'reveals/min': metrics.revealsPerMinute.toFixed(2),
      'events/min': metrics.specialEventsPerMinute.toFixed(2),
      'manual/assisted': `${formatPercent(metrics.manualCellShare)} / ${formatPercent(metrics.assistedCellShare)}`,
      interruptions: metrics.interruptions,
      cameras: metrics.cameraTransitions,
      stops: metrics.stopPoints,
    };
  });
  console.table(rows);
}

function readArg(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function printUsage() {
  console.log('Usage: node scripts/phase2-session-simulator.mjs [--scenario 30s|3m|15m] [--variant control|treatment] [--seed N] [--json]');
}

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }
  const scenarioArg = readArg(args, '--scenario', 'all');
  const variantArg = normalizeVariant(readArg(args, '--variant', 'treatment'));
  const seedArg = readArg(args, '--seed', null);
  const scenarios = scenarioArg === 'all' ? Object.keys(SESSION_SCENARIOS) : [scenarioArg];
  const results = simulateMatrix({ scenarios, variants: args.includes('--variant') ? [variantArg] : SESSION_VARIANTS, seed: seedArg });
  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  console.log('Splint Phase 2 deterministic session simulator');
  console.log('Model evidence only: this does not prove human enjoyment or Telegram-device behaviour.');
  printTable(results);
  for (const result of results) {
    const { metrics } = result;
    console.log(`${result.scenario}/${result.variant}: ${metrics.fragmentReveals} reveals, ${metrics.specialEvents} special events, ${metrics.stopPoints} stop points; assisted cells ${formatPercent(metrics.assistedCellShare)}.`);
  }
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href === import.meta.url;
if (isMain) runCli();
