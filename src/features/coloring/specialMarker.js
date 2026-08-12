// Shared marker rendering for Special Cells. Both canvas surfaces use this
// module so legacy and tiled glyphs stay visually identical. Marker geometry
// is authored in world units; callers pass a screen-space radius so the same
// glyph remains readable across the zoom range without scaling without bound.

export const SPECIAL_MARKER_VISUALS = Object.freeze({
  spark: Object.freeze({
    markerColor: 'rgba(112, 225, 255, 0.96)',
    markerCore: '#e7fbff',
    markerOutline: '#06202a',
    markerGlow: 'rgba(82, 218, 255, 0.82)',
    markerPattern: 'rays',
    markerShape: 'diamond',
  }),
  bomb: Object.freeze({
    markerColor: 'rgba(255, 122, 112, 0.97)',
    markerCore: '#fff0ed',
    markerOutline: '#35100e',
    markerGlow: 'rgba(255, 105, 92, 0.7)',
    markerPattern: 'crosshair',
    markerShape: 'bomb',
  }),
  fuse: Object.freeze({
    markerColor: 'rgba(255, 193, 83, 0.97)',
    markerCore: '#fff6d7',
    markerOutline: '#352207',
    markerGlow: 'rgba(255, 193, 83, 0.7)',
    markerPattern: 'links',
    markerShape: 'fuse',
  }),
  choice: Object.freeze({
    markerColor: 'rgba(105, 225, 168, 0.97)',
    markerCore: '#e4ffef',
    markerOutline: '#06251a',
    markerGlow: 'rgba(105, 225, 168, 0.66)',
    markerPattern: 'split',
    markerShape: 'choice',
  }),
  artifact: Object.freeze({
    markerColor: 'rgba(255, 211, 137, 0.97)',
    markerCore: '#fff5db',
    markerOutline: '#352407',
    markerGlow: 'rgba(255, 211, 137, 0.72)',
    markerPattern: 'facets',
    markerShape: 'artifact',
  }),
  hazard: Object.freeze({
    markerColor: 'rgba(255, 84, 84, 0.97)',
    markerCore: '#fff0f0',
    markerOutline: '#380707',
    markerGlow: 'rgba(255, 75, 75, 0.64)',
    markerPattern: 'warning',
    markerShape: 'hazard',
  }),
  unknown: Object.freeze({
    markerColor: 'rgba(173, 190, 198, 0.95)',
    markerCore: '#f2f6f7',
    markerOutline: '#0b131a',
    markerGlow: 'rgba(173, 190, 198, 0.45)',
    markerPattern: 'plain',
    markerShape: 'unknown',
  }),
});

export function specialMarkerVisual(kind) {
  return SPECIAL_MARKER_VISUALS[String(kind || '').toLowerCase()] || SPECIAL_MARKER_VISUALS.unknown;
}

export function collectVisibleSpecialKinds(tiles, visibleKeys) {
  if (!tiles || !visibleKeys?.size) return [];
  const kinds = [];
  for (const tile of tiles) {
    if (!visibleKeys.has(tile?.key)) continue;
    for (const special of tile.specials || []) {
      const localIndex = Number(special.localIndex);
      if (special.state !== 'unseen' || !Number.isSafeInteger(localIndex)
        || tile.filled?.[localIndex] !== -1) continue;
      if (special.kind && !kinds.includes(special.kind)) kinds.push(special.kind);
    }
  }
  return kinds;
}

export function specialMarkerScreenRadius(cellPixels, { min = 4, max = 10, fraction = 0.32 } = {}) {
  const pixels = Number(cellPixels);
  if (!Number.isFinite(pixels) || pixels <= 0) return min;
  return Math.max(min, Math.min(max, pixels * fraction));
}

