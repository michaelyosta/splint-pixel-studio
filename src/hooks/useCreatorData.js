import { useEffect, useRef, useState } from 'react';
import { api, metaApi } from '../api/client';
import { buildColoringFromImage } from '../lib/pixelColoring';
import {
  CREATOR_PREVIEW_RESOLUTIONS,
  buildCreatorPreviewError,
  buildCreatorPreviewCacheKey,
  deriveCreatorPreviewInsights,
  isCreatorPreviewCurrent,
  renderCreatorNumberGridPreview,
  renderFitPreview,
  renderImageCropPreview,
} from '../lib/imageCrop';
import { createCreatorWorkerClient } from '../lib/creatorWorkerClient';
import { createTiledTemplateAsync } from '../lib/tiledTemplate';

// The previous 192×192/10-colour default flattened faces, lettering, and
// silhouettes before the player ever saw the real number grid. 512×512 keeps
// materially more structure while remaining within the bounded creator
// contract; 192 remains available when a deliberately simpler painting is
// preferred.
const DEFAULT_CREATOR_RESOLUTION = CREATOR_PREVIEW_RESOLUTIONS[1];
// Pixelization R&D can replace the candidate without changing preview/save
// semantics. Until that review closes, the selected preset remains an
// explicit integration switch rather than a creator-flow assumption.
const CREATOR_STYLE_PRESET = import.meta.env.VITE_CREATOR_PREVIEW_STYLE_PRESET?.trim() || null;

function emptyPreviewOption(resolution) {
  return {
    resolution,
    status: 'idle',
    progress: 0,
    stage: null,
    error: null,
    pixel: null,
    numbered: null,
    palette: [],
    metrics: null,
    insights: null,
    pipelineVersion: null,
    resultFingerprint: null,
    previewPixelFingerprint: null,
  };
}

function emptyCreatorPreviews(selectedResolution = DEFAULT_CREATOR_RESOLUTION) {
  return {
    original: null,
    selectedResolution,
    options: Object.fromEntries(
      CREATOR_PREVIEW_RESOLUTIONS.map((resolution) => [resolution, emptyPreviewOption(resolution)]),
    ),
  };
}

function asPreviewSummary(data) {
  const { width, height, palette, cells, metrics = {}, previewDataUrl = null } = data;
  const resultFingerprint = data.resultFingerprint || null;
  return {
    resolution: width,
    width,
    height,
    status: 'ready',
    progress: 1,
    stage: 'done',
    error: null,
    pixel: previewDataUrl,
    numbered: renderCreatorNumberGridPreview(width, height, palette, cells),
    palette,
    metrics,
    insights: deriveCreatorPreviewInsights({ width, height, palette, cells, metrics }),
    pipelineVersion: data.pipelineVersion,
    stylePreset: data.stylePreset,
    resultFingerprint,
    previewPixelFingerprint: data.previewPixelFingerprint || null,
  };
}

