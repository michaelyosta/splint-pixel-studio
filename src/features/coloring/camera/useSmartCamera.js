import { useState, useCallback, useRef, useEffect } from 'react';
import { clampCamera, planCamera, getTransitionDuration } from '../engine/cameraPlanner.js';
import { createCameraAnimation } from './cameraAnimation.js';

export function useSmartCamera(template, viewWidth, viewHeight) {
  const [camera, setCameraRaw] = useState({ x: 0, y: 0, zoom: 1 });
  const [isAuto, setIsAuto] = useState(true);
  const autoRef = useRef(true);
  const manualUntilRef = useRef(0);
  const animCancelRef = useRef(null);
  const sessionRef = useRef(Date.now());
  const lastFocusRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);

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

  const setCamera = useCallback((c) => {
    if (!template) return;
    const clamped = clampCamera(c, viewWidth, viewHeight, template.width, template.height);
    setCameraRaw(clamped);
  }, [template, viewWidth, viewHeight]);

  const animateTo = useCallback((target, duration) => {
    if (animCancelRef.current) animCancelRef.current();
    const from = { ...camera };
    animCancelRef.current = createCameraAnimation(
      from, target, duration,
      (frame) => setCameraRaw(frame),
      () => { animCancelRef.current = null; },
    );
  }, [camera]);

  const focusOnWindow = useCallback((window, immediate) => {
    if (!template) return;
    if (animCancelRef.current) animCancelRef.current();
    const target = planCamera(window, viewWidth, viewHeight, template.width, template.height);
    const dx = window.centerX - (lastFocusRef.current?.centerX || window.centerX);
    const dy = window.centerY - (lastFocusRef.current?.centerY || window.centerY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = immediate ? 1 : getTransitionDuration(dist, reducedMotion);
    lastFocusRef.current = window;
    animateTo(target, duration);
    return target;
  }, [template, viewWidth, viewHeight, animateTo, reducedMotion]);

  const focusOverview = useCallback(() => {
    if (!template) return;
    const zoomX = viewWidth / (template.width * 32);
    const zoomY = viewHeight / (template.height * 32);
    const zoom = Math.min(zoomX, zoomY, 1);
    const totalW = template.width * 32 * zoom;
    const totalH = template.height * 32 * zoom;
    const target = { x: (viewWidth - totalW) / 2, y: (viewHeight - totalH) / 2, zoom };
    const duration = reducedMotion ? 1 : 350;
    animateTo(target, duration);
  }, [template, viewWidth, viewHeight, animateTo, reducedMotion]);

  const toggleAuto = useCallback(() => {
    autoRef.current = !autoRef.current;
    setIsAuto(autoRef.current);
    if (!autoRef.current) {
      manualUntilRef.current = Infinity;
    } else {
      manualUntilRef.current = 0;
    }
  }, []);

  const pauseAuto = useCallback(() => {
    manualUntilRef.current = Date.now() + 6000;
    if (isAuto) {
      setIsAuto(false);
    }
  }, [isAuto]);

  const resumeAuto = useCallback(() => {
    autoRef.current = true;
    manualUntilRef.current = 0;
    setIsAuto(true);
  }, []);

  const checkAutoResume = useCallback(() => {
    if (!autoRef.current && Date.now() > manualUntilRef.current && manualUntilRef.current !== Infinity) {
      autoRef.current = true;
      setIsAuto(true);
    }
  }, []);

  return {
    camera,
    setCamera,
    isAuto,
    toggleAuto,
    pauseAuto,
    resumeAuto,
    focusOnWindow,
    focusOverview,
    checkAutoResume,
    sessionRef,
    reducedMotion,
    lastFocusRef,
  };
}
