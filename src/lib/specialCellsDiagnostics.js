/**
 * Opt-in client diagnostics for Special Cells. This module only reads state;
 * it never queues saves, changes gameplay, or writes session files. The HUD
 * and dump are development-only and stay hidden unless explicitly enabled.
 */

import { getTelegramVerticalSwipeStatus } from './telegram.js';

export const SPECIAL_CELL_KINDS = Object.freeze([
  'spark',
  'bomb',
  'fuse',
  'choice',
  'artifact',
  'hazard',
]);

export function isSpecialCellsDiagnosticsEnabled(env = {}) {
  if (!env.DEV) return false;
  if (env.VITE_SHOW_SPECIAL_CELLS_DIAGNOSTICS === 'true'
    || env.VITE_SHOW_COLORING_DIAGNOSTICS === 'true') {
    return true;
  }
  if (typeof window === 'undefined' || typeof window.location?.search !== 'string') return false;
  return new URLSearchParams(window.location.search).has('specialDiagnostics');
}

export function normalizeSpecialMarker(marker, { tileX = null, tileY = null } = {}) {
  if (!marker || typeof marker !== 'object') return null;
  const id = String(marker.id || marker.special_id || '');
  if (!id) return null;
  const rawKind = String(marker.kind || '').toLowerCase();
  const index = Number(marker.cell_index ?? marker.cellIndex ?? marker.index);
  const localIndex = Number(marker.local_index ?? marker.localIndex);
  const tile = tileX == null || tileY == null
    ? null
    : `${Number(tileX)}:${Number(tileY)}`;
  return {
    id,
    kind: SPECIAL_CELL_KINDS.includes(rawKind) ? rawKind : 'unknown',
    state: String(marker.state || marker.status || 'unseen').toLowerCase(),
    index: Number.isInteger(index) && index >= 0 ? index : null,
    localIndex: Number.isInteger(localIndex) && localIndex >= 0 ? localIndex : null,
    tile,
  };
}

function normalizeMarkerList(markers) {
  const result = [];
  const seen = new Set();
  for (const entry of markers || []) {
    if (entry && typeof entry === 'object' && Array.isArray(entry.specials)) {
      for (const marker of entry.specials) {
        const normalized = normalizeSpecialMarker(marker, {
          tileX: entry.tile_x ?? entry.tileX,
          tileY: entry.tile_y ?? entry.tileY,
        });
        if (normalized && !seen.has(normalized.id)) {
          seen.add(normalized.id);
          result.push(normalized);
        }
      }
      continue;
    }
    const normalized = normalizeSpecialMarker(entry);
    if (normalized && !seen.has(normalized.id)) {
      seen.add(normalized.id);
      result.push(normalized);
    }
  }
  return result.slice(0, 64);
}

export function stripMarkerCoordinates(markers) {
  return (markers || []).map((marker) => ({
    kind: marker?.kind || 'unknown',
    state: marker?.state || 'unseen',
  }));
}

export function normalizeVisibleSpecials(specials) {
  return normalizeMarkerList(specials);
}

export function countSpecialsByKindWithUnknown(markers, kinds = SPECIAL_CELL_KINDS) {
  const counts = Object.fromEntries([...kinds, 'unknown'].map((kind) => [kind, 0]));
  for (const marker of markers || []) {
    const kind = kinds.includes(marker?.kind) ? marker.kind : 'unknown';
    counts[kind] += 1;
  }
  return counts;
}

