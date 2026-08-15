import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  Hand,
  LoaderCircle,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { extendStroke, PAINT_STATUS, paintStrokeIndex } from './strokeLive.js';
import { createProgressiveGridClient, PROGRESSIVE_GRID_STATUS, isAbortError } from '../../../lib/progressiveGridClient.js';
import { DEV_USER_ID } from '../../../api/client.js';
import {
  buildSpecialCellsDiagnosticsSnapshot,
  getSpecialCellsLastError,
  isSpecialCellsDiagnosticsEnabled,
} from '../../../lib/specialCellsDiagnostics.js';
import { createBoundedAnnouncer, formatPaletteState, moveKeyboardCursor } from '../../../lib/accessibility.js';
import { autoSparkActionForOffer } from '../../../lib/specialCellsGameplay.js';
import SpecialCellsDevHud from '../SpecialCellsDevHud.jsx';
import {
  GRID_LOD_MODE,
  resolveGridLodMode,
  selectViewportTiles,
} from './gridMath.js';
import { TileGuideIndex } from './guide.js';
import { LruTileCache } from './tileCache.js';
import { createCameraAnimation } from '../camera/cameraAnimation.js';
import { drawSpecialMarker, specialMarkerScreenRadius, SPECIAL_MARKER_VISUALS } from '../specialMarker.js';
import {
  GUIDANCE_REASON,
  countPaintedCellsInTarget,
  guidanceCameraCenter,
  isGuidanceIndexMissing,
  isStaleGuidance,
  isTargetActionable,
  isTrueColorCompletion,
  planGuidanceCamera,
} from './smartRoute.js';

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
// Opt-in stroke instrumentation (URL param or env flag): records per-stroke
// counters and phase timings into window.__splintStrokeMetrics. Production
// never runs the recorder unless explicitly enabled.
const STROKE_METRICS_ENABLED = DIAGNOSTICS_ENABLED
  || (typeof window !== 'undefined' && /[?&]splintMetrics=1/.test(window.location.search));
const SPECIAL_CELLS_ENABLED = import.meta.env.VITE_SPECIAL_CELLS_V0 !== 'false';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

// The server contract exposes `kind` on tile specials and on
// special_discovered; the offer response keeps its existing spark shape and
// may carry `kind` in later slices. Everything here is client presentation
// only: unsupported kinds stay visible but their action buttons are disabled
// instead of guessing at a server effect.
const SPECIAL_KIND_VISUALS = {
  spark: {
    label: 'Искра',
    markerColor: 'rgba(127, 231, 255, 0.92)',
    markerOutline: '#081218',
    markerShape: 'diamond',
    title: 'Искра: выбрать участок',
    groupLabel: 'Выберите участок для Искры',
    useLabel: 'Использовать искру',
    supported: true,
  },
  bomb: {
    label: 'Бомба',
    markerColor: 'rgba(255, 126, 116, 0.95)',
    markerOutline: '#2a0c0a',
    markerShape: 'bomb',
    title: 'Бомба: выбрать точку',
    groupLabel: 'Бомба: выбрать точку применения',
    useLabel: 'Использовать бомбу',
    supported: true,
  },
  fuse: {
    label: 'Фитиль',
    markerColor: 'rgba(255, 194, 91, 0.95)',
    markerOutline: '#2a1c06',
    markerShape: 'fuse',
    title: 'Фитиль: обезвредить',
    groupLabel: 'Особая клетка: фитиль',
    useLabel: 'Обезвредить фитиль',
    supported: true,
  },
  choice: {
    label: 'Выбор',
    markerColor: 'rgba(120, 224, 173, 0.95)',
    markerOutline: '#06231a',
    markerShape: 'choice',
    title: 'Выбор: выбрать эффект',
    groupLabel: 'Особая клетка: выбор',
    useLabel: 'Выбрать эффект',
    supported: true,
  },
  artifact: {
    label: 'Артефакт',
    markerColor: 'rgba(255, 214, 145, 0.95)',
    markerOutline: '#2a1d06',
    markerShape: 'artifact',
    title: 'Артефакт: найти',
    groupLabel: 'Особая клетка: артефакт',
    useLabel: 'Забрать артефакт',
    supported: false,
  },
  hazard: {
    label: 'Опасность',
    markerColor: 'rgba(255, 88, 88, 0.95)',
    markerOutline: '#2a0505',
    markerShape: 'hazard',
    title: 'Опасность: обезвредьте маркер',
    groupLabel: 'Опасность: обезвредьте маркер',
    useLabel: 'Обезвредить и продолжить',
    supported: true,
  },
  unknown: {
    label: 'Особая клетка',
    markerColor: 'rgba(173, 190, 198, 0.95)',
    markerOutline: '#0b131a',
    markerShape: 'unknown',
    title: 'Особая клетка',
    groupLabel: 'Особая клетка',
    useLabel: 'Активировать эффект',
    supported: false,
  },
};

function specialKindVisual(kind) {
  const key = String(kind || '').toLowerCase();
  return {
    ...(SPECIAL_KIND_VISUALS[key] || SPECIAL_KIND_VISUALS.unknown),
    ...(SPECIAL_MARKER_VISUALS[key] || SPECIAL_MARKER_VISUALS.unknown),
  };
}

function offerKind(specialOffer) {
  // Existing server offers have no kind yet; fall back to the proven spark
  // contract so this slice never invents or fakes a new field.
  return specialOffer?.kind ? String(specialOffer.kind).toLowerCase() : 'spark';
}

const BOMB_CENTER_NUDGE_LIMIT = 6;

function findSpecialCellCenter(client, specialId) {
  if (!client) return null;
  for (const tile of client.cache.values()) {
    const special = (tile.specials || []).find((candidate) => candidate.id === specialId);
    if (!special) continue;
    return {
      x: tile.offsetX + (special.localIndex % tile.width),
      y: tile.offsetY + Math.floor(special.localIndex / tile.width),
    };
  }
  return null;
}

