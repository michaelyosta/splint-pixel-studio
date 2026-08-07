import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Hand, LoaderCircle, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { rasterizeStroke } from '../engine/strokeRasterizer.js';
import { createProgressiveGridClient, PROGRESSIVE_GRID_STATUS } from '../../../lib/progressiveGridClient.js';
import { DEV_USER_ID } from '../../../api/client.js';
import { createBoundedAnnouncer, formatPaletteState, moveKeyboardCursor } from '../../../lib/accessibility.js';
import { selectViewportTiles } from './gridMath.js';
import { TileGuideIndex, pickColorWithMostRemaining, pickNextZoneWithCells } from './guide.js';
import { LruTileCache } from './tileCache.js';

const CELL_SIZE = 32;
// Keep the initial viewport bounded: at 0.08 a phone sees a small tile
// neighbourhood instead of asking the cache to fetch the whole 1200×1200 map.
const MIN_ZOOM = 0.08;
// Zone jumps zoom to a readable working scale even when the whole zone does
// not fit on screen; the minimap keeps the user oriented.
const WORK_ZOOM = 1;
// Minimap backing pixels stay modest; the CSS size is set in App.css.
const MINIMAP_SIZE = 168;
// Below this cell size individual empty-cell fills are indistinguishable from
// the preview, so the canvas renders tile rectangles plus painted overlays
// instead of one draw call per visible cell.
const DETAILED_CELL_PIXELS = 5;
const DIAGNOSTICS_ENABLED = import.meta.env.VITE_SHOW_COLORING_DIAGNOSTICS === 'true';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function zoneCountsEqual(first, second) {
  const firstKeys = Object.keys(first || {});
  const secondKeys = Object.keys(second || {});
  if (firstKeys.length !== secondKeys.length) return false;
  return firstKeys.every((key) => first[key] === second[key]);
}

function firstCellsEqual(first, second) {
  const firstKeys = Object.keys(first || {});
  const secondKeys = Object.keys(second || {});
  if (firstKeys.length !== secondKeys.length) return false;
  return firstKeys.every((key) => {
    const a = first[key];
    const b = second[key];
    return a?.index === b?.index && a?.x === b?.x && a?.y === b?.y;
  });
}

function buildZoneRects(width, height) {
  const maxDimension = Math.max(width, height);
  let rows;
  let columns;
  if (maxDimension >= 900) {
    rows = 4;
    columns = 4;
  } else if (maxDimension >= 400) {
    rows = 3;
    columns = 3;
  } else if (maxDimension >= 200) {
    rows = 2;
    columns = 3;
  } else {
    rows = 3;
    columns = 2;
  }
  const zoneWidth = Math.ceil(width / columns);
  const zoneHeight = Math.ceil(height / rows);
  return Array.from({ length: rows * columns }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: index,
      x: column * zoneWidth,
      y: row * zoneHeight,
      width: Math.min(zoneWidth, width - column * zoneWidth),
      height: Math.min(zoneHeight, height - row * zoneHeight),
    };
  });
}

