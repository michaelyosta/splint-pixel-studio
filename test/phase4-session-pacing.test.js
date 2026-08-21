import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE4_REFERENCE_ARTWORK,
  evaluatePhase4Matrix,
  evaluatePhase4Session,
} from '../scripts/phase4-session-pacing.mjs';

test('Phase 4 pacing evaluation is deterministic', () => {
  const first = evaluatePhase4Session({ scenario: '15m', variant: 'treatment', seed: 30 });
  const second = evaluatePhase4Session({ scenario: '15m', variant: 'treatment', seed: 30 });
  assert.deepEqual(first, second);
});

test('30-second visits finish a first beat without requiring long-form progress', () => {
  for (const variant of ['control', 'treatment']) {
    const result = evaluatePhase4Session({ scenario: '30s', variant });
    assert.equal(result.closure.firstBeatReady, true, `${variant} first beat`);
    assert.equal(result.closure.closureReady, true, `${variant} closure`);
    assert.equal(result.metrics.closedSegmentIds[0], 'arrival');
    assert.equal(result.metrics.closedSegments, 1);
    assert.equal(result.closure.pilot.eligible, false);
  }
});

test('3-minute visits expose a closed layer and an actionable resume promise', () => {
  for (const variant of ['control', 'treatment']) {
    const result = evaluatePhase4Session({ scenario: '3m', variant, seed: 300 });
    assert.ok(result.metrics.closedSegments >= 2, `${variant} has no second layer`);
    assert.ok(result.metrics.resumePromiseCount > 0, `${variant} has no stop point`);
    assert.equal(result.closure.everyNonFinalStopResolvable, true);
    assert.ok(result.resumePromises.some((promise) => promise.nextSegmentId === 'compose'));
    assert.equal(result.closure.pilot.eligible, false);
  }
});

test('15-minute reference run passes only when it is emotionally segmented', () => {
  const [control, treatment] = evaluatePhase4Matrix({ scenarios: ['15m'], seed: 30 });
  for (const result of [control, treatment]) {
    assert.equal(result.closure.pilot.eligible, true, `${result.variant} pilot gate`);
    assert.equal(result.metrics.closedSegments >= PHASE4_REFERENCE_ARTWORK.pilot.minSegments, true);
    assert.equal(result.metrics.playerAuthoredClosures >= PHASE4_REFERENCE_ARTWORK.pilot.minPlayerAuthoredClosures, true);
    assert.ok(result.metrics.maxClosureGapMs <= PHASE4_REFERENCE_ARTWORK.pilot.maxClosureGapMs);
    assert.equal(result.closure.everyNonFinalStopResolvable, true);
  }
  assert.ok(treatment.metrics.assistedClosures <= PHASE4_REFERENCE_ARTWORK.pilot.maxAssistedClosures);
});

test('long-form gate rejects a profile with an unresolved emotional tail', () => {
  const result = evaluatePhase4Session({
    scenario: '15m',
    variant: 'control',
    seed: 30,
    profile: {
      ...PHASE4_REFERENCE_ARTWORK,
      id: 'invalid-unresolved-tail',
      segments: [
        ...PHASE4_REFERENCE_ARTWORK.segments.slice(0, 1),
        { id: 'tail', label: 'Unbounded tail', startTarget: 1, endTarget: 999 },
      ],
    },
  });
  assert.equal(result.closure.pilot.eligible, false);
  assert.match(result.closure.pilot.reason, /not-enough-closed-segments/);
});

test('pacing harness does not invent goals, streaks, currency or special events', () => {
  const result = evaluatePhase4Session({ scenario: '3m', variant: 'control' });
  assert.equal(result.events.some((event) => ['goal', 'streak', 'currency', 'special_offered'].includes(event.type)), false);
});

