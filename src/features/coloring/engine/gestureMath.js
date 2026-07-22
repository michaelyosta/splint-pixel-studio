export function centroid(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

export function distance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function clampZoom(zoom) {
  return Math.min(4, Math.max(0.25, zoom));
}

export function computePinchPan({ a, b, startDistance, startCentroid, startCamera, rect }) {
  const currentDistance = distance(a, b);
  const currentCentroid = centroid(a, b);
  const ratio = currentDistance / startDistance;
  const newZoom = clampZoom(startCamera.zoom * ratio);
  const cx = currentCentroid.x - rect.left;
  const cy = currentCentroid.y - rect.top;
  const scx = startCentroid.x - rect.left;
  const scy = startCentroid.y - rect.top;
  const newX = cx + (startCamera.x - scx) * (newZoom / startCamera.zoom);
  const newY = cy + (startCamera.y - scy) * (newZoom / startCamera.zoom);
  return { x: newX, y: newY, zoom: newZoom };
}

export function computePanFromCentroid({ currentCentroid, startCentroid, camera, rect }) {
  const cx = currentCentroid.x - rect.left;
  const cy = currentCentroid.y - rect.top;
  const scx = startCentroid.x - rect.left;
  const scy = startCentroid.y - rect.top;
  return {
    x: camera.x + (cx - scx),
    y: camera.y + (cy - scy),
    zoom: camera.zoom,
  };
}

export function isTapGesture(startPoint, endPoint) {
  if (!startPoint || !endPoint) return false;
  const dx = endPoint.clientX - startPoint.clientX;
  const dy = endPoint.clientY - startPoint.clientY;
  return Math.hypot(dx, dy) <= 5;
}