function BombOfferPanel({
  specialOffer,
  onSpecialAction,
  cameraRef,
  sizeRef,
  defaultCenter = null,
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const cameraCenter = guidanceCameraCenter(cameraRef.current, sizeRef.current, CELL_SIZE);
  const baseCenter = defaultCenter || cameraCenter;
  const center = {
    x: Math.round(baseCenter.x + offset.x),
    y: Math.round(baseCenter.y + offset.y),
  };
  const nudge = (dx, dy) => setOffset((current) => {
    const next = {
      x: clamp(current.x + dx, -BOMB_CENTER_NUDGE_LIMIT, BOMB_CENTER_NUDGE_LIMIT),
      y: clamp(current.y + dy, -BOMB_CENTER_NUDGE_LIMIT, BOMB_CENTER_NUDGE_LIMIT),
    };
    // The server clamps use_bomb centers to the special's 6-cell
    // neighbourhood; keep the explicit control inside that valid radius.
    if (Math.hypot(next.x, next.y) > BOMB_CENTER_NUDGE_LIMIT) return current;
    return next;
  });
  const radius = Number(specialOffer.radius) || 3;
  return (
    <div
      className="progressive-grid-special-offer progressive-grid-bomb-offer"
      role="group"
      aria-label="Бомба: выбрать точку применения"
      data-special-kind="bomb"
      data-special-supported="true"
      data-bomb-center-x={center.x}
      data-bomb-center-y={center.y}
    >
      <span className="progressive-grid-special-title">Бомба: точка · радиус {radius}</span>
      <span className="progressive-grid-special-kind" aria-hidden="true">Бомба</span>
      <div className="progressive-grid-bomb-center" aria-label="Центр бомбы">
        <span data-bomb-center-label>Центр: {center.x}, {center.y}</span>
        <div className="progressive-grid-bomb-nudge" role="group" aria-label="Сдвинуть центр">
          <button
            type="button"
            data-bomb-center-direction="up"
            aria-label="Центр выше"
            title="Центр выше"
            onClick={() => nudge(0, -1)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            data-bomb-center-direction="left"
            aria-label="Центр левее"
            title="Центр левее"
            onClick={() => nudge(-1, 0)}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            data-bomb-center-direction="reset"
            aria-label="По центру экрана"
            title="По центру экрана"
            onClick={() => setOffset({ x: 0, y: 0 })}
          >
            <Crosshair size={14} />
          </button>
          <button
            type="button"
            data-bomb-center-direction="right"
            aria-label="Центр правее"
            title="Центр правее"
            onClick={() => nudge(1, 0)}
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            data-bomb-center-direction="down"
            aria-label="Центр ниже"
            title="Центр ниже"
            onClick={() => nudge(0, 1)}
          >
            <ArrowDown size={14} />
          </button>
        </div>
      </div>
      <button
        type="button"
        data-special-action="use"
        data-bomb-use
        onClick={() => onSpecialAction?.({
          type: 'use_bomb',
          special_id: specialOffer.special_id,
          offer_token: specialOffer.offer_token,
          center_x: center.x,
          center_y: center.y,
          experiment_group: 'treatment',
        })}
      >
        Использовать здесь
      </button>
    </div>
  );
}

function SpecialOfferPanel({ specialOffer, onSpecialAction, cameraRef, sizeRef, clientRef }) {
  const kind = offerKind(specialOffer);
  const visual = specialKindVisual(kind);
  if (kind === 'bomb') {
    return (
      <BombOfferPanel
            specialOffer={specialOffer}
            onSpecialAction={onSpecialAction}
            cameraRef={cameraRef}
            sizeRef={sizeRef}
            defaultCenter={
              Number.isFinite(Number(specialOffer.center_x))
                && Number.isFinite(Number(specialOffer.center_y))
                ? { x: Number(specialOffer.center_x), y: Number(specialOffer.center_y) }
                : findSpecialCellCenter(clientRef.current, specialOffer.special_id)
            }
      />
    );
  }
  if (kind === 'fuse' && Array.isArray(specialOffer.steps)) {
    const remainingCells = specialOffer.steps.reduce((sum, step) => sum + Number(step.cells || 0), 0);
    const totalCells = Number(specialOffer.chain_cells?.length) || remainingCells;
    const lastStep = specialOffer.steps.length <= 1;
    return (
      <div
        className="progressive-grid-special-offer progressive-grid-fuse-offer"
        role="group"
        aria-label="Фитиль: обезвредить цепочку"
        data-special-kind="fuse"
        data-special-supported="true"
        data-fuse-steps-remaining={specialOffer.steps.length}
      >
        <button
          type="button"
          className="progressive-grid-special-skip"
          data-fuse-skip
          onClick={() => onSpecialAction?.({
            type: 'skip_fuse',
            special_id: specialOffer.special_id,
            offer_token: specialOffer.offer_token,
            experiment_group: 'treatment',
          })}
        >Leave it and continue</button>
        <span className="progressive-grid-special-title">Фитиль: короткая цепочка</span>
        <span className="progressive-grid-special-kind" aria-hidden="true">Фитиль</span>
        <span className="progressive-grid-special-detail" data-fuse-chain-detail>
          Осталось звеньев: {specialOffer.steps.length}, клеток: {remainingCells} из {totalCells}
        </span>
        <button
          type="button"
          data-special-action="disarm"
          data-fuse-disarm
          data-fuse-step-distance={specialOffer.steps[0]?.distance}
          data-fuse-steps-remaining={specialOffer.steps.length}
          onClick={() => onSpecialAction?.({
            type: 'disarm_fuse',
            special_id: specialOffer.special_id,
            offer_token: specialOffer.offer_token,
            experiment_group: 'treatment',
          })}
        >
          {lastStep ? 'Обезвредить и продолжить' : `Обезвредить звено ${specialOffer.steps[0]?.distance}`}
        </button>
      </div>
    );
  }
  if (kind === 'hazard') {
    return (
      <div
        className="progressive-grid-special-offer progressive-grid-hazard-offer"
        role="group"
        aria-label="Опасность: обезвредьте маркер"
        data-special-kind="hazard"
        data-special-supported="true"
      >
        <button
          type="button"
          className="progressive-grid-special-skip"
          data-hazard-skip
          onClick={() => onSpecialAction?.({
            type: 'skip_hazard',
            special_id: specialOffer.special_id,
            offer_token: specialOffer.offer_token,
            experiment_group: 'treatment',
          })}
        >Пропустить (маленькая пауза)</button>
        <span className="progressive-grid-special-title">Опасность: обезвредьте маркер</span>
        <span className="progressive-grid-special-kind" aria-hidden="true">Опасность</span>
        <span className="progressive-grid-special-detail" data-hazard-reward>
          До {specialOffer.reward_cap || 16} клеток, прогресс не удаляется
        </span>
        <button
          type="button"
          data-special-action="disarm"
          data-hazard-disarm
          onClick={() => onSpecialAction?.({
            type: 'disarm_hazard',
            special_id: specialOffer.special_id,
            offer_token: specialOffer.offer_token,
            experiment_group: 'treatment',
          })}
        >
          Обезвредить и продолжить
        </button>
      </div>
    );
  }
  if (kind === 'choice' && Array.isArray(specialOffer.choice_options)) {
    return (
      <div
        className="progressive-grid-special-offer progressive-grid-choice-offer"
        role="group"
        aria-label="Выбор действия"
        data-special-kind="choice"
        data-special-supported="true"
      >
        <span className="progressive-grid-special-title">Выберите способ продолжить</span>
        <span className="progressive-grid-special-kind" aria-hidden="true">Выбор</span>
        {specialOffer.choice_options.slice(0, 2).map((option) => (
          <button
            key={option.option_id}
            type="button"
            data-special-option={option.option_id}
            data-special-action="use"
            onClick={() => onSpecialAction?.({
              type: 'use_choice',
              special_id: specialOffer.special_id,
              offer_token: specialOffer.offer_token,
              option_id: option.option_id,
              camera_center: guidanceCameraCenter(cameraRef.current, sizeRef.current, CELL_SIZE),
              experiment_group: 'treatment',
            })}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  if (!Array.isArray(specialOffer.target_options)) return null;
  const target = specialOffer.target_options.find((option) => (
    option.option_id === specialOffer.default_option_id
  )) || specialOffer.target_options[0];
  const estimated = Math.max(0, Number(target?.estimated_cells) || 0);
  return (
    <div
      className="progressive-grid-special-offer progressive-grid-spark-offer"
      role="status"
      aria-live="polite"
      aria-label="Искра применяется автоматически"
      data-special-kind={kind}
      data-special-supported="true"
      data-special-auto-apply="true"
      data-special-interaction-cost="0"
    >
      <span className="progressive-grid-special-title">Искра заряжается…</span>
      <span className="progressive-grid-special-kind" aria-hidden="true">{visual.label}</span>
      <span className="progressive-grid-special-detail progressive-grid-spark-contract" data-spark-target-contract>
        Сервер выбрал трудоёмкий участок · {estimated} клеток
      </span>
    </div>
  );
}

export default function ProgressiveColoringSession({
  template,
  progress,
  selectedColor,
  onSelectColor,
  resumeSnapshot = null,
  onResumeStateChange,
  onStrokeCommitted,
  onSpecialAction,
  specialOffer = null,
  specialApplied = null,
  specialDiscovered = null,
  reconciledChanges = [],
  onVisibleSpecialKinds,
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
  const cameraRef = useRef({ x: 0, y: 0, zoom: MIN_ZOOM });
  const pointerRef = useRef(null);
  const panRef = useRef(null);
  const minimapCanvasRef = useRef(null);
  const minimapBaseRef = useRef(null);
  const minimapDragRef = useRef(null);
  const minimapTimerRef = useRef(null);
  const pendingCellRef = useRef(null);
  const tilePreloadRef = useRef(null);
  const strokeMetricsRef = useRef(null);
  if (STROKE_METRICS_ENABLED && !strokeMetricsRef.current) {
    strokeMetricsRef.current = { strokes: [], pointerEvents: 0, livePaints: 0 };
    if (typeof window !== 'undefined') window.__splintStrokeMetrics = strokeMetricsRef.current;
  }
  const touchPointersRef = useRef(new Map());
  const gestureRef = useRef({ active: false, midpoint: null, distance: 0 });
  const initialCameraRef = useRef(false);
  const resumeCameraRef = useRef(null);
  const resumeCameraAppliedRef = useRef(false);
  const resumeTargetRef = useRef(null);
  const resumeChangeRef = useRef(onResumeStateChange);
  resumeChangeRef.current = onResumeStateChange;
  const pendingCameraSaveRef = useRef(null);
  const cameraSaveTimerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [camera, setCamera] = useState(cameraRef.current);
  const [reducedMotion, setReducedMotion] = useState(false);
  const lodModeRef = useRef(GRID_LOD_MODE.OVERVIEW);
  const [lodMode, setLodMode] = useState(GRID_LOD_MODE.OVERVIEW);
  const viewportLoadTimerRef = useRef(null);
  const [status, setStatus] = useState(PROGRESSIVE_GRID_STATUS.IDLE);
  const [error, setError] = useState(null);
  const [manifestReady, setManifestReady] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [inputNotice, setInputNotice] = useState(null);
  const [drawRevision, redraw] = useState(0);
  const [keyboardCell, setKeyboardCell] = useState(null);
  const [liveText, setLiveText] = useState('');
  const [guide, setGuide] = useState(null);
  const [smartState, setSmartState] = useState('idle');
  const [wrongNotice, setWrongNotice] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);
  const [errorNotice, setErrorNotice] = useState(null);
  const [navigationMode, setNavigationMode] = useState(false);
  const [sparkWave, setSparkWave] = useState(null);
  const markerPhaseRef = useRef(0);
  const smartStateRef = useRef('idle');
  const smartPlanRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  const guidanceTokenRef = useRef(0);
  const guidanceIndexRetryRef = useRef(0);
  const guidanceIndexRetryTimerRef = useRef(null);
  const cameraAnimRef = useRef(null);
  const autoAdvanceTimerRef = useRef(null);
  const recentTargetsRef = useRef([]);
  const targetRemainingRef = useRef(null);
  const committedRevisionRef = useRef(0);
  const selectedColorRef = useRef(selectedColor);
  const guidanceBootstrappedRef = useRef(false);
  const previousSpecialOfferRef = useRef(null);
  const autoSparkOfferKeyRef = useRef('');
  const wrongNoticeTimerRef = useRef(null);
  const successNoticeTimerRef = useRef(null);
  const keyboardCellRef = useRef(null);

  useEffect(() => {
    const action = autoSparkActionForOffer(specialOffer);
    if (!action || typeof onSpecialAction !== 'function') {
      if (!specialOffer) autoSparkOfferKeyRef.current = '';
      return;
    }
    const key = `${action.special_id}:${action.offer_token}:${action.option_id}`;
    if (autoSparkOfferKeyRef.current === key) return;
    autoSparkOfferKeyRef.current = key;
    void onSpecialAction(action);
  }, [specialOffer, onSpecialAction]);
  const diagnosticsRef = useRef(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const instructionsId = useId();
  const liveId = useId();
  const announcerRef = useRef(null);
  const guideIndexRef = useRef(null);
  selectedColorRef.current = selectedColor;
  resumeTargetRef.current = resumeSnapshot?.smartTarget || null;
  if (announcerRef.current === null) {
    announcerRef.current = createBoundedAnnouncer({ onAnnounce: setLiveText });
  }
  const minimapZones = useMemo(() => buildZoneRects(template.width, template.height), [template.width, template.height]);
  const specialTreatment = SPECIAL_CELLS_ENABLED
    && progress?.specials_experiment_group === 'treatment';
  const specialDiagnostics = progress?.special_diagnostics || null;
  const artifactProgress = progress?.artifact_progress || null;

  useEffect(() => {
    if (!specialTreatment || lodMode !== GRID_LOD_MODE.WORK || reducedMotion) return undefined;
    let frame = 0;
    let last = 0;
    const tick = (time) => {
      if (time - last > 55) {
        markerPhaseRef.current = time / 650;
        redraw((value) => value + 1);
        last = time;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [lodMode, reducedMotion, specialTreatment]);

  useEffect(() => {
    if (!onVisibleSpecialKinds) return;
    if (!specialTreatment) {
      onVisibleSpecialKinds([]);
      return;
    }
    if (!manifestReady || !size.width || !size.height || lodMode === GRID_LOD_MODE.OVERVIEW) {
      onVisibleSpecialKinds([]);
      return;
    }
    const client = clientRef.current;
    const manifest = client?.getSnapshot().manifest;
    if (!manifest) {
      onVisibleSpecialKinds([]);
      return;
    }
    const plan = selectViewportTiles({
      grid: manifest.grid,
      camera,
      viewportWidth: size.width,
      viewportHeight: size.height,
      cellSize: CELL_SIZE,
      overscanCells: 1,
      overscanTiles: 0,
    });
    const visibleKeys = new Set((plan.visible || []).map((tile) => tile.key));
    const kinds = [];
    for (const tile of client.cache.values()) {
      if (!visibleKeys.has(tile.key)) continue;
      for (const special of tile.specials || []) {
        if (special.state !== 'unseen' || tile.filled[special.localIndex] !== -1) continue;
        if (special.kind && !kinds.includes(special.kind)) kinds.push(special.kind);
      }
    }
    onVisibleSpecialKinds(kinds);
    // The tiled client/cache is stable for this mounted session; the camera
    // and load status are the visible-relevance signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, lodMode, manifestReady, onVisibleSpecialKinds, progress?.revision, reconciledChanges, size.height, size.width, specialApplied, specialTreatment, status]);
  const specialCellsDiagnosticsEnabled = isSpecialCellsDiagnosticsEnabled(import.meta.env);
  const specialCellsSnapshot = specialCellsDiagnosticsEnabled
    ? buildSpecialCellsDiagnosticsSnapshot({
      template,
      progress,
      visibleSpecials: clientRef.current ? [...clientRef.current.cache.values()] : [],
      offer: specialOffer,
      discovered: specialDiscovered,
      target: smartPlanRef.current?.target || null,
      plan: smartPlanRef.current || null,
      targetActive: smartStateRef.current !== 'freeExploration',
      recentTargets: recentTargetsRef.current,
      userId: DEV_USER_ID,
      lastError: errorNotice || error || getSpecialCellsLastError(),
    })
    : null;

  // The special-cell snapshot is QA-only and reads live refs, so it must
  // refresh whenever those refs change instead of going stale.
  const [, forceSpecialDiagnosticsRender] = useState(0);
  useEffect(() => {
    if (!specialCellsDiagnosticsEnabled) return undefined;
    const interval = window.setInterval(
      () => forceSpecialDiagnosticsRender((value) => value + 1),
      750,
    );
    return () => window.clearInterval(interval);
  }, [specialCellsDiagnosticsEnabled]);

  useEffect(() => {
    if (!specialOffer) return;
    // An offer is a short-lived decision state, not a modal route. Stop any
    // already scheduled Smart Engine advance and invalidate an in-flight
    // guidance response so it cannot move the camera underneath the HUD.
    cancelAutoAdvance();
    guidanceTokenRef.current += 1;
  }, [specialOffer]);

  useEffect(() => {
    const applied = specialApplied;
    const client = clientRef.current;
    if (!specialTreatment || !client || !applied?.changes?.length) return;
    const changedTiles = new Set();
    for (const change of applied.changes) {
      const x = Number(change.index) % template.width;
      const y = Math.floor(Number(change.index) / template.width);
      if (client.updateFilled(x, y, Number(change.color))) changedTiles.add(`${Math.floor(x / 32)}:${Math.floor(y / 32)}`);
    }
    if (applied.specialId) {
      for (const tile of client.cache.values()) {
        for (const special of tile.specials || []) {
          if (special.id === applied.specialId) special.state = 'consumed';
        }
      }
    }
    for (const key of changedTiles) {
      const tile = client.cache.peek(key);
      if (tile) guideIndexRef.current?.refreshTile(tile);
    }
    redraw((value) => value + 1);
    scheduleMinimapRebuild();
    // The client/cache helpers are stable for the mounted tiled session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialApplied, specialTreatment, template.width]);

  useEffect(() => {
    if (!specialApplied || specialApplied.kind !== 'spark' || !specialApplied.changes?.length) return undefined;
    setSparkWave({ revision: specialApplied.revision, cells: specialApplied.changes.length });
    const timer = window.setTimeout(() => setSparkWave(null), reducedMotion ? 700 : 1500);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, specialApplied]);

  useEffect(() => {
    const wasOpen = Boolean(previousSpecialOfferRef.current);
    previousSpecialOfferRef.current = specialOffer;
    if (!wasOpen || specialOffer || !manifestReady || !size.width || !size.height) return undefined;

    // Resolution is committed before the offer disappears. Resume through
    // the existing guidance route after the cache/progress effects above have
    // observed that commit; no special-cell work enters pointermove.
    const resumeTimer = window.setTimeout(() => {
      if (specialOffer) return;
      void fetchAndApplyGuidance({
        reason: smartPlanRef.current ? GUIDANCE_REASON.SAME_COLOR_NEXT : GUIDANCE_REASON.INITIAL_TARGET,
        color: smartPlanRef.current?.selectedColor ?? selectedColorRef.current,
        recent: recentTargetsRef.current,
        immediate: true,
      });
    }, 0);
    return () => window.clearTimeout(resumeTimer);
    // The mounted tiled session owns these callbacks/refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialOffer, manifestReady, size.width, size.height]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !Array.isArray(reconciledChanges) || !reconciledChanges.length) return;
    const changedTiles = new Set();
    for (const change of reconciledChanges) {
      const index = Number(change.index);
      const color = Number(change.color);
      if (!Number.isInteger(index) || !Number.isInteger(color)) continue;
      const x = index % template.width;
      const y = Math.floor(index / template.width);
      if (client.updateFilled(x, y, color)) changedTiles.add(`${Math.floor(x / 32)}:${Math.floor(y / 32)}`);
    }
    for (const key of changedTiles) {
      const tile = client.cache.peek(key);
      if (tile) guideIndexRef.current?.refreshTile(tile);
    }
    if (changedTiles.size) {
      redraw((value) => value + 1);
      scheduleMinimapRebuild();
    }
    // Replay reconciliation is post-commit work; it is deliberately absent
    // from the Stroke Engine V2 pointermove hot path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconciledChanges, template.width]);

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
    const nextMode = resolveGridLodMode(CELL_SIZE * next.zoom, lodModeRef.current);
    if (nextMode !== lodModeRef.current) {
      lodModeRef.current = nextMode;
      setLodMode(nextMode);
    }
    cameraRef.current = next;
    setCamera(next);
    scheduleCameraSave(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cameraStorageKey() {
    return `splint:tiled-camera:${template.id}`;
  }

  function flushCameraSave() {
    const pending = pendingCameraSaveRef.current;
    if (!pending) return;
    pendingCameraSaveRef.current = null;
    if (cameraSaveTimerRef.current) {
      clearTimeout(cameraSaveTimerRef.current);
      cameraSaveTimerRef.current = null;
    }
    try {
      window.localStorage.setItem(cameraStorageKey(), JSON.stringify({
        centerX: pending.centerX,
        centerY: pending.centerY,
        zoom: pending.zoom,
        savedAt: Date.now(),
      }));
    } catch {
      // Storage may be unavailable.
    }
    resumeChangeRef.current?.({ camera: pending.camera });
  }

  function scheduleCameraSave(cameraValue) {
    if (typeof window === 'undefined' || !template.id) return;
    const viewport = sizeRef.current;
    if (!viewport.width || !viewport.height) return;
    const zoom = Math.max(Number(cameraValue.zoom) || MIN_ZOOM, MIN_ZOOM);
    const centerX = (viewport.width / 2 - cameraValue.x) / zoom / CELL_SIZE;
    const centerY = (viewport.height / 2 - cameraValue.y) / zoom / CELL_SIZE;
    pendingCameraSaveRef.current = {
      camera: {
        x: Number(cameraValue.x) || 0,
        y: Number(cameraValue.y) || 0,
        zoom,
      },
      centerX,
      centerY,
      zoom,
    };
    if (cameraSaveTimerRef.current) clearTimeout(cameraSaveTimerRef.current);
    cameraSaveTimerRef.current = setTimeout(flushCameraSave, 350);
  }

  function restoreStoredCamera() {
    const saved = resumeSnapshot?.artworkId === template.id ? resumeSnapshot.camera : null;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.zoom) && saved.zoom > 0) {
      return { x: saved.x, y: saved.y, zoom: Math.max(MIN_ZOOM, saved.zoom) };
    }
    try {
      const legacy = JSON.parse(window.localStorage.getItem(cameraStorageKey()) || 'null');
      if (legacy && Number.isFinite(Number(legacy.centerX)) && Number.isFinite(Number(legacy.centerY)) && Number(legacy.zoom) > 0) {
        const zoom = Math.max(MIN_ZOOM, Number(legacy.zoom));
        return {
          x: size.width / 2 - Number(legacy.centerX) * CELL_SIZE * zoom,
          y: size.height / 2 - Number(legacy.centerY) * CELL_SIZE * zoom,
          zoom,
        };
      }
    } catch {
      // A malformed legacy camera must fall back to the bounded overview.
    }
    return null;
  }

  function persistSmartTarget(plan) {
    if (!plan?.target || !resumeChangeRef.current) return;
    resumeChangeRef.current({
      selectedColor: plan.selectedColor,
      smartTargetRevision: plan.progressRevision,
      smartTarget: {
        kind: 'tiled',
        tileKey: `${plan.target.tile_x}:${plan.target.tile_y}`,
        color: plan.target.color ?? plan.selectedColor,
        anchorX: plan.target.anchor_x,
        anchorY: plan.target.anchor_y,
        bounds: {
          minX: plan.target.bounds?.min_x,
          minY: plan.target.bounds?.min_y,
          maxX: plan.target.bounds?.max_x,
          maxY: plan.target.bounds?.max_y,
        },
      },
    });
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

  function setSmartStateValue(next) {
    smartStateRef.current = next;
    setSmartState(next);
  }

  function cancelCameraAnimation() {
    if (cameraAnimRef.current) {
      cameraAnimRef.current();
      cameraAnimRef.current = null;
    }
  }

  function cancelAutoAdvance() {
    if (autoAdvanceTimerRef.current != null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }

  function animateCameraTo(targetCamera, { immediate = false, onComplete } = {}) {
    cancelCameraAnimation();
    if (!targetCamera) {
      onComplete?.();
      return;
    }
    if (immediate || reducedMotion) {
      const nextMode = resolveGridLodMode(CELL_SIZE * targetCamera.zoom, lodModeRef.current);
      lodModeRef.current = nextMode;
      setLodMode(nextMode);
      cameraRef.current = targetCamera;
      setCamera(targetCamera);
      scheduleCameraSave(targetCamera);
      onComplete?.();
      return;
    }
    const from = { ...cameraRef.current };
    cameraAnimRef.current = createCameraAnimation(
      from,
      targetCamera,
      360,
      (frame) => {
        const nextMode = resolveGridLodMode(CELL_SIZE * frame.zoom, lodModeRef.current);
        if (nextMode !== lodModeRef.current) {
          lodModeRef.current = nextMode;
          setLodMode(nextMode);
        }
        cameraRef.current = frame;
        setCamera(frame);
      },
      () => {
        cameraAnimRef.current = null;
        scheduleCameraSave(cameraRef.current);
        onComplete?.();
      },
    );
  }

  function markFreeExploration() {
    cancelCameraAnimation();
    cancelAutoAdvance();
    if (smartStateRef.current === 'freeExploration') return;
    setSmartStateValue('freeExploration');
  }

  function clearGuidanceIndexRetry() {
    guidanceIndexRetryRef.current = 0;
    if (guidanceIndexRetryTimerRef.current) {
      clearTimeout(guidanceIndexRetryTimerRef.current);
      guidanceIndexRetryTimerRef.current = null;
    }
  }

  async function applyGuidancePlan(plan, { immediate = false } = {}) {
    if (!plan || specialOffer) return false;
    if (isStaleGuidance(plan, committedRevisionRef.current)) {
      window.setTimeout(() => {
        void fetchAndApplyGuidance({
          reason: plan.reason,
          color: plan.selectedColor,
          immediate,
        });
      }, 350);
      return false;
    }
    if (plan.artworkComplete) {
      clearGuidanceIndexRetry();
      setSmartStateValue('artworkComplete');
      setSuccessNotice('Картина готова');
      if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current);
      successNoticeTimerRef.current = setTimeout(() => setSuccessNotice(null), 3600);
      return true;
    }
    if (isTrueColorCompletion(plan)) {
      clearGuidanceIndexRetry();
      setSmartStateValue('colorComplete');
      smartPlanRef.current = plan;
      const message = plan.nextColor != null
        ? `Цвет ${plan.selectedColor + 1} завершён · дальше цвет ${plan.nextColor + 1}`
        : `Цвет ${plan.selectedColor + 1} завершён`;
      setSuccessNotice(message);
      if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current);
      successNoticeTimerRef.current = setTimeout(() => setSuccessNotice(null), 3600);
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
      } catch {
        // Haptics are optional.
      }
      announcerRef.current?.announce(message);
      if (plan.nextColor != null && isTargetActionable(plan)) {
        cancelAutoAdvance();
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          if (specialOffer || smartStateRef.current !== 'colorComplete') return;
          if (plan.nextColor !== selectedColorRef.current) {
            selectedColorRef.current = plan.nextColor;
            onSelectColor(plan.nextColor);
          }
          void fetchAndApplyGuidance({
            reason: GUIDANCE_REASON.SAME_COLOR_NEXT,
            color: plan.nextColor,
            recent: recentTargetsRef.current,
          });
        }, 1100);
      }
      return true;
    }
    if (isGuidanceIndexMissing(plan)) {
      // The server has no static guidance index for this template yet
      // (pre-021 migration, background backfill still running). Retry with
      // bounded backoff instead of pretending the artwork has no work left.
      guidanceIndexRetryRef.current += 1;
      if (guidanceIndexRetryRef.current <= 5) {
        if (!smartPlanRef.current) setInputNotice('Готовим участок…');
        const delay = 700 * guidanceIndexRetryRef.current;
        if (guidanceIndexRetryTimerRef.current) clearTimeout(guidanceIndexRetryTimerRef.current);
        guidanceIndexRetryTimerRef.current = window.setTimeout(() => {
          guidanceIndexRetryTimerRef.current = null;
          void fetchAndApplyGuidance({
            reason: plan.reason,
            color: plan.selectedColor,
            immediate,
          });
        }, delay);
      } else {
        setInputNotice(null);
        setSmartStateValue('errorRetryable');
        setErrorNotice('Не удалось подготовить следующий фрагмент');
      }
      return false;
    }
    if (!isTargetActionable(plan)) {
      clearGuidanceIndexRetry();
      setSmartStateValue('freeExploration');
      return false;
    }

    clearGuidanceIndexRetry();
    smartPlanRef.current = plan;
    persistSmartTarget(plan);
    targetRemainingRef.current = plan.target.estimated_cells;
    const tileKey = `${plan.target.tile_x}:${plan.target.tile_y}`;
    recentTargetsRef.current = [...recentTargetsRef.current.filter((key) => key !== tileKey), tileKey].slice(-4);
    setGuide({
      color: plan.selectedColor,
      remaining: plan.globalRemainingForColor,
      targetRemaining: plan.target.estimated_cells,
      reason: plan.reason,
    });

    // Contract: READY is forbidden before the guidance target tile is
    // explicitly loaded. The generic viewport loader is a fallback, never
    // the dependency that unlocks the route.
    setSmartStateValue('loadingTarget');
    try {
      await clientRef.current.fetchTile(plan.target.tile_x, plan.target.tile_y);
    } catch (error) {
      // A cancelled request is a race (new plan, camera change, unmount),
      // not a failure: the newer plan owns the state machine.
      if (isAbortError(error)) return false;
      setSmartStateValue('errorRetryable');
      setErrorNotice('Не удалось подготовить следующий фрагмент');
      return false;
    }
    markFirstTile();
    redraw((value) => value + 1);
    if (plan.selectedColor !== selectedColorRef.current && plan.selectedColor != null) {
      selectedColorRef.current = plan.selectedColor;
      onSelectColor(plan.selectedColor);
    }
    setSmartStateValue('focusing');
    const cameraTarget = resumeCameraAppliedRef.current
      ? resumeCameraRef.current
      : planGuidanceCamera(plan, sizeRef.current, template, CELL_SIZE);
    resumeCameraAppliedRef.current = false;
    if (cameraTarget) {
      animateCameraTo(cameraTarget, {
        immediate,
        onComplete: () => {
          if (smartStateRef.current === 'focusing') setSmartStateValue('ready');
        },
      });
    } else {
      setSmartStateValue('ready');
    }
    return true;
  }

  async function fetchAndApplyGuidance({
    reason = GUIDANCE_REASON.INITIAL_TARGET,
    color = null,
    targetColor = null,
    tileKey = null,
    recent = null,
    immediate = false,
  } = {}) {
    if (specialOffer) {
      cancelAutoAdvance();
      return;
    }
    const client = clientRef.current;
    const manifest = client?.getSnapshot().manifest;
    if (!client || !manifest || !sizeRef.current.width || !sizeRef.current.height) return;
    const token = ++guidanceTokenRef.current;
    const [tileX, tileY] = tileKey ? tileKey.split(':').map(Number) : [null, null];
    try {
      const plan = await client.fetchGuidance({
        selectedColor: color ?? smartPlanRef.current?.selectedColor ?? null,
        targetColor,
        reason,
        cameraCenter: guidanceCameraCenter(cameraRef.current, sizeRef.current, CELL_SIZE),
        recent: recent ?? recentTargetsRef.current,
        tileX,
        tileY,
        sparkTreatment: specialTreatment,
      });
      if (token !== guidanceTokenRef.current) return;
      if (isStaleGuidance(plan, committedRevisionRef.current)) {
        window.setTimeout(() => {
          void fetchAndApplyGuidance({ reason, color, targetColor, tileKey, recent, immediate });
        }, 350);
        return;
      }
      const applied = await applyGuidancePlan(plan, { immediate });
      if (applied) {
        setErrorNotice(null);
        setInputNotice(null);
      }
    } catch (error) {
      if (isAbortError(error)) return;
      if (error?.status === 409 && error?.data?.code === 'SPECIAL_ACTIVE_OFFER') return;
      // A failed bootstrap must not leave the user staring at an inert
      // overview as if everything worked.
      if (!smartPlanRef.current && smartStateRef.current !== 'errorRetryable') {
        setSmartStateValue('errorRetryable');
        setErrorNotice('Не удалось подготовить следующий фрагмент');
      }
    }
  }

  function retrySmartGuidance() {
    setErrorNotice(null);
    setInputNotice(null);
    void fetchAndApplyGuidance({
      reason: smartPlanRef.current?.reason || GUIDANCE_REASON.INITIAL_TARGET,
      color: smartPlanRef.current?.selectedColor ?? null,
      recent: recentTargetsRef.current,
      immediate: true,
    });
  }

  function scheduleAutoAdvance() {
    if (specialOffer) return;
    cancelAutoAdvance();
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      if (specialOffer || smartStateRef.current !== 'ready' || !smartPlanRef.current) return;
      void fetchAndApplyGuidance({
        reason: GUIDANCE_REASON.SAME_COLOR_NEXT,
        color: smartPlanRef.current.selectedColor,
        recent: recentTargetsRef.current,
      });
    }, 900);
  }

  function returnToTarget() {
    const plan = smartPlanRef.current;
    if (!plan?.target) return;
    cancelAutoAdvance();
    void fetchAndApplyGuidance({
      reason: GUIDANCE_REASON.RETURN_TO_TARGET,
      color: plan.selectedColor,
      tileKey: `${plan.target.tile_x}:${plan.target.tile_y}`,
      immediate: true,
    });
  }

  function handleSmartGuideAction() {
    const plan = smartPlanRef.current;
    if (!plan) return;
    void fetchAndApplyGuidance({
      reason: GUIDANCE_REASON.SAME_COLOR_NEXT,
      color: plan.globalRemainingForColor > 0 ? plan.selectedColor : null,
      recent: recentTargetsRef.current,
    });
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
    markFreeExploration();
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
    markFreeExploration();
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
    if (STROKE_METRICS_ENABLED && typeof window !== 'undefined') {
      // Diagnostic hook: expose the live client for e2e verification.
      window.__splintClient = client;
    }
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
      tilePreloadRef.current = null;
      if (minimapTimerRef.current != null) {
        clearTimeout(minimapTimerRef.current);
        minimapTimerRef.current = null;
      }
      if (viewportLoadTimerRef.current != null) {
        clearTimeout(viewportLoadTimerRef.current);
        viewportLoadTimerRef.current = null;
      }
      cancelCameraAnimation();
      cancelAutoAdvance();
      clearGuidanceIndexRetry();
      guidanceTokenRef.current += 1;
      if (wrongNoticeTimerRef.current) clearTimeout(wrongNoticeTimerRef.current);
      if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current);
      scheduleCameraSave(cameraRef.current);
      flushCameraSave();
      announcerRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, updateCamera]);

  useEffect(() => {
    const persistCameraBeforeHide = () => {
      scheduleCameraSave(cameraRef.current);
      flushCameraSave();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistCameraBeforeHide();
    };
    window.addEventListener('pagehide', persistCameraBeforeHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', persistCameraBeforeHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // The pending payload lives in refs; the listener is scoped to this artwork.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  useEffect(() => {
    initialCameraRef.current = false;
    resumeCameraRef.current = null;
    resumeCameraAppliedRef.current = false;
    resumeTargetRef.current = resumeSnapshot?.smartTarget || null;
    guidanceBootstrappedRef.current = false;
    smartPlanRef.current = null;
    smartStateRef.current = 'idle';
    setSmartState('idle');
    recentTargetsRef.current = [];
    targetRemainingRef.current = null;
    committedRevisionRef.current = 0;
    lodModeRef.current = GRID_LOD_MODE.OVERVIEW;
    setLodMode(GRID_LOD_MODE.OVERVIEW);
    guidanceTokenRef.current += 1;
    clearGuidanceIndexRetry();
    setErrorNotice(null);
    setInputNotice(null);
    cancelAutoAdvance();
    cancelCameraAnimation();
    previousSpecialOfferRef.current = null;
    setManifestReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const zoom = Math.min(
      1,
      (size.width * 0.9) / (manifest.grid.width * CELL_SIZE),
      (size.height * 0.66) / (manifest.grid.height * CELL_SIZE),
    );
    initialCameraRef.current = true;
    const storedCamera = restoreStoredCamera();
    if (storedCamera) {
      resumeCameraRef.current = storedCamera;
      resumeCameraAppliedRef.current = true;
      updateCamera(storedCamera);
    } else {
      updateCamera({
        x: (size.width - manifest.grid.width * CELL_SIZE * Math.max(MIN_ZOOM, zoom)) / 2,
        y: (size.height - manifest.grid.height * CELL_SIZE * Math.max(MIN_ZOOM, zoom)) / 2,
        zoom: Math.max(MIN_ZOOM, zoom),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestReady, size.height, size.width, updateCamera]);

  useEffect(() => {
    if (!manifestReady || guidanceBootstrappedRef.current || !size.width || !size.height) return;
    const manifest = clientRef.current?.getSnapshot().manifest;
    if (!manifest) return;
    guidanceBootstrappedRef.current = true;
    const savedTarget = resumeTargetRef.current;
    const savedTargetRevision = Number(resumeSnapshot?.smartTargetRevision);
    const currentRevision = Number(progress?.revision);
    const canRevalidateSavedTarget = savedTarget?.tileKey
      && Number.isSafeInteger(savedTargetRevision)
      && savedTargetRevision === currentRevision;
    void fetchAndApplyGuidance({
      reason: canRevalidateSavedTarget ? GUIDANCE_REASON.RETURN_TO_TARGET : GUIDANCE_REASON.INITIAL_TARGET,
      color: canRevalidateSavedTarget ? savedTarget.color ?? resumeSnapshot?.selectedColor : undefined,
      tileKey: canRevalidateSavedTarget ? savedTarget.tileKey : null,
      immediate: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestReady, size.height, size.width]);

  useEffect(() => {
    const revision = Number(progress?.revision);
    if (Number.isSafeInteger(revision) && revision >= 0 && revision > committedRevisionRef.current) {
      committedRevisionRef.current = revision;
    }
  }, [progress?.revision]);

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

  const viewportPlanKey = useMemo(() => {
    if (!manifestReady || !size.width || !size.height) return null;
    if (lodMode === GRID_LOD_MODE.OVERVIEW) return GRID_LOD_MODE.OVERVIEW;
    const manifest = clientRef.current?.getSnapshot().manifest;
    if (!manifest) return null;
    const plan = selectViewportTiles({
      grid: manifest.grid,
      camera,
      viewportWidth: size.width,
      viewportHeight: size.height,
      cellSize: CELL_SIZE,
      overscanCells: 1,
      overscanTiles: 1,
    });
    return `${GRID_LOD_MODE.WORK}:${plan.all.map((tile) => tile.key).join(',')}`;
  }, [camera, lodMode, manifestReady, size.height, size.width]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !viewportPlanKey) return undefined;
    if (viewportLoadTimerRef.current != null) {
      clearTimeout(viewportLoadTimerRef.current);
      viewportLoadTimerRef.current = null;
    }
    const controller = new AbortController();
    const start = () => {
      viewportLoadTimerRef.current = null;
      client.loadViewport({
        camera,
        viewportWidth: size.width,
        viewportHeight: size.height,
        cellSize: CELL_SIZE,
        mode: lodMode,
        overscanCells: 1,
        overscanTiles: 1,
        maxPrefetchTiles: 8,
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted) return;
        if (result.visible.length || result.prefetched.length) markFirstTile();
        for (const tile of [...result.visible, ...result.prefetched]) {
          guideIndexRef.current?.addTile(tile);
        }
        rebuildMinimapBase();
        drawMinimap();
      }).catch(() => {});
    };
    // Camera frames within one tile plan are coalesced by the key above. A
    // short settle window handles the remaining rapid pinch/animation frames
    // without delaying the overview path or direct painting requests.
    viewportLoadTimerRef.current = window.setTimeout(start, lodMode === GRID_LOD_MODE.WORK ? 80 : 0);
    return () => {
      if (viewportLoadTimerRef.current != null) {
        clearTimeout(viewportLoadTimerRef.current);
        viewportLoadTimerRef.current = null;
      }
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lodMode, viewportPlanKey]);

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
    const overviewMode = lodMode === GRID_LOD_MODE.OVERVIEW;
    const detailedCells = !overviewMode && cellPixels >= DETAILED_CELL_PIXELS;
    const previewImage = previewImageRef.current;
    if (!previewReady || !previewImage?.naturalWidth) {
      // Missing preview is a single uniform fallback, never a cache-shaped
      // mosaic. Filled cells from resident tiles are painted over it below.
      ctx.fillStyle = '#172735';
      ctx.fillRect(0, 0, template.width * CELL_SIZE, template.height * CELL_SIZE);
    }
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
    const visiblePlan = manifest && !overviewMode ? selectViewportTiles({
      grid: manifest.grid,
      camera,
      viewportWidth: size.width,
      viewportHeight: size.height,
      cellSize: CELL_SIZE,
      overscanCells: 1,
      overscanTiles: 0,
    }) : null;
    const visibleKeys = overviewMode ? null : new Set((visiblePlan?.visible || []).map((tile) => tile.key));
    const cellBounds = visiblePlan?.cellBounds || null;
    for (const tile of client.cache.values()) {
      if (!overviewMode && !visibleKeys.has(tile.key)) continue;
      if (!detailedCells) {
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
    if (specialTreatment && !overviewMode) {
      for (const tile of client.cache.values()) {
        if (!visibleKeys.has(tile.key)) continue;
        for (const special of tile.specials || []) {
          if (special.state !== 'unseen' || tile.filled[special.localIndex] !== -1) continue;
          const localX = special.localIndex % tile.width;
          const localY = Math.floor(special.localIndex / tile.width);
          const centerX = (tile.offsetX + localX) * CELL_SIZE + CELL_SIZE / 2;
          const centerY = (tile.offsetY + localY) * CELL_SIZE + CELL_SIZE / 2;
          const screenRadius = specialMarkerScreenRadius(cellPixels);
          drawSpecialMarker(ctx, special, centerX, centerY, screenRadius, camera.zoom, {
            state: special.id === smartPlanRef.current?.specialId ? 'active' : 'idle',
            phase: markerPhaseRef.current,
            reducedMotion,
          });
        }
      }
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
  }, [camera, hideNumbers, hintMode, interactionMode, keyboardCell, lodMode, previewReady, selectedColor, size.height, size.width, template.height, template.palette, template.width]);

  useLayoutEffect(() => { draw(); }, [draw, drawRevision, status, progress]);

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
      .catch((error) => {
        if (pendingCellRef.current?.key !== key) return;
        // A cancelled request is a viewport/camera race, not an unavailable
        // fragment: never surface it as a permanent failure.
        if (isAbortError(error)) return;
        pendingCellRef.current = null;
        setInputNotice('Фрагмент пока недоступен. Нажмите ещё раз.');
      });
  }

  function showWrongFeedback(cell) {
    const targetColor = cell?.target;
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
  }

  /**
   * Silent background preload for a tile the finger crossed into during a
   * drag. Does not touch pendingCellRef, the loading notice, or the minimap:
   * it only makes the tile resident so a return swipe paints instead of
   * queueing. `cell.loaded === false` inside a READY drag stays exceptional.
   */
  function preloadTileSilently(tileX, tileY) {
    const client = clientRef.current;
    if (!client) return;
    const key = `${tileX}:${tileY}`;
    if (client.cache.has(key)) return;
    if (tilePreloadRef.current?.has(key)) return;
    if (!tilePreloadRef.current) tilePreloadRef.current = new Set();
    tilePreloadRef.current.add(key);
    client.fetchTile(tileX, tileY)
      .then((tile) => {
        tilePreloadRef.current?.delete(key);
        if (tile && clientRef.current) guideIndexRef.current?.addTile(tile);
      })
      .catch(() => {
        tilePreloadRef.current?.delete(key);
      });
  }

  /**
   * Frame path: paints one optimistically painted cell with direct canvas ops
   * exactly like draw() renders a filled cell — synchronously in the pointer
   * event's own task, so the cell changes on screen before the browser paints
   * the next frame ("краска следует за пальцем"). No React, no network, no
   * guide/minimap work — the canonical full redraw happens on finalization.
   */
  function paintCellImmediate(index) {
    const canvas = canvasRef.current;
    const client = clientRef.current;
    if (!canvas || !client) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const x = index % template.width;
    const y = Math.floor(index / template.width);
    const cell = client.getCell(x, y);
    if (!cell?.loaded || cell.filled === -1) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const current = cameraRef.current;
    const cellPixels = CELL_SIZE * current.zoom;
    ctx.setTransform(dpr * current.zoom, 0, 0, dpr * current.zoom, dpr * current.x, dpr * current.y);
    ctx.fillStyle = template.palette[cell.filled] || '#24465a';
    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    if (cellPixels >= 4) {
      ctx.strokeStyle = '#0b131a';
      ctx.lineWidth = 1 / Math.max(current.zoom, 0.1);
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  function addStrokeCell(pointer, cell) {
    if (!pointer || !cell) return;
    pointer.rasterized += extendStroke(pointer, cell.index, {
      width: template.width,
      height: template.height,
      tileSize: 32,
      mode: interactionMode,
      getTile: (tileX, tileY) => clientRef.current?.cache.peek(`${tileX}:${tileY}`),
      onOutcome: (outcome) => {
        if (outcome.status === PAINT_STATUS.PAINTED) {
          paintCellImmediate(outcome.index);
          if (strokeMetricsRef.current) strokeMetricsRef.current.livePaints += 1;
        } else if (outcome.status === PAINT_STATUS.UNLOADED) preloadTileSilently(outcome.tileX, outcome.tileY);
      },
    });
    pointer.unique = pointer.indexSet.size;
  }

  /**
   * Deferred minimap: painted-cell refreshes are secondary to finger-to-paint
   * latency. Rebuild at most once shortly after a stroke instead of inline in
   * the finalization path.
   */
  function scheduleMinimapRebuild() {
    if (minimapTimerRef.current != null) return;
    minimapTimerRef.current = window.setTimeout(() => {
      minimapTimerRef.current = null;
      rebuildMinimapBase();
      drawMinimap();
    }, 120);
  }

  /**
   * Shared finalization: batch guide refresh once per changed tile (never one
   * full 32×32 scan per painted cell), defer the minimap, emit exactly one
   * application-level stroke and one canonical redraw.
   */
  function commitChanges(changes, { announce = false, wrongDetected = false, wrongCell = null, unloaded = [] } = {}) {
    if (specialOffer) {
      // A stroke must never be queued behind an unresolved offer. This guard
      // is a defensive boundary for a stroke that began just before the
      // offer response arrived; normal pointerdown is blocked below too.
      for (const change of changes) {
        const tile = clientRef.current?.cache.peek(change.tileKey);
        if (!tile) continue;
        const x = Number(change.index) % template.width;
        const y = Math.floor(Number(change.index) / template.width);
        const localX = x - tile.offsetX;
        const localY = y - tile.offsetY;
        const localIndex = localY * tile.width + localX;
        if (localIndex >= 0 && localIndex < tile.filled.length) tile.filled[localIndex] = -1;
      }
      cancelAutoAdvance();
      setInputNotice('Сначала завершите особое событие');
      return;
    }
    const client = clientRef.current;
    const changedTiles = new Set();
    for (const change of changes) changedTiles.add(change.tileKey);
    for (const tileKey of changedTiles) {
      const tile = client?.cache.peek(tileKey);
      if (tile) guideIndexRef.current?.refreshTile(tile);
    }
    scheduleMinimapRebuild();
    if (changes.length) {
      onFirstPaint?.();
      const commitMetrics = diagnosticsRef.current;
      if (commitMetrics) {
        commitMetrics.commits += 1;
        commitMetrics.lastCommitAt = performance.now();
      }
      const normalized = changes.map(({ index, to }) => ({ index, from: -1, to }));
      const special = specialTreatment
        ? changes.map((change) => client?.cache.peek(change.tileKey)?.specials || [])
          .flat()
          .find((candidate) => ['spark', 'bomb', 'fuse', 'choice', 'artifact', 'hazard'].includes(candidate.kind)
            && candidate.state === 'unseen'
            && changes.some((change) => change.index === candidate.cellIndex
              && change.to === client.cache.peek(`${Math.floor((candidate.cellIndex % template.width) / 32)}:${Math.floor(Math.floor(candidate.cellIndex / template.width) / 32)}`)?.cells[candidate.localIndex]))
        : null;
      const specialAction = special ? {
        type: `claim_${special.kind}`,
        special_id: special.id,
        cell_index: special.cellIndex,
        camera_center: guidanceCameraCenter(cameraRef.current, sizeRef.current, CELL_SIZE),
        experiment_group: 'treatment',
      } : null;
      onStrokeCommitted?.(normalized, {
        type: 'stroke',
        timestamp: Date.now(),
        changes: normalized,
        color: normalized[0].to,
      }, specialAction);
      try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
      } catch {
        // Haptics are optional.
      }
      if (interactionMode !== 'reveal') {
        const paintedInTarget = countPaintedCellsInTarget(
          smartPlanRef.current,
          normalized.map(({ index }) => ({ index })),
          template.width,
        );
        if (paintedInTarget > 0 && smartStateRef.current === 'ready') {
          targetRemainingRef.current = Math.max(0, (targetRemainingRef.current ?? 0) - paintedInTarget);
          setGuide((current) => (current ? { ...current, targetRemaining: targetRemainingRef.current } : current));
          if (targetRemainingRef.current === 0) {
            setSuccessNotice('Участок готов');
            if (successNoticeTimerRef.current) clearTimeout(successNoticeTimerRef.current);
            successNoticeTimerRef.current = setTimeout(() => setSuccessNotice(null), 1600);
            try {
              window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
            } catch {
              // Haptics are optional.
            }
            announcerRef.current?.announce('Участок готов');
            scheduleAutoAdvance();
          }
        }
      }
      redraw((value) => value + 1);
      if (announce) announcerRef.current?.announce(`Закрашено ${changes.length} клеток`);
    } else if (wrongDetected && wrongCell) {
      showWrongFeedback(wrongCell);
    } else if (unloaded.length) {
      const firstIndex = unloaded[0];
      ensureCellLoaded({
        index: firstIndex,
        x: firstIndex % template.width,
        y: Math.floor(firstIndex / template.width),
        tileX: Math.floor((firstIndex % template.width) / 32),
        tileY: Math.floor(Math.floor(firstIndex / template.width) / 32),
      });
    }
  }

  /**
   * Pointerup / pointercancel: finalize the optimistically painted stroke.
   * Cells were already mutated and drawn live; here we settle guide summaries,
   * minimap, the save queue and one canonical redraw — no network in the path.
   */
  function finalizePointerStroke(event) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    const endAt = performance.now();
    const metrics = strokeMetricsRef.current;
    if (metrics) {
      metrics.strokes.push({
        startedAt: pointer.startedAt,
        endedAt: endAt,
        durationMs: endAt - pointer.startedAt,
        events: pointer.events,
        rasterized: pointer.rasterized,
        unique: pointer.unique,
        painted: pointer.changes.length,
        wrong: pointer.wrongDetected,
        unloaded: pointer.unloadedCells.length,
        maxEventMs: pointer.maxEventMs,
        first: pointer.changes[0]?.index ?? null,
        last: pointer.changes[pointer.changes.length - 1]?.index ?? null,
        color: pointer.color,
        finalizeMs: 0,
      });
      const record = metrics.strokes[metrics.strokes.length - 1];
      const finalizeStart = performance.now();
      commitChanges(pointer.changes, {
        wrongDetected: pointer.wrongDetected,
        wrongCell: pointer.wrongCell,
        unloaded: pointer.unloadedCells,
      });
      record.finalizeMs = performance.now() - finalizeStart;
    } else {
      commitChanges(pointer.changes, {
        wrongDetected: pointer.wrongDetected,
        wrongCell: pointer.wrongCell,
        unloaded: pointer.unloadedCells,
      });
    }
  }

  /**
   * Synchronous single-shot commit (keyboard paint, tap-after-tile-load):
   * validates and paints each index, then runs the same finalization.
   */
  function commitIndices(indices, { announce = false } = {}) {
    const client = clientRef.current;
    if (!client || !indices.length) return;
    const pointer = {
      color: interactionMode === 'reveal' ? 0 : selectedColorRef.current,
      changes: [],
      dirtyTiles: new Set(),
      unloadedCells: [],
      wrongDetected: false,
      wrongCell: null,
    };
    for (const index of indices) {
      const outcome = paintStrokeIndex(pointer, index, {
        width: template.width,
        tileSize: 32,
        mode: interactionMode,
        getTile: (tileX, tileY) => client.cache.peek(`${tileX}:${tileY}`),
      });
      if (outcome.status === PAINT_STATUS.UNLOADED && !pointer.firstUnloaded) pointer.firstUnloaded = index;
    }
    commitChanges(pointer.changes, {
      announce,
      wrongDetected: pointer.wrongDetected,
      wrongCell: pointer.wrongCell,
      unloaded: pointer.firstUnloaded != null ? [pointer.firstUnloaded] : pointer.unloadedCells,
    });
  }

  function updateTouchGesture() {
    // A second finger means pinch-zoom: commit any in-flight optimistically
    // painted stroke first so painted cells are never lost from the durable
    // save when the interaction switches to camera control.
    const activePointer = pointerRef.current;
    if (activePointer) {
      pointerRef.current = null;
      commitChanges(activePointer.changes, {
        wrongDetected: activePointer.wrongDetected,
        wrongCell: activePointer.wrongCell,
        unloaded: activePointer.unloadedCells,
      });
    }
    const points = [...touchPointersRef.current.values()];
    if (points.length < 2) return;
    markInteraction();
    markFreeExploration();
    const midpoint = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
    const previous = gestureRef.current;
    if (!previous.active) {
      gestureRef.current = { active: true, midpoint, distance };
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
    if (specialOffer) {
      event.preventDefault();
      cancelAutoAdvance();
      setInputNotice('Сначала завершите особое событие');
      return;
    }
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
    // Validate the first cell at touch time: a wrong-color touch gets one
    // immediate bounded notice instead of a deferred pointerup one, and an
    // already-painted cell does not start a stroke.
    if (interactionMode !== 'reveal' && current.target !== selectedColorRef.current) {
      showWrongFeedback(current);
      if (event.pointerType === 'touch') touchPointersRef.current.delete(event.pointerId);
      return;
    }
    if (current.filled !== -1) return;
    const strokeColor = interactionMode === 'reveal' ? current.target : selectedColorRef.current;
    const now = performance.now();
    const pointer = {
      pointerId: event.pointerId,
      color: strokeColor,
      lastIndex: cell.index,
      indexSet: new Set([cell.index]),
      changes: [{ index: cell.index, tileKey: cell.tileKey, to: strokeColor }],
      dirtyTiles: new Set([cell.tileKey]),
      unloadedCells: [],
      wrongDetected: false,
      wrongCell: null,
      startedAt: now,
      events: 0,
      rasterized: 0,
      unique: 1,
      maxEventMs: 0,
    };
    pointerRef.current = pointer;
    // Live optimistic paint of the first cell: mutate the authoritative local
    // tile and draw it on the next frame — no React, no network, no waiting.
    const tile = clientRef.current?.cache.peek(cell.tileKey);
    if (tile) tile.filled[cell.localIndex] = strokeColor;
    paintCellImmediate(cell.index);
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
      markFreeExploration();
      const pan = panRef.current;
      const current = cameraRef.current;
      updateCamera({ ...current, x: current.x + event.clientX - pan.x, y: current.y + event.clientY - pan.y });
      panRef.current = { ...pan, x: event.clientX, y: event.clientY };
      return;
    }
    const pointer = pointerRef.current;
    if (pointer?.pointerId !== event.pointerId) return;
    event.preventDefault();
    markInteraction();
    pointer.events += 1;
    if (strokeMetricsRef.current) strokeMetricsRef.current.pointerEvents += 1;
    const eventStart = performance.now();
    // Coalesced pointer samples (Android/Chrome fast swipes): process the raw
    // samples so a fast stroke is rasterized contiguously. Bounded to 16 to
    // avoid pathological batches.
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
    const sampleCount = coalesced?.length ? Math.min(coalesced.length, 16) : 1;
    const rect = viewportRef.current?.getBoundingClientRect();
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = coalesced ? coalesced[i] : event;
      if (!rect || !clientRef.current) break;
      const cell = clientRef.current.mapPointer({
        clientX: sample.clientX,
        clientY: sample.clientY,
        rect,
        camera,
        cellSize: CELL_SIZE,
      });
      addStrokeCell(pointer, cell);
    }
    const eventTime = performance.now() - eventStart;
    if (eventTime > pointer.maxEventMs) pointer.maxEventMs = eventTime;
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
    finalizePointerStroke(event);
  }

  function zoomAt(factor) {
    markFreeExploration();
    const nextZoom = clamp(camera.zoom * factor, MIN_ZOOM, 4);
    updateCamera({
      x: size.width / 2 - (size.width / 2 - camera.x) * (nextZoom / camera.zoom),
      y: size.height / 2 - (size.height / 2 - camera.y) * (nextZoom / camera.zoom),
      zoom: nextZoom,
    });
  }

  function jumpToZone(zone) {
    markFreeExploration();
    const fitZoom = clamp(
      Math.min(
        (size.width * 0.78) / (zone.width * CELL_SIZE),
        (size.height * 0.56) / (zone.height * CELL_SIZE),
      ),
      MIN_ZOOM,
      4,
    );
    const zoom = clamp(Math.max(fitZoom, WORK_ZOOM), MIN_ZOOM, 2);
    const focusX = zone.x + zone.width / 2;
    const focusY = zone.y + zone.height / 2;
    updateCamera({
      x: size.width / 2 - focusX * CELL_SIZE * zoom,
      y: size.height / 2 - focusY * CELL_SIZE * zoom,
      zoom,
    });
    announcerRef.current?.announce(`Открыта зона ${zone.id + 1}`);
  }

  function handleColorSelect(colorIndex) {
    onSelectColor(colorIndex);
    selectedColorRef.current = colorIndex;
    if (interactionMode === 'reveal') return;
    cancelAutoAdvance();
    announcerRef.current?.announce(`Выбран цвет ${colorIndex + 1}`);
    void fetchAndApplyGuidance({
      reason: GUIDANCE_REASON.MANUAL_COLOR,
      color: colorIndex,
      recent: recentTargetsRef.current,
    });
  }

  function advanceGuide() {
    handleSmartGuideAction();
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
    markFreeExploration();
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
        markFreeExploration();
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
  const tileErrorCount = Object.keys(clientRef.current?.getSnapshot().tileErrors || {}).length;

  const retry = () => {
    const client = clientRef.current;
    if (!client) return;
    client.loadManifest({ signal: undefined }).then(() => {
      setManifestReady(true);
      updateCamera({ ...cameraRef.current });
    }).catch(() => {});
  };

  const retryTileErrors = () => {
    const client = clientRef.current;
    if (!client || !tileErrorCount) return;
    setInputNotice('Повторяем недоступные фрагменты…');
    client.retryFailedTiles()
      .finally(() => setInputNotice(null));
  };

  return (
    <div
      className="progressive-coloring-session"
      data-artwork-id={template.id}
      data-grid-width={template.width}
      data-grid-height={template.height}
      data-lod-mode={lodMode}
      data-tile-error-count={tileErrorCount}
      data-smart-state={smartState}
      data-smart-color={smartPlanRef.current?.selectedColor == null ? '' : smartPlanRef.current.selectedColor}
      data-smart-target-tile={smartPlanRef.current?.target == null
        ? ''
        : `${smartPlanRef.current.target.tile_x}:${smartPlanRef.current.target.tile_y}`}
      data-smart-target-x={smartPlanRef.current?.target?.anchor_x == null ? '' : smartPlanRef.current.target.anchor_x}
      data-smart-target-y={smartPlanRef.current?.target?.anchor_y == null ? '' : smartPlanRef.current.target.anchor_y}
      data-special-treatment={specialTreatment ? 'treatment' : 'control'}
      data-special-generation-version={specialDiagnostics?.generation_version ?? ''}
      data-special-count={specialDiagnostics?.special_count ?? ''}
      data-special-active={specialCellsSnapshot?.active_special?.present ? 'true' : ''}
      data-special-cohort-override={specialCellsSnapshot?.override ? 'true' : ''}
      data-special-counts-by-kind={specialCellsSnapshot?.by_type?.server
        ? Object.entries(specialCellsSnapshot.by_type.server)
          .filter(([, count]) => Number(count || 0) > 0)
          .map(([kind, count]) => `${kind}:${count}`)
          .join(',')
        : ''}
      data-special-visible-count={specialCellsSnapshot?.visible?.length ?? ''}
      data-special-last-error-code={specialCellsSnapshot?.last_error?.code ?? ''}
      data-special-pity-due={specialDiagnostics?.pity_due == null ? '' : String(Boolean(specialDiagnostics.pity_due))}
      data-special-cells-to-pity={specialDiagnostics?.cells_to_next_pity_boundary ?? ''}
      data-special-unseen={specialDiagnostics?.counts_by_status?.unseen ?? ''}
      data-special-offered={specialDiagnostics?.counts_by_status?.offered ?? ''}
      data-special-consumed={specialDiagnostics?.counts_by_status?.consumed ?? ''}
      data-special-skipped={specialDiagnostics?.counts_by_status?.skipped ?? ''}
      data-special-offer-kind={specialOffer?.kind || ''}
      data-special-offer-supported={specialOffer
        ? (specialOffer.kind
          ? String(Boolean(specialKindVisual(specialOffer.kind).supported))
          : 'true')
        : ''}
      data-smart-target-min-x={smartPlanRef.current?.target?.bounds?.min_x == null ? '' : smartPlanRef.current.target.bounds.min_x}
      data-smart-target-min-y={smartPlanRef.current?.target?.bounds?.min_y == null ? '' : smartPlanRef.current.target.bounds.min_y}
      data-smart-target-max-x={smartPlanRef.current?.target?.bounds?.max_x == null ? '' : smartPlanRef.current.target.bounds.max_x}
      data-smart-target-max-y={smartPlanRef.current?.target?.bounds?.max_y == null ? '' : smartPlanRef.current.target.bounds.max_y}
    >
      <div
        className="player-canvas-area progressive-grid-area"
        ref={viewportRef}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(event) => {
          // Finalize whatever was optimistically painted: a system gesture
          // interruption must not discard visually committed cells.
          finalizePointerStroke(event);
          panRef.current = null;
          if (event.pointerType === 'touch') touchPointersRef.current.delete(event.pointerId);
          if (touchPointersRef.current.size === 0) gestureRef.current = { active: false, midpoint: null, distance: 0 };
        }}
        onWheel={(event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.1 : 0.91); }}
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
        {(status === PROGRESSIVE_GRID_STATUS.OFFLINE || status === PROGRESSIVE_GRID_STATUS.ERROR) && !manifestReady && <div className="progressive-grid-status progressive-grid-error"><span>{error?.message || 'Фрагмент пока недоступен'}</span><button type="button" onClick={retry}><RotateCw size={15} /> Повторить</button></div>}
        {manifestReady && lodMode === GRID_LOD_MODE.WORK && tileErrorCount > 0 && <div className="progressive-grid-tile-warning" role="status" aria-live="polite">
          <span>{tileErrorCount} фрагм. временно недоступно</span>
          <button type="button" onClick={retryTileErrors}><RotateCw size={14} /> Повторить</button>
        </div>}
        {previewReady && !hasLoadedTiles && lodMode === GRID_LOD_MODE.WORK && <div className="progressive-grid-preview" aria-live="polite">
          <img src={previewImageRef.current?.src} alt="Предварительный обзор изображения" draggable={false} />
          <span>Обзор карты · фрагменты поля загружаются для раскрашивания</span>
        </div>}
        {inputNotice && <div className="progressive-grid-input-notice" role="status" aria-live="polite">{inputNotice}</div>}
        {smartState === 'loadingTarget' && <div className="progressive-grid-status" role="status"><LoaderCircle className="spin" size={18} /> Загружаем участок…</div>}
        {smartState === 'errorRetryable' && errorNotice && (
          <div className="progressive-grid-status progressive-grid-error" data-smart-error="true" role="alert">
            <span>{errorNotice}</span>
            <button type="button" onClick={retrySmartGuidance}><RotateCw size={15} /> Повторить</button>
            <button type="button" onClick={() => { setErrorNotice(null); setInputNotice(null); markFreeExploration(); }}>Свободный просмотр</button>
          </div>
        )}
        {specialTreatment && specialOffer && (
          <SpecialOfferPanel
            key={specialOffer.special_id || specialOffer.offer_token || 'special-offer'}
            specialOffer={specialOffer}
            onSpecialAction={onSpecialAction}
            cameraRef={cameraRef}
            sizeRef={sizeRef}
            clientRef={clientRef}
          />
        )}
        {sparkWave && (
          <div
            className="progressive-grid-special-wave"
            role="status"
            data-special-wave
            data-special-wave-kind="spark"
            data-special-wave-cells={String(sparkWave.cells)}
          >
            <span className="progressive-grid-special-wave-ring" aria-hidden="true" />
            <span>
              <b>Spark wave</b>
              <small>{sparkWave.cells} cells filled by the selected target</small>
            </span>
          </div>
        )}
        {specialTreatment && specialDiscovered && !specialOffer && (
          <div
            className="progressive-grid-special-discovered"
            role="status"
            data-special-discovered
            data-artifact-progress={specialDiscovered.kind === 'artifact' ? '' : undefined}
            data-artifact-fragments={specialDiscovered.kind === 'artifact' ? String(specialDiscovered.artifact_fragments || 1) : undefined}
            data-artifact-total={specialDiscovered.kind === 'artifact' ? '3' : undefined}
          >
            {specialDiscovered.kind === 'artifact'
              ? `Артефакт: фрагмент ${specialDiscovered.artifact_fragments || 1}/3`
              : specialDiscovered.kind === 'hazard' && specialDiscovered.missed
                ? 'Опасность пропущена: небольшая локальная пауза'
                : `${specialDiscovered.kind || 'Spark'} найден`}
          </div>
        )}
        {specialTreatment && artifactProgress && artifactProgress.fragments > 0
          && !specialOffer && !specialDiscovered && (
          <div
            className="progressive-grid-special-discovered"
            role="status"
            data-artifact-progress
            data-special-discovered=""
            data-artifact-fragments={String(artifactProgress.fragments)}
            data-artifact-total={String(artifactProgress.total || 3)}
          >
            {artifactProgress.complete
              ? `Артефакт собран`
              : `Артефакт: фрагмент ${artifactProgress.fragments}/${artifactProgress.total || 3}`}
          </div>
        )}
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
            <div data-diagnostic-specials><b style={{ color: '#fff' }}>specials:</b> {specialTreatment ? 'T' : 'C'}
              {' '}v{specialDiagnostics?.generation_version ?? '-'} · {specialDiagnostics?.special_count ?? 0}</div>
            <div><b style={{ color: '#aaa' }}>state:</b> u{specialDiagnostics?.counts_by_status?.unseen ?? 0}
              {' '}o{specialDiagnostics?.counts_by_status?.offered ?? 0}
              {' '}c{specialDiagnostics?.counts_by_status?.consumed ?? 0}
              {' '}s{specialDiagnostics?.counts_by_status?.skipped ?? 0}</div>
            <div><b style={{ color: '#aaa' }}>active:</b> {specialCellsSnapshot?.active_special?.present ? 'yes' : '-'}
              {' '}· pity {specialDiagnostics?.pity_due ? 'due' : (specialDiagnostics?.cells_to_next_pity_boundary ?? '-')}</div>
          </div>
        )}
        {specialCellsSnapshot && <SpecialCellsDevHud snapshot={specialCellsSnapshot} />}
        {guide && (
          <div
            className="progressive-grid-guide"
            data-guide-color={guide.color == null ? '' : guide.color}
            data-guide-remaining={guide.remaining}
            data-guide-target-remaining={guide.targetRemaining == null ? '' : guide.targetRemaining}
          >
            <span
              className="progressive-grid-guide-dot"
              style={guide.color == null ? undefined : { background: template.palette[guide.color] }}
              aria-hidden="true"
            />
            <span>{interactionMode === 'reveal'
              ? `Видно клеток: ${guide.remaining}`
              : guide.targetRemaining == null
                ? `Цвет ${guide.color + 1} · осталось ${guide.remaining}`
                : `Цвет ${guide.color + 1} · осталось ${guide.remaining} · участок ${guide.targetRemaining}`}</span>
            <button type="button" onClick={advanceGuide} aria-label="К следующему участку">
              Дальше
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
          {smartState === 'freeExploration' && smartPlanRef.current?.target && (
            <button
              type="button"
              className="progressive-grid-return"
              onClick={returnToTarget}
              aria-label="Вернуться к цели"
              title="Вернуться к цели"
              data-return-target
            >
              <Crosshair size={16} />
            </button>
          )}
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