export function countSpecialsByKind(markers, kinds = SPECIAL_CELL_KINDS) {
  const counts = Object.fromEntries(kinds.map((kind) => [kind, 0]));
  for (const marker of markers || []) {
    const kind = SPECIAL_CELL_KINDS.includes(marker?.kind) ? marker.kind : 'unknown';
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

export function normalizeTarget(target, plan = null) {
  if (!target || typeof target !== 'object') return null;
  return {
    cells: Number.isFinite(Number(target.estimated_cells))
      ? Number(target.estimated_cells)
      : Array.isArray(target.workCells) ? target.workCells.length : null,
    color: Number.isFinite(Number(target.color)) ? Number(target.color) : null,
    reason: plan?.reason ? String(plan.reason) : null,
    specialPity: Boolean(plan?.specialPity),
  };
}

export function normalizeActiveOffer(offer) {
  if (!offer || typeof offer !== 'object') return null;
  return {
    kind: String(offer.kind || 'spark').toLowerCase(),
    hasToken: Boolean(offer.offer_token),
    optionCount: Array.isArray(offer.target_options)
      ? offer.target_options.length
      : Array.isArray(offer.choice_options) ? offer.choice_options.length : null,
  };
}

function markerInTarget(marker, target, templateWidth = null) {
  if (!marker || marker.index == null || !target || typeof target !== 'object') return false;
  const workCells = Array.isArray(target.workCells)
    ? new Set(target.workCells.map(Number))
    : null;
  if (workCells) return workCells.has(marker.index);
  const bounds = target.bounds;
  if (!bounds || !templateWidth) return false;
  const minX = Number(bounds.min_x);
  const minY = Number(bounds.min_y);
  const maxX = Number(bounds.max_x);
  const maxY = Number(bounds.max_y);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
  const x = marker.index % templateWidth;
  const y = Math.floor(marker.index / templateWidth);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

export function markersInTarget(markers, target, templateWidth = null) {
  if (!Array.isArray(markers) || !target) return [];
  return markers.filter((marker) => markerInTarget(marker, target, templateWidth));
}

export function normalizeDiscovered(discovered) {
  if (!discovered || typeof discovered !== 'object') return null;
  return {
    kind: String(discovered.kind || '').toLowerCase() || 'unknown',
    missed: Boolean(discovered.missed),
    artifactFragments: Number.isFinite(Number(discovered.artifact_fragments))
      ? Number(discovered.artifact_fragments)
      : null,
  };
}

export function normalizeLastError(error) {
  if (!error) return null;
  return {
    name: typeof error.name === 'string' ? error.name : null,
    message: typeof error.message === 'string' ? error.message : String(error),
    code: error.code || error.data?.code || null,
    status: error.status == null ? null : Number(error.status),
    at: error.at || error.timestamp || null,
  };
}

export function getTelegramCapability() {
  if (typeof window === 'undefined') return { available: false };
  const webApp = window.Telegram?.WebApp || null;
  return {
    available: Boolean(webApp),
    initData: Boolean(webApp?.initData?.trim()),
    version: webApp?.version || null,
    platform: webApp?.platform || null,
    colorScheme: webApp?.colorScheme || null,
    haptics: Boolean(webApp?.HapticFeedback),
    backButton: Boolean(webApp?.BackButton),
    openTelegramLink: typeof webApp?.openTelegramLink === 'function',
    verticalSwipe: {
      ...getTelegramVerticalSwipeStatus(webApp),
    },
    fullscreen: {
      current: webApp?.isFullscreen == null ? null : Boolean(webApp.isFullscreen),
      requestSupported: typeof webApp?.requestFullscreen === 'function',
      exitSupported: typeof webApp?.exitFullscreen === 'function',
      expanded: webApp?.isExpanded == null ? null : Boolean(webApp.isExpanded),
      viewportStableHeight: webApp?.viewportStableHeight == null
        ? null
        : Number(webApp.viewportStableHeight),
    },
  };
}

export function buildSpecialCellsDiagnosticsSnapshot({
  template = null,
  progress = null,
  visibleSpecials = [],
  offer = null,
  discovered = null,
  target = null,
  plan = null,
  recentTargets = [],
  targetActive = true,
  lastError = null,
  telegram = null,
  now = null,
} = {}) {
  const serverDiagnostics = progress?.special_diagnostics || null;
  const serverHasCountsByKind = Boolean(
    serverDiagnostics
    && typeof serverDiagnostics.counts_by_kind === 'object'
    && serverDiagnostics.counts_by_kind !== null,
  );
  const serverHasOverride = Object.prototype.hasOwnProperty.call(
    serverDiagnostics || {},
    'cohort_override',
  );
  const markers = normalizeVisibleSpecials(visibleSpecials);
  const cohort = progress?.specials_experiment_group || null;
  const override = serverHasOverride
    ? Boolean(serverDiagnostics.cohort_override)
    : null;
  const normalizedTarget = targetActive && plan && target ? normalizeTarget(target, plan) : null;
  const inTarget = normalizedTarget
    ? markersInTarget(markers, target, template?.width)
    : [];
  const publicMarkers = stripMarkerCoordinates(markers);
  const publicInTarget = stripMarkerCoordinates(inTarget);
  const templateId = template?.id ?? progress?.template_id ?? null;
  const targetKinds = countSpecialsByKindWithUnknown(publicInTarget);
  const totalServerCandidates = serverHasCountsByKind
    ? Object.values(serverDiagnostics.counts_by_kind)
      .filter((value) => Number.isFinite(Number(value)))
      .reduce((sum, value) => sum + Number(value), 0)
    : null;
  return {
    generatedAt: now || new Date().toISOString(),
    templateId,
    cohort,
    override,
    override_unknown: !serverHasOverride,
    template: template
      ? {
        id: template.id,
        title: template.title || null,
        width: Number(template.width),
        height: Number(template.height),
        storage_mode: template.storage_mode || template.storageMode || null,
        tile_size: template.tile_size == null ? null : Number(template.tile_size),
      }
      : null,
    placement: {
      generation_version: serverDiagnostics?.generation_version ?? null,
      special_count: serverDiagnostics?.special_count ?? markers.length,
    },
    active_special: serverDiagnostics?.active_special_id
      ? { present: true }
      : { present: false },
    counts: serverDiagnostics?.counts_by_status ?? null,
    by_type: {
      server: serverHasCountsByKind ? { ...serverDiagnostics.counts_by_kind } : null,
      server_missing: !serverHasCountsByKind,
      visible: countSpecialsByKindWithUnknown(publicMarkers),
    },
    metadata: {
      loaded: publicMarkers.length,
      visible: publicMarkers.length,
      server_candidates: totalServerCandidates,
      server_candidates_unknown: totalServerCandidates == null,
    },
    visible: publicMarkers,
    current_target: normalizedTarget,
    current_target_specials: {
      count: publicInTarget.length,
      by_type: targetKinds,
    },
    discovered: normalizeDiscovered(discovered),
    active_offer: normalizeActiveOffer(offer),
    recent_targets: recentTargets.length,
    completed: {
      percent: Number(progress?.percent ?? 0),
      completed_cells: Number(progress?.completed_cells ?? 0),
      total_cells: Number(progress?.total_cells ?? 0),
      completed_at: progress?.completed_at ?? null,
      artwork_id: progress?.artwork_id ?? null,
      consumed: serverDiagnostics?.counts_by_status?.consumed ?? null,
      skipped: serverDiagnostics?.counts_by_status?.skipped ?? null,
    },
    pity: {
      due: Boolean(serverDiagnostics?.pity_due),
      cells_to_next: serverDiagnostics?.cells_to_next_pity_boundary ?? null,
    },
    artifact_progress: progress?.artifact_progress || null,
    last_error: normalizeLastError(lastError),
    telegram: telegram || getTelegramCapability(),
  };
}

export function formatSpecialCellsDiagnostics(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

let diagnosticsEnabled = false;
let lastError = null;

/** Enables/disables retention for the dev-only last-error recorder. */
export function setSpecialCellsDiagnosticsEnabled(enabled) {
  if (!enabled) clearSpecialCellsLastError();
  diagnosticsEnabled = Boolean(enabled);
}

/** Records the most recent special-cell error for the dev HUD only. */
export function recordSpecialCellsError(error) {
  if (!diagnosticsEnabled) return null;
  const normalized = normalizeLastError(error) || {};
  lastError = { ...normalized, at: new Date().toISOString() };
  return { ...lastError };
}

export function getSpecialCellsLastError() {
  return lastError ? { ...lastError } : null;
}

export function clearSpecialCellsLastError() {
  lastError = null;
}
