/**
 * Phase 4 pacing and controlled long-form pilot harness.
 *
 * This is a deterministic planning/evidence layer over the Phase 2 session
 * simulator. It does not add a runtime feature, a timer, a quest, or a new
 * progression system. Its job is to answer a narrower question:
 *
 *   Can a bounded artwork be divided into recognisable reveal segments so a
 *   30-second visit, a 3-minute session, and a 15-minute pilot all end with
 *   an honest closure and an inspectable next reveal beat?
 *
 * Segment boundaries are fixture data for the pilot, not production balance
 * thresholds. Replace them with observed artwork metadata before shipping.
 */

import {
  PHASE2_REFERENCE_WORKLOAD,
  SESSION_SCENARIOS,
  simulateSession,
} from './phase2-session-simulator.mjs';

/**
 * A deliberately small, emotionally ordered pilot artwork. The first beat is
 * one quick reveal so a short visit can finish something. Later beats become
 * wider/deeper and the final beat resolves the composition. The target ranges
 * are internal fixture coordinates, not an instruction to add chapters to all
 * existing artworks. Seven bounded beats keep the 15-minute reference run
 * from hiding a nine-minute unresolved tail behind one generic "continue".
 */
export const PHASE4_REFERENCE_ARTWORK = Object.freeze({
  id: 'phase4-layered-reveal-pilot',
  label: 'Layered reveal pilot',
  segments: Object.freeze([
    Object.freeze({ id: 'arrival', label: 'Arrival', startTarget: 0, endTarget: 0, role: 'first-beat' }),
    Object.freeze({ id: 'build', label: 'Build', startTarget: 1, endTarget: 3, role: 'momentum' }),
    Object.freeze({ id: 'compose', label: 'Compose', startTarget: 4, endTarget: 7, role: 'shape' }),
    Object.freeze({ id: 'signature', label: 'Signature', startTarget: 8, endTarget: 15, role: 'recognition' }),
    Object.freeze({ id: 'depth', label: 'Depth', startTarget: 16, endTarget: 23, role: 'variation' }),
    Object.freeze({ id: 'resolve', label: 'Resolve', startTarget: 24, endTarget: 31, role: 'long-form-closure' }),
    Object.freeze({ id: 'detail', label: 'Detail', startTarget: 32, endTarget: 40, role: 'final-detail' }),
  ]),
  pilot: Object.freeze({
    scenario: '15m',
    minSegments: 4,
    minPlayerAuthoredClosures: 4,
    maxAssistedClosures: 1,
    // A segment should still feel like the same artwork beat, but a long-form
    // closure may span one 3-minute visit plus a small settle/resume margin.
    // This is an explicit pilot gate, not a runtime timer.
    maxClosureGapMs: 210_000,
  }),
});

export const PHASE4_SESSION_WINDOWS = Object.freeze({
  '30s': Object.freeze({ label: '30 seconds', purpose: 'micro-reveal' }),
  '3m': Object.freeze({ label: '3 minutes', purpose: 'complete-a-layer' }),
  '15m': Object.freeze({ label: '15 minutes', purpose: 'controlled-long-form-pilot' }),
});

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function assertScenario(scenario) {
  if (!SESSION_SCENARIOS[scenario]) {
    throw new Error(`Unknown session scenario: ${scenario}. Expected 30s, 3m or 15m.`);
  }
  return scenario;
}

function resolveSegment(profile, targetIndex) {
  return profile.segments.find((segment) => (
    targetIndex >= segment.startTarget && targetIndex <= segment.endTarget
  )) || null;
}

function segmentSummary(profile, reveals) {
  return profile.segments.map((segment) => {
    const segmentReveals = reveals.filter((event) => (
      event.targetIndex >= segment.startTarget && event.targetIndex <= segment.endTarget
    ));
    const closure = segmentReveals.find((event) => event.targetIndex === segment.endTarget) || null;
    const playerAuthored = Boolean(closure && closure.source === 'player');
    return {
      id: segment.id,
      label: segment.label,
      role: segment.role,
      targetRange: [segment.startTarget, segment.endTarget],
      expectedTargets: segment.endTarget - segment.startTarget + 1,
      revealedTargets: new Set(segmentReveals.map((event) => event.targetIndex)).size,
      firstRevealMs: segmentReveals[0]?.atMs ?? null,
      lastRevealMs: segmentReveals.at(-1)?.atMs ?? null,
      closed: Boolean(closure),
      closureAtMs: closure?.atMs ?? null,
      closureSource: closure?.source ?? null,
      playerAuthoredClosure: playerAuthored,
      assistedClosure: Boolean(closure && closure.source === 'assisted'),
    };
  });
}

