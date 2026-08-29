import { ArrowRight, BookOpen, Check } from 'lucide-react';
import { sortCollectionsForShelf } from '../lib/galleryProgression';

export default function CollectionsView({ collections = [], mine = [], onOpenCollection, onNavigate }) {
  const publicCollections = sortCollectionsForShelf(collections, mine);
  return <section className="page collections-page" data-collections-page>
    <div className="page-heading">
      <div><p className="eyebrow">ТЕМАТИЧЕСКИЕ ПОЛКИ</p><h1>Коллекции</h1></div>
      <button className="gallery-collections-link" type="button" onClick={() => onNavigate?.('gallery')} data-collections-open-gallery>
        Моя галерея <ArrowRight size={15} aria-hidden="true" />
      </button>
    </div>
    <p className="collections-intro">Собирайте законченные картины в серии, к которым приятно вернуться.</p>
    <div className="collection-list">
      {publicCollections.map((col) => {
        const complete = col.state === 'complete';
        const progressLabel = col.total_count > 0 ? `${col.completed_count}/${col.total_count} готово` : 'Подборка картин';
        return <button key={col.id} className={`collection-card${complete ? ' collection-card--complete' : ''}`} onClick={() => onOpenCollection(col)} data-collection-id={col.id}>
          <span className="collection-preview" style={col.image_url ? { backgroundImage: `url(${col.image_url})` } : undefined}>{complete ? <Check size={18} /> : <BookOpen size={18} />}</span>
          <span className="collection-info"><b>{col.title}</b><small>{progressLabel}{col.rarity ? ` · ${col.rarity}` : ''}</small><i className="collection-progress-track"><i style={{ width: `${col.progress_percent}%` }} /></i></span>
          <ArrowRight size={18} />
        </button>;
      })}
      {!publicCollections.length && <p className="empty-state">Коллекции появятся позже.</p>}
    </div>
    <div className="collection-footer-actions"><button type="button" onClick={() => onNavigate?.('catalog')}>Найти картину для полки <ArrowRight size={15} aria-hidden="true" /></button></div>
  </section>;
}
