export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function createCameraAnimation(from, to, duration, onFrame, onComplete) {
  const startTime = performance.now();
  let animId = null;
  let running = true;

  function tick(now) {
    if (!running) return;
    const elapsed = now - startTime;
    const t = Math.min(1, duration > 0 ? elapsed / duration : 1);
    const e = easeOutCubic(t);
    onFrame({
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      zoom: from.zoom + (to.zoom - from.zoom) * e,
    });
    if (t < 1) {
      animId = requestAnimationFrame(tick);
    } else {
      if (onComplete) onComplete();
    }
  }

  animId = requestAnimationFrame(tick);

  return () => {
    running = false;
    if (animId) cancelAnimationFrame(animId);
  };
}