function closureTransitions(segments) {
  const closed = segments.filter((segment) => segment.closed);
  return closed.map((segment, index) => {
    const previous = closed[index - 1] || null;
    return {
      segmentId: segment.id,
      segmentLabel: segment.label,
      atMs: segment.closureAtMs,
      fromPreviousMs: previous ? segment.closureAtMs - previous.closureAtMs : null,
      previousSegmentId: previous?.id ?? null,
      playerAuthored: segment.playerAuthoredClosure,
    };
  });
}

function resolveResumePromises(events, profile) {
  const stopPoints = events.filter((event) => event.type === 'stop_point');
  return stopPoints.map((stopPoint) => {
    const nextTarget = events.find((event) => (
      event.type === 'target_proposed'
      && event.atMs > stopPoint.atMs
      && event.targetIndex > stopPoint.targetIndex
    ));
    const nextSegment = nextTarget ? resolveSegment(profile, nextTarget.targetIndex) : null;
    return {
      atMs: stopPoint.atMs,
      reason: stopPoint.reason,
      targetIndex: stopPoint.targetIndex,
      nextTargetId: nextTarget?.targetId ?? null,
      nextTargetIndex: nextTarget?.targetIndex ?? null,
      nextSegmentId: nextSegment?.id ?? null,
      nextSegmentLabel: nextSegment?.label ?? null,
      remainingTargetsInNextSegment: nextTarget && nextSegment
        ? Math.max(0, nextSegment.endTarget - nextTarget.targetIndex + 1)
        : 0,
      resolvable: Boolean(nextTarget && nextSegment),
      // A proposed target outside the artwork profile is the simulator's
      // bounded end-of-artwork probe, not an unresolved product promise.
      isFinalStop: !nextTarget || !nextSegment,
    };
  });
}

function classifyClosure(metrics, segments, transitions, resumePromises, scenario, profile) {
  const firstSegment = segments[0];
  const closedCount = segments.filter((segment) => segment.closed).length;
  const playerAuthoredClosures = segments.filter((segment) => segment.playerAuthoredClosure).length;
  const assistedClosures = segments.filter((segment) => segment.assistedClosure).length;
  const closureGaps = transitions
    .map((transition) => transition.fromPreviousMs)
    .filter((value) => value != null);
  const firstBeatReady = Boolean(
    firstSegment?.closed
      && firstSegment.closureAtMs != null
      && firstSegment.closureAtMs <= 30_000,
  );
  const closureReady = closedCount > 0 && metrics.stopPoints > 0;
  const everyNonFinalStopResolvable = resumePromises
    .filter((promise) => !promise.isFinalStop)
    .every((promise) => promise.resolvable);
  const pilot = scenario === profile.pilot.scenario
    ? {
      eligible: Boolean(
        segments.length >= profile.pilot.minSegments
          && closedCount >= profile.pilot.minSegments
          && playerAuthoredClosures >= profile.pilot.minPlayerAuthoredClosures
          && assistedClosures <= profile.pilot.maxAssistedClosures
          && closureGaps.every((gap) => gap <= profile.pilot.maxClosureGapMs)
          && firstBeatReady
          && everyNonFinalStopResolvable,
      ),
      closedSegments: closedCount,
      playerAuthoredClosures,
      assistedClosures,
      maxClosureGapMs: closureGaps.length ? Math.max(...closureGaps) : null,
      requiredSegments: profile.pilot.minSegments,
      requiredPlayerAuthoredClosures: profile.pilot.minPlayerAuthoredClosures,
      reason: null,
    }
    : { eligible: false, reason: 'long-form-pilot-only-at-15m' };

  if (scenario === profile.pilot.scenario && !pilot.eligible) {
    const failures = [];
    if (closedCount < profile.pilot.minSegments) failures.push('not-enough-closed-segments');
    if (playerAuthoredClosures < profile.pilot.minPlayerAuthoredClosures) failures.push('not-enough-player-authored-closures');
    if (assistedClosures > profile.pilot.maxAssistedClosures) failures.push('too-many-assisted-closures');
    if (closureGaps.some((gap) => gap > profile.pilot.maxClosureGapMs)) failures.push('closure-gap-too-long');
    if (!firstBeatReady) failures.push('first-beat-not-within-30s');
    if (!everyNonFinalStopResolvable) failures.push('resume-promise-unresolved');
    pilot.reason = failures.join(',');
  }

  return {
    firstBeatReady,
    closureReady,
    everyNonFinalStopResolvable,
    closedSegments: closedCount,
    segmentCount: segments.length,
    playerAuthoredClosures,
    assistedClosures,
    maxClosureGapMs: closureGaps.length ? Math.max(...closureGaps) : null,
    pilot,
  };
}

