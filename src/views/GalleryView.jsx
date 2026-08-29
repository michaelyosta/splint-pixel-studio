import { ArrowRight, Check, Clock3, Globe2, Grid3X3, LoaderCircle, Lock, Trash2 } from 'lucide-react';
import {
  buildGallerySummary,
  formatArtworkMeta,
  formatResumeBeat,
  isCompletedArtwork,
  isInProgressArtwork,
  progressPercent,
  sortGalleryItems,
} from '../lib/galleryProgression';
import { hasContentMetadata } from '../lib/contentMetadata.js';

function ArtworkPreview({ item, completed = false }) {
  return <span
    className={`mini-palette${completed ? ' mini-palette--completed' : ''}`}
    style={item.preview_url
      ? { backgroundImage: `linear-gradient(145deg, rgba(43, 217, 254, 0.1), transparent), url(${item.preview_url})` }
      : { background: item.palette?.[0] || 'linear-gradient(145deg, #17344a, #0b1522)' }}
    aria-hidden="true"
  >
    {completed ? <Check size={18} /> : <Grid3X3 size={18} />}
  </span>;
}

export default function GalleryView({
  mine,
  mineError,
  publishingTemplateId,
  onRetry,
  onOpen,
  onToggleVisibility,
  onDelete,
  onNavigate,
}) {
  const items = sortGalleryItems(mine);
  const summary = buildGallerySummary(items);
  const activeItems = items.filter(isInProgressArtwork);
  const completedItems = items.filter(isCompletedArtwork);
  const resumeItem = activeItems[0] || null;

  const renderActions = (item) => item.source_type === 'user' && <div className="gallery-actions">
    <button
      className={`visibility-button ${item.visibility === 'public' ? 'published' : ''}`}
      disabled={publishingTemplateId === item.id}
      onClick={() => onToggleVisibility(item)}
      aria-label={item.visibility === 'public' ? `Снять с публикации ${item.title}` : `Опубликовать ${item.title}`}
    >
      {publishingTemplateId === item.id
        ? <LoaderCircle className="spin" size={16} />
        : item.visibility === 'public' ? <Globe2 size={17} /> : <Lock size={17} />}
    </button>
    <button className="delete-button" onClick={() => onDelete(item)} aria-label={`Удалить ${item.title}`}><Trash2 size={17} /></button>
  </div>;

  const renderRow = (item, completed = false) => {
    const percent = progressPercent(item);
    return <div className={`gallery-row${completed ? ' gallery-row--completed' : ''}`} key={item.id} data-gallery-item={completed ? 'completed' : 'in-progress'}>
      <button className="gallery-open" type="button" onClick={() => onOpen(item.id)}>
        <ArtworkPreview item={item} completed={completed} />
        <span className="gallery-row-copy">
          <b>{item.title}</b>
          <small>{completed ? 'Готовый результат' : formatResumeBeat(item)}</small>
          <em data-content-metadata={hasContentMetadata(item) ? 'authoritative' : 'unassessed'}>{formatArtworkMeta(item)}</em>
        </span>
        <span className={`gallery-progress${completed ? ' is-complete' : ''}`}>{completed ? <Check size={15} /> : `${percent}%`}</span>
      </button>
      {renderActions(item)}
    </div>;
  };

  return <section className="page gallery-page" data-gallery-page>
    <div className="page-heading">
      <div><p className="eyebrow">МОЯ ПОЛКА</p><h1>Галерея</h1></div>
      <button className="gallery-collections-link" type="button" onClick={() => onNavigate('collections')} data-gallery-open-collections>
        Коллекции <ArrowRight size={15} aria-hidden="true" />
      </button>
    </div>

    <section className="gallery-shelf-summary" aria-label="Сводка моей полки" data-gallery-summary>
      <div><b>{summary.completed}</b><small>готовых результатов</small></div>
      <div><b>{summary.inProgress}</b><small>картин в работе</small></div>
      <div><b>{summary.unopened}</b><small>начатых позже</small></div>
    </section>

    {resumeItem && <section className="gallery-resume" data-gallery-resume>
      <div className="gallery-resume-copy">
        <p className="eyebrow">СЛЕДУЮЩИЙ BEAT</p>
        <h2>Продолжить раскрытие</h2>
        <p>{resumeItem.title}</p>
        <small data-content-metadata={hasContentMetadata(resumeItem) ? 'authoritative' : 'unassessed'}><Clock3 size={13} aria-hidden="true" /> {formatResumeBeat(resumeItem)} · {formatArtworkMeta(resumeItem)}</small>
      </div>
      <button type="button" className="primary-button" onClick={() => onOpen(resumeItem.id)} data-gallery-resume-action>
        Продолжить <ArrowRight size={15} aria-hidden="true" />
      </button>
    </section>}

    {completedItems.length > 0 && <section className="gallery-section" data-gallery-completed>
      <div className="section-heading"><div><p className="eyebrow">СОБРАННЫЕ РЕЗУЛЬТАТЫ</p><h2>Моя коллекция</h2></div><span>{completedItems.length}</span></div>
      <div className="gallery-list">{completedItems.map((item) => renderRow(item, true))}</div>
    </section>}

    {activeItems.length > 0 && <section className="gallery-section" data-gallery-in-progress>
      <div className="section-heading"><div><p className="eyebrow">В РАБОТЕ</p><h2>Незавершённые картины</h2></div><span>{activeItems.length}</span></div>
      <div className="gallery-list">{activeItems.map((item) => renderRow(item))}</div>
    </section>}

    {!mine.length && (mineError
      ? <div className="error-retry"><p>Не удалось загрузить полку</p><button className="secondary-button" onClick={onRetry}>Повторить</button></div>
      : <p className="empty-state" data-gallery-empty>Здесь будут ваши начатые и завершённые картины.<button className="secondary-button" onClick={() => onNavigate('catalog')}>Выбрать первую картину</button></p>)}

    <div className="gallery-footer-actions">
      <button type="button" onClick={() => onNavigate('collections')}>Смотреть тематические коллекции <ArrowRight size={15} aria-hidden="true" /></button>
      <button type="button" onClick={() => onNavigate('catalog')}>Найти следующую картину <ArrowRight size={15} aria-hidden="true" /></button>
    </div>
  </section>;
}
