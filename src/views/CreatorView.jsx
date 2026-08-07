import { LoaderCircle, Sparkles, Star } from 'lucide-react';
import { CREATOR_GRID_OPTIONS, gridDetailMeta } from '../lib/catalogMeta';

export default function CreatorView({
  file,
  onFileSelected,
  title,
  onChangeTitle,
  creatorImageUrl,
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
  const renderCreator = () => {
    const gridOptionIndex = CREATOR_GRID_OPTIONS.findIndex((option) => option.w === creatorGrid.width);
    const gridMeta = gridDetailMeta(creatorGrid.width);
    const gridStep = Math.max(4, Math.round(576 / creatorGrid.width));
    return <section className="page creator-page"><div className="page-heading"><div><p className="eyebrow">СВОЯ РАСКРАСКА</p><h1>Из изображения</h1></div></div><div className="creator-card">
      <label className="file-field"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onFileSelected(event.target.files?.[0] || null)} />{file ? file.name : 'Выбрать PNG, JPG или WebP'}</label>
      {file && <><label>Название<input value={title} maxLength="80" onChange={(event) => onChangeTitle(event.target.value)} /></label>
        <div className="creator-crop-section"><h3>Кадрирование</h3>
          <div className="creator-crop-toggle"><button className={creatorCropMode === 'fit' ? 'selected' : ''} onClick={() => { onChangeCropMode('fit'); onChangeCrop({ scale: 1, offsetX: 0, offsetY: 0 }); }}>Вписать целиком</button><button className={creatorCropMode === 'crop' ? 'selected' : ''} onClick={() => onChangeCropMode('crop')}>Кадрировать</button></div>
          {creatorCropMode === 'crop' && <><div className="creator-slider-row"><label>Масштаб <b>{creatorCrop.scale.toFixed(1)}×</b></label><input type="range" min="0.5" max="3" step="0.1" value={creatorCrop.scale} onChange={(event) => onChangeCrop({ ...creatorCrop, scale: +event.target.value })} /></div>
            <div className="creator-slider-row"><label>Смещение по X</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetX} onChange={(event) => onChangeCrop({ ...creatorCrop, offsetX: +event.target.value })} /><b>{creatorCrop.offsetX}</b></div>
            <div className="creator-slider-row"><label>Смещение по Y</label><input type="range" min="-200" max="200" step="1" value={creatorCrop.offsetY} onChange={(event) => onChangeCrop({ ...creatorCrop, offsetY: +event.target.value })} /><b>{creatorCrop.offsetY}</b></div>
            <button className="secondary-button" onClick={() => onChangeCrop({ scale: 1, offsetX: 0, offsetY: 0 })}>Сбросить кадрирование</button></>}
        </div>
        <div className="creator-grid-section"><h3>Детализация сетки</h3>
          <div className={`grid-detail-picker grid-detail-picker-${gridMeta.load === 'Экспериментально' ? 'experimental' : 'standard'}`}>
            <div className="grid-density-preview" style={creatorImageUrl ? { backgroundImage: `url(${creatorImageUrl})` } : undefined}>
              <span className="grid-density-overlay" style={{ '--grid-step': `${gridStep}px` }} />
              <span className="grid-density-size">{creatorGrid.width}<small>× {creatorGrid.height}</small></span>
              <span className="grid-density-cells">{(creatorGrid.width * creatorGrid.height).toLocaleString('ru-RU')} клеток</span>
            </div>
            <div className="grid-detail-copy"><span><b>{gridMeta.title}</b><em>{gridMeta.load}</em></span><p className="creator-grid-hint">{gridMeta.hint}</p></div>
            <input className="grid-detail-range" type="range" min="0" max={CREATOR_GRID_OPTIONS.length - 1} step="1" value={gridOptionIndex} aria-label="Размер сетки" onChange={(event) => { const option = CREATOR_GRID_OPTIONS[Number(event.target.value)]; onChangeGrid({ width: option.w, height: option.h }); }} />
            <div className="creator-grid-options">{CREATOR_GRID_OPTIONS.map((g) => <button key={g.label} title={g.label} aria-label={`Сетка ${g.label}`} className={creatorGrid.width === g.w ? 'selected' : ''} onClick={() => onChangeGrid({ width: g.w, height: g.h })}><span>{g.w}</span></button>)}</div>
            <div className="grid-detail-scale" aria-hidden="true"><span>Крупнее</span><span>Точнее</span></div>
          </div>
        </div>
        <div className="creator-colors-section"><h3>Количество цветов</h3>
          <div className="creator-slider-row"><input type="range" min="4" max="16" step="1" value={creatorColors} onChange={(event) => onChangeColors(+event.target.value)} /><span className="creator-colors-badge">{creatorColors}</span></div>
        </div>
        <button className="primary-button create-button" disabled={creatorComputing} onClick={onComputePreview}>{creatorComputing ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />} Обновить превью</button>
        {(creatorPreviews.original || creatorPreviews.pixel || creatorPreviews.numbered) && <div className="creator-previews">
          <div className="creator-preview-item"><h4>Исходное кадрирование</h4>{creatorPreviews.original ? <img src={creatorPreviews.original} alt="Кадрированное изображение" /> : <div className="preview-placeholder" />}</div>
          <div className="creator-preview-item"><h4>Пиксельная сетка</h4>{creatorPreviews.pixel ? <img src={creatorPreviews.pixel} alt="Пиксельная сетка" /> : <div className="preview-placeholder" />}</div>
          <div className="creator-preview-item"><h4>По номерам</h4>{creatorPreviews.numbered ? <img src={creatorPreviews.numbered} alt="По номерам" /> : <div className="preview-placeholder" />}</div>
        </div>}
        {creatorQuality && <div className={`creator-quality creator-quality-${creatorQuality.level}`}><span className="creator-quality-label">{creatorQuality.label}</span>{creatorQuality.hint && <p className="creator-quality-hint">{creatorQuality.hint}</p>}</div>}
        {creatorResult && <button className="primary-button create-button" disabled={creating} onClick={onSaveDraft}>{creating ? <LoaderCircle className="spin" size={18} /> : <Star size={18} />} Сохранить и начать</button>}
      </>}
    </div></section>;
  };

  if (!createdColoring) return renderCreator();
  return <section className="page creator-success-page">
    <div className="creator-success-art" style={createdColoring.previewUrl ? { backgroundImage: `url(${createdColoring.previewUrl})` } : undefined} aria-hidden="true"><Sparkles size={34} /></div>
    <p className="eyebrow">НОВАЯ РАБОТА</p>
    <h1>Раскраска готова</h1>
    <p>«{createdColoring.title}» сохранена в вашей галерее. Теперь можно спокойно раскрыть картину.</p>
    <button className="primary-button" onClick={() => onOpen(createdColoring.id)}><Sparkles size={18} /> Начать раскрашивать</button>
    <button className="secondary-button" onClick={onGoToProfile}>К моим работам</button>
  </section>;
}
