import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSessionGoalsExperiment,
  SESSION_GOALS_MODES,
} from '../src/features/goals/sessionGoalsExperiment.js';

test('recovery defaults to the hidden goals treatment', () => {
  assert.deepEqual(resolveSessionGoalsExperiment(''), {
    mode: SESSION_GOALS_MODES.HIDDEN,
    showGoals: false,
    source: 'default',
  });
});

test('the existing goal card is available through an explicit control query', () => {
  assert.deepEqual(resolveSessionGoalsExperiment('?sessionGoals=control'), {
    mode: SESSION_GOALS_MODES.CONTROL,
    showGoals: true,
    source: 'query',
  });
  assert.deepEqual(resolveSessionGoalsExperiment('?foo=1&sessionGoals=CONTROL'), {
    mode: SESSION_GOALS_MODES.CONTROL,
    showGoals: true,
    source: 'query',
  });
});

test('hidden is an explicit treatment and unknown values fail closed', () => {
  assert.deepEqual(resolveSessionGoalsExperiment('?sessionGoals=hidden'), {
    mode: SESSION_GOALS_MODES.HIDDEN,
    showGoals: false,
    source: 'query',
  });
  assert.equal(resolveSessionGoalsExperiment('?sessionGoals=off').showGoals, false);
  assert.equal(resolveSessionGoalsExperiment('?sessionGoals=unexpected').showGoals, false);
});
