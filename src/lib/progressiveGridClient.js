import {
  createGridDescriptor,
  getTileBounds,
  mapPointerToCell,
  selectViewportTiles,
} from '../features/coloring/large-grid/gridMath.js';
import {
  LruTileCache,
  TileCellStore,
  normalizeTilePayload,
} from '../features/coloring/large-grid/tileCache.js';
import { normalizeGuidancePayload } from '../features/coloring/large-grid/smartRoute.js';

export const PROGRESSIVE_GRID_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING_MANIFEST: 'loading-manifest',
  LOADING_TILES: 'loading-tiles',
  READY: 'ready',
  OFFLINE: 'offline',
  ERROR: 'error',
  DESTROYED: 'destroyed',
});

export class ProgressiveGridClientError extends Error {
  constructor(message, {
    kind = 'client',
    status = 0,
    code = kind.toUpperCase(),
    data = null,
    cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProgressiveGridClientError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.data = data;
    this.cause = cause;
  }
}

function createAbortError(message = 'Progressive grid request was aborted') {
  const error = new ProgressiveGridClientError(message, {
    kind: 'aborted',
    code: 'ABORTED',
  });
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.kind === 'aborted' || error?.code === 'ABORT_ERR';
}

export function isOfflineError(error) {
  if (error?.kind === 'offline') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return error?.name === 'TypeError' || error?.code === 'ERR_NETWORK' || error?.code === 'ENOTFOUND';
}

function asClientError(error, context = 'request') {
  if (error instanceof ProgressiveGridClientError) return error;
  if (isAbortError(error)) return createAbortError(`${context} was aborted`);
  return new ProgressiveGridClientError(
    isOfflineError(error) ? 'Network is unavailable' : `${context} failed`,
    {
      kind: isOfflineError(error) ? 'offline' : 'network',
      code: isOfflineError(error) ? 'OFFLINE' : 'NETWORK_ERROR',
      cause: error,
    },
  );
}

function joinApiUrl(baseUrl, path) {
  const value = String(path || '');
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = value.replace(/^\/+/, '');
  return base ? `${base}/${suffix}` : (value || '/');
}

function resolveHeaders(headers) {
  const value = typeof headers === 'function' ? headers() : headers;
  return { Accept: 'application/json', ...(value || {}) };
}

async function readResponseJson(response, context) {
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw new ProgressiveGridClientError(`${context} returned invalid JSON`, {
      kind: 'invalid-response',
      code: 'INVALID_JSON',
      cause: error,
    });
  }
  return data;
}

async function requestJson(url, {
  fetchImpl = globalThis.fetch,
  headers,
  signal,
  requestInit = {},
  context = 'Grid request',
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ProgressiveGridClientError('fetch is not available', {
      kind: 'configuration',
      code: 'FETCH_UNAVAILABLE',
    });
  }
  let response;
  try {
    response = await fetchImpl(url, {
      ...requestInit,
      method: requestInit.method || 'GET',
      headers: { ...resolveHeaders(headers), ...(requestInit.headers || {}) },
      signal,
    });
  } catch (error) {
    throw asClientError(error, context);
  }
  if (!response || response.ok === false) {
    let data = null;
    try {
      data = typeof response?.json === 'function' ? await response.json() : null;
    } catch {
      data = null;
    }
    const status = Number(response?.status || 0);
    throw new ProgressiveGridClientError(
      data?.error || `${context} returned HTTP ${status || 'error'}`,
      { kind: 'http', status, code: data?.code || `HTTP_${status || 0}`, data },
    );
  }
  return readResponseJson(response, context);
}

function rejectIfAborted(signal) {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return null;
}

function createSharedRequest(start, { onSettled, onEmpty } = {}) {
  const controller = new AbortController();
  const pending = {
    controller,
    consumers: 0,
    settled: false,
    onEmpty,
    promise: null,
  };
  pending.promise = Promise.resolve()
    .then(() => start(controller.signal))
    .then(
      (value) => {
        pending.settled = true;
        onSettled?.(pending);
        return value;
      },
      (error) => {
        pending.settled = true;
        onSettled?.(pending);
        throw error;
      },
    );
  // A request can be aborted after every consumer leaves. Keep the shared
  // promise observed even when no caller remains to await its rejection.
  pending.promise.catch(() => {});
  return pending;
}

