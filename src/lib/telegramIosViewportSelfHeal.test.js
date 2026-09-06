import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTelegramIosViewportSelfHealSession,
  IOS_VIEWPORT_SELF_HEAL_STATES,
  shouldRunTelegramIosViewportSelfHeal,
  supportsTelegramFullscreenCycle,
  TELEGRAM_FULLSCREEN_VERSION,
} from './telegramIosViewportSelfHeal.js';

function createWebApp({
  platform = 'ios',
  initData = 'signed-query',
  version = TELEGRAM_FULLSCREEN_VERSION,
  viewportStableHeight = 734,
  isFullscreen = false,
  requestBehavior = 'success',
  exitBehavior = 'success',
} = {}) {
  const handlers = new Map();
  const calls = [];
  const webApp = {
    platform,
    initData,
    version,
    viewportStableHeight,
    viewportHeight: viewportStableHeight,
    isFullscreen,
    calls,
    isVersionAtLeast(minimum) {
      return Number(version) >= Number(minimum);
    },
    onEvent(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
    offEvent(name, handler) {
      const list = handlers.get(name) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    emit(name, payload) {
      for (const handler of [...(handlers.get(name) || [])]) handler(payload);
    },
    listenerCount(name) {
      return (handlers.get(name) || []).length;
    },
    requestFullscreen() {
      calls.push('requestFullscreen');
      if (requestBehavior === 'throw') throw new Error('request failed');
      if (requestBehavior === 'ignored') return;
      queueMicrotask(() => {
        if (requestBehavior === 'failed') {
          webApp.emit('fullscreenFailed', { error: 'USER_DECLINED' });
          return;
        }
        webApp.isFullscreen = true;
        webApp.emit('fullscreenChanged', { isFullscreen: true });
        if (requestBehavior === 'duplicate') {
          webApp.emit('fullscreenChanged', { isFullscreen: true });
        }
      });
    },
    exitFullscreen() {
      calls.push('exitFullscreen');
      if (exitBehavior === 'throw') throw new Error('exit failed');
      if (exitBehavior === 'ignored') return;
      queueMicrotask(() => {
        if (exitBehavior === 'failed') {
          webApp.emit('fullscreenFailed', { error: 'EXIT_FAILED' });
          return;
        }
        webApp.isFullscreen = false;
        webApp.emit('fullscreenChanged', { isFullscreen: false });
        if (exitBehavior === 'duplicate') {
          webApp.emit('fullscreenChanged', { isFullscreen: false });
        }
      });
    },
  };
  return webApp;
}

function createHarness(options = {}) {
  const calls = [];
  const session = createTelegramIosViewportSelfHealSession({
    timeoutMs: options.timeoutMs ?? 8,
    scheduleFrame(callback) {
      calls.push('frame');
      callback();
    },
    syncViewport() {
      calls.push('syncViewport');
      return true;
    },
  });
  const run = (webApp) => session.run({
    webApp,
    invalidateShell() {
      calls.push('invalidateShell');
    },
  });
  return { calls, run, session };
}

test('scope excludes non-Telegram, Android, desktop, and iOS SDK stubs', async () => {
  const excluded = [
    null,
    createWebApp({ platform: 'android' }),
    createWebApp({ platform: 'tdesktop' }),
    createWebApp({ initData: '' }),
  ];

  for (const webApp of excluded) {
    assert.equal(shouldRunTelegramIosViewportSelfHeal(webApp), false);
    const harness = createHarness();
    const result = await harness.run(webApp);
    assert.equal(result.attempted, false);
    assert.equal(result.outcome, 'skipped');
    assert.deepEqual(harness.calls, []);
  }
});

test('fullscreen capability requires Telegram 8.0 plus the complete runtime contract', () => {
  assert.equal(supportsTelegramFullscreenCycle(createWebApp()), true);
  assert.equal(supportsTelegramFullscreenCycle(createWebApp({ version: '7.9' })), false);
  const missingExit = createWebApp();
  delete missingExit.exitFullscreen;
  assert.equal(supportsTelegramFullscreenCycle(missingExit), false);
  const methodOnlyStub = createWebApp({ initData: '' });
  assert.equal(supportsTelegramFullscreenCycle(methodOnlyStub), false);
});

test('successful iOS cycle confirms enter and exit before one resync and shell invalidation', async () => {
  const webApp = createWebApp();
  const harness = createHarness();
  const result = await harness.run(webApp);

  assert.equal(result.outcome, 'success');
  assert.equal(result.fullscreenTransitionConfirmed, true);
  assert.equal(result.fullscreenExitConfirmed, true);
  assert.equal(result.viewportResyncExecuted, true);
  assert.equal(result.shellInvalidationExecuted, true);
  assert.deepEqual(webApp.calls, ['requestFullscreen', 'exitFullscreen']);
  assert.deepEqual(harness.calls, ['syncViewport', 'frame', 'invalidateShell']);
  assert.deepEqual(result.states, [
    IOS_VIEWPORT_SELF_HEAL_STATES.IDLE,
    IOS_VIEWPORT_SELF_HEAL_STATES.WAIT_INITIAL_STABLE_VIEWPORT,
    IOS_VIEWPORT_SELF_HEAL_STATES.REQUEST_FULLSCREEN,
    IOS_VIEWPORT_SELF_HEAL_STATES.WAIT_FULLSCREEN_ENTER,
    IOS_VIEWPORT_SELF_HEAL_STATES.EXIT_FULLSCREEN,
    IOS_VIEWPORT_SELF_HEAL_STATES.WAIT_FULLSCREEN_EXIT,
    IOS_VIEWPORT_SELF_HEAL_STATES.RESYNC_VIEWPORT,
    IOS_VIEWPORT_SELF_HEAL_STATES.INVALIDATE_SHELL,
    IOS_VIEWPORT_SELF_HEAL_STATES.COMPLETE,
  ]);
  assert.equal(webApp.listenerCount('fullscreenChanged'), 0);
  assert.equal(webApp.listenerCount('fullscreenFailed'), 0);
});

test('fullscreenFailed never retries and still completes the fallback path', async () => {
  const webApp = createWebApp({ requestBehavior: 'failed' });
  const harness = createHarness();
  const result = await harness.run(webApp);

  assert.equal(result.outcome, 'fullscreen-failed');
  assert.deepEqual(webApp.calls, ['requestFullscreen']);
  assert.equal(result.states.includes(IOS_VIEWPORT_SELF_HEAL_STATES.FULLSCREEN_FAILED), true);
  assert.deepEqual(harness.calls, ['syncViewport', 'frame', 'invalidateShell']);
  assert.equal(webApp.listenerCount('fullscreenChanged'), 0);
  assert.equal(webApp.listenerCount('fullscreenFailed'), 0);
});

test('ignored fullscreen request reaches the bounded enter timeout without retry', async () => {
  const webApp = createWebApp({ requestBehavior: 'ignored' });
  const harness = createHarness();
  const result = await harness.run(webApp);

  assert.equal(result.outcome, 'enter-timeout');
  assert.deepEqual(webApp.calls, ['requestFullscreen']);
  assert.equal(result.states.includes(IOS_VIEWPORT_SELF_HEAL_STATES.ENTER_TIMEOUT), true);
  assert.deepEqual(harness.calls, ['syncViewport', 'frame', 'invalidateShell']);
});

test('ignored fullscreen exit reaches the bounded exit timeout without retry', async () => {
  const webApp = createWebApp({ exitBehavior: 'ignored' });
  const harness = createHarness();
  const result = await harness.run(webApp);

  assert.equal(result.outcome, 'exit-timeout');
  assert.deepEqual(webApp.calls, ['requestFullscreen', 'exitFullscreen']);
  assert.equal(result.fullscreenTransitionConfirmed, true);
  assert.equal(result.fullscreenExitConfirmed, false);
  assert.equal(result.states.includes(IOS_VIEWPORT_SELF_HEAL_STATES.EXIT_TIMEOUT), true);
  assert.deepEqual(harness.calls, ['syncViewport', 'frame', 'invalidateShell']);
});

test('duplicate fullscreen events cannot duplicate exit, resync, or invalidation', async () => {
  const webApp = createWebApp({ requestBehavior: 'duplicate', exitBehavior: 'duplicate' });
  const harness = createHarness();
  const result = await harness.run(webApp);

  assert.equal(result.outcome, 'success');
  assert.deepEqual(webApp.calls, ['requestFullscreen', 'exitFullscreen']);
  assert.deepEqual(harness.calls, ['syncViewport', 'frame', 'invalidateShell']);
});

test('one session attempts once across route-like calls; a cold session is eligible again', async () => {
  const webApp = createWebApp();
  const first = createHarness();
  const firstResult = await first.run(webApp);
  const routeChangeResult = await first.run(webApp);

  assert.equal(first.session.attempted, true);
  assert.equal(routeChangeResult, firstResult);
  assert.deepEqual(webApp.calls, ['requestFullscreen', 'exitFullscreen']);
  assert.deepEqual(first.calls, ['syncViewport', 'frame', 'invalidateShell']);

  const coldWebApp = createWebApp();
  const cold = createHarness();
  const coldResult = await cold.run(coldWebApp);
  assert.equal(coldResult.outcome, 'success');
  assert.deepEqual(coldWebApp.calls, ['requestFullscreen', 'exitFullscreen']);
});

test('unsupported and already-fullscreen iOS sessions use one bounded fallback only', async () => {
  for (const webApp of [createWebApp({ version: '7.9' }), createWebApp({ isFullscreen: true })]) {
    const harness = createHarness();
    const result = await harness.run(webApp);
    assert.equal(result.attempted, true);
    assert.equal(['unsupported', 'already-fullscreen'].includes(result.outcome), true);
    assert.deepEqual(webApp.calls, []);
    assert.deepEqual(harness.calls, ['syncViewport', 'frame', 'invalidateShell']);
  }
});

test('missing initial stable viewport times out, cleans listeners, and continues startup', async () => {
  const webApp = createWebApp({ viewportStableHeight: null });
  const harness = createHarness();
  const result = await harness.run(webApp);

  assert.equal(result.outcome, 'initial-viewport-timeout');
  assert.deepEqual(webApp.calls, []);
  assert.equal(webApp.listenerCount('viewportChanged'), 0);
  assert.deepEqual(harness.calls, ['syncViewport', 'frame', 'invalidateShell']);
});
