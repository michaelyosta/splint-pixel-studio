import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpecialCellsDiagnosticsSnapshot,
  clearSpecialCellsLastError,
  countSpecialsByKind,
  countSpecialsByKindWithUnknown,
  formatSpecialCellsDiagnostics,
  getSpecialCellsLastError,
  isSpecialCellsDiagnosticsEnabled,
  normalizeActiveOffer,
  normalizeVisibleSpecials,
  recordSpecialCellsError,
  setSpecialCellsDiagnosticsEnabled,
  markersInTarget,
  stripMarkerCoordinates,
  getTelegramCapability,
} from './specialCellsDiagnostics.js';

test('special diagnostics stay opt-in and development-only', () => {
  assert.equal(isSpecialCellsDiagnosticsEnabled({}), false);
  assert.equal(isSpecialCellsDiagnosticsEnabled({ DEV: true }), false);
  assert.equal(isSpecialCellsDiagnosticsEnabled({ DEV: false, VITE_SHOW_SPECIAL_CELLS_DIAGNOSTICS: 'true' }), false);
  assert.equal(isSpecialCellsDiagnosticsEnabled({ DEV: true, VITE_SHOW_SPECIAL_CELLS_DIAGNOSTICS: 'true' }), true);
  assert.equal(isSpecialCellsDiagnosticsEnabled({ DEV: true, VITE_SHOW_COLORING_DIAGNOSTICS: 'true' }), true);
});

test('visible metadata normalizes tile payloads and legacy markers', () => {
  const tiles = [
    {
      tile_x: 0,
      tile_y: 1,
      specials: [
        { id: 'sc_a', kind: 'spark', cell_index: 40, local_index: 8, state: 'unseen', meta: { seed: 1 } },
        { id: 'sc_b', kind: 'bomb', cell_index: 41, local_index: 9, state: 'offered' },
      ],
    },
  ];
  const legacy = [{ id: 'sc_c', kind: 'hazard', cell_index: 10, local_index: 10, status: 'consumed' }];
  const normalized = normalizeVisibleSpecials([...tiles, ...legacy, ...tiles]);
  assert.equal(normalized.length, 3, 'duplicate tile markers are deduplicated');
  assert.deepEqual(normalized[0], {
    id: 'sc_a',
    kind: 'spark',
    state: 'unseen',
    index: 40,
    localIndex: 8,
    tile: '0:1',
  });
});

test('counts by kind always include the frozen kinds with zero fill', () => {
  const counts = countSpecialsByKind([
    { kind: 'spark' },
    { kind: 'spark' },
    { kind: 'bomb' },
    { kind: 'artifact' },
    { kind: 'mystery' },
  ]);
  assert.deepEqual(counts, {
    spark: 2,
    bomb: 1,
    fuse: 0,
    choice: 0,
    artifact: 1,
    hazard: 0,
    unknown: 1,
  });
});

test('visible counts include an explicit unknown bucket', () => {
  const counts = countSpecialsByKindWithUnknown([{ kind: 'spark' }, { kind: 'mystery' }]);
  assert.deepEqual(counts, {
    spark: 1,
    bomb: 0,
    fuse: 0,
    choice: 0,
    artifact: 0,
    hazard: 0,
    unknown: 1,
  });
});

