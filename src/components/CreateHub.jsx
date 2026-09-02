import { BookOpen, ImagePlus } from 'lucide-react';

export default function CreateHub({ onImport, onCreatePack = null }) {
  return (
    <section className="page create-hub-page">
      <div className="page-heading create-hub-heading">
        <div>
          <p className="eyebrow">СОЗДАТЬ</p>
          <h1>Превратите изображение в раскраску</h1>
        </div>
        <p>Загрузите фото или иллюстрацию — Splint сразу подготовит рекомендуемый вариант.</p>
      </div>

      <div className="create-hub-list">
        <button className="create-hub-card create-hub-card--active" type="button" onClick={onImport}>
          <span className="create-hub-icon create-hub-icon--blue"><ImagePlus size={24} /></span>
          <span className="create-hub-copy"><b>Загрузить изображение</b><small>PNG, JPG или WebP · рекомендуемые настройки автоматически</small></span>
          <span className="create-hub-arrow" aria-hidden="true">›</span>
        </button>
      </div>

      {typeof onCreatePack === 'function' && <div className="create-hub-secondary">
        <span>Уже есть свои работы?</span>
        <button type="button" onClick={onCreatePack}><BookOpen size={16} /> Управлять коллекциями</button>
      </div>}
    </section>
  );
}
