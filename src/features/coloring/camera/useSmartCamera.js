import { useState, useCallback, useRef, useEffect } from 'react';
import { clampCamera, planCamera, getTransitionDuration } from '../engine/cameraPlanner.js';
import { createCameraAnimation } from './cameraAnimation.js';

export function useSmartCamera(template, viewWidth, viewHeight) {
  const [camera, setCameraRaw] = useState({ x: 0, y: 0, zoom: 1 });
  const [autoEnabled, setAutoEnabled] = useState(true);
  const autoEnabledRef = useRef(true);
  const manualPauseUntilRef = useRef(0);
  const pauseTimerRef = useRef(null);
  const animCancelRef = useRef(null);
  const sessionRef = useRef(Date.now());
  const lastFocusRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const isInteractingRef = useRef(false);
  const pendingFocusRef = useRef(null);

  const now = Date.now();
  const isTemporarilyPaused = autoEnabled && now <= manualPauseUntilRef.current;
  const isAutoActive = autoEnabled && !isTemporarilyPaused && !isInteractingRef.current;

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
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      sessionRef.current = 0;
    };
  }, []);

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

  const cameraRawRef = useRef(camera);
  cameraRawRef.current = camera;

  const setCamera = useCallback((c) => {
    cancelAnimation();
    if (!template) return;
    const clamped = clampCamera(c, viewWidth, viewHeight, template.width, template.height);
    cameraRawRef.current = clamped;
    setCameraRaw(clamped);
  }, [template, viewWidth, viewHeight, cancelAnimation]);

  const beginInteraction = useCallback(() => {
    isInteractingRef.current = true;
    cancelAnimation();
  }, [cancelAnimation]);

  const endInteraction = useCallback(() => {
    isInteractingRef.current = false;
    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (pending && autoEnabledRef.current && Date.now() > manualPauseUntilRef.current) {
      focusOnWindowRef.current(pending.window, pending.immediate);
    }
  }, []);

  const focusOnWindow = useCallback((window, immediate, force) => {
    if (isInteractingRef.current) {
      pendingFocusRef.current = { window, immediate };
      return null;
    }
    if (!template) return null;
    if (!force && (!autoEnabledRef.current || Date.now() <= manualPauseUntilRef.current)) return null;
    cancelAnimation();
    const target = planCamera(window, viewWidth, viewHeight, template.width, template.height);
    const dx = window.centerX - (lastFocusRef.current?.centerX || window.centerX);
    const dy = window.centerY - (lastFocusRef.current?.centerY || window.centerY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = immediate ? 1 : getTransitionDuration(dist, reducedMotion);
    lastFocusRef.current = window;
    animateTo(target, duration);
    return target;
  }, [template, viewWidth, viewHeight, animateTo, cancelAnimation, reducedMotion]);

  const focusOnWindowRef = useRef(focusOnWindow);
  focusOnWindowRef.current = focusOnWindow;

  const focusOverview = useCallback(() => {
    if (isInteractingRef.current) return;
    if (!template) return;
    cancelAnimation();
    const zoomX = viewWidth / (template.width * 32);
    const zoomY = viewHeight / (template.height * 32);
    const zoom = Math.min(zoomX, zoomY, 1);
    const totalW = template.width * 32 * zoom;
    const totalH = template.height * 32 * zoom;
    const target = { x: (viewWidth - totalW) / 2, y: (viewHeight - totalH) / 2, zoom };
    const duration = reducedMotion ? 1 : 350;
    animateTo(target, duration);
  }, [template, viewWidth, viewHeight, animateTo, cancelAnimation, reducedMotion]);

  const toggleAuto = useCallback(() => {
    const currentlyEnabled = autoEnabledRef.current;
    if (currentlyEnabled && isTemporarilyPaused) {
      resumeAutoRef.current();
      return;
    }
    autoEnabledRef.current = !currentlyEnabled;
    setAutoEnabled(autoEnabledRef.current);
    if (autoEnabledRef.current) {
      manualPauseUntilRef.current = 0;
    } else {
      manualPauseUntilRef.current = Infinity;
    }
  }, [isTemporarilyPaused]);

  const pauseAuto = useCallback(() => {
    manualPauseUntilRef.current = Date.now() + 6000;
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      pauseTimerRef.current = null;
      if (autoEnabledRef.current && manualPauseUntilRef.current !== Infinity) {
        manualPauseUntilRef.current = 0;
        setAutoEnabled(true);
      }
    }, 6000);
  }, []);

  const resumeAuto = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
    autoEnabledRef.current = true;
    setAutoEnabled(true);
    manualPauseUntilRef.current = 0;
  }, []);

  const resumeAutoRef = useRef(resumeAuto);
  resumeAutoRef.current = resumeAuto;

  return {
    camera,
    setCamera,
    isAutoActive,
    autoEnabled,
    isTemporarilyPaused,
    toggleAuto,
    pauseAuto,
    resumeAuto,
    focusOnWindow,
    focusOverview,
    cancelAnimation,
    beginInteraction,
    endInteraction,
    sessionRef,
    reducedMotion,
    lastFocusRef,
  };
}