test('dev URL opt-in works only in development and never in production', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { search: '?specialDiagnostics=1' } };
  try {
    assert.equal(isSpecialCellsDiagnosticsEnabled({ DEV: true }), true);
    assert.equal(isSpecialCellsDiagnosticsEnabled({ DEV: false }), false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('marker identity and coordinates are discarded and only counts remain', () => {
  const markers = normalizeVisibleSpecials([
    { id: 'in_work', kind: 'spark', cell_index: 9, state: 'unseen' },
    { id: 'out_work', kind: 'bomb', cell_index: 99, state: 'unseen' },
  ]);
  // Coordinates are intentionally not retained; target membership is reported
  // as aggregate counts only, never as marker identities or positions.
  assert.equal(markers.length, 2);
  assert.deepEqual(markers[0], {
    id: 'in_work',
    kind: 'spark',
    state: 'unseen',
    index: 9,
    localIndex: null,
    tile: null,
  });
});

test('markers in target use live work cells or bounds without exposing coordinates', () => {
  const markers = normalizeVisibleSpecials([
    { id: 'in-work-a', kind: 'spark', cell_index: 9, state: 'unseen' },
    { id: 'in-work-b', kind: 'bomb', cell_index: 14, state: 'unseen' },
    { id: 'out-work', kind: 'hazard', cell_index: 99, state: 'unseen' },
  ]);
  const inTarget = markersInTarget(markers, { workCells: [9, 14] });
  assert.equal(inTarget.length, 2);
  assert.deepEqual(stripMarkerCoordinates(inTarget), [
    { kind: 'spark', state: 'unseen' },
    { kind: 'bomb', state: 'unseen' },
  ]);

  const byBounds = markersInTarget(markers, {
    bounds: { min_x: 0, min_y: 0, max_x: 9, max_y: 0 },
  }, 10);
  assert.equal(byBounds.length, 1);
  assert.deepEqual(stripMarkerCoordinates(byBounds), [
    { kind: 'spark', state: 'unseen' },
  ]);
});

test('active offer is summarized without leaking token, ids, options, or coordinates', () => {
  const normalized = normalizeActiveOffer({
    kind: 'spark',
    special_id: 'sc_offer',
    offer_token: '0123456789abcdef',
    target_options: [{ option_id: 'a' }, { option_id: 'b' }],
    choice_options: [{ option_id: 'c' }],
    steps: [{ distance: 1, cells: 4 }],
    chain_cells: [1, 2, 3],
    center_x: 12,
    center_y: 14,
    reward_cap: 16,
  });
  assert.equal(normalized.hasToken, true);
  assert.equal(normalized.optionCount, 2);
  assert.equal(JSON.stringify(normalized).includes('89abcdef'), false);
  assert.equal(JSON.stringify(normalized).includes('01234567'), false);
  assert.equal(JSON.stringify(normalized).includes('sc_offer'), false);
  assert.equal(JSON.stringify(normalized).includes('"a"'), false);
  assert.equal(JSON.stringify(normalized).includes('12'), false);
  assert.equal(JSON.stringify(normalized).includes('"distance"'), false);
  assert.equal(JSON.stringify(normalized).includes('chain_cells'), false);
});

test('snapshot combines server diagnostics with client-visible state', () => {
  const template = {
    id: 'template-1',
    title: 'Diagnostics',
    width: 64,
    height: 64,
    storage_mode: 'tiled',
    tile_size: 32,
  };
  const progress = {
    template_id: 'template-1',
    specials_experiment_group: 'treatment',
    percent: 50,
    completed_cells: 2048,
    total_cells: 4096,
    completed_at: '2026-08-11T00:00:00.000Z',
    artwork_id: 'art_1',
    special_diagnostics: {
      cohort_override: true,
      generation_version: 4,
      special_count: 4,
      counts_by_kind: { spark: 2, bomb: 1, fuse: 0, choice: 0, artifact: 1, hazard: 0 },
      counts_by_status: { unseen: 1, offered: 1, consumed: 2, skipped: 0 },
      active_special_id: 'sc_offer',
      pity_due: false,
      cells_to_next_pity_boundary: 3952,
    },
    artifact_progress: { fragments: 1, complete: false, total: 3 },
  };
  const markers = normalizeVisibleSpecials([
    { id: 'spark-1', kind: 'spark', cell_index: 5, local_index: 5, state: 'unseen' },
    { id: 'spark-2', kind: 'spark', cell_index: 9, local_index: 9, state: 'unseen' },
    { id: 'spark-3', kind: 'spark', cell_index: 12, local_index: 12, state: 'unseen' },
    { id: 'bomb-1', kind: 'bomb', cell_index: 7, local_index: 7, state: 'unseen' },
    { id: 'bomb-2', kind: 'bomb', cell_index: 20, local_index: 20, state: 'unseen' },
  ]);
  const snapshot = buildSpecialCellsDiagnosticsSnapshot({
    template,
    progress,
    userId: 'user-1',
    visibleSpecials: [
      { tile_x: 0, tile_y: 0, specials: markers },
    ],
    offer: { kind: 'spark', special_id: 'sc_offer', offer_token: 'abcdef1234567890', target_options: [{ option_id: 'a' }] },
    discovered: { special_id: 'sc_discovered', kind: 'hazard', missed: false },
    target: {
      tile_x: 0,
      tile_y: 0,
      anchor_x: 4,
      anchor_y: 4,
      bounds: { min_x: 0, min_y: 0, max_x: 7, max_y: 0 },
      estimated_cells: 12,
      color: 1,
    },
    plan: { reason: 'INITIAL_TARGET', specialId: 'sc_offer', specialPity: true },
    recentTargets: ['0:0', '1:0', '0:1'],
    lastError: { message: 'Offer stale', code: 'SPECIAL_OFFER_STALE', status: 409 },
    now: '2026-08-11T12:00:00.000Z',
  });

  assert.equal(snapshot.generatedAt, '2026-08-11T12:00:00.000Z');
  assert.equal(snapshot.cohort, 'treatment');
  assert.equal(snapshot.override, true);
  assert.equal(snapshot.override_unknown, false);
  assert.equal(snapshot.placement.generation_version, 4);
  assert.deepEqual(snapshot.by_type.server, progress.special_diagnostics.counts_by_kind);
  assert.equal(snapshot.by_type.visible.spark, 3);
  assert.equal(snapshot.by_type.visible.bomb, 2);
  assert.equal(snapshot.by_type.server_missing, false);
  assert.equal(snapshot.metadata.loaded, 5);
  assert.equal(snapshot.metadata.visible, 5);
  assert.equal(snapshot.metadata.server_candidates, 4);
  assert.equal(snapshot.metadata.server_candidates_unknown, false);
  assert.equal(snapshot.current_target.specialPity, true);
  assert.equal(snapshot.current_target_specials.count, 2);
  assert.deepEqual(snapshot.current_target_specials.by_type, {
    spark: 1,
    bomb: 1,
    fuse: 0,
    choice: 0,
    artifact: 0,
    hazard: 0,
    unknown: 0,
  });
  assert.equal(snapshot.active_offer.hasToken, true);
  assert.equal(snapshot.active_offer.tokenPrefix, undefined);
  assert.ok(!JSON.stringify(snapshot).includes('abcdef12'), 'snapshot dump must not contain token material');
  assert.ok(!JSON.stringify(snapshot).includes('spark-1'), 'dump must not contain special ids');
  assert.ok(!JSON.stringify(snapshot).includes('bomb-2'), 'dump must not contain special ids');
  assert.ok(!JSON.stringify(snapshot).includes('local_index'), 'dump must not contain local indices');
  assert.ok(!JSON.stringify(snapshot).includes('cell_index'), 'dump must not contain cell indices');
  assert.ok(!JSON.stringify(snapshot).includes('"tile"'), 'dump must not contain tile coordinates');
  assert.ok(!JSON.stringify(snapshot).includes('target_options'), 'dump must not contain option payloads');
  assert.ok(!JSON.stringify(snapshot).includes('chain_cells'), 'dump must not contain chain cells');
  assert.ok(!JSON.stringify(snapshot).includes('anchor_x'), 'dump must not contain anchor coordinates');
  assert.ok(!JSON.stringify(snapshot).includes('workCells'), 'dump must not contain work-cell lists');
  assert.ok(!JSON.stringify(snapshot).includes('"id": "spark-1"'), 'dump must not contain marker identities');
  assert.ok(!JSON.stringify(snapshot).includes('"state": "unseen"'), 'dump must not expose per-marker status lists');
  assert.equal(snapshot.discovered.kind, 'hazard');
  assert.equal(snapshot.recent_targets, 3);
  assert.equal(snapshot.completed.percent, 50);
  assert.equal(snapshot.pity.cells_to_next, 3952);
  assert.equal(snapshot.last_error.code, 'SPECIAL_OFFER_STALE');
  assert.equal(snapshot.artifact_progress.fragments, 1);
  assert.deepEqual(snapshot.telegram, { available: false });
  assert.equal(snapshot.override, true);

  const dump = formatSpecialCellsDiagnostics(snapshot);
  assert.ok(dump.includes('SPECIAL_OFFER_STALE'));
  assert.ok(dump.includes('"by_type"'));
  assert.ok(dump.includes('"server"'));
  assert.ok(JSON.parse(dump).templateId === 'template-1');
  assert.equal(JSON.parse(dump).current_target_specials.count, 2);
});

test('override is unknown when the server does not report it', () => {
  const progress = {
    template_id: 'template-infer',
    specials_experiment_group: 'treatment',
    special_diagnostics: { counts_by_status: {} },
  };
  const snapshot = buildSpecialCellsDiagnosticsSnapshot({
    template: { id: 'template-infer', width: 10, height: 10 },
    progress,
    userId: 'user-infer',
    now: '2026-08-11T00:00:00.000Z',
  });
  assert.equal(snapshot.override, null);
  assert.equal(snapshot.override_unknown, true);
  assert.equal(snapshot.by_type.server_missing, true);
  assert.equal(snapshot.by_type.server, null);
  assert.equal(snapshot.metadata.server_candidates, null);
  assert.equal(snapshot.metadata.server_candidates_unknown, true);
  assert.deepEqual(snapshot.current_target_specials, {
    count: 0,
    by_type: {
      spark: 0,
      bomb: 0,
      fuse: 0,
      choice: 0,
      artifact: 0,
      hazard: 0,
      unknown: 0,
    },
  });
});

test('stale target is cleared when the Smart plan is inactive', () => {
  const snapshot = buildSpecialCellsDiagnosticsSnapshot({
    template: { id: 'template-stale', width: 10, height: 10 },
    progress: {
      template_id: 'template-stale',
      specials_experiment_group: 'treatment',
      special_diagnostics: { counts_by_status: {} },
    },
    target: {
      tile_x: 0,
      tile_y: 0,
      anchor_x: 4,
      anchor_y: 4,
      bounds: { min_x: 0, min_y: 0, max_x: 7, max_y: 7 },
      estimated_cells: 12,
    },
    plan: null,
    now: '2026-08-11T00:00:00.000Z',
  });
  assert.equal(snapshot.current_target, null);
  assert.deepEqual(snapshot.current_target_specials, {
    count: 0,
    by_type: {
      spark: 0,
      bomb: 0,
      fuse: 0,
      choice: 0,
      artifact: 0,
      hazard: 0,
      unknown: 0,
    },
  });
});

test('target is cleared when free exploration deactivates the plan even if a plan object remains', () => {
  const snapshot = buildSpecialCellsDiagnosticsSnapshot({
    template: { id: 'template-free', width: 10, height: 10 },
    progress: {
      template_id: 'template-free',
      specials_experiment_group: 'treatment',
      special_diagnostics: { counts_by_status: {} },
    },
    visibleSpecials: [
      { id: 'spark-free', kind: 'spark', cell_index: 4, state: 'unseen' },
    ],
    target: {
      tile_x: 0,
      tile_y: 0,
      anchor_x: 4,
      anchor_y: 0,
      bounds: { min_x: 0, min_y: 0, max_x: 7, max_y: 0 },
      estimated_cells: 2,
    },
    plan: { reason: 'INITIAL_TARGET' },
    targetActive: false,
    now: '2026-08-11T00:00:00.000Z',
  });
  assert.equal(snapshot.current_target, null);
  assert.deepEqual(snapshot.current_target_specials, {
    count: 0,
    by_type: {
      spark: 0,
      bomb: 0,
      fuse: 0,
      choice: 0,
      artifact: 0,
      hazard: 0,
      unknown: 0,
    },
  });
});

test('snapshot never exposes active special identity or per-marker ids', () => {
  const snapshot = buildSpecialCellsDiagnosticsSnapshot({
    template: { id: 'template-no-ids', width: 10, height: 10 },
    progress: {
      template_id: 'template-no-ids',
      specials_experiment_group: 'treatment',
      special_diagnostics: {
        active_special_id: 'sc_secret_active',
        counts_by_status: {},
      },
    },
    visibleSpecials: [
      { id: 'sc_secret_visible', kind: 'spark', cell_index: 4, state: 'unseen' },
    ],
    offer: { kind: 'spark', special_id: 'sc_secret_offer', offer_token: 'token-secret' },
    now: '2026-08-11T00:00:00.000Z',
  });
  const dump = formatSpecialCellsDiagnostics(snapshot);
  assert.equal(snapshot.active_special.present, true);
  assert.ok(!dump.includes('sc_secret_active'));
  assert.ok(!dump.includes('sc_secret_visible'));
  assert.ok(!dump.includes('sc_secret_offer'));
  assert.ok(!dump.includes('active_special_id'));
});

test('last error recorder is inert and retains nothing while diagnostics are disabled', () => {
  setSpecialCellsDiagnosticsEnabled(false);
  clearSpecialCellsLastError();
  assert.equal(recordSpecialCellsError({ message: 'disabled', code: 'SPECIAL_OFFER_STALE' }), null);
  assert.equal(getSpecialCellsLastError(), null);
  setSpecialCellsDiagnosticsEnabled(true);
  recordSpecialCellsError({ message: 'enabled', code: 'SPECIAL_OFFER_STALE' });
  assert.equal(getSpecialCellsLastError().message, 'enabled');
  setSpecialCellsDiagnosticsEnabled(false);
  assert.equal(getSpecialCellsLastError(), null);
});

test('last error recorder keeps the latest error for the HUD', () => {
  setSpecialCellsDiagnosticsEnabled(true);
  clearSpecialCellsLastError();
  assert.equal(getSpecialCellsLastError(), null);
  recordSpecialCellsError({ message: 'First', code: 'SPECIAL_CLAIM_INVALID', status: 409 });
  recordSpecialCellsError(new Error('Second'));
  const latest = getSpecialCellsLastError();
  assert.equal(latest.message, 'Second');
  assert.equal(latest.status, null);
  assert.ok(latest.at);
  clearSpecialCellsLastError();
  assert.equal(getSpecialCellsLastError(), null);
  setSpecialCellsDiagnosticsEnabled(false);
});

test('telegram capability reports swipe/fullscreen state as observable', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const element = {
    attributes: new Set(),
    hasAttribute(name) {
      return this.attributes.has(name);
    },
  };
  const webAppStub = {
    initData: 'init-data',
    version: '8.0',
    platform: 'android',
    colorScheme: 'dark',
    isVerticalSwipesEnabled: false,
    isFullscreen: true,
    isExpanded: true,
    viewportStableHeight: 640,
    HapticFeedback: {},
    BackButton: {},
    openTelegramLink() {},
    requestFullscreen() {},
    exitFullscreen() {},
    isVersionAtLeast() { return true; },
    disableVerticalSwipes() {},
    enableVerticalSwipes() {},
  };
  globalThis.window = {
    Telegram: {
      WebApp: webAppStub,
    },
  };
  globalThis.document = { documentElement: element };
  try {
    const capability = getTelegramCapability();
    assert.equal(capability.available, true);
    assert.equal(capability.verticalSwipe.apiSupported, true);
    assert.equal(capability.verticalSwipe.protectionApplied, true);
    assert.equal(capability.verticalSwipe.fallbackApplied, false);
    assert.equal(capability.verticalSwipe.previousState, false);
    assert.equal(capability.verticalSwipe.currentState, false);
    assert.equal(capability.fullscreen.current, true);
    assert.equal(capability.fullscreen.requestSupported, true);
    assert.equal(capability.fullscreen.exitSupported, true);
    assert.equal(capability.fullscreen.expanded, true);
    assert.equal(capability.fullscreen.viewportStableHeight, 640);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
