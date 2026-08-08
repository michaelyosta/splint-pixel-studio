import { planCamera } from '../engine/cameraPlanner.js';

export const GUIDANCE_REASON = Object.freeze({
  INITIAL_TARGET: 'INITIAL_TARGET',
  SAME_COLOR_NEXT: 'SAME_COLOR_NEXT',
  COLOR_COMPLETE: 'COLOR_COMPLETE',
  MANUAL_COLOR: 'MANUAL_COLOR',
  RETURN_TO_TARGET: 'RETURN_TO_TARGET',
  ARTWORK_COMPLETE: 'ARTWORK_COMPLETE',
  NO_ACTIONABLE_CELLS: 'NO_ACTIONABLE_CELLS',
});

export const MIN_WORK_ZOOM = 0.4;
export const MAX_WORK_ZOOM = 1;

function asInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TypeError(`${label} must be an integer`);
  }
  return number;
}

/**
 * Bounded guidance contract: a plan must never carry full-grid arrays.
 * Rejects any payload that leaks cells/filled onto the client.
 */
export function normalizeGuidancePayload(raw, { templateId } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Guidance response must be an object');
  }
  if ('cells' in raw || 'filled' in raw || 'cells_json' in raw || 'filled_json' in raw
    || ('target' in raw && raw.target && ('cells' in raw.target || 'filled' in raw.target))) {
    throw new TypeError('Guidance response must not contain full cell arrays');
  }
  if (templateId && raw.template_id && String(raw.template_id) !== String(templateId)) {
    throw new TypeError('Guidance belongs to a different template');
  }
  const progressRevision = asInteger(raw.progress_revision ?? 0, 'progress_revision');
  const reason = String(raw.reason || GUIDANCE_REASON.INITIAL_TARGET);
  const indexMissing = Boolean(raw.index_missing);
  const selectedColor = raw.selected_color === null || raw.selected_color === undefined
    ? null
    : asInteger(raw.selected_color, 'selected_color');
  const globalRemaining = asInteger(raw.global_remaining_for_color ?? 0, 'global_remaining_for_color');
  const nextColor = raw.next_color === null || raw.next_color === undefined
    ? null
    : asInteger(raw.next_color, 'next_color');
  let target = null;
  if (raw.target && typeof raw.target === 'object') {
    const bounds = raw.target.bounds || {};
    target = {
      tile_x: asInteger(raw.target.tile_x, 'target.tile_x'),
      tile_y: asInteger(raw.target.tile_y, 'target.tile_y'),
      anchor_x: asInteger(raw.target.anchor_x, 'target.anchor_x'),
      anchor_y: asInteger(raw.target.anchor_y, 'target.anchor_y'),
      bounds: {
        min_x: asInteger(bounds.min_x, 'target.bounds.min_x'),
        min_y: asInteger(bounds.min_y, 'target.bounds.min_y'),
        max_x: asInteger(bounds.max_x, 'target.bounds.max_x'),
        max_y: asInteger(bounds.max_y, 'target.bounds.max_y'),
        width: asInteger(bounds.width, 'target.bounds.width'),
        height: asInteger(bounds.height, 'target.bounds.height'),
      },
      estimated_cells: asInteger(raw.target.estimated_cells, 'target.estimated_cells'),
      color: raw.target.color === null || raw.target.color === undefined
        ? selectedColor
        : asInteger(raw.target.color, 'target.color'),
    };
  }
  return {
    schemaVersion: raw.schema_version ?? null,
    templateId: raw.template_id ? String(raw.template_id) : null,
    progressRevision,
    reason,
    indexMissing,
    selectedColor,
    globalRemainingForColor: globalRemaining,
    nextColor,
    colorComplete: Boolean(raw.color_complete),
    artworkComplete: Boolean(raw.artwork_complete),
    target,
  };
}

export function isStaleGuidance(plan, committedRevision) {
  return Boolean(plan && Number(plan.progressRevision) < Number(committedRevision || 0));
}

export function isGuidanceIndexMissing(plan) {
  return Boolean(plan?.indexMissing);
}

export function isTrueColorCompletion(plan) {
  return Boolean(plan && (
    plan.reason === GUIDANCE_REASON.COLOR_COMPLETE
    || plan.colorComplete
  ) && plan.globalRemainingForColor === 0);
}

export function isTargetActionable(plan) {
  return Boolean(plan?.target && plan.target.estimated_cells > 0);
}

export function guidanceCameraCenter(camera, viewport, cellSize = 32) {
  const zoom = Math.max(0.0001, Number(camera?.zoom) || 1);
  const width = Math.max(1, Number(viewport?.width) || 1);
  const height = Math.max(1, Number(viewport?.height) || 1);
  const x = (width / 2 - Number(camera?.x || 0)) / zoom / cellSize;
  const y = (height / 2 - Number(camera?.y || 0)) / zoom / cellSize;
  return { x, y };
}

export function planGuidanceCamera(plan, viewport, template, cellSize = 32) {
  if (!isTargetActionable(plan) || !viewport?.width || !viewport?.height || !template) return null;
  const bounds = plan.target.bounds;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const zoom = Math.min(
    1,
    (viewport.width * 0.92) / (width * cellSize),
    (viewport.height * 0.72) / (height * cellSize),
  );
  const clampedZoom = Math.min(MAX_WORK_ZOOM, Math.max(MIN_WORK_ZOOM, zoom));
  return planCamera(
    {
      centerX: plan.target.anchor_x + 0.5,
      centerY: plan.target.anchor_y + 0.5,
      zoom: clampedZoom,
      bounds: {
        minX: bounds.min_x,
        minY: bounds.min_y,
        maxX: bounds.max_x,
        maxY: bounds.max_y,
      },
    },
    viewport.width,
    viewport.height,
    template.width,
    template.height,
  );
}

export function countPaintedCellsInTarget(plan, changes, templateWidth) {
  if (!plan?.target || !Array.isArray(changes)) return 0;
  const bounds = plan.target.bounds;
  return changes.reduce((total, change) => {
    const x = change.index % templateWidth;
    const y = Math.floor(change.index / templateWidth);
    if (x >= bounds.min_x && x <= bounds.max_x && y >= bounds.min_y && y <= bounds.max_y) {
      return total + 1;
    }
    return total;
  }, 0);
}
