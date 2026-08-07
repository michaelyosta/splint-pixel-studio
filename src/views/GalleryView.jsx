import { Globe2, Grid3X3, LoaderCircle, Lock, Trash2 } from 'lucide-react';

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
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">МОИ РАБОТЫ</p><h1>Галерея</h1></div></div><div className="gallery-list">{mine.map((item) => <div className="gallery-row" key={item.id}><button className="gallery-open" onClick={() => onOpen(item.id)}><span className="mini-palette" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : { background: item.palette[0] }}><Grid3X3 size={18} /></span><span><b>{item.title}</b><small>{item.progress.percent}% · {item.width}×{item.height}{item.source_type === 'user' ? ` · ${item.visibility === 'public' ? 'в каталоге' : 'личная'}` : ''}</small></span><span className="gallery-progress">{item.progress.percent}%</span></button>{item.source_type === 'user' && <div className="gallery-actions"><button className={`visibility-button ${item.visibility === 'public' ? 'published' : ''}`} disabled={publishingTemplateId === item.id} onClick={() => onToggleVisibility(item)} aria-label={item.visibility === 'public' ? `Снять с публикации ${item.title}` : `Опубликовать ${item.title}`}>{publishingTemplateId === item.id ? <LoaderCircle className="spin" size={16} /> : item.visibility === 'public' ? <Globe2 size={17} /> : <Lock size={17} />}</button><button className="delete-button" onClick={() => onDelete(item)} aria-label={`Удалить ${item.title}`}><Trash2 size={17} /></button></div>}</div>)}{!mine.length ? mineError ? <div className="error-retry"><p>Не удалось загрузить галерею</p><button className="secondary-button" onClick={onRetry}>Повторить</button></div> : <p className="empty-state">Здесь появятся начатые и созданные вами раскраски.<button className="secondary-button" onClick={() => onNavigate('catalog')}>Выбрать раскраску</button></p> : null}</div></section>;
}