/**
 * Evaluate one session against a bounded emotional-segment fixture.
 *
 * The returned booleans are machine contracts for content/session QA. They
 * are not a proxy for delight, retention, or a human's desire to continue.
 */
export function evaluatePhase4Session({
  scenario = '3m',
  variant = 'treatment',
  seed,
  workload = PHASE2_REFERENCE_WORKLOAD,
  profile = PHASE4_REFERENCE_ARTWORK,
} = {}) {
  const resolvedScenario = assertScenario(scenario);
  if (!profile?.segments?.length) throw new Error('profile must contain at least one segment');
  const simulation = simulateSession({ scenario: resolvedScenario, variant, seed, workload });
  const reveals = simulation.events.filter((event) => event.type === 'fragment_reveal');
  const segments = segmentSummary(profile, reveals);
  const transitions = closureTransitions(segments);
  const resumePromises = resolveResumePromises(simulation.events, profile);
  const closure = classifyClosure(
    simulation.metrics,
    segments,
    transitions,
    resumePromises,
    resolvedScenario,
    profile,
  );
  const closedSegmentIds = segments.filter((segment) => segment.closed).map((segment) => segment.id);
  const unresolvedSegmentIds = segments.filter((segment) => !segment.closed).map((segment) => segment.id);
  return {
    scenario: resolvedScenario,
    variant: simulation.variant,
    seed: simulation.seed,
    artworkId: profile.id,
    window: PHASE4_SESSION_WINDOWS[resolvedScenario],
    metrics: {
      ...simulation.metrics,
      closedSegments: closure.closedSegments,
      segmentCount: closure.segmentCount,
      segmentClosureRate: round(closure.closedSegments / Math.max(1, closure.segmentCount)),
      playerAuthoredClosures: closure.playerAuthoredClosures,
      assistedClosures: closure.assistedClosures,
      maxClosureGapMs: closure.maxClosureGapMs,
      resumePromiseCount: resumePromises.length,
      resolvableResumePromises: resumePromises.filter((promise) => promise.resolvable).length,
      closedSegmentIds,
      unresolvedSegmentIds,
    },
    segments,
    transitions,
    resumePromises,
    closure,
    events: simulation.events,
  };
}

export function evaluatePhase4Matrix({
  scenarios = Object.keys(PHASE4_SESSION_WINDOWS),
  variants = ['control', 'treatment'],
  seed,
  workload,
  profile,
} = {}) {
  return scenarios.flatMap((scenario) => variants.map((variant) => evaluatePhase4Session({
    scenario,
    variant,
    seed,
    workload,
    profile,
  })));
}

function formatSeconds(value) {
  return value == null ? '-' : `${(Number(value) / 1000).toFixed(1)}s`;
}

function printTable(results) {
  console.table(results.map((result) => ({
    scenario: result.scenario,
    variant: result.variant,
    firstBeat: result.closure.firstBeatReady ? 'yes' : 'no',
    reveals: result.metrics.fragmentReveals,
    closed: `${result.metrics.closedSegments}/${result.metrics.segmentCount}`,
    authoredClosures: result.metrics.playerAuthoredClosures,
    maxGap: formatSeconds(result.metrics.maxClosureGapMs),
    resume: `${result.metrics.resolvableResumePromises}/${result.metrics.resumePromiseCount}`,
    pilot: result.closure.pilot.eligible ? 'eligible' : 'no',
  })));
}

function readArg(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function runCli() {
  const args = process.argv.slice(2);
  const scenario = readArg(args, '--scenario', null);
  const variant = readArg(args, '--variant', null);
  const results = scenario
    ? [evaluatePhase4Session({ scenario, variant: variant || 'treatment' })]
    : evaluatePhase4Matrix({ variants: variant ? [variant] : undefined });
  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  console.log('Splint Phase 4 session pacing / long-form pilot harness');
  console.log('Model evidence only: segmentation contracts do not prove human enjoyment or retention.');
  printTable(results);
}

const isMain = process.argv[1]
  && new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href === import.meta.url;
if (isMain) runCli();