function consumeSharedRequest(pending, signal) {
  const earlyAbort = rejectIfAborted(signal);
  if (earlyAbort) return earlyAbort;
  pending.consumers += 1;
  let released = false;
  let abortHandler = null;
  const release = (abortIfEmpty = false) => {
    if (released) return;
    released = true;
    pending.consumers -= 1;
    if (abortIfEmpty && pending.consumers === 0 && !pending.settled) {
      pending.controller.abort();
      pending.onEmpty?.(pending);
    }
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
  };
  return new Promise((resolve, reject) => {
    const finish = (handler, value) => {
      if (released) return;
      release(false);
      handler(value);
    };
    pending.promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (signal) {
      abortHandler = () => {
        if (released) return;
        release(true);
        reject(createAbortError());
      };
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) abortHandler();
    }
  });
}

function assertManifestShape(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProgressiveGridClientError('Manifest must be an object', {
      kind: 'invalid-manifest',
      code: 'INVALID_MANIFEST',
    });
  }
  if ('cells' in raw || 'filled' in raw || 'cells_json' in raw || 'filled_json' in raw) {
    throw new ProgressiveGridClientError('Manifest must not contain full cell arrays', {
      kind: 'invalid-manifest',
      code: 'FULL_GRID_IN_MANIFEST',
    });
  }
  if ('cells' in (raw.template || {}) || 'filled' in (raw.template || {})) {
    throw new ProgressiveGridClientError('Manifest template metadata must not contain cell arrays', {
      kind: 'invalid-manifest',
      code: 'FULL_GRID_IN_MANIFEST',
    });
  }
}

export function normalizeGridManifest(raw) {
  assertManifestShape(raw);
  const templateSource = raw.template || {};
  const grid = createGridDescriptor({
    grid: raw.grid || templateSource,
    template: templateSource,
  });
  const templateId = String(raw.template_id || templateSource.id || '');
  if (!templateId) {
    throw new ProgressiveGridClientError('Manifest is missing template_id', {
      kind: 'invalid-manifest',
      code: 'MISSING_TEMPLATE_ID',
    });
  }
  const palette = Array.isArray(templateSource.palette) ? [...templateSource.palette] : [];
  const links = raw.links || {};
  return {
    schemaVersion: raw.schema_version ?? null,
    schema_version: raw.schema_version ?? null,
    templateId,
    template_id: templateId,
    contentRevision: raw.content_revision ?? null,
    content_revision: raw.content_revision ?? null,
    template: {
      id: String(templateSource.id || templateId),
      title: String(templateSource.title || ''),
      description: String(templateSource.description || ''),
      category: templateSource.category ?? null,
      difficulty: templateSource.difficulty ?? null,
      theme: templateSource.theme ?? null,
      mood: templateSource.mood ?? null,
      collection_id: templateSource.collection_id ?? null,
      preview_url: templateSource.preview_url ?? null,
      palette,
      width: grid.width,
      height: grid.height,
    },
    grid,
    progress: raw.progress ? { ...raw.progress } : null,
    links: {
      tile: links.tile || `/colorings/${encodeURIComponent(templateId)}/tiles/{tile_x}/{tile_y}`,
      chunk: links.chunk || null,
      guidance: links.guidance || `/colorings/${encodeURIComponent(templateId)}/guidance`,
      manifest: links.manifest || null,
      progress: links.progress || null,
      progress_actions: links.progress_actions || null,
    },
    writeContract: raw.write_contract ? { ...raw.write_contract } : null,
  };
}

export async function loadGridManifest({
  url,
  templateId,
  baseUrl = '',
  manifestPath,
  fetchImpl = globalThis.fetch,
  headers,
  signal,
  requestInit,
} = {}) {
  const earlyAbort = rejectIfAborted(signal);
  if (earlyAbort) return earlyAbort;
  const id = String(templateId || '');
  if (!url && !id && !manifestPath) {
    throw new ProgressiveGridClientError('Manifest URL or templateId is required', {
      kind: 'configuration',
      code: 'MISSING_MANIFEST_URL',
    });
  }
  const path = manifestPath || `/colorings/${encodeURIComponent(id)}/manifest`;
  const endpoint = joinApiUrl(baseUrl, url || path);
  const raw = await requestJson(endpoint, {
    fetchImpl,
    headers,
    signal,
    requestInit,
    context: 'Manifest request',
  });
  try {
    return normalizeGridManifest(raw);
  } catch (error) {
    if (error instanceof ProgressiveGridClientError) throw error;
    throw new ProgressiveGridClientError('Manifest shape is invalid', {
      kind: 'invalid-manifest',
      code: 'INVALID_MANIFEST',
      cause: error,
    });
  }
}

