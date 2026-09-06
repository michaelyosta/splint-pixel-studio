import {
  isRealTelegramIosSession,
  isTelegramVersionAtLeast,
  syncTelegramViewportCssVars,
} from './telegram.js';

export const TELEGRAM_FULLSCREEN_VERSION = '8.0';
export const IOS_VIEWPORT_SELF_HEAL_TIMEOUT_MS = 1200;

export const IOS_VIEWPORT_SELF_HEAL_STATES = Object.freeze({
  IDLE: 'IDLE',
  WAIT_INITIAL_STABLE_VIEWPORT: 'WAIT_INITIAL_STABLE_VIEWPORT',
  REQUEST_FULLSCREEN: 'REQUEST_FULLSCREEN',
  WAIT_FULLSCREEN_ENTER: 'WAIT_FULLSCREEN_ENTER',
  EXIT_FULLSCREEN: 'EXIT_FULLSCREEN',
  WAIT_FULLSCREEN_EXIT: 'WAIT_FULLSCREEN_EXIT',
  RESYNC_VIEWPORT: 'RESYNC_VIEWPORT',
  INVALIDATE_SHELL: 'INVALIDATE_SHELL',
  COMPLETE: 'COMPLETE',
  UNSUPPORTED: 'UNSUPPORTED',
  ALREADY_FULLSCREEN: 'ALREADY_FULLSCREEN',
  INITIAL_VIEWPORT_TIMEOUT: 'INITIAL_VIEWPORT_TIMEOUT',
  FULLSCREEN_FAILED: 'FULLSCREEN_FAILED',
  ENTER_TIMEOUT: 'ENTER_TIMEOUT',
  EXIT_TIMEOUT: 'EXIT_TIMEOUT',
});

export function shouldRunTelegramIosViewportSelfHeal(webApp) {
  return isRealTelegramIosSession(webApp);
}

export function supportsTelegramFullscreenCycle(webApp) {
  if (!shouldRunTelegramIosViewportSelfHeal(webApp)) return false;

  let versionSupported = false;
  if (typeof webApp.isVersionAtLeast === 'function') {
    try {
      versionSupported = Boolean(webApp.isVersionAtLeast(TELEGRAM_FULLSCREEN_VERSION));
    } catch {
      versionSupported = false;
    }
  }
  if (!versionSupported) {
    versionSupported = isTelegramVersionAtLeast(webApp.version, TELEGRAM_FULLSCREEN_VERSION);
  }

  return versionSupported
    && typeof webApp.requestFullscreen === 'function'
    && typeof webApp.exitFullscreen === 'function'
    && typeof webApp.onEvent === 'function'
    && typeof webApp.offEvent === 'function';
}

function hasUsableViewport(webApp) {
  const height = Number(webApp?.viewportStableHeight ?? webApp?.viewportHeight);
  return Number.isFinite(height) && height > 1;
}

function readFullscreenState(webApp, payload) {
  if (typeof payload?.isFullscreen === 'boolean') return payload.isFullscreen;
  if (typeof webApp?.isFullscreen === 'boolean') return webApp.isFullscreen;
  return null;
}

function createEventWait({
  webApp,
  eventName,
  failureEventName = null,
  predicate,
  timeoutMs,
  setTimer,
  clearTimer,
}) {
  let settled = false;
  let timerId = null;
  let resolvePromise;

  const cleanup = () => {
    if (timerId !== null) clearTimer(timerId);
    try { webApp.offEvent(eventName, handleEvent); } catch { /* optional bridge cleanup */ }
    if (failureEventName) {
      try { webApp.offEvent(failureEventName, handleFailure); } catch { /* optional bridge cleanup */ }
    }
  };

  const settle = (result) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise(result);
  };

  const handleEvent = (payload) => {
    let matched = false;
    try { matched = Boolean(predicate(payload)); } catch { matched = false; }
    if (matched) settle({ kind: 'confirmed', payload });
  };
  const handleFailure = (payload) => settle({ kind: 'failed', payload });

  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    try {
      webApp.onEvent(eventName, handleEvent);
      if (failureEventName) webApp.onEvent(failureEventName, handleFailure);
    } catch (error) {
      settle({ kind: 'listener-failed', error });
      return;
    }
    timerId = setTimer(() => settle({ kind: 'timeout' }), timeoutMs);
  });

  return { promise, cancel: () => settle({ kind: 'cancelled' }) };
}

function defaultScheduleFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 16);
}

/**
 * Creates one document-session state machine. A controller accepts at most one
 * real Telegram iOS attempt; subsequent calls share its settled result. A cold
 * document load creates a fresh module/controller and is eligible again.
 */
