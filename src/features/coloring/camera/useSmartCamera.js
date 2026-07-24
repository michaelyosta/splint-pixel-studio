import { useState, useCallback, useRef, useEffect } from 'react';
import { clampCamera, planCamera, getTransitionDuration } from '../engine/cameraPlanner.js';
import { AUTO_STATE } from '../engine/autoState.js';
import { createCameraAnimation } from './cameraAnimation.js';

export { AUTO_STATE };

export function useSmartCamera(template, viewWidth, viewHeight) {
  const [camera, setCameraRaw] = useState({ x: 0, y: 0, zoom: 1 });
  const [cameraReady, setCameraReady] = useState(false);
  const [autoState, setAutoState] = useState(AUTO_STATE.ACTIVE);
  const autoStateRef = useRef(AUTO_STATE.ACTIVE);
  const sessionRef = useRef(Date.now());
  const animCancelRef = useRef(null);
  const lastFocusRef = useRef(null);
  const lastCenterRef = useRef(null);
  const prevCenterRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const isInteractingRef = useRef(false);
  const pendingFocusRef = useRef(null);
  const safeAreaRef = useRef({ top: 0, right: 0, bottom: 0, left: 0 });

  const isAutoActive = autoState === AUTO_STATE.ACTIVE && !isInteractingRef.current;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    return () => {
      if (animCancelRef.current) animCancelRef.current();
      sessionRef.current = 0;
    };
  }, []);

  const cameraRawRef = useRef(camera);
  cameraRawRef.current = camera;

  const cancelAnimation = useCallback(() => {
    if (animCancelRef.current) {
      animCancelRef.current();
      animCancelRef.current = null;
    }
  }, []);

  const animateTo = useCallback((target, duration) => {
    cancelAnimation();
    const from = { ...cameraRawRef.current };
    animCancelRef.current = createCameraAnimation(
      from, target, duration,
      (frame) => { cameraRawRef.current = frame; setCameraRaw(frame); },
      () => { animCancelRef.current = null; },
    );
  }, [cancelAnimation]);

  const setCamera = useCallback((c) => {
    cancelAnimation();
    if (!template) return;
    const clamped = clampCamera(c, viewWidth, viewHeight, template.width, template.height);
    cameraRawRef.current = clamped;
    setCameraRaw(clamped);
  }, [template, viewWidth, viewHeight, cancelAnimation]);

  const setCameraInstant = useCallback((c) => {
    cancelAnimation();
    cameraRawRef.current = c;
    setCameraRaw(c);
  }, [cancelAnimation]);

  const beginInteraction = useCallback(() => {
    isInteractingRef.current = true;
    cancelAnimation();
  }, [cancelAnimation]);

  const endInteraction = useCallback(() => {
    isInteractingRef.current = false;
    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    const mayRun = pending?.force || (autoStateRef.current === AUTO_STATE.ACTIVE);
    if (pending && mayRun) {
      focusOnWindowRef.current(pending.window, pending.immediate, pending.force);
    }
  }, []);

  const setSafeArea = useCallback((sa) => {
    safeAreaRef.current = { ...sa };
  }, []);

  const focusOnWindowImpl = useCallback((window, immediate, force) => {
    if (isInteractingRef.current) {
      pendingFocusRef.current = { window, immediate, force };
      return null;
    }
    if (!template) return null;
    if (!force && (autoStateRef.current !== AUTO_STATE.ACTIVE)) return null;
    cancelAnimation();
    const safeArea = safeAreaRef.current;
    const target = planCamera(window, viewWidth, viewHeight, template.width, template.height, safeArea);
    const dx = window.centerX - (lastFocusRef.current?.centerX || window.centerX);
    const dy = window.centerY - (lastFocusRef.current?.centerY || window.centerY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = immediate ? 1 : getTransitionDuration(dist, reducedMotion);
    lastFocusRef.current = window;
    // Initial readiness is atomic: never expose the canvas for one frame with
    // the default overview camera and then animate to the actionable target.
    if (immediate) {
      cameraRawRef.current = target;
      setCameraRaw(target);
    } else {
      animateTo(target, duration);
    }
    return target;
  }, [template, viewWidth, viewHeight, animateTo, cancelAnimation, reducedMotion]);

  const focusOnWindowRef = useRef(focusOnWindowImpl);
  focusOnWindowRef.current = focusOnWindowImpl;

  const focusOnWindow = focusOnWindowImpl;

  const focusOverview = useCallback(() => {
    if (isInteractingRef.current) return;
    if (!template) return;
    cancelAnimation();
    const safeArea = safeAreaRef.current;
    const availW = viewWidth - safeArea.left - safeArea.right;
    const availH = viewHeight - safeArea.top - safeArea.bottom;
    const zoomX = availW / (template.width * 32);
    const zoomY = availH / (template.height * 32);
    const zoom = Math.min(zoomX, zoomY, 1);
    const totalW = template.width * 32 * zoom;
    const totalH = template.height * 32 * zoom;
    const target = {
      x: (viewWidth - totalW) / 2,
      y: (viewHeight - totalH) / 2,
      zoom,
    };
    const duration = reducedMotion ? 1 : 350;
    animateTo(target, duration);
  }, [template, viewWidth, viewHeight, animateTo, cancelAnimation, reducedMotion]);

  const resumeAuto = useCallback(() => {
    autoStateRef.current = AUTO_STATE.ACTIVE;
    setAutoState(AUTO_STATE.ACTIVE);
  }, []);

  const pauseAuto = useCallback(() => {
    if (autoStateRef.current !== AUTO_STATE.ACTIVE) return;
    autoStateRef.current = AUTO_STATE.PAUSED;
    setAutoState(AUTO_STATE.PAUSED);
  }, []);

  const toggleAuto = useCallback(() => {
    const current = autoStateRef.current;
    if (current === AUTO_STATE.ACTIVE) {
      autoStateRef.current = AUTO_STATE.OFF;
      setAutoState(AUTO_STATE.OFF);
      cancelAnimation();
    } else if (current === AUTO_STATE.PAUSED) {
      resumeAuto();
    } else {
      autoStateRef.current = AUTO_STATE.ACTIVE;
      setAutoState(AUTO_STATE.ACTIVE);
    }
  }, [cancelAnimation, resumeAuto]);

  const enableAuto = useCallback(() => {
    if (autoStateRef.current === AUTO_STATE.ACTIVE) return;
    autoStateRef.current = AUTO_STATE.ACTIVE;
    setAutoState(AUTO_STATE.ACTIVE);
  }, []);

  const forceDisableAuto = useCallback(() => {
    autoStateRef.current = AUTO_STATE.OFF;
    setAutoState(AUTO_STATE.OFF);
    cancelAnimation();
  }, [cancelAnimation]);

  const markCameraReady = useCallback(() => {
    setCameraReady(true);
  }, []);

  useEffect(() => {
    if (!template && viewWidth === 0 && viewHeight === 0) {
      setCameraReady(false);
    }
  }, [template, viewWidth, viewHeight]);

  return {
    camera,
    cameraReady,
    markCameraReady,
    setCamera,
    setCameraInstant,
    isAutoActive,
    autoState,
    isInteracting: () => isInteractingRef.current,
    toggleAuto,
    pauseAuto,
    resumeAuto,
    enableAuto,
    forceDisableAuto,
    focusOnWindow,
    focusOverview,
    cancelAnimation,
    beginInteraction,
    endInteraction,
    setSafeArea,
    sessionRef,
    reducedMotion,
    lastFocusRef,
    lastCenterRef,
    prevCenterRef,
    safeAreaRef,
  };
}