function buildGuidanceQuery({
  selectedColor,
  targetColor,
  reason,
  cameraCenter,
  recent,
  tileX,
  tileY,
} = {}) {
  const params = new URLSearchParams();
  if (selectedColor != null && Number.isInteger(selectedColor)) params.set('selected_color', String(selectedColor));
  if (targetColor != null && Number.isInteger(targetColor)) params.set('target_color', String(targetColor));
  if (reason) params.set('reason', String(reason));
  if (cameraCenter && Number.isFinite(cameraCenter.x) && Number.isFinite(cameraCenter.y)) {
    params.set('camera_x', cameraCenter.x.toFixed(3));
    params.set('camera_y', cameraCenter.y.toFixed(3));
  }
  if (Array.isArray(recent) && recent.length) params.set('recent', recent.slice(0, 8).join(','));
  if (tileX != null && tileY != null) {
    params.set('tile_x', String(tileX));
    params.set('tile_y', String(tileY));
  }
  return params.toString();
}

export async function loadGuidance({
  url,
  templateId,
  baseUrl = '',
  fetchImpl = globalThis.fetch,
  headers,
  signal,
  requestInit,
  ...params
} = {}) {
  const earlyAbort = rejectIfAborted(signal);
  if (earlyAbort) return earlyAbort;
  const id = String(templateId || '');
  if (!url && !id) {
    throw new ProgressiveGridClientError('Guidance URL or templateId is required', {
      kind: 'configuration',
      code: 'MISSING_GUIDANCE_URL',
    });
  }
  const path = url || `/colorings/${encodeURIComponent(id)}/guidance`;
  const query = buildGuidanceQuery(params);
  const endpoint = joinApiUrl(baseUrl, query ? `${path}?${query}` : path);
  const raw = await requestJson(endpoint, {
    fetchImpl,
    headers,
    signal,
    requestInit,
    context: 'Guidance request',
  });
  try {
    return normalizeGuidancePayload(raw, { templateId: id || undefined });
  } catch (error) {
    if (error instanceof ProgressiveGridClientError) throw error;
    throw new ProgressiveGridClientError('Guidance shape is invalid', {
      kind: 'invalid-guidance',
      code: 'INVALID_GUIDANCE',
      cause: error,
    });
  }
}

