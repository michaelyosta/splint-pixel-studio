import { LoaderCircle, Sparkles, Star } from 'lucide-react';
import { CREATOR_PREVIEW_RESOLUTIONS } from '../lib/imageCrop';

const RESOLUTION_COPY = {
  192: { title: 'Крупные формы', hint: 'Легче раскрашивать' },
  512: { title: 'Рекомендуемый баланс', hint: 'Больше деталей без режима 1200' },
  1024: { title: 'Мелкие формы', hint: 'Заметно больше ручной работы' },
  1200: { title: 'Максимум клеток', hint: 'Не всегда даёт лучший рисунок' },
};

const STAGE_COPY = {
  prepare: 'Подготовка',
  rasterized: 'Читаем формы',
  sampled: 'Сохраняем детали',
  palette: 'Собираем палитру',
  quantized: 'Строим области',
  cleaned: 'Убираем шум',
  complete: 'Готово',
};

function formatCount(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

export default function CreatorView({
  file,
  onFileSelected,
  title,
  onChangeTitle,
  creatorGrid,
  onChangeGrid,
  creatorColors,
  onChangeColors,
  creatorCrop,
  onChangeCrop,
  creatorCropMode,
  onChangeCropMode,
  creatorPreviews,
  creatorQuality,
  creatorComputing,
  creating,
  creatorResult,
  createdColoring,
  onComputePreview,
  onSaveDraft,
  onOpen,
  onGoToProfile,
}) {
  const selectedResolution = creatorGrid.width;
  const selectedOption = creatorPreviews?.options?.[selectedResolution] || null;
  const selectedIndex = CREATOR_PREVIEW_RESOLUTIONS.indexOf(selectedResolution);
  const selectedMatchesSave = Boolean(
    creatorResult
      && selectedOption?.status === 'ready'
      && creatorResult.width === selectedResolution
      && creatorResult.resultFingerprint
      && creatorResult.resultFingerprint === selectedOption.resultFingerprint
      && (!selectedOption.previewPixelFingerprint
        || creatorResult.previewPixelFingerprint === selectedOption.previewPixelFingerprint),
  );

  if (createdColoring) {
    return <section className="page creator-success-page">
      <div className="creator-success-art" style={createdColoring.previewUrl ? { backgroundImage: `url(${createdColoring.previewUrl})` } : undefined} aria-hidden="true"><Sparkles size={34} /></div>
      <p className="eyebrow">НОВАЯ РАБОТА</p>
      <h1>Раскраска готова</h1>
      <p>«{createdColoring.title}» сохранена в вашей галерее. Теперь можно спокойно раскрыть картину.</p>
      <button className="primary-button" type="button" onClick={() => onOpen(createdColoring.id)}><Sparkles size={18} /> Начать раскрашивать</button>
      <button className="secondary-button" type="button" onClick={onGoToProfile}>К моим работам</button>
    </section>;
  }

  return <section className="page creator-page">
    <div className="page-heading"><div><p className="eyebrow">СВОЯ РАСКРАСКА</p><h1>Из изображения</h1></div></div>
    <div className="creator-card">
      <label className="file-field">
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onFileSelected(event.target.files?.[0] || null)} />
        {file ? file.name : 'Выбрать PNG, JPG или WebP'}
      </label>
      {file && <>
        <label>Название<input value={title} maxLength="80" onChange={(event) => onChangeTitle(event.target.value)} /></label>

        <div className="creator-crop-section"><h3>Кадрирование</h3>
          <div className="creator-crop-toggle">
            <button type="button" className={creatorCropMode === 'fit' ? 'selected' : ''} onClick={() => { onChangeCropMode('fit'); onChangeCrop({ scale: 1, offsetX: 0, offsetY: 0 }); }}>Вписать целиком</button>
            <button type="button" className={creatorCropMode === 'crop' ? 'selected' : ''} onClick={() => onChangeCropMode('crop')}>Кадрировать</button>
          </div>
          {creatorCropMode === 'crop' && <>
            <div className="creator-slider-row"><label>Масштаб <b>{creatorCrop.scale.toFixed(1)}×</b></label><input type="range" min="0.5" max="3" step="0.1" value={creatorCrop.scale} onChange={(event) => onChangeCrop({ ...creatorCrop, scale: +event.target.value })} /></div>
            <div className="creator-slider-row"><label>Смещение по X</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetX} onChange={(event) => onChangeCrop({ ...creatorCrop, offsetX: +event.target.value })} /><b>{creatorCrop.offsetX}</b></div>
            <div className="creator-slider-row"><label>Смещение по Y</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetY} onChange={(event) => onChangeCrop({ ...creatorCrop, offsetY: +event.target.value })} /><b>{creatorCrop.offsetY}</b></div>
            <button className="secondary-button" type="button" onClick={() => onChangeCrop({ scale: 1, offsetX: 0, offsetY: 0 })}>Сбросить кадрирование</button>
          </>}
        </div>

        <div className="creator-grid-section">
          <div className="creator-section-heading"><div><h3>Выберите детализацию</h3><p>Нажмите вариант, чтобы построить его тем же конвертером, который создаст раскраску. Уже готовые варианты остаются для сравнения.</p></div></div>
          <div className="creator-resolution-note"><strong>Для фотографий по умолчанию выбран баланс 512 × 512 и 16 цветов.</strong> Он лучше сохраняет лицо, надписи и силуэты, чем слишком грубые 192 × 192. 1200 — не автоматический «лучший» режим: больше клеток может означать больше мелких областей и труднее читаемые номера.</div>
          <input
            className="grid-detail-range creator-resolution-range"
            type="range"
            min="0"
            max={CREATOR_PREVIEW_RESOLUTIONS.length - 1}
            step="1"
            value={Math.max(0, selectedIndex)}
            aria-label="Размер сетки"
            onChange={(event) => {
              const resolution = CREATOR_PREVIEW_RESOLUTIONS[Number(event.target.value)];
              onChangeGrid({ width: resolution, height: resolution });
            }}
          />
          <div className="creator-resolution-options" role="group" aria-label="Варианты детализации">
            {CREATOR_PREVIEW_RESOLUTIONS.map((resolution) => {
              const option = creatorPreviews?.options?.[resolution];
              const copy = RESOLUTION_COPY[resolution];
              const progress = Math.round(Number(option?.progress || 0) * 100);
              return <button
                key={resolution}
                type="button"
                className={`creator-preview-option${selectedResolution === resolution ? ' selected' : ''}`}
                aria-pressed={selectedResolution === resolution}
                aria-label={`Сетка ${resolution} на ${resolution}`}
                data-resolution={resolution}
                data-status={option?.status || 'idle'}
                data-result-fingerprint={option?.resultFingerprint || ''}
                onClick={() => onChangeGrid({ width: resolution, height: resolution })}
                disabled={creating}
              >
                <span className="creator-option-visual">
                  {option?.pixel
                    ? <img src={option.pixel} alt="" />
                    : <span className="creator-option-placeholder" aria-hidden="true">{option?.status === 'computing' ? <LoaderCircle className="spin" size={22} /> : resolution}</span>}
                  {option?.status === 'computing' && <span className="creator-option-progress"><i style={{ width: `${Math.max(6, progress)}%` }} /></span>}
                </span>
                <span className="creator-option-copy"><b>{resolution} × {resolution}</b><em>{copy.title}</em><small>{option?.status === 'computing' ? `${STAGE_COPY[option.stage] || 'Обработка'} · ${progress}%` : option?.status === 'ready' ? copy.hint : `${copy.hint} · нажмите для preview`}</small></span>
                {option?.status === 'ready' && <span className="creator-option-metrics"><span>{formatCount(option.insights?.colorsUsed)} цветов</span><span>{formatCount(option.insights?.regionCount)} областей</span></span>}
                {option?.status === 'error' && <span className="creator-option-error">Не удалось построить</span>}
              </button>;
            })}
          </div>
          <div className="grid-detail-scale" aria-hidden="true"><span>Крупнее</span><span>Детальнее, но труднее</span></div>
        </div>

        <div className="creator-colors-section"><h3>Количество цветов</h3>
          <div className="creator-slider-row"><input type="range" min="4" max="16" step="1" value={creatorColors} onChange={(event) => onChangeColors(+event.target.value)} /><span className="creator-colors-badge">{creatorColors}</span></div>
        </div>

        <button className="secondary-button creator-refresh-button" type="button" disabled={creatorComputing || creating} onClick={() => onComputePreview()}>
          {creatorComputing ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />} Пересчитать выбранный вариант
        </button>

        {(creatorPreviews?.original || selectedOption?.pixel) && <div className="creator-selected-evidence creator-previews" data-selected-resolution={selectedResolution} data-result-fingerprint={selectedOption?.resultFingerprint || ''}>
          <div className="creator-preview-item creator-source-preview"><h4>Исходный кадр</h4>{creatorPreviews.original ? <img src={creatorPreviews.original} alt="Выбранный кадр исходного изображения" /> : <div className="preview-placeholder" />}</div>
          <div className="creator-preview-item"><h4>Готовый пиксельный результат</h4>{selectedOption?.pixel ? <img src={selectedOption.pixel} alt={`Пиксельный результат ${selectedResolution} на ${selectedResolution}`} /> : <div className="preview-placeholder"><LoaderCircle className="spin" size={22} /></div>}</div>
          <div className="creator-preview-item creator-number-preview"><h4>Фрагмент раскраски с номерами</h4>{selectedOption?.numbered ? <img src={selectedOption.numbered} alt="Увеличенный фрагмент реальной сетки с номерами" /> : <div className="preview-placeholder"><LoaderCircle className="spin" size={22} /></div>}<p>Это увеличенный фрагмент 12 × 12 клеток, а не уменьшенная имитация номеров.</p></div>
        </div>}

        {selectedOption?.status === 'ready' && <div className="creator-preview-report" aria-label="Оценка раскрашиваемости">
          <div className="creator-palette" aria-label={`${selectedOption.palette.length} цветов`}>{selectedOption.palette.map((color, index) => <span key={`${color}-${index}`} style={{ backgroundColor: color }} title={`${index + 1}: ${color}`} />)}</div>
          <div className="creator-preview-stats">
            <span><b>{formatCount(selectedOption.insights?.totalCells)}</b><small>клеток</small></span>
            <span><b>{formatCount(selectedOption.insights?.regionCount)}</b><small>областей</small></span>
            <span><b>{selectedOption.insights?.fragmentationPerThousand?.toFixed(1)}</b><small>фрагм. / 1000</small></span>
            <span><b>{formatPercent(selectedOption.insights?.tinyRegionRatio)}</b><small>малых областей</small></span>
            <span><b>{formatCount(selectedOption.insights?.predictedEffort)}</b><small>оценка действий</small></span>
            <span><b>{selectedOption.insights?.numberReadability}</b><small>читаемость номеров</small></span>
          </div>
          <div className={`creator-quality creator-quality-${creatorQuality?.level || selectedOption.insights?.paintability?.level}`}>
            <span className="creator-quality-label">Раскрашиваемость: {creatorQuality?.label || selectedOption.insights?.paintability?.label} · {selectedOption.insights?.paintabilityScore}/100</span>
            <p className="creator-quality-hint">Прогноз учитывает дробность, маленькие области и сохранение границ. Финальная художественная оценка остаётся за вами.</p>
          </div>
          <p className="creator-preview-proof">Пайплайн <code>{selectedOption.pipelineVersion}</code> · клетки <code>{selectedOption.resultFingerprint?.slice(0, 12)}</code>{selectedOption.previewPixelFingerprint && <> · пиксели <code>{selectedOption.previewPixelFingerprint.slice(0, 12)}</code></>}</p>
        </div>}

        {selectedMatchesSave && <button className="primary-button create-button" type="button" disabled={creating || creatorComputing} onClick={onSaveDraft}>
          {creating ? <LoaderCircle className="spin" size={18} /> : <Star size={18} />} Сохранить и начать · {selectedResolution} × {selectedResolution}
        </button>}
        {!selectedMatchesSave && selectedOption?.status === 'computing' && <p className="creator-save-wait"><LoaderCircle className="spin" size={16} /> Готовим точный результат выбранной детализации…</p>}
      </>}
    </div>
  </section>;
}