export function drawSpecialMarker(ctx, special, centerX, centerY, screenRadius, zoom, {
  state = 'idle',
  phase = 0,
  reducedMotion = false,
} = {}) {
  const visual = specialMarkerVisual(special.kind);
  const safeZoom = Math.max(Number(zoom) || 1, 0.1);
  const radius = Math.max(Number(screenRadius) || 4, 4) / safeZoom;
  const pulse = reducedMotion ? 0 : (Math.sin(phase) + 1) / 2;
  const active = state === 'active';
  const outlineWidth = 1.5 / safeZoom;
  ctx.save();
  // Every marker gets a quiet atmospheric ring; only the current Smart target
  // gets the stronger breathing ring. This makes state legible without
  // pretending a future server effect has already happened.
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * (1.22 + (active ? pulse * 0.22 : 0)), 0, Math.PI * 2);
  ctx.strokeStyle = visual.markerGlow;
  ctx.globalAlpha = active ? 0.34 + pulse * 0.2 : 0.16;
  ctx.lineWidth = (active ? 1.7 : 1) / safeZoom;
  ctx.shadowColor = visual.markerGlow;
  ctx.shadowBlur = (active ? 5 : 2) / safeZoom;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = visual.markerColor;
  ctx.strokeStyle = visual.markerOutline;
  ctx.lineWidth = outlineWidth;
  if (visual.markerShape === 'diamond') {
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
  } else if (visual.markerShape === 'bomb') {
    ctx.beginPath();
    ctx.arc(centerX, centerY - radius * 0.15, radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius * 1.05);
    ctx.quadraticCurveTo(centerX + radius * 0.75, centerY - radius * 1.3, centerX + radius * 0.8, centerY - radius * 0.55);
    ctx.stroke();
  } else if (visual.markerShape === 'fuse') {
    // Fuse is intentionally a horizontal link with a trailing spark. A
    // triangle reads too close to Hazard at small mobile sizes, especially
    // when both markers are visible in the same work window.
    const bodyWidth = radius * 1.5;
    const bodyHeight = radius * 0.72;
    const bodyLeft = centerX - radius * 0.72;
    const bodyTop = centerY - bodyHeight / 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bodyLeft, bodyTop, bodyWidth, bodyHeight, radius * 0.28);
    } else {
      ctx.rect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
    }
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + radius * 0.48, centerY);
    ctx.quadraticCurveTo(
      centerX + radius * 0.98,
      centerY - radius * 0.52,
      centerX + radius * 0.76,
      centerY - radius * 0.92,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX + radius * 0.76, centerY - radius * 0.92, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (visual.markerShape === 'choice') {
    ctx.beginPath();
    ctx.arc(centerX - radius * 0.45, centerY, radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX + radius * 0.45, centerY, radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (visual.markerShape === 'artifact') {
    ctx.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI / 3) * index - Math.PI / 2;
      const pointX = centerX + Math.cos(angle) * radius;
      const pointY = centerY + Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(pointX, pointY);
      else ctx.lineTo(pointX, pointY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (visual.markerShape === 'hazard') {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX + radius * 0.95, centerY + radius * 0.7);
    ctx.lineTo(centerX - radius * 0.95, centerY + radius * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = visual.markerOutline;
    ctx.fillRect(centerX - radius * 0.18, centerY - radius * 0.28, radius * 0.36, radius * 0.62);
    ctx.fillRect(centerX - radius * 0.18, centerY + radius * 0.5, radius * 0.36, radius * 0.12);
  } else {
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.strokeRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }
  // A small, high-contrast core plus a one-stroke pattern survives the 4 px
  // minimum marker size and keeps the six silhouettes distinguishable without
  // relying on hue alone.
  ctx.strokeStyle = visual.markerCore;
  ctx.fillStyle = visual.markerCore;
  ctx.lineWidth = Math.max(0.7, 0.9 / safeZoom);
  ctx.globalAlpha = 0.82;
  if (visual.markerPattern === 'rays') {
    ctx.beginPath();
    ctx.moveTo(centerX - radius * 0.48, centerY);
    ctx.lineTo(centerX + radius * 0.48, centerY);
    ctx.moveTo(centerX, centerY - radius * 0.48);
    ctx.lineTo(centerX, centerY + radius * 0.48);
    ctx.stroke();
  } else if (visual.markerPattern === 'crosshair') {
    ctx.beginPath();
    ctx.arc(centerX, centerY - radius * 0.12, radius * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
  } else if (visual.markerPattern === 'links') {
    ctx.beginPath();
    ctx.arc(centerX - radius * 0.34, centerY, radius * 0.12, 0, Math.PI * 2);
    ctx.arc(centerX + radius * 0.12, centerY, radius * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else if (visual.markerPattern === 'split') {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius * 0.52);
    ctx.lineTo(centerX, centerY + radius * 0.52);
    ctx.stroke();
  } else if (visual.markerPattern === 'facets') {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius * 0.48);
    ctx.lineTo(centerX + radius * 0.4, centerY);
    ctx.lineTo(centerX, centerY + radius * 0.48);
    ctx.lineTo(centerX - radius * 0.4, centerY);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
