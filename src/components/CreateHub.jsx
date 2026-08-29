import { BookOpen, ImagePlus, Sparkles } from 'lucide-react';

const CREATE_OPTIONS = [
  {
    id: 'draw',
    title: 'Нарисовать самому',
    copy: 'Создавайте пиксельные картины с нуля',
    Icon: Sparkles,
    accent: 'violet',
  },
  {
    id: 'pack',
    title: 'Собрать бесплатную коллекцию',
    copy: 'Объединяйте свои работы в бесплатную коллекцию',
    Icon: BookOpen,
    accent: 'orange',
  },
];

export default function CreateHub({ onImport, onManualDraw = null, onCreatePack = null }) {
  return (
    <section className="page create-hub-page">
      <div className="page-heading create-hub-heading">
        <div>
          <p className="eyebrow">СОЗДАВАЙТЕ</p>
          <h1>Ваше творчество</h1>
        </div>
        <p>Делитесь работами и вдохновляйте других.</p>
      </div>

      <div className="create-hub-list">
        <button className="create-hub-card create-hub-card--active" type="button" onClick={onImport}>
          <span className="create-hub-icon create-hub-icon--blue"><ImagePlus size={24} /></span>
          <span className="create-hub-copy"><b>Из изображения</b><small>Преобразуйте фото в пиксельную раскраску</small></span>
          <span className="create-hub-arrow" aria-hidden="true">›</span>
        </button>
        {CREATE_OPTIONS.map(({ id, title, copy, Icon, accent }) => {
          const action = id === 'draw' ? onManualDraw : id === 'pack' ? onCreatePack : null;
          const isReady = typeof action === 'function';
          return <button key={id} className={`create-hub-card ${isReady ? 'create-hub-card--active' : 'create-hub-card--soon'} create-hub-card--${accent}`} type="button" disabled={!isReady} onClick={isReady ? action : undefined}>
            <span className={`create-hub-icon create-hub-icon--${accent}`}><Icon size={24} /></span>
            <span className="create-hub-copy"><b>{title}</b><small>{copy}</small></span>
            {isReady ? <span className="create-hub-arrow" aria-hidden="true">›</span> : <span className="soon-badge">Скоро</span>}
          </button>;
        })}
      </div>

      <p className="create-hub-note">Импортируйте изображение, рисуйте с нуля или объединяйте собственные работы в бесплатные наборы.</p>
    </section>
  );
}
