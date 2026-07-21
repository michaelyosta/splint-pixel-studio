import { useState, useCallback, useRef, useEffect } from 'react';
import { clampCamera, planCamera, getTransitionDuration } from '../engine/cameraPlanner.js';
import { createCameraAnimation } from './cameraAnimation.js';

export function useSmartCamera(template, viewWidth, viewHeight) {
  const [camera, setCameraRaw] = useState({ x: 0, y: 0, zoom: 1 });
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [isTemporarilyPaused, setTemporarilyPaused] = useState(false);
  const autoEnabledRef = useRef(true);
  const pauseTimerRef = useRef(null);
  const animCancelRef = useRef(null);
  const sessionRef = useRef(Date.now());
  const lastFocusRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const isInteractingRef = useRef(false);
  const pendingFocusRef = useRef(null);

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
    const mayRun = pending?.force || (autoEnabledRef.current && !isTemporarilyPaused);
    if (pending && mayRun) {
      focusOnWindowRef.current(pending.window, pending.immediate, pending.force);
    }
  }, [isTemporarilyPaused]);

  const focusOnWindow = useCallback((window, immediate, force) => {
    if (isInteractingRef.current) {
      pendingFocusRef.current = { window, immediate, force };
      return null;
    }
    if (!template) return null;
    if (!force && (!autoEnabledRef.current || isTemporarilyPaused)) return null;
    cancelAnimation();
    const target = planCamera(window, viewWidth, viewHeight, template.width, template.height);
    const dx = window.centerX - (lastFocusRef.current?.centerX || window.centerX);
    const dy = window.centerY - (lastFocusRef.current?.centerY || window.centerY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = immediate ? 1 : getTransitionDuration(dist, reducedMotion);
    lastFocusRef.current = window;
    animateTo(target, duration);
    return target;
  }, [template, viewWidth, viewHeight, animateTo, cancelAnimation, reducedMotion, isTemporarilyPaused]);

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

  const resumeAuto = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
    autoEnabledRef.current = true;
    setAutoEnabled(true);
    setTemporarilyPaused(false);
  }, []);

  const pauseAuto = useCallback(() => {
    if (!autoEnabledRef.current) return;
    setTemporarilyPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      pauseTimerRef.current = null;
      if (autoEnabledRef.current) {
        setTemporarilyPaused(false);
      }
    }, 6000);
  }, []);

  const toggleAuto = useCallback(() => {
    if (autoEnabledRef.current && isTemporarilyPaused) {
      resumeAuto();
      return;
    }
    const next = !autoEnabledRef.current;
    autoEnabledRef.current = next;
    setAutoEnabled(next);
    if (next) {
      setTemporarilyPaused(false);
    }
  }, [isTemporarilyPaused, resumeAuto]);

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