export function createTelegramIosViewportSelfHealSession({
  timeoutMs = IOS_VIEWPORT_SELF_HEAL_TIMEOUT_MS,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timerId) => globalThis.clearTimeout(timerId),
  scheduleFrame = defaultScheduleFrame,
  syncViewport = syncTelegramViewportCssVars,
} = {}) {
  let attempted = false;
  let activePromise = null;
  let settledResult = null;

  const waitOneFrame = () => new Promise((resolve) => scheduleFrame(resolve));

  async function execute({ webApp, invalidateShell }) {
    const states = [IOS_VIEWPORT_SELF_HEAL_STATES.IDLE];
    const result = {
      attempted: true,
      outcome: 'pending',
      states,
      fullscreenTransitionConfirmed: false,
      fullscreenExitConfirmed: false,
      viewportResyncExecuted: false,
      shellInvalidationExecuted: false,
    };
    const transition = (state) => states.push(state);

    const complete = async (outcome) => {
      transition(IOS_VIEWPORT_SELF_HEAL_STATES.RESYNC_VIEWPORT);
      try { syncViewport(webApp); } catch { /* startup must continue */ }
      result.viewportResyncExecuted = true;

      await waitOneFrame();
      transition(IOS_VIEWPORT_SELF_HEAL_STATES.INVALIDATE_SHELL);
      try {
        await invalidateShell();
        result.shellInvalidationExecuted = true;
      } catch {
        result.shellInvalidationExecuted = false;
      }

      transition(IOS_VIEWPORT_SELF_HEAL_STATES.COMPLETE);
      result.outcome = outcome;
      return Object.freeze({ ...result, states: Object.freeze([...states]) });
    };

    transition(IOS_VIEWPORT_SELF_HEAL_STATES.WAIT_INITIAL_STABLE_VIEWPORT);
    if (!hasUsableViewport(webApp)) {
      const initialViewportWait = createEventWait({
        webApp,
        eventName: 'viewportChanged',
        predicate: (payload) => payload?.isStateStable !== false && hasUsableViewport(webApp),
        timeoutMs,
        setTimer,
        clearTimer,
      });
      const initialViewport = await initialViewportWait.promise;
      if (initialViewport.kind !== 'confirmed') {
        transition(IOS_VIEWPORT_SELF_HEAL_STATES.INITIAL_VIEWPORT_TIMEOUT);
        return complete('initial-viewport-timeout');
      }
    }

    if (!supportsTelegramFullscreenCycle(webApp)) {
      transition(IOS_VIEWPORT_SELF_HEAL_STATES.UNSUPPORTED);
      return complete('unsupported');
    }

    if (webApp.isFullscreen === true) {
      transition(IOS_VIEWPORT_SELF_HEAL_STATES.ALREADY_FULLSCREEN);
      return complete('already-fullscreen');
    }

    transition(IOS_VIEWPORT_SELF_HEAL_STATES.REQUEST_FULLSCREEN);
    const enterWait = createEventWait({
      webApp,
      eventName: 'fullscreenChanged',
      failureEventName: 'fullscreenFailed',
      predicate: (payload) => readFullscreenState(webApp, payload) === true,
      timeoutMs,
      setTimer,
      clearTimer,
    });
    try {
      webApp.requestFullscreen();
    } catch {
      enterWait.cancel();
      transition(IOS_VIEWPORT_SELF_HEAL_STATES.FULLSCREEN_FAILED);
      return complete('request-failed');
    }

    transition(IOS_VIEWPORT_SELF_HEAL_STATES.WAIT_FULLSCREEN_ENTER);
    const entered = await enterWait.promise;
    if (entered.kind !== 'confirmed') {
      transition(entered.kind === 'timeout'
        ? IOS_VIEWPORT_SELF_HEAL_STATES.ENTER_TIMEOUT
        : IOS_VIEWPORT_SELF_HEAL_STATES.FULLSCREEN_FAILED);
      return complete(entered.kind === 'timeout' ? 'enter-timeout' : 'fullscreen-failed');
    }
    result.fullscreenTransitionConfirmed = true;

    transition(IOS_VIEWPORT_SELF_HEAL_STATES.EXIT_FULLSCREEN);
    const exitWait = createEventWait({
      webApp,
      eventName: 'fullscreenChanged',
      failureEventName: 'fullscreenFailed',
      predicate: (payload) => readFullscreenState(webApp, payload) === false,
      timeoutMs,
      setTimer,
      clearTimer,
    });
    try {
      webApp.exitFullscreen();
    } catch {
      exitWait.cancel();
      transition(IOS_VIEWPORT_SELF_HEAL_STATES.FULLSCREEN_FAILED);
      return complete('exit-failed');
    }

    transition(IOS_VIEWPORT_SELF_HEAL_STATES.WAIT_FULLSCREEN_EXIT);
    const exited = await exitWait.promise;
    if (exited.kind !== 'confirmed') {
      transition(exited.kind === 'timeout'
        ? IOS_VIEWPORT_SELF_HEAL_STATES.EXIT_TIMEOUT
        : IOS_VIEWPORT_SELF_HEAL_STATES.FULLSCREEN_FAILED);
      return complete(exited.kind === 'timeout' ? 'exit-timeout' : 'fullscreen-exit-failed');
    }
    result.fullscreenExitConfirmed = true;
    return complete('success');
  }

  return {
    get attempted() { return attempted; },
    get result() { return settledResult; },
    run({ webApp, invalidateShell = () => {} } = {}) {
      if (!shouldRunTelegramIosViewportSelfHeal(webApp)) {
        return Promise.resolve(Object.freeze({
          attempted: false,
          outcome: 'skipped',
          states: Object.freeze([IOS_VIEWPORT_SELF_HEAL_STATES.IDLE]),
          fullscreenTransitionConfirmed: false,
          fullscreenExitConfirmed: false,
          viewportResyncExecuted: false,
          shellInvalidationExecuted: false,
        }));
      }
      if (activePromise) return activePromise;
      attempted = true;
      activePromise = execute({ webApp, invalidateShell }).then((result) => {
        settledResult = result;
        return result;
      });
      return activePromise;
    },
  };
}