export default function ProgressiveColoringSession({
  template,
  progress,
  selectedColor,
  onSelectColor,
  onStrokeCommitted,
  onFirstPaint,
  onWrongCell,
  interactionMode = 'classic',
  hideNumbers = false,
  hintMode = false,
}) {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const previewImageRef = useRef(null);
  const clientRef = useRef(null);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 0.3 });
  const pointerRef = useRef(null);
  const panRef = useRef(null);
  const minimapCanvasRef = useRef(null);
  const minimapBaseRef = useRef(null);
  const minimapDragRef = useRef(null);
  const pendingCellRef = useRef(null);
  const touchPointersRef = useRef(new Map());
  const gestureRef = useRef({ active: false, midpoint: null, distance: 0 });
  const initialCameraRef = useRef(false);
  const cameraSaveTimerRef = useRef(null);
  const cameraRestoredRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [camera, setCamera] = useState(cameraRef.current);
  const [status, setStatus] = useState(PROGRESSIVE_GRID_STATUS.IDLE);
  const [error, setError] = useState(null);
  const [manifestReady, setManifestReady] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [inputNotice, setInputNotice] = useState(null);
  const [, redraw] = useState(0);
  const [keyboardCell, setKeyboardCell] = useState(null);
  const [liveText, setLiveText] = useState('');
  const [guide, setGuide] = useState(null);
  const [wrongNotice, setWrongNotice] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);
  const [navigationMode, setNavigationMode] = useState(false);
  const guideRef = useRef(null);
  const wrongNoticeTimerRef = useRef(null);
  const successNoticeTimerRef = useRef(null);
  const keyboardCellRef = useRef(null);
  const diagnosticsRef = useRef(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const instructionsId = useId();
  const liveId = useId();
  const announcerRef = useRef(null);
  const guideIndexRef = useRef(null);
  if (announcerRef.current === null) {
    announcerRef.current = createBoundedAnnouncer({ onAnnounce: setLiveText });
  }
  const minimapZones = useMemo(() => buildZoneRects(template.width, template.height), [template.width, template.height]);

  useEffect(() => {
    const metrics = {
      templateId: template.id,
      startedAt: performance.now(),
      firstTileAt: null,
      frames: 0,
      fps: 0,
      maxFps: 0,
      interactionFrames: 0,
      interactionFps: 0,
      interactionMaxFps: 0,
      interactionEndsAt: 0,
      cacheTiles: 0,
      cacheBytes: 0,
      domNodes: 0,
      zoom: cameraRef.current.zoom,
      heapBytes: typeof performance.memory?.usedJSHeapSize === 'number' ? performance.memory.usedJSHeapSize : null,
      commits: 0,
      lastCommitAt: null,
    };
    diagnosticsRef.current = metrics;
    if (typeof window !== 'undefined') window.__splintTiledMetrics = metrics;
    // The rAF/DOM sampling loop is opt-in: production must not run a
    // perpetual sampler unless explicitly enabled (env flag or URL param).
    const samplingEnabled = DIAGNOSTICS_ENABLED
      || (typeof window !== 'undefined' && /[?&]splintMetrics=1/.test(window.location.search));
    if (!samplingEnabled) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      metrics.frames += 1;
      const elapsed = now - last;
      if (elapsed >= 500) {
        const fps = Math.round((metrics.frames * 1000) / elapsed);
        metrics.frames = 0;
        metrics.fps = fps;
        metrics.maxFps = Math.max(metrics.maxFps, fps);
        if (metrics.interactionFrames > 0) {
          const interactionFps = Math.round((metrics.interactionFrames * 1000) / elapsed);
          metrics.interactionFps = interactionFps;
          metrics.interactionMaxFps = Math.max(metrics.interactionMaxFps, interactionFps);
          metrics.interactionFrames = 0;
        }
        metrics.cacheTiles = clientRef.current?.cache.size || 0;
        const stats = clientRef.current?.getMemoryStats?.();
        metrics.cacheBytes = stats?.bytes || 0;
        metrics.domNodes = document.querySelectorAll('*').length;
        metrics.zoom = cameraRef.current.zoom;
        if (typeof performance.memory?.usedJSHeapSize === 'number') {
          metrics.heapBytes = performance.memory.usedJSHeapSize;
        }
        if (DIAGNOSTICS_ENABLED) setDiagnostics({ ...metrics });
        last = now;
      }
      if (now < metrics.interactionEndsAt) metrics.interactionFrames += 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  useEffect(() => {
    guideIndexRef.current = new TileGuideIndex({
      zones: minimapZones,
      paletteLength: template.palette.length,
      template,
    });
    guideRef.current = null;
    const mini = minimapCanvasRef.current;
    if (mini) {
      mini.width = MINIMAP_SIZE;
      mini.height = MINIMAP_SIZE;
    }
    minimapBaseRef.current = null;
    rebuildMinimapBase();
    drawMinimap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimapZones, template]);

  const updateCamera = useCallback((next) => {
    cameraRef.current = next;
    setCamera(next);
    scheduleCameraSave(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cameraStorageKey() {
    return `splint:tiled-camera:${template.id}`;
  }

  function scheduleCameraSave(cameraValue) {
    if (typeof window === 'undefined' || !template.id) return;
    const viewport = sizeRef.current;
    if (!viewport.width || !viewport.height) return;
    const zoom = Math.max(Number(cameraValue.zoom) || MIN_ZOOM, MIN_ZOOM);
    const centerX = (viewport.width / 2 - cameraValue.x) / zoom / CELL_SIZE;
    const centerY = (viewport.height / 2 - cameraValue.y) / zoom / CELL_SIZE;
    if (cameraSaveTimerRef.current) clearTimeout(cameraSaveTimerRef.current);
    cameraSaveTimerRef.current = setTimeout(() => {
      cameraSaveTimerRef.current = null;
      try {
        window.localStorage.setItem(cameraStorageKey(), JSON.stringify({
          centerX,
          centerY,
          zoom,
          savedAt: Date.now(),
        }));
      } catch {
        // Storage may be unavailable.
      }
    }, 350);
  }

  function markFirstTile() {
    const metrics = diagnosticsRef.current;
    if (!metrics || metrics.firstTileAt != null) return;
    metrics.firstTileAt = performance.now();
    if (DIAGNOSTICS_ENABLED) setDiagnostics({ ...metrics });
  }

  function markInteraction() {
    const metrics = diagnosticsRef.current;
    if (!metrics) return;
    metrics.interactionEndsAt = performance.now() + 600;
  }

  function minimapPointToLocal(clientX, clientY) {
    const mini = minimapCanvasRef.current;
    if (!mini) return null;
    const rect = mini.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (clientX - rect.left) * (mini.width / rect.width),
      y: (clientY - rect.top) * (mini.height / rect.height),
    };
  }

  function minimapPointToWorld(clientX, clientY) {
    const point = minimapPointToLocal(clientX, clientY);
    if (!point) return null;
    return {
      x: point.x / (MINIMAP_SIZE / template.width),
      y: point.y / (MINIMAP_SIZE / template.height),
    };
  }

  function minimapViewportRect() {
    const mini = minimapCanvasRef.current;
    if (!mini) return null;
    const current = cameraRef.current;
    const scaleX = mini.width / template.width;
    const scaleY = mini.height / template.height;
    const worldLeft = -current.x / CELL_SIZE / current.zoom;
    const worldTop = -current.y / CELL_SIZE / current.zoom;
    const worldRight = (size.width - current.x) / CELL_SIZE / current.zoom;
    const worldBottom = (size.height - current.y) / CELL_SIZE / current.zoom;
    const rawX = worldLeft * scaleX;
    const rawY = worldTop * scaleY;
    let width = Math.max(0, (worldRight - worldLeft) * scaleX);
    let height = Math.max(0, (worldBottom - worldTop) * scaleY);
    // At working zoom the real viewport is a tiny fraction of a 1200x1200
    // map. Keep the indicator at least 14px so it can be seen and dragged.
    const MIN_VIEW = 14;
    if (width > 0 && width < MIN_VIEW) width = Math.min(MIN_VIEW, mini.width);
    if (height > 0 && height < MIN_VIEW) height = Math.min(MIN_VIEW, mini.height);
    const x = width >= mini.width ? 0 : clamp(rawX, 0, mini.width - width);
    const y = height >= mini.height ? 0 : clamp(rawY, 0, mini.height - height);
    return { x, y, width, height };
  }

  function rebuildMinimapBase() {
    const mini = minimapCanvasRef.current;
    const client = clientRef.current;
    if (!mini || !client) return;
    let base = minimapBaseRef.current;
    if (!base) {
      base = document.createElement('canvas');
      minimapBaseRef.current = base;
    }
    base.width = mini.width;
    base.height = mini.height;
    const ctx = base.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.fillStyle = '#0b151c';
    ctx.fillRect(0, 0, base.width, base.height);
    const preview = previewImageRef.current;
    if (preview?.naturalWidth) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(preview, 0, 0, base.width, base.height);
      ctx.globalAlpha = 1;
    }
    const scaleX = base.width / template.width;
    const scaleY = base.height / template.height;
    for (const tile of client.cache.values()) {
      for (let localY = 0; localY < tile.height; localY += 1) {
        for (let localX = 0; localX < tile.width; localX += 1) {
          const localIndex = localY * tile.width + localX;
          const color = tile.filled[localIndex];
          if (color === -1) continue;
          ctx.fillStyle = template.palette[color] || '#24465a';
          ctx.fillRect(
            (tile.offsetX + localX) * scaleX,
            (tile.offsetY + localY) * scaleY,
            Math.max(1, scaleX),
            Math.max(1, scaleY),
          );
        }
      }
    }
    ctx.strokeStyle = 'rgba(127, 231, 255, 0.32)';
    ctx.lineWidth = 1;
    for (const zone of minimapZones) {
      const x = zone.x * scaleX;
      const y = zone.y * scaleY;
      const w = zone.width * scaleX;
      const h = zone.height * scaleY;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }

  function drawMinimap() {
    const mini = minimapCanvasRef.current;
    if (!mini) return;
    const ctx = mini.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mini.width, mini.height);
    if (minimapBaseRef.current) ctx.drawImage(minimapBaseRef.current, 0, 0);
    const rect = minimapViewportRect();
    if (!rect) return;
    ctx.fillStyle = 'rgba(43, 217, 254, 0.18)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  function handleMinimapPointerDown(event) {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    event.stopPropagation();
    const rect = minimapViewportRect();
    const point = minimapPointToLocal(event.clientX, event.clientY);
    if (!rect || !point) return;
    if (point.x >= rect.x && point.x <= rect.x + rect.width
      && point.y >= rect.y && point.y <= rect.y + rect.height) {
      minimapDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCamera: { ...cameraRef.current },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const world = minimapPointToWorld(event.clientX, event.clientY);
    if (!world) return;
    const zoom = Math.max(cameraRef.current.zoom, WORK_ZOOM);
    updateCamera({
      x: size.width / 2 - world.x * CELL_SIZE * zoom,
      y: size.height / 2 - world.y * CELL_SIZE * zoom,
      zoom,
    });
  }

  function handleMinimapPointerMove(event) {
    const drag = minimapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    markInteraction();
    const mini = minimapCanvasRef.current;
    if (!mini) return;
    const dxWorld = (event.clientX - drag.startClientX) * (template.width / mini.width);
    const dyWorld = (event.clientY - drag.startClientY) * (template.height / mini.height);
    updateCamera({
      ...drag.startCamera,
      x: drag.startCamera.x - dxWorld * CELL_SIZE * drag.startCamera.zoom,
      y: drag.startCamera.y - dyWorld * CELL_SIZE * drag.startCamera.zoom,
    });
  }

  function handleMinimapPointerEnd(event) {
    if (minimapDragRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    minimapDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useEffect(() => {
    const client = createProgressiveGridClient({
      templateId: template.id,
      // At the minimum mobile zoom the viewport spans roughly 40 tiles.
      // Keep that visible neighbourhood resident so a valid tap is not
      // rejected merely because its tile was evicted before the next frame.
      maxTiles: 48,
      cache: new LruTileCache({
        maxTiles: 48,
        onEvict: (_key, tile) => {
          guideIndexRef.current?.removeTile(tile);
          rebuildMinimapBase();
          drawMinimap();
        },
      }),
      headers: () => {
        const telegramInitData = window.Telegram?.WebApp?.initData?.trim();
        return telegramInitData
          ? { 'X-Telegram-Init-Data': telegramInitData }
          : import.meta.env.VITE_ALLOW_DEV_AUTH === 'true' ? { 'X-User-Id': DEV_USER_ID } : {};
      },
    });
    clientRef.current = client;
    const unsubscribe = client.subscribe((snapshot) => {
      setStatus(snapshot.status);
      setError(snapshot.lastError || null);
      redraw((value) => value + 1);
    });
    client.loadManifest()
      .then(() => setManifestReady(true))
      .catch(() => {});
    return () => {
      unsubscribe();
      client.destroy();
      clientRef.current = null;
      pendingCellRef.current = null;
      if (wrongNoticeTimerRef.current) clearTimeout(wrongNoticeTimerRef.current);
      if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current);
      if (cameraSaveTimerRef.current) {
        clearTimeout(cameraSaveTimerRef.current);
        cameraSaveTimerRef.current = null;
      }
      announcerRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, updateCamera]);

  useEffect(() => {
    initialCameraRef.current = false;
    cameraRestoredRef.current = false;
    setManifestReady(false);
  }, [template.id]);

  useEffect(() => {
    let cancelled = false;
    const manifestPreview = clientRef.current?.getSnapshot().manifest?.template?.preview_url;
    const previewUrl = manifestPreview || template.preview_url;
    previewImageRef.current = null;
    setPreviewReady(false);
    if (!previewUrl) return () => { cancelled = true; };
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (cancelled) return;
      previewImageRef.current = image;
      setPreviewReady(true);
      rebuildMinimapBase();
      drawMinimap();
    };
    image.onerror = () => {
      if (!cancelled) setPreviewReady(false);
    };
    image.src = previewUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestReady, template.id, template.preview_url]);

  useEffect(() => {
    if (!manifestReady || initialCameraRef.current || !size.width || !size.height) return;
    const manifest = clientRef.current?.getSnapshot().manifest;
    if (!manifest) return;
    const saved = (() => {
      if (cameraRestoredRef.current || typeof window === 'undefined') return null;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(cameraStorageKey()) || 'null');
        if (!parsed || !Number.isFinite(parsed.centerX) || !Number.isFinite(parsed.centerY)
          || !Number.isFinite(parsed.zoom)) return null;
        const zoom = clamp(Number(parsed.zoom), MIN_ZOOM, 4);
        if (zoom <= MIN_ZOOM) return null;
        return {
          centerX: Number(parsed.centerX),
          centerY: Number(parsed.centerY),
          zoom,
        };
      } catch {
        return null;
      }
    })();
    if (saved) {
      cameraRestoredRef.current = true;
      initialCameraRef.current = true;
    updateCamera({
      x: size.width / 2 - saved.centerX * CELL_SIZE * saved.zoom,
      y: size.height / 2 - saved.centerY * CELL_SIZE * saved.zoom,
      zoom: saved.zoom,
    });
    return;
    }
    const zoom = Math.min(
      1,
      (size.width * 0.9) / (manifest.grid.width * CELL_SIZE),
      (size.height * 0.66) / (manifest.grid.height * CELL_SIZE),
    );
    initialCameraRef.current = true;
    updateCamera({
      x: (size.width - manifest.grid.width * CELL_SIZE * Math.max(MIN_ZOOM, zoom)) / 2,
      y: (size.height - manifest.grid.height * CELL_SIZE * Math.max(MIN_ZOOM, zoom)) / 2,
      zoom: Math.max(MIN_ZOOM, zoom),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestReady, size.height, size.width, updateCamera]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect?.width && rect?.height) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !manifestReady || !size.width || !size.height) return undefined;
    const controller = new AbortController();
    client.loadViewport({
      camera,
      viewportWidth: size.width,
      viewportHeight: size.height,
      cellSize: CELL_SIZE,
      overscanCells: 1,
      overscanTiles: 1,
      maxPrefetchTiles: 8,
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      markFirstTile();
      for (const tile of [...result.visible, ...result.prefetched]) {
        guideIndexRef.current?.addTile(tile);
      }
      rebuildMinimapBase();
      drawMinimap();
    }).catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, manifestReady, size.width, size.height]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const client = clientRef.current;
    if (!canvas || !client || !size.width || !size.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bitmapWidth = Math.ceil(size.width * dpr);
    const bitmapHeight = Math.ceil(size.height * dpr);
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bitmapWidth, bitmapHeight);
    ctx.fillStyle = '#081218';
    ctx.fillRect(0, 0, bitmapWidth, bitmapHeight);
    ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
    const cellPixels = CELL_SIZE * camera.zoom;
    const detailedCells = cellPixels >= DETAILED_CELL_PIXELS;
    const previewImage = previewImageRef.current;
    if (previewReady && previewImage?.naturalWidth) {
      ctx.save();
      const previewAlpha = detailedCells ? (client.cache.size ? 0.2 : 0.58) : 0.9;
      ctx.globalAlpha = previewAlpha;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(previewImage, 0, 0, template.width * CELL_SIZE, template.height * CELL_SIZE);
      ctx.restore();
    }
    const showNumbers = !hideNumbers && cellPixels >= 12;
    const showGuideOutlines = detailedCells && interactionMode !== 'reveal';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '13px Outfit, sans-serif';
    const manifest = client.getSnapshot().manifest;
    const visiblePlan = manifest ? selectViewportTiles({
      grid: manifest.grid,
      camera,
      viewportWidth: size.width,
      viewportHeight: size.height,
      cellSize: CELL_SIZE,
      overscanCells: 1,
      overscanTiles: 0,
    }) : null;
    const visibleKeys = new Set((visiblePlan?.visible || []).map((tile) => tile.key));
    const cellBounds = visiblePlan?.cellBounds || null;
    const emptyTileStyle = previewReady ? null : '#172735';
    for (const tile of client.cache.values()) {
      if (!visibleKeys.has(tile.key)) continue;
      if (!detailedCells) {
        if (emptyTileStyle) {
          ctx.fillStyle = emptyTileStyle;
          ctx.fillRect(tile.offsetX * CELL_SIZE, tile.offsetY * CELL_SIZE, tile.width * CELL_SIZE, tile.height * CELL_SIZE);
        }
        for (let localY = 0; localY < tile.height; localY += 1) {
          for (let localX = 0; localX < tile.width; localX += 1) {
            const localIndex = localY * tile.width + localX;
            if (tile.filled[localIndex] === -1) continue;
            ctx.fillStyle = template.palette[tile.filled[localIndex]] || '#24465a';
            ctx.fillRect((tile.offsetX + localX) * CELL_SIZE, (tile.offsetY + localY) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }
        }
        continue;
      }
      const startX = cellBounds ? Math.max(0, cellBounds.startX - tile.offsetX) : 0;
      const endX = cellBounds ? Math.min(tile.width - 1, cellBounds.endX - tile.offsetX) : tile.width - 1;
      const startY = cellBounds ? Math.max(0, cellBounds.startY - tile.offsetY) : 0;
      const endY = cellBounds ? Math.min(tile.height - 1, cellBounds.endY - tile.offsetY) : tile.height - 1;
      if (endX < startX || endY < startY) continue;
      for (let localY = startY; localY <= endY; localY += 1) {
        for (let localX = startX; localX <= endX; localX += 1) {
          const localIndex = localY * tile.width + localX;
          const target = tile.cells[localIndex];
          const filled = tile.filled[localIndex];
          const x = (tile.offsetX + localX) * CELL_SIZE;
          const y = (tile.offsetY + localY) * CELL_SIZE;
          const selected = filled === -1 && target === selectedColor;
          const hinted = hintMode && filled === -1 && target === selectedColor;
          const isGuideCell = interactionMode !== 'reveal' && filled === -1 && target === selectedColor;
          ctx.fillStyle = filled === -1
            ? (selected ? '#24465a' : hinted ? '#2f6f5a' : '#172735')
            : (template.palette[filled] || '#24465a');
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          if (isGuideCell && showGuideOutlines) {
            ctx.strokeStyle = 'rgba(127, 231, 255, 0.7)';
            ctx.lineWidth = 2 / Math.max(camera.zoom, 0.1);
            ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          }
          if (cellPixels >= 4) {
            ctx.strokeStyle = '#0b131a';
            ctx.lineWidth = 1 / Math.max(camera.zoom, 0.1);
            ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
          }
          if (filled === -1 && showNumbers && interactionMode !== 'reveal') {
            ctx.fillStyle = selected ? '#ffffff' : hinted ? '#bfffe0' : '#8d9fa5';
            ctx.fillText(String(target + 1), x + CELL_SIZE / 2, y + CELL_SIZE / 2);
          }
        }
      }
    }
    const guideStats = guideIndexRef.current?.snapshot(interactionMode === 'reveal' ? null : selectedColor)
      || { remaining: 0, remainingByZone: {}, firstCellByZone: {} };
    const previousGuide = guideRef.current;
    const guideColor = interactionMode === 'reveal' ? null : selectedColor;
    if (!previousGuide
      || previousGuide.color !== guideColor
      || previousGuide.remaining !== guideStats.remaining
      || !zoneCountsEqual(previousGuide.remainingByZone, guideStats.remainingByZone)
      || !firstCellsEqual(previousGuide.firstCellByZone, guideStats.firstCellByZone)) {
      const nextGuide = { color: guideColor, ...guideStats };
      guideRef.current = nextGuide;
      setGuide(nextGuide);
    }
    if (keyboardCell != null) {
      const cursorX = (keyboardCell % template.width) * CELL_SIZE;
      const cursorY = Math.floor(keyboardCell / template.width) * CELL_SIZE;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.strokeRect(cursorX + 1.5, cursorY + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
      ctx.strokeStyle = '#7fe7ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cursorX + 4.5, cursorY + 4.5, CELL_SIZE - 9, CELL_SIZE - 9);
    }
    drawMinimap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, hideNumbers, hintMode, interactionMode, keyboardCell, previewReady, selectedColor, size.height, size.width, template.height, template.palette, template.width]);

  useLayoutEffect(() => { draw(); }, [draw, status, progress]);

  function mapCell(event) {
    const client = clientRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!client || !rect) return null;
    return client.mapPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      camera,
      cellSize: CELL_SIZE,
    });
  }

  function ensureCellLoaded(cell) {
    const client = clientRef.current;
    if (!client || !cell) return;
    const key = `${cell.tileX}:${cell.tileY}`;
    if (pendingCellRef.current?.key === key) return;
    pendingCellRef.current = { key, cell };
    setInputNotice('Загружаем фрагмент поля…');
    client.fetchTile(cell.tileX, cell.tileY)
      .then(() => {
        if (pendingCellRef.current?.key !== key) return;
        const queuedCell = pendingCellRef.current.cell;
        pendingCellRef.current = null;
        setInputNotice(null);
        redraw((value) => value + 1);
        const loaded = client.getCell(queuedCell.x, queuedCell.y);
        const tile = loaded ? client.cache.get(loaded.tileKey) : null;
        if (tile) guideIndexRef.current?.addTile(tile);
        rebuildMinimapBase();
        drawMinimap();
        commitIndices([queuedCell.index]);
      })
      .catch(() => {
        if (pendingCellRef.current?.key !== key) return;
        pendingCellRef.current = null;
        setInputNotice('Фрагмент пока недоступен. Нажмите ещё раз.');
      });
  }

  function addStrokeCell(cell) {
    const pointer = pointerRef.current;
    if (!pointer || !cell || pointer.lastIndex === cell.index) return;
    const path = rasterizeStroke(pointer.lastIndex, cell.index, template.width, template.height);
    pointer.lastIndex = cell.index;
    for (const index of path) if (!pointer.indices.includes(index)) pointer.indices.push(index);
  }

  function commitIndices(indices, { announce = false } = {}) {
    const client = clientRef.current;
    const changes = [];
    const unloaded = [];
    let wrong = false;
    for (const index of indices) {
      const x = index % template.width;
      const y = Math.floor(index / template.width);
      const cell = client?.getCell(x, y);
      if (!cell) continue;
      if (!cell.loaded) {
        unloaded.push(index);
        continue;
      }
      if (cell.filled !== -1) continue;
      const color = interactionMode === 'reveal' ? cell.target : selectedColor;
      if (interactionMode !== 'reveal' && color !== cell.target) {
        wrong = true;
        continue;
      }
      client.updateFilled(x, y, color);
      const tile = client.cache.get(cell.tileKey);
      if (tile) guideIndexRef.current?.refreshTile(tile);
      changes.push({ index, from: -1, to: color });
    }
    if (changes.length) {
      rebuildMinimapBase();
      drawMinimap();
    }
    if (wrong && !changes.length) {
      const firstIndex = indices[0];
      const wrongCell = firstIndex != null
        ? client?.getCell(firstIndex % template.width, Math.floor(firstIndex / template.width))
        : null;
      const targetColor = wrongCell?.target;
      const message = Number.isInteger(targetColor) && targetColor >= 0
        ? `Эта клетка относится к цвету ${targetColor + 1}`
        : 'Неправильный цвет';
      setWrongNotice(message);
      if (wrongNoticeTimerRef.current) clearTimeout(wrongNoticeTimerRef.current);
      wrongNoticeTimerRef.current = setTimeout(() => setWrongNotice(null), 2200);
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error');
      } catch {
        // Haptics are optional.
      }
      onWrongCell?.();
      announcerRef.current?.announce(Number.isInteger(targetColor) && targetColor >= 0
        ? `Неправильный цвет, этой клетке нужен цвет ${targetColor + 1}`
        : 'Неправильный цвет');
    } else if (!changes.length && unloaded.length) {
      const firstIndex = unloaded[0];
      ensureCellLoaded({
        index: firstIndex,
        x: firstIndex % template.width,
        y: Math.floor(firstIndex / template.width),
        tileX: Math.floor((firstIndex % template.width) / 32),
        tileY: Math.floor(Math.floor(firstIndex / template.width) / 32),
      });
    }
    if (changes.length) {
      onFirstPaint?.();
      const commitMetrics = diagnosticsRef.current;
      if (commitMetrics) {
        commitMetrics.commits += 1;
        commitMetrics.lastCommitAt = performance.now();
      }
      onStrokeCommitted?.(changes.map(({ index, from, to }) => ({ index, from, to })), {
        type: 'stroke',
        timestamp: Date.now(),
        changes,
        color: changes[0].to,
      });
      try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
      } catch {
        // Haptics are optional.
      }
      if (interactionMode !== 'reveal') {
        const remaining = guideIndexRef.current?.snapshot(selectedColor)?.remaining ?? null;
        if (remaining === 0) {
          const nextZone = pickNextZoneWithCells(minimapZones, activeZone ?? 0, guideRef.current?.remainingByZone || {});
          const nextColor = pickColorWithMostRemaining(clientRef.current?.cache.values() || [], template.palette.length);
          setSuccessNotice(
            nextZone
              ? `Цвет ${selectedColor + 1} готов · дальше зона ${nextZone.id + 1}`
              : nextColor != null && nextColor !== selectedColor
                ? `Цвет ${selectedColor + 1} готов · дальше цвет ${nextColor + 1}`
                : `Цвет ${selectedColor + 1} готов`,
          );
          if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current);
          successNoticeTimerRef.current = setTimeout(() => setSuccessNotice(null), 3400);
          try {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
          } catch {
            // Haptics are optional.
          }
          announcerRef.current?.announce(`Цвет ${selectedColor + 1} в видимой области завершён`);
          // Keep the player moving: jump to the next zone with this colour,
          // or auto-select the next colour with remaining loaded cells.
          if (nextZone) {
            window.setTimeout(() => {
              if (guideRef.current?.color === selectedColor) jumpToZone(nextZone);
            }, 900);
          } else {
            if (nextColor != null && nextColor !== selectedColor) {
              window.setTimeout(() => {
                if (guideRef.current?.color === selectedColor) {
                  handleColorSelect(nextColor);
                  announcerRef.current?.announce(`Цвет ${selectedColor + 1} завершён, выбран цвет ${nextColor + 1}`);
                }
              }, 900);
            }
          }
        }
      }
      redraw((value) => value + 1);
      if (announce) announcerRef.current?.announce(`Закрашено ${changes.length} клеток`);
    }
  }

  function updateTouchGesture() {
    const points = [...touchPointersRef.current.values()];
    if (points.length < 2) return;
    markInteraction();
    const midpoint = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
    const previous = gestureRef.current;
    if (!previous.active) {
      gestureRef.current = { active: true, midpoint, distance };
      pointerRef.current = null;
      return;
    }
    const current = cameraRef.current;
    const nextZoom = clamp(current.zoom * (distance / previous.distance), MIN_ZOOM, 4);
    const worldX = (previous.midpoint.x - current.x) / current.zoom;
    const worldY = (previous.midpoint.y - current.y) / current.zoom;
    updateCamera({
      x: midpoint.x - worldX * nextZoom,
      y: midpoint.y - worldY * nextZoom,
      zoom: nextZoom,
    });
    gestureRef.current = { active: true, midpoint, distance };
  }

  function handlePointerDown(event) {
    // Controls live inside the viewport for compact mobile layout. Let their
    // own click handlers run; capturing their pointer here prevents zone and
    // zoom navigation in touch WebViews.
    if (event.target instanceof Element && event.target.closest('button')) return;
    if (event.pointerType === 'touch') {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touchPointersRef.current.size > 1) updateTouchGesture();
      if (touchPointersRef.current.size > 1) return;
      if (navigationMode) {
        event.preventDefault();
        panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        return;
      }
    } else if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    } else if (event.button !== 0) return;
    if (navigationMode) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    const cell = mapCell(event);
    const current = cell && clientRef.current?.getCell(cell.x, cell.y);
    if (!cell || !current?.loaded) {
      if (cell) ensureCellLoaded(cell);
      if (event.pointerType === 'touch') touchPointersRef.current.delete(event.pointerId);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { pointerId: event.pointerId, lastIndex: cell.index, indices: [cell.index] };
  }

  function handlePointerMove(event) {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointersRef.current.size > 1) {
        event.preventDefault();
        updateTouchGesture();
        return;
      }
      if (gestureRef.current.active) return;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      markInteraction();
      const pan = panRef.current;
      const current = cameraRef.current;
      updateCamera({ ...current, x: current.x + event.clientX - pan.x, y: current.y + event.clientY - pan.y });
      panRef.current = { ...pan, x: event.clientX, y: event.clientY };
      return;
    }
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    markInteraction();
    addStrokeCell(mapCell(event));
  }

  function handlePointerUp(event) {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.delete(event.pointerId);
      if (touchPointersRef.current.size > 0 || gestureRef.current.active) {
        if (touchPointersRef.current.size === 0) gestureRef.current = { active: false, midpoint: null, distance: 0 };
        return;
      }
    }
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      return;
    }
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    const pointer = pointerRef.current;
    pointerRef.current = null;
    commitIndices(pointer.indices);
  }

  function zoomAt(factor) {
    const nextZoom = clamp(camera.zoom * factor, MIN_ZOOM, 4);
    updateCamera({
      x: size.width / 2 - (size.width / 2 - camera.x) * (nextZoom / camera.zoom),
      y: size.height / 2 - (size.height / 2 - camera.y) * (nextZoom / camera.zoom),
      zoom: nextZoom,
    });
  }

  function jumpToZone(zone) {
    const fitZoom = clamp(
      Math.min(
        (size.width * 0.78) / (zone.width * CELL_SIZE),
        (size.height * 0.56) / (zone.height * CELL_SIZE),
      ),
      MIN_ZOOM,
      4,
    );
    const zoom = clamp(Math.max(fitZoom, WORK_ZOOM), MIN_ZOOM, 2);
    const firstCell = guideRef.current?.firstCellByZone?.[zone.id];
    const focusX = firstCell ? firstCell.x + 0.5 : zone.x + zone.width / 2;
    const focusY = firstCell ? firstCell.y + 0.5 : zone.y + zone.height / 2;
    updateCamera({
      x: size.width / 2 - focusX * CELL_SIZE * zoom,
      y: size.height / 2 - focusY * CELL_SIZE * zoom,
      zoom,
    });
    announcerRef.current?.announce(
      firstCell
        ? `Открыта зона ${zone.id + 1}, здесь есть клетки цвета ${selectedColor + 1}`
        : `Открыта зона ${zone.id + 1}`,
    );
  }

  function handleColorSelect(colorIndex) {
    onSelectColor(colorIndex);
    if (colorIndex === selectedColor || interactionMode === 'reveal') return;
    const stats = guideIndexRef.current?.snapshot(colorIndex)
      || { remaining: 0, remainingByZone: {}, firstCellByZone: {} };
    // Jump only when the current view cannot show the freshly selected color:
    // either the user is at overview or the active zone has no cells of it.
    const currentZoneHasColor = (stats.remainingByZone[activeZone ?? -1] || 0) > 0;
    const isOverview = camera.zoom <= MIN_ZOOM * 1.5;
    if ((isOverview || !currentZoneHasColor) && stats.remaining > 0) {
      const zone = pickNextZoneWithCells(minimapZones, activeZone ?? 0, stats.remainingByZone);
      if (zone) {
        jumpToZone(zone);
        return;
      }
    }
    announcerRef.current?.announce(`Выбран цвет ${colorIndex + 1}`);
  }

  function advanceGuide() {
    const stats = guideRef.current;
    if (!stats || !minimapZones.length) return;
    if (stats.remaining === 0) {
      const nextColor = pickColorWithMostRemaining(clientRef.current?.cache.values() || [], template.palette.length);
      if (nextColor != null && nextColor !== selectedColor) {
        handleColorSelect(nextColor);
        announcerRef.current?.announce(`Цвет ${selectedColor + 1} завершён, выбран цвет ${nextColor + 1}`);
      } else {
        announcerRef.current?.announce('В загруженных фрагментах больше нет клеток');
      }
      return;
    }
    const next = pickNextZoneWithCells(minimapZones, activeZone ?? 0, stats.remainingByZone);
    if (next) jumpToZone(next);
    else jumpToZone(minimapZones[(activeZone + 1) % minimapZones.length]);
  }

  function setKeyboardCursor(index) {
    const client = clientRef.current;
    const x = index % template.width;
    const y = Math.floor(index / template.width);
    const cell = client?.getCell(x, y) || { index, x, y };
    keyboardCellRef.current = cell;
    setKeyboardCell(index);
  }

  function paintKeyboardCell() {
    const cell = keyboardCellRef.current;
    if (cell == null || !clientRef.current) return;
    const current = clientRef.current.getCell(cell.x, cell.y);
    if (!current?.loaded) {
      announcerRef.current?.announce('Фрагмент поля загружается, клетка будет закрашена после загрузки.');
      ensureCellLoaded(cell);
      return;
    }
    commitIndices([cell.index], { announce: true });
  }

  function focusOverview() {
    const manifest = clientRef.current?.getSnapshot().manifest;
    if (!manifest || !size.width || !size.height) return;
    const zoom = clamp(
      Math.min(
        size.width / (manifest.grid.width * CELL_SIZE),
        size.height / (manifest.grid.height * CELL_SIZE),
      ),
      MIN_ZOOM,
      1,
    );
    updateCamera({
      x: (size.width - manifest.grid.width * CELL_SIZE * zoom) / 2,
      y: (size.height - manifest.grid.height * CELL_SIZE * zoom) / 2,
      zoom,
    });
    announcerRef.current?.announce('Показан обзор всего поля.');
  }

  function handleCanvasFocus() {
    const client = clientRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    let cell = null;
    if (client && rect) {
      cell = client.mapPointer({
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        rect,
        camera,
        cellSize: CELL_SIZE,
      });
    }
    const index = cell?.index ?? Math.floor(template.height / 2) * template.width + Math.floor(template.width / 2);
    setKeyboardCursor(index);
    announcerRef.current?.announce(
      `Поле ${template.width} на ${template.height}. Стрелки перемещают курсор, Enter закрашивает, цифры 1-9 открывают зоны, 0 показывает обзор.`,
    );
  }

  function handleCanvasKeyDown(event) {
    const key = event.key;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      if (event.shiftKey) {
        const delta = 96;
        const current = cameraRef.current;
        updateCamera({
          ...current,
          x: current.x + (key === 'ArrowLeft' ? -delta : key === 'ArrowRight' ? delta : 0),
          y: current.y + (key === 'ArrowUp' ? -delta : key === 'ArrowDown' ? delta : 0),
        });
        return;
      }
      const next = moveKeyboardCursor(keyboardCellRef.current?.index ?? 0, key, {
        width: template.width,
        height: template.height,
      });
      setKeyboardCursor(next);
      return;
    }
    if (key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown') {
      event.preventDefault();
      const next = moveKeyboardCursor(keyboardCellRef.current?.index ?? 0, key, {
        width: template.width,
        height: template.height,
      });
      setKeyboardCursor(next);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      paintKeyboardCell();
      return;
    }
    if (key === '+' || key === '=') {
      event.preventDefault();
      zoomAt(1.2);
      return;
    }
    if (key === '-' || key === '_') {
      event.preventDefault();
      zoomAt(0.83);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      focusOverview();
      return;
    }
    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      const zone = minimapZones[Number(key) - 1];
      if (zone) jumpToZone(zone);
    }
  }

  const centerCellX = (size.width / 2 - camera.x) / Math.max(camera.zoom, MIN_ZOOM) / CELL_SIZE;
  const centerCellY = (size.height / 2 - camera.y) / Math.max(camera.zoom, MIN_ZOOM) / CELL_SIZE;
  const activeZone = minimapZones.find((zone) => centerCellX >= zone.x && centerCellX < zone.x + zone.width && centerCellY >= zone.y && centerCellY < zone.y + zone.height)?.id;
  const hasLoadedTiles = Boolean(clientRef.current?.cache.size);

  const retry = () => {
    const client = clientRef.current;
    if (!client) return;
    client.loadManifest({ signal: undefined }).then(() => {
      setManifestReady(true);
      updateCamera({ ...cameraRef.current });
    }).catch(() => {});
  };

  return (
    <div className="progressive-coloring-session" data-grid-width={template.width} data-grid-height={template.height}>
      <div
        className="player-canvas-area progressive-grid-area"
        ref={viewportRef}
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-camera-zoom={camera.zoom}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(event) => {
          pointerRef.current = null;
          panRef.current = null;
          if (event.pointerType === 'touch') touchPointersRef.current.delete(event.pointerId);
          if (touchPointersRef.current.size === 0) gestureRef.current = { active: false, midpoint: null, distance: 0 };
        }}
        onWheel={(event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.1 : 0.91); }}
        style={{ touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          role="application"
          aria-roledescription="поле раскраски"
          aria-label={`Поле раскраски, сетка ${template.width} на ${template.height}`}
          aria-describedby={instructionsId}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space + - 0 1 2 3 4 5 6 7 8 9"
          tabIndex={0}
          data-keyboard-cell={keyboardCell == null ? '' : keyboardCell}
          onFocus={handleCanvasFocus}
          onKeyDown={handleCanvasKeyDown}
          style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
        />
        <span id={instructionsId} className="sr-only">
          Стрелки перемещают курсор, Enter или пробел закрашивают клетку, плюс и минус меняют масштаб, цифры 1-9 открывают зоны, 0 показывает обзор.
        </span>
        <span id={liveId} role="status" aria-live="polite" className="sr-only">{liveText}</span>
        {(status === PROGRESSIVE_GRID_STATUS.LOADING_MANIFEST || (status === PROGRESSIVE_GRID_STATUS.LOADING_TILES && !clientRef.current?.cache.size)) && <div className="progressive-grid-status" role="status"><LoaderCircle className="spin" size={18} /> Загружаем фрагмент поля…</div>}
        {(status === PROGRESSIVE_GRID_STATUS.OFFLINE || status === PROGRESSIVE_GRID_STATUS.ERROR) && <div className="progressive-grid-status progressive-grid-error"><span>{error?.message || 'Фрагмент пока недоступен'}</span><button type="button" onClick={retry}><RotateCw size={15} /> Повторить</button></div>}
        {previewReady && !hasLoadedTiles && <div className="progressive-grid-preview" aria-live="polite">
          <img src={previewImageRef.current?.src} alt="Предварительный обзор изображения" />
          <span>Обзор карты · фрагменты поля загружаются для раскрашивания</span>
        </div>}
        {inputNotice && <div className="progressive-grid-input-notice" role="status" aria-live="polite">{inputNotice}</div>}
        {DIAGNOSTICS_ENABLED && diagnostics && (
          <div
            className="progressive-grid-diagnostics"
            data-diagnostics
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              zIndex: 30,
              maxWidth: '240px',
              padding: '6px 8px',
              background: 'rgba(0,0,0,0.82)',
              color: '#8d9fa5',
              fontFamily: 'monospace',
              fontSize: '10px',
              lineHeight: '1.5',
              borderRadius: '0 0 6px 0',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            <div><b style={{ color: '#fff' }}>tiled:</b> fps {diagnostics.fps} · max {diagnostics.maxFps}</div>
            <div><b style={{ color: '#aaa' }}>interact:</b> {diagnostics.interactionFps || 0} fps · max {diagnostics.interactionMaxFps || 0}</div>
            <div><b style={{ color: '#aaa' }}>first tile:</b> {diagnostics.firstTileAt == null
              ? '-'
              : `${Math.round(diagnostics.firstTileAt - diagnostics.startedAt)}ms`}</div>
            <div><b style={{ color: '#aaa' }}>cache:</b> {diagnostics.cacheTiles} tiles · {(diagnostics.cacheBytes / 1024).toFixed(0)}KB</div>
            <div><b style={{ color: '#aaa' }}>dom:</b> {diagnostics.domNodes} nodes · zoom {diagnostics.zoom.toFixed(2)}</div>
            <div><b style={{ color: '#aaa' }}>heap:</b> {diagnostics.heapBytes == null
              ? '-'
              : `${(diagnostics.heapBytes / 1024 / 1024).toFixed(1)}MB`} · commits {diagnostics.commits}</div>
          </div>
        )}
        {guide && (
          <div
            className="progressive-grid-guide"
            data-guide-color={guide.color == null ? '' : guide.color}
            data-guide-remaining={guide.remaining}
          >
            <span
              className="progressive-grid-guide-dot"
              style={guide.color == null ? undefined : { background: template.palette[guide.color] }}
              aria-hidden="true"
            />
            <span>{interactionMode === 'reveal'
              ? `Видно клеток: ${guide.remaining}`
              : `Цвет ${guide.color + 1} · видно ${guide.remaining}`}</span>
            <button type="button" onClick={advanceGuide} aria-label="К следующему участку">
              {guide.remaining === 0 ? 'Сменить цвет' : 'Дальше'}
            </button>
          </div>
        )}
        {wrongNotice && <div className="progressive-grid-wrong">{wrongNotice}</div>}
        {successNotice && <div className="progressive-grid-success" role="status" aria-live="polite">{successNotice}</div>}
        <div className="progressive-grid-controls" aria-label="Управление полем">
          <button
            type="button"
            className={navigationMode ? 'active' : ''}
            onClick={() => {
              setNavigationMode((value) => !value);
              window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
            }}
            aria-label="Режим перемещения"
            aria-pressed={navigationMode}
            title={navigationMode ? 'Перемещение включено' : 'Перемещение одним пальцем'}
          >
            <Hand size={16} />
          </button>
          <button type="button" onClick={() => zoomAt(1.2)} aria-label="Увеличить"><ZoomIn size={16} /></button>
          <button type="button" onClick={() => zoomAt(0.83)} aria-label="Уменьшить"><ZoomOut size={16} /></button>
        </div>
        <div
          className="progressive-grid-minimap"
          aria-label="Карта поля"
          data-zone-count={minimapZones.length}
          data-active-zone={activeZone == null ? '' : activeZone}
        >
          <span className="progressive-grid-minimap-label">
            {activeZone == null ? 'Карта' : `Карта · зона ${activeZone + 1}`}
          </span>
          <canvas
            ref={minimapCanvasRef}
            className="progressive-grid-minimap-canvas"
            role="application"
            aria-roledescription="миникарта поля"
            aria-label="Миникарта поля. Перетащите рамку, чтобы двигать холст, или коснитесь места для перехода."
            onPointerDown={handleMinimapPointerDown}
            onPointerMove={handleMinimapPointerMove}
            onPointerUp={handleMinimapPointerEnd}
            onPointerCancel={handleMinimapPointerEnd}
            style={{ touchAction: 'none' }}
          />
        </div>
      </div>
      <div className="player-dock progressive-grid-dock">
        {template.palette.length > 6 && <span className="palette-scroll-cue" aria-hidden="true">Свайпните палитру →</span>}
        <div className="palette" role="radiogroup" aria-label="Палитра цветов">
          {template.palette.map((color, index) => (
            <button
              key={color}
              type="button"
              className={`color-swatch ${selectedColor === index ? 'selected' : ''}`}
              role="radio"
              aria-checked={selectedColor === index}
              aria-label={formatPaletteState({ index, remaining: 0, selected: selectedColor === index })}
              data-state={selectedColor === index ? 'selected' : 'available'}
              onClick={() => handleColorSelect(index)}
              title={`Цвет ${index + 1}`}
            >
              <i style={{ background: color }} /><span>{index + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