export function createProgressiveGridClient({
  templateId,
  manifestUrl,
  manifestPath,
  baseUrl = '/api',
  fetchImpl = globalThis.fetch,
  headers,
  requestInit,
  maxTiles = 24,
  cache,
} = {}) {
  const tileCache = cache || new LruTileCache({ maxTiles });
  const listeners = new Set();
  const tileRequests = new Map();
  let manifestRequest = null;
  let manifest = null;
  let store = null;
  let destroyed = false;
  let lastError = null;
  const tileErrors = new Map();
  let status = PROGRESSIVE_GRID_STATUS.IDLE;

  function snapshot() {
    return {
      status,
      manifest,
      lastError,
      cache: tileCache.stats(),
      pendingTiles: [...tileRequests.keys()],
      tileErrors: Object.fromEntries(tileErrors),
    };
  }

  function notify() {
    const value = snapshot();
    for (const listener of listeners) {
      try {
        listener(value);
      } catch {
        // A UI observer must not break the data loader.
      }
    }
  }

  function setStatus(nextStatus, error = null) {
    status = nextStatus;
    lastError = error;
    notify();
  }

  function ensureActive() {
    if (destroyed) {
      throw new ProgressiveGridClientError('Progressive grid client is destroyed', {
        kind: 'lifecycle',
        code: 'CLIENT_DESTROYED',
      });
    }
  }

  function ensureManifest() {
    ensureActive();
    if (!manifest || !store) {
      throw new ProgressiveGridClientError('Load the grid manifest before requesting tiles', {
        kind: 'lifecycle',
        code: 'MANIFEST_NOT_LOADED',
      });
    }
    return manifest;
  }

  function manifestTileUrl(tileX, tileY) {
    const source = manifest.links.tile;
    const path = source
      .replaceAll('{tile_x}', encodeURIComponent(String(tileX)))
      .replaceAll('{tile_y}', encodeURIComponent(String(tileY)))
      .replaceAll('{tileX}', encodeURIComponent(String(tileX)))
      .replaceAll('{tileY}', encodeURIComponent(String(tileY)));
    return joinApiUrl(baseUrl, path);
  }

  async function loadManifest({ signal } = {}) {
    ensureActive();
    if (manifest) return manifest;
    const earlyAbort = rejectIfAborted(signal);
    if (earlyAbort) return earlyAbort;
    if (manifestRequest && !manifestRequest.controller.signal.aborted) {
      return consumeSharedRequest(manifestRequest, signal);
    }
    setStatus(PROGRESSIVE_GRID_STATUS.LOADING_MANIFEST);
    const pending = createSharedRequest(
      (requestSignal) => loadGridManifest({
        url: manifestUrl,
        templateId,
        baseUrl,
        manifestPath,
        fetchImpl,
        headers,
        signal: requestSignal,
        requestInit,
      }),
      {
        onSettled: (current) => {
          if (manifestRequest === current) manifestRequest = null;
        },
        onEmpty: (current) => {
          if (manifestRequest === current) manifestRequest = null;
        },
      },
    );
    manifestRequest = pending;
    pending.promise.then(
      (loadedManifest) => {
        if (destroyed) return;
        manifest = loadedManifest;
        tileCache.setPinnedKeys([]);
        store = new TileCellStore({ grid: manifest.grid, cache: tileCache });
        setStatus(PROGRESSIVE_GRID_STATUS.READY);
      },
      (error) => {
        if (destroyed || isAbortError(error)) return;
        const clientError = asClientError(error, 'Manifest request');
        setStatus(
          clientError.kind === 'offline' ? PROGRESSIVE_GRID_STATUS.OFFLINE : PROGRESSIVE_GRID_STATUS.ERROR,
          clientError,
        );
      },
    );
    return consumeSharedRequest(pending, signal);
  }

  async function fetchGuidance({
    selectedColor,
    targetColor,
    reason,
    cameraCenter,
    recent,
    tileX,
    tileY,
    signal,
  } = {}) {
    ensureManifest();
    return loadGuidance({
      url: manifest.links.guidance,
      templateId: manifest.templateId,
      baseUrl,
      fetchImpl,
      headers,
      signal,
      requestInit,
      selectedColor,
      targetColor,
      reason,
      cameraCenter,
      recent,
      tileX,
      tileY,
    });
  }

  async function loadTile(bounds, signal) {
    const raw = await requestJson(manifestTileUrl(bounds.tileX, bounds.tileY), {
      fetchImpl,
      headers,
      signal,
      requestInit,
      context: `Tile ${bounds.key} request`,
    });
    return normalizeTilePayload(raw, { grid: manifest.grid, templateId: manifest.templateId });
  }

  function fetchTile(tileX, tileY, { signal } = {}) {
    const activeManifest = ensureManifest();
    const bounds = getTileBounds(activeManifest.grid, tileX, tileY);
    const cached = tileCache.get(bounds.key);
    if (cached) return Promise.resolve(cached);
    const earlyAbort = rejectIfAborted(signal);
    if (earlyAbort) return earlyAbort;
    const existing = tileRequests.get(bounds.key);
    if (existing && !existing.controller.signal.aborted) {
      return consumeSharedRequest(existing, signal);
    }

    if (status === PROGRESSIVE_GRID_STATUS.READY) setStatus(PROGRESSIVE_GRID_STATUS.LOADING_TILES);
    const pending = createSharedRequest(
      (requestSignal) => loadTile(bounds, requestSignal),
      {
        onSettled: (current) => {
          if (tileRequests.get(bounds.key) === current) tileRequests.delete(bounds.key);
        },
        onEmpty: (current) => {
          if (tileRequests.get(bounds.key) === current) tileRequests.delete(bounds.key);
        },
      },
    );
    tileRequests.set(bounds.key, pending);
    pending.promise.then(
      (tile) => {
        if (destroyed) return;
        tileCache.set(tile.key, tile);
        tileErrors.delete(tile.key);
        if (status === PROGRESSIVE_GRID_STATUS.LOADING_TILES) setStatus(PROGRESSIVE_GRID_STATUS.READY);
        else notify();
      },
      (error) => {
        if (destroyed || isAbortError(error)) return;
        const clientError = asClientError(error, `Tile ${bounds.key} request`);
        tileErrors.set(bounds.key, clientError);
        setStatus(
          clientError.kind === 'offline' ? PROGRESSIVE_GRID_STATUS.OFFLINE : PROGRESSIVE_GRID_STATUS.ERROR,
          clientError,
        );
      },
    );
    return consumeSharedRequest(pending, signal);
  }

  async function loadGroup(tiles, signal) {
    return Promise.all(tiles.map(async (tile) => {
      try {
        return { tile, value: await fetchTile(tile.tileX, tile.tileY, { signal }) };
      } catch (error) {
        if (isAbortError(error)) throw error;
        return { tile, error: asClientError(error, `Tile ${tile.key} request`) };
      }
    }));
  }

  /**
   * Bound the number of "visible" tiles actually fetched. At overview zoom a
   * 1200x1200 grid makes the whole map "visible" (1444 tiles); fetching and
   * pinning all of them violates the bounded-cache contract and floods the
   * server on every camera reset. Keep the tiles nearest the viewport center.
   */
  function pickCenterTiles(tiles, camera, viewportWidth, viewportHeight, cellSize, cap) {
    if (tiles.length <= cap) return tiles;
    const zoom = Math.max(0.0001, Number(camera?.zoom) || 1);
    const size = Math.max(1, Number(cellSize) || 32);
    const centerX = (Number(viewportWidth) / 2 - Number(camera?.x || 0)) / zoom / size;
    const centerY = (Number(viewportHeight) / 2 - Number(camera?.y || 0)) / zoom / size;
    return [...tiles]
      .map((tile) => ({
        tile,
        distance: Math.hypot(
          tile.offsetX + tile.width / 2 - centerX,
          tile.offsetY + tile.height / 2 - centerY,
        ),
      }))
      .sort((first, second) => first.distance - second.distance)
      .slice(0, cap)
      .map((entry) => entry.tile);
  }

  async function loadViewport({
    camera,
    viewportWidth,
    viewportHeight,
    cellSize,
    overscanCells = 0,
    overscanTiles = 1,
    maxPrefetchTiles = tileCache.maxTiles,
    maxVisibleTiles = tileCache.maxTiles,
    signal,
  } = {}) {
    const activeManifest = await loadManifest({ signal });
    const plan = selectViewportTiles({
      grid: activeManifest.grid,
      camera,
      viewportWidth,
      viewportHeight,
      cellSize,
      overscanCells,
      overscanTiles,
    });
    // Bounded visible set: never fetch/pin more than the cache can hold, even
    // when the whole grid is inside the viewport at overview zoom.
    const visible = pickCenterTiles(
      plan.visible,
      camera,
      viewportWidth,
      viewportHeight,
      cellSize,
      Math.max(1, Math.floor(Number(maxVisibleTiles) || tileCache.maxTiles)),
    );
    tileCache.setPinnedKeys(visible.map((tile) => tile.key));
    const prefetch = plan.prefetch.slice(0, Math.max(0, Math.floor(Number(maxPrefetchTiles) || 0)));
    const [visibleResults, prefetchResults] = await Promise.all([
      loadGroup(visible, signal),
      loadGroup(prefetch, signal),
    ]);
    const loadedVisible = visibleResults.filter((result) => result.value).map((result) => result.value);
    const loadedPrefetched = prefetchResults.filter((result) => result.value).map((result) => result.value);
    const errors = [...visibleResults, ...prefetchResults]
      .filter((result) => result.error)
      .map((result) => ({ tile: result.tile, error: result.error }));
    if (errors.length) {
      const firstError = errors[0].error;
      setStatus(
        firstError.kind === 'offline' ? PROGRESSIVE_GRID_STATUS.OFFLINE : PROGRESSIVE_GRID_STATUS.ERROR,
        firstError,
      );
    } else if (!destroyed) {
      setStatus(PROGRESSIVE_GRID_STATUS.READY);
    }
    return {
      plan: { ...plan, visible, prefetch },
      visible: loadedVisible,
      prefetched: loadedPrefetched,
      errors,
      cache: tileCache.stats(),
    };
  }

  function getCell(x, y) {
    if (!store) return null;
    return store.getCell(x, y);
  }

  function updateFilled(x, y, value) {
    if (!store) return false;
    return store.updateFilled(x, y, value);
  }

  function mapPointer(args = {}) {
    if (!manifest) return null;
    return mapPointerToCell({ ...args, grid: manifest.grid });
  }

  function getTilePlan(args = {}) {
    const activeManifest = ensureManifest();
    return selectViewportTiles({ ...args, grid: activeManifest.grid });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    manifestRequest?.controller.abort();
    for (const pending of tileRequests.values()) pending.controller.abort();
    tileRequests.clear();
    manifestRequest = null;
    tileCache.clear();
    listeners.clear();
    status = PROGRESSIVE_GRID_STATUS.DESTROYED;
    manifest = null;
    store = null;
  }

  return {
    loadManifest,
    fetchGuidance,
    fetchTile,
    loadViewport,
    getTilePlan,
    getCell,
    updateFilled,
    mapPointer,
    getMemoryStats: () => tileCache.stats(),
    getSnapshot: snapshot,
    subscribe,
    destroy,
    cache: tileCache,
  };
}
