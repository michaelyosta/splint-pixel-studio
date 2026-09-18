import { ArrowRight, BookOpen, Check } from 'lucide-react';
import { sortCollectionsForShelf } from '../lib/galleryProgression';

export default function CollectionsView({ collections = [], mine = [], onOpenCollection, onNavigate, onTrack = () => {} }) {
  const publicCollections = sortCollectionsForShelf(collections, mine)
    .filter((collection) => collection.is_store_product !== true && collection.is_catalog !== false);
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
        const coverUrl = col.catalog_cover_url || col.image_url;
        const albumSummary = col.albums?.slice(0, 2) || [];
        return <article key={col.id} className="collection-card-group">
          <button className={`collection-card${complete ? ' collection-card--complete' : ''}`} onClick={() => { onTrack('collection_open', { collection_id: col.id }); onOpenCollection(col); }} data-collection-id={col.id}>
            <span className="collection-preview" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>{complete ? <Check size={18} /> : <BookOpen size={18} />}</span>
            <span className="collection-info"><b>{col.title}</b><small>{col.free_count != null ? `${col.free_count} free · ${col.premium_count || 0} premium` : progressLabel}{col.rarity ? ` · ${col.rarity}` : ''}</small><i className="collection-progress-track"><i style={{ width: `${col.progress_percent || 0}%` }} /></i></span>
            <ArrowRight size={18} />
          </button>
          {albumSummary.length > 0 && <div className="collection-album-list" aria-label={`Альбомы коллекции ${col.title}`}>
            {albumSummary.map((album) => <button key={album.id} type="button" className="collection-album-chip" data-album-id={album.id} onClick={() => {
              onTrack('album_open', { collection_id: col.id, album_id: album.id });
              onOpenCollection({ ...col, album_id: album.id, album_title: album.title });
            }}>
              <span>{album.title}</span><small>{album.total_count ?? album.count ?? 0}</small>
            </button>)}
            {col.albums.length > albumSummary.length && <span className="collection-album-more">+{col.albums.length - albumSummary.length} альбома</span>}
          </div>}
        </article>;
      })}
      {!publicCollections.length && <p className="empty-state">Коллекции появятся позже.</p>}
    </div>
    <div className="collection-footer-actions"><button type="button" onClick={() => onNavigate?.('catalog')}>Найти картину для полки <ArrowRight size={15} aria-hidden="true" /></button></div>
  </section>;
}