export function useCreatorData({ showNotice, onLoadMine, onLoadCatalog, onNavigate }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('Моя пиксельная раскраска');
  const [creating, setCreating] = useState(false);
  const [creatorGrid, setCreatorGridState] = useState({
    width: DEFAULT_CREATOR_RESOLUTION,
    height: DEFAULT_CREATOR_RESOLUTION,
  });
  const [creatorColors, setCreatorColors] = useState(16);
  const [creatorCrop, setCreatorCrop] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [creatorCropMode, setCreatorCropMode] = useState('fit');
  const [creatorImageUrl, setCreatorImageUrl] = useState(null);
  const [creatorResult, setCreatorResult] = useState(null);
  const [creatorQuality, setCreatorQuality] = useState(null);
  const [creatorPreviews, setCreatorPreviews] = useState(() => emptyCreatorPreviews());
  const [creatorComputing, setCreatorComputing] = useState(false);
  const [createdColoring, setCreatedColoring] = useState(null);

  const creatorComputeRef = useRef(0);
  const creatorFileRef = useRef(null);
  const creatorFileTokenRef = useRef('no-file');
  const creatorTimerRef = useRef(null);
  const creatorWorkerRef = useRef(null);
  const creatorWorkerInitializedRef = useRef(false);
  const creatorCacheRef = useRef(new Map());
  const creatorFullResultRef = useRef(null);
  const creatorGridRef = useRef(creatorGrid);
  const creatorImageUrlRef = useRef(null);
  const computeRef = useRef(null);

  if (!creatorWorkerInitializedRef.current) {
    creatorWorkerRef.current = createCreatorWorkerClient();
    creatorWorkerInitializedRef.current = true;
  }

  useEffect(() => {
    creatorGridRef.current = creatorGrid;
  }, [creatorGrid]);

  useEffect(() => () => {
    window.clearTimeout(creatorTimerRef.current);
    creatorComputeRef.current += 1;
    creatorWorkerRef.current?.dispose();
    if (creatorImageUrlRef.current) URL.revokeObjectURL(creatorImageUrlRef.current);
  }, []);

  useEffect(() => {
    if (!creatorImageUrl) return undefined;
    window.clearTimeout(creatorTimerRef.current);
    const batchId = ++creatorComputeRef.current;
    creatorWorkerRef.current?.cancel();
    creatorCacheRef.current.clear();
    creatorFullResultRef.current = null;
    setCreatorResult(null);
    setCreatorQuality(null);
    // Crop changes invalidate the source crop as well as the converted cells.
    // Rebuilding the bounded source preview on a colors-only change is cheap
    // and avoids preserving a stale crop through this shared invalidation path.
    setCreatorPreviews(emptyCreatorPreviews(creatorGridRef.current.width));
    creatorTimerRef.current = window.setTimeout(() => {
      computeRef.current?.({ batchId });
    }, 450);
    return () => window.clearTimeout(creatorTimerRef.current);
  }, [creatorColors, creatorCrop, creatorCropMode, creatorImageUrl]);

  async function runPreviewPipeline(sourceFile, options, batchId, onProgress) {
    // Large previews run in a worker, so yielding every 24 cells only adds
    // tens of thousands of timer turnarounds to the region cleanup pass.
    // Keep cancellation/progress responsive while using a bounded chunk for
    // the 512/1200 creator presets.
    const previewArea = Number(options.width || 0) * Number(options.height || 0);
    const pipelineOptions = {
      ...options,
      mode: 'preview',
      includeOriginalDataUrl: false,
      ...(previewArea >= 200_000 ? { yieldEvery: 2048 } : {}),
      ...(CREATOR_STYLE_PRESET ? { stylePreset: CREATOR_STYLE_PRESET } : {}),
    };
    if (creatorWorkerRef.current) {
      try {
        return await creatorWorkerRef.current.run(sourceFile, pipelineOptions, { onProgress });
      } catch (workerError) {
        if (workerError?.name === 'AbortError') throw workerError;
        creatorWorkerRef.current.dispose();
        creatorWorkerRef.current = null;
      }
    }
    return buildColoringFromImage(sourceFile, {
      ...pipelineOptions,
      yieldEvery: 96,
      shouldCancel: () => !isCreatorPreviewCurrent(batchId, creatorComputeRef.current),
      onProgress,
    });
  }

  function setPreviewOption(resolution, updater) {
    setCreatorPreviews((previous) => ({
      ...previous,
      options: {
        ...previous.options,
        [resolution]: typeof updater === 'function'
          ? updater(previous.options[resolution] || emptyPreviewOption(resolution))
          : updater,
      },
    }));
  }

  function markPreviewError(resolution, error, batchId) {
    if (error?.name === 'AbortError' || !isCreatorPreviewCurrent(batchId, creatorComputeRef.current)) return;
    setPreviewOption(resolution, (previous) => buildCreatorPreviewError(previous, error));
  }

  async function loadSourcePreview(sourceFile, crop, batchId) {
    const objectUrl = URL.createObjectURL(sourceFile);
    try {
      const image = new window.Image();
      image.src = objectUrl;
      await image.decode();
      if (!isCreatorPreviewCurrent(batchId, creatorComputeRef.current)) return;
      const original = crop
        ? renderImageCropPreview(image, { ...creatorCrop, size: 512 })
        : renderFitPreview(image, 512);
      setCreatorPreviews((previous) => ({ ...previous, original }));
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function computeResolution(sourceFile, resolution, batchId, { retain = false } = {}) {
    if (!isCreatorPreviewCurrent(batchId, creatorComputeRef.current)) return null;
    const crop = creatorCropMode === 'crop' ? creatorCrop : null;
    const cacheKey = buildCreatorPreviewCacheKey({
      fileToken: creatorFileTokenRef.current,
      width: resolution,
      colors: creatorColors,
      cropMode: creatorCropMode,
      crop,
      stylePreset: CREATOR_STYLE_PRESET || 'pipeline-default',
    });
    const cached = creatorCacheRef.current.get(cacheKey);
    if (cached) setPreviewOption(resolution, cached.summary);

    setPreviewOption(resolution, (previous) => ({
      ...previous,
      status: 'computing',
      progress: 0,
      stage: 'prepare',
      error: null,
    }));
    const data = await runPreviewPipeline(sourceFile, {
      width: resolution,
      height: resolution,
      colors: creatorColors,
      crop,
    }, batchId, (progress) => {
      if (!isCreatorPreviewCurrent(batchId, creatorComputeRef.current)) return;
      setPreviewOption(resolution, (previous) => ({
        ...previous,
        status: 'computing',
        stage: progress?.stage || previous.stage,
        progress: Number(progress?.progress || 0),
      }));
    });
    if (!isCreatorPreviewCurrent(batchId, creatorComputeRef.current)) return null;
    const summary = asPreviewSummary(data);
    const full = {
      ...data,
      originalDataUrl: null,
      previewDataUrl: summary.pixel,
      resultFingerprint: summary.resultFingerprint,
      previewPixelFingerprint: summary.previewPixelFingerprint,
    };
    // Only bounded previews and statistics are cached across choices. The
    // cell array for exactly one selected result lives in creatorFullResultRef.
    creatorCacheRef.current.set(cacheKey, { summary });
    setPreviewOption(resolution, summary);
    if (retain) {
      creatorFullResultRef.current = full;
      setCreatorResult(full);
      setCreatorQuality(summary.insights?.paintability || null);
    }
    return full;
  }

  async function computeCreatorPreview({ batchId = null } = {}) {
    const sourceFile = creatorFileRef.current || file;
    if (!sourceFile) return;
    const activeBatch = batchId ?? ++creatorComputeRef.current;
    if (batchId == null) {
      creatorWorkerRef.current?.cancel();
      creatorFullResultRef.current = null;
      setCreatorResult(null);
    }
    const selectedResolution = creatorGridRef.current.width;
    setCreatorComputing(true);
    try {
      const crop = creatorCropMode === 'crop' ? creatorCrop : null;
      if (!creatorPreviews.original) await loadSourcePreview(sourceFile, crop, activeBatch);
      await computeResolution(sourceFile, selectedResolution, activeBatch, { retain: true });
    } catch (error) {
      markPreviewError(selectedResolution, error, activeBatch);
      if (error?.name !== 'AbortError' && isCreatorPreviewCurrent(activeBatch, creatorComputeRef.current)) {
        showNotice(error.message || 'Не удалось обработать изображение', 'error');
      }
    } finally {
      if (isCreatorPreviewCurrent(activeBatch, creatorComputeRef.current)) setCreatorComputing(false);
    }
  }
  computeRef.current = computeCreatorPreview;

  function selectCreatorGrid(nextGrid) {
    const resolution = Number(nextGrid?.width);
    if (!CREATOR_PREVIEW_RESOLUTIONS.includes(resolution)) return;
    const next = { width: resolution, height: resolution };
    creatorGridRef.current = next;
    setCreatorGridState(next);
    setCreatorPreviews((previous) => ({
      ...previous,
      selectedResolution: resolution,
      options: Object.fromEntries(Object.entries(previous.options).map(([key, option]) => [
        key,
        option.status === 'computing' && Number(key) !== resolution
          ? { ...option, status: 'idle', progress: 0, stage: null }
          : option,
      ])),
    }));
    const retained = creatorFullResultRef.current;
    if (retained?.width === resolution && retained.resultFingerprint) {
      setCreatorResult(retained);
      return;
    }
    creatorFullResultRef.current = null;
    setCreatorResult(null);
    if (!creatorFileRef.current) return;
    const batchId = ++creatorComputeRef.current;
    creatorWorkerRef.current?.cancel();
    setCreatorComputing(true);
    computeResolution(creatorFileRef.current, resolution, batchId, { retain: true })
      .catch((error) => {
        markPreviewError(resolution, error, batchId);
        if (error?.name !== 'AbortError' && isCreatorPreviewCurrent(batchId, creatorComputeRef.current)) {
          showNotice(error.message || 'Не удалось построить выбранный вариант', 'error');
        }
      })
      .finally(() => {
        if (isCreatorPreviewCurrent(batchId, creatorComputeRef.current)) setCreatorComputing(false);
      });
  }

  async function prepareFromImage(selectedFile) {
    const imageFile = selectedFile || file;
    if (!imageFile) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(imageFile.type) || imageFile.size > 10 * 1024 * 1024) {
      showNotice('Поддерживаются PNG, JPG и WebP размером до 10 МБ', 'error');
      return;
    }
    creatorFileRef.current = imageFile;
    creatorFileTokenRef.current = `${imageFile.name}:${imageFile.size}:${imageFile.lastModified}`;
    if (creatorImageUrlRef.current) URL.revokeObjectURL(creatorImageUrlRef.current);
    const url = URL.createObjectURL(imageFile);
    creatorImageUrlRef.current = url;
    setCreatorImageUrl(url);
    setCreatorResult(null);
    setCreatorQuality(null);
    setCreatorPreviews(emptyCreatorPreviews(creatorGridRef.current.width));
    setCreatorCrop({ scale: 1, offsetX: 0, offsetY: 0 });
    setCreatorCropMode('fit');
  }

  function handleFileSelected(selected) {
    creatorFileRef.current = selected;
    setFile(selected);
    setTitle('Моя пиксельная раскраска');
    if (selected) prepareFromImage(selected).then(() => computeRef.current?.());
  }

  async function saveDraftColoring() {
    const selected = creatorFullResultRef.current;
    const selectedResolution = creatorGridRef.current.width;
    const preview = creatorPreviews.options[selectedResolution];
    if (!selected
      || selected.width !== selectedResolution
      || !selected.resultFingerprint
      || selected.resultFingerprint !== preview?.resultFingerprint
      || (preview?.previewPixelFingerprint
        && selected.previewPixelFingerprint !== preview.previewPixelFingerprint)) {
      showNotice('Сначала дождитесь точного превью выбранной детализации', 'error');
      return;
    }
    setCreating(true);
    try {
      const tiled = await createTiledTemplateAsync({
        width: selected.width,
        height: selected.height,
        palette: selected.palette,
        cells: selected.cells,
      }, { yieldEvery: 8 });
      const payload = {
        title,
        description: 'Создано из пользовательского изображения',
        width: selected.width,
        height: selected.height,
        palette: selected.palette,
        previewDataUrl: selected.previewDataUrl,
        originalDataUrl: null,
        storageMode: 'tiled',
        tiles: tiled.tiles,
        tileSize: 32,
        pipelineVersion: selected.pipelineVersion,
        stylePreset: selected.stylePreset,
        resultFingerprint: selected.resultFingerprint,
        previewPixelFingerprint: preview.previewPixelFingerprint,
        metrics: selected.metrics,
      };
      const created = await api('/colorings/create', { method: 'POST', body: payload });
      const successPreview = created.preview_url || selected.previewDataUrl || preview.pixel || null;
      setCreatorResult(null);
      creatorFullResultRef.current = null;
      setFile(null);
      creatorFileRef.current = null;
      if (creatorImageUrlRef.current) URL.revokeObjectURL(creatorImageUrlRef.current);
      creatorImageUrlRef.current = null;
      setCreatorImageUrl(null);
      setCreatorPreviews(emptyCreatorPreviews());
      setCreatorQuality(null);
      await onLoadMine();
      metaApi.track('create_coloring', {
        id: created.id,
        resolution: selectedResolution,
        pipelineVersion: selected.pipelineVersion,
        resultFingerprint: selected.resultFingerprint,
      });
      setCreatedColoring({ id: created.id, title: created.title || title, previewUrl: successPreview });
      onNavigate('created');
    } catch (error) {
      showNotice(error.message || 'Не удалось сохранить раскраску', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function saveManualColoring(payload) {
    setCreating(true);
    try {
      const created = await api('/colorings/create', {
        method: 'POST',
        body: { description: 'Нарисовано вручную в Splint Pixel Studio', ...payload },
      });
      await Promise.all([onLoadMine(), onLoadCatalog()]);
      metaApi.track('create_manual_coloring', { id: created.id });
      setCreatedColoring({ id: created.id, title: created.title || payload.title, previewUrl: created.preview_url || payload.previewDataUrl || null });
      onNavigate('created');
    } catch (error) {
      showNotice(error.message, 'error');
      throw error;
    } finally {
      setCreating(false);
    }
  }

  return {
    file,
    title,
    setTitle,
    creating,
    creatorGrid,
    setCreatorGrid: selectCreatorGrid,
    creatorColors,
    setCreatorColors,
    creatorCrop,
    setCreatorCrop,
    creatorCropMode,
    setCreatorCropMode,
    creatorImageUrl,
    creatorResult,
    creatorQuality,
    creatorPreviews,
    creatorComputing,
    createdColoring,
    setCreatedColoring,
    handleFileSelected,
    computeCreatorPreview,
    saveDraftColoring,
    saveManualColoring,
  };
}
