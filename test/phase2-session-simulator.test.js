import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SESSION_POLICY,
  PHASE2_REFERENCE_WORKLOAD,
  SESSION_SCENARIOS,
  simulateMatrix,
  simulateSession,
} from '../scripts/phase2-session-simulator.mjs';

function eventTypes(result, type) {
  return result.events.filter((event) => event.type === type);
}

test('simulator is deterministic for the same scenario, variant and seed', () => {
  const first = simulateSession({ scenario: '3m', variant: 'treatment', seed: 17 });
  const second = simulateSession({ scenario: '3m', variant: 'treatment', seed: 17 });
  assert.deepEqual(first, second);
});

test('all bounded windows contain a start, manual action, reveal and natural stop opportunity', () => {
  for (const scenario of Object.keys(SESSION_SCENARIOS)) {
    const result = simulateSession({ scenario, variant: 'control' });
    assert.equal(eventTypes(result, 'session_start').length, 1);
    assert.ok(result.metrics.manualActions > 0, `${scenario} has no manual action`);
    assert.ok(result.metrics.fragmentReveals > 0, `${scenario} has no reveal`);
    assert.ok(result.metrics.stopPoints > 0, `${scenario} has no stop point`);
    assert.equal(result.metrics.assistedCells, 0);
    assert.equal(result.metrics.guardrails.specialDisabled, true);
  }
});

test('treatment keeps Spark rare and records agency-relevant lifecycle costs', () => {
  const result = simulateSession({ scenario: '15m', variant: 'treatment', seed: 30 });
  assert.ok(result.metrics.sparkApplied >= 1);
  assert.ok(result.metrics.sparkApplied <= 5);
  assert.ok(result.metrics.artifactsDiscovered >= 1);
  assert.equal(eventTypes(result, 'special_offered').length, result.metrics.sparkApplied);
  assert.equal(eventTypes(result, 'special_selected').length, result.metrics.sparkApplied);
  assert.equal(eventTypes(result, 'ownership_pause').length, result.metrics.sparkApplied);
  assert.ok(result.metrics.interactionCost.taps >= result.metrics.sparkApplied);
  assert.ok(result.metrics.interactionCost.pauses >= result.metrics.sparkApplied);
  assert.ok(result.metrics.cameraTransitions > 0);
  assert.ok(result.metrics.naturalStopPoints.length > 0);
});

test('treatment does not assist the first reveal before the player authors one', () => {
  for (const scenario of ['30s', '3m', '15m']) {
    const result = simulateSession({ scenario, variant: 'treatment' });
    assert.ok(result.metrics.firstPlayerAuthoredRevealMs != null, `${scenario} has no authored reveal`);
    assert.ok(
      result.metrics.firstPlayerAuthoredRevealMs <= result.metrics.firstRevealMs,
      `${scenario} assisted reveal preceded authored reveal`,
    );
    assert.equal(result.events.find((event) => event.type === 'fragment_reveal')?.source, 'player');
  }
});

test('the model exposes manual versus assisted ratio and reveal cadence for comparison', () => {
  const [control, treatment] = simulateMatrix({ scenarios: ['3m'], seed: 300 });
  assert.equal(control.variant, 'control');
  assert.equal(treatment.variant, 'treatment');
  assert.equal(control.metrics.assistedCellShare, 0);
  assert.ok(treatment.metrics.assistedCellShare > 0);
  assert.ok(Number.isFinite(control.metrics.revealsPerMinute));
  assert.ok(Number.isFinite(treatment.metrics.specialEventsPerMinute));
  assert.ok(treatment.metrics.interruptions >= control.metrics.interruptions);
});

test('workload and policy are injectable without changing runtime code', () => {
  const result = simulateSession({
    scenario: '30s',
    variant: 'treatment',
    workload: [{ ...PHASE2_REFERENCE_WORKLOAD[0], effortCells: 20, manualMs: 20_000 }],
    policy: {
      spark: {
        everyTarget: 1,
        cooldownMs: 0,
        firstTargetPity: false,
        minTargetsBeforeEvent: 0,
        minElapsedMsBeforeEvent: 0,
      },
      stopPoint: { cadenceMs: 1_000 },
    },
  });
  assert.equal(result.policy.sparkCooldownMs, 0);
  assert.ok(result.metrics.fragmentReveals >= 1);
  assert.ok(result.metrics.manualCells >= 1);
  assert.ok(result.metrics.assistedCells >= 1);
  assert.equal(result.events.at(-1).type, 'session_stop');
  assert.equal(DEFAULT_SESSION_POLICY.spark.firstTargetPity, false);
});
