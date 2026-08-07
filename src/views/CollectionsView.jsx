import { BookOpen } from 'lucide-react';

export default function CollectionsView({ collections, onOpenCollection }) {
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">АЛЬБОМЫ</p><h1>Коллекции</h1></div></div><div className="collection-list">{collections.map((col) => <button key={col.id} className="collection-card" onClick={() => onOpenCollection(col)}>
    <span className="collection-preview" style={col.image_url ? { backgroundImage: `url(${col.image_url})` } : undefined} />
    <span className="collection-info"><b>{col.title}</b><small>{col.completed_count}/{col.total_count} завершено · {col.rarity}</small></span>
    <BookOpen size={18} />
  </button>)}{!collections.length && <p className="empty-state">Коллекции появятся позже.</p>}</div></section>;
}
