import { useEffect, useRef, useState } from 'react';
import { api, metaApi } from '../api/client';
import { buildColoringFromImage } from '../lib/pixelColoring';
import { renderImageCropPreview, renderFitPreview, renderGridPreview, renderNumberedPreview } from '../lib/imageCrop';
import { assessQualityAsync } from '../lib/creatorQuality';
import { createCreatorWorkerClient } from '../lib/creatorWorkerClient';
import { createTiledTemplateAsync } from '../lib/tiledTemplate';

export function useCreatorData({ showNotice, onLoadMine, onLoadCatalog, onNavigate }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('Моя пиксельная раскраска');
  const [creating, setCreating] = useState(false);
  // 24×24 with eight colours is quick, but it flattens most user photos and
  // illustrations before the converter has a chance to preserve their forms.
  const [creatorGrid, setCreatorGrid] = useState({ width: 32, height: 32 });
  const [creatorColors, setCreatorColors] = useState(10);
  const [creatorCrop, setCreatorCrop] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [creatorCropMode, setCreatorCropMode] = useState('fit');
  const [creatorImageUrl, setCreatorImageUrl] = useState(null);
  const [creatorResult, setCreatorResult] = useState(null);
  const [creatorQuality, setCreatorQuality] = useState(null);
  const [creatorPreviews, setCreatorPreviews] = useState({ original: null, pixel: null, numbered: null });
  const [creatorComputing, setCreatorComputing] = useState(false);
  const [createdColoring, setCreatedColoring] = useState(null);
  const creatorComputeRef = useRef(0);
  const creatorFileRef = useRef(null);
  const creatorTimerRef = useRef(null);
  const computeRef = useRef(null);
  const creatorWorkerRef = useRef(null);
  if (!creatorWorkerRef.current) creatorWorkerRef.current = createCreatorWorkerClient();
  computeRef.current = computeCreatorPreview;

  useEffect(() => {
    if (!creatorImageUrl) return;
    window.clearTimeout(creatorTimerRef.current);
    creatorTimerRef.current = window.setTimeout(() => computeRef.current(), 400);
    return () => window.clearTimeout(creatorTimerRef.current);
  }, [creatorGrid, creatorColors, creatorCrop, creatorCropMode, creatorImageUrl]);

  async function computeCreatorPreview() {
    const sourceFile = creatorFileRef.current || file;
    if (!sourceFile) return;
    setCreatorComputing(true);
    const id = ++creatorComputeRef.current;
    let imgUrl;
    try {
      imgUrl = URL.createObjectURL(sourceFile);
      const img = new window.Image();
      img.src = imgUrl;
      await img.decode();
      const preset = { width: creatorGrid.width, height: creatorGrid.height, colors: creatorColors };
      const crop = creatorCropMode === 'crop' ? creatorCrop : null;
      let data;
      if (creatorWorkerRef.current) {
        try {
          data = await creatorWorkerRef.current.run(sourceFile, { ...preset, crop });
        } catch (workerError) {
          if (workerError?.name === 'AbortError') throw workerError;
          // Older WebViews may expose Worker but not the full canvas/File API
          // used by the pipeline. Retire the failed worker and keep the
          // user-facing flow available on the main thread.
          creatorWorkerRef.current.dispose();
          creatorWorkerRef.current = null;
          data = await buildColoringFromImage(sourceFile, { ...preset, crop, yieldEvery: 96 });
        }
      } else {
        data = await buildColoringFromImage(sourceFile, { ...preset, crop, yieldEvery: 96 });
      }
      if (id !== creatorComputeRef.current) return;
      const { width, height, palette, cells } = data;
      const originalPreview = crop ? renderImageCropPreview(img, { ...creatorCrop, size: 512 }) : renderFitPreview(img, 512);
      if (id !== creatorComputeRef.current) return;
      // The creator pipeline already produces the bounded 512px preview in
      // the worker. Re-rendering all 1.44M cells here would put the exact
      // large-grid bottleneck back on the UI thread.
      const pixelPreview = data.previewDataUrl || renderGridPreview(width, height, palette, cells);
      if (id !== creatorComputeRef.current) return;
      // A numbered 1200x1200 canvas would allocate hundreds of megabytes and
      // spend most of the preview time painting text that cannot be read at
      // the card's size. Large creator maps use the bounded pixel preview;
      // numbered previews remain useful for the legacy-sized maps.
      const numberedPreview = width > 160 || height > 160 ? null : renderNumberedPreview(width, height, palette, cells);
      if (id !== creatorComputeRef.current) return;
      const quality = data.quality || await assessQualityAsync(width, height, palette, cells, { yieldEvery: 96 });
      if (id !== creatorComputeRef.current) return;
      setCreatorPreviews({ original: originalPreview, pixel: pixelPreview, numbered: numberedPreview });
      const creatorPayload = width > 160 || height > 160
        ? await (async () => {
          const metadata = { ...data };
          delete metadata.cells;
          delete metadata.originalDataUrl;
          delete metadata.quality;
          // The worker already performs the 1.44M-cell -> tile conversion.
          // Keep the synchronous fallback for older WebViews without Worker.
          const tiled = data.tiles
            ? data
            : await createTiledTemplateAsync({ width, height, palette, cells: data.cells }, { yieldEvery: 24 });
          return { ...metadata, tiles: tiled.tiles, tileSize: tiled.tileSize || 32, originalDataUrl: null };
        })()
        : data;
      setCreatorResult(creatorPayload);
      setCreatorQuality(quality);
    } catch (error) {
      showNotice(error.message || 'Не удалось обработать изображение', 'error');
    } finally {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      if (id === creatorComputeRef.current) setCreatorComputing(false);
    }
  }

  async function prepareFromImage(f) {
    const img = f || file;
    if (!img) return;
    creatorFileRef.current = img;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(img.type) || img.size > 10 * 1024 * 1024) {
      return showNotice('Поддерживаются PNG, JPG и WebP размером до 10 МБ', 'error');
    }
    const url = URL.createObjectURL(img);
    setCreatorImageUrl(url);
    setCreatorResult(null);
    setCreatorQuality(null);
    setCreatorPreviews({ original: null, pixel: null, numbered: null });
    setCreatorCrop({ scale: 1, offsetX: 0, offsetY: 0 });
    setCreatorCropMode('fit');
  }

  function handleFileSelected(selected) {
    creatorFileRef.current = selected;
    setFile(selected);
    setTitle('Моя пиксельная раскраска');
    if (selected) prepareFromImage(selected);
  }

  async function saveDraftColoring() {
    if (!creatorResult) return;
    setCreating(true);
    try {
      const created = await api('/colorings/create', { method: 'POST', body: { title, description: 'Создано из пользовательского изображения', ...creatorResult } });
      const successPreview = created.preview_url || creatorPreviews.pixel || creatorPreviews.numbered || null;
      setCreatorResult(null);
      setFile(null);
      creatorFileRef.current = null;
      setCreatorImageUrl(null);
      setCreatorPreviews({ original: null, pixel: null, numbered: null });
      setCreatorQuality(null);
      await onLoadMine();
      metaApi.track('create_coloring', { id: created.id });
      setCreatedColoring({ id: created.id, title: created.title || title, previewUrl: successPreview });
      onNavigate('created');
    } catch (error) {
      showNotice(error.message, 'error');
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
    setCreatorGrid,
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
