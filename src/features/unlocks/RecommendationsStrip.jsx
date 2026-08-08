import { LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import {
  recommendationDetail,
  recommendationReasonText,
} from '../../lib/unlockState';

export default function RecommendationsStrip({
  items = [],
  status = 'loading',
  onRetry,
  onOpen,
  limit = 8,
}) {
  const visible = items.slice(0, limit);
  return (
    <section className="recommendations-strip" data-recommendations="true">
      <div className="section-heading recommendations-heading">
        <div>
          <p className="eyebrow">ДЛЯ ВАС</p>
          <h2>Продолжить раскрашивать</h2>
        </div>
        {status === 'ready' && visible.length > 0 && (
          <span className="recommendations-count" aria-label={`${visible.length} рекомендаций`}>
            <Sparkles size={14} aria-hidden="true" />
            {visible.length}
          </span>
        )}
      </div>

      {status === 'loading' && (
        <div className="recommendations-status" data-recommendations-status="loading" role="status">
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
          Подбираем раскраски…
        </div>
      )}
      {status === 'error' && (
        <div className="recommendations-status recommendations-status--error" data-recommendations-status="error">
          <p>Не удалось подобрать рекомендации.</p>
          <button className="secondary-button" type="button" onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" />
            Повторить
          </button>
        </div>
      )}
      {status === 'ready' && visible.length === 0 && (
        <div className="recommendations-status recommendations-status--empty" data-recommendations-status="empty">
          <p>Сейчас нет новых рекомендаций — загляните в каталог.</p>
        </div>
      )}
      {status === 'ready' && visible.length > 0 && (
        <div className="recommendations-scroll" data-recommendations-count={visible.length} aria-label="Персональные рекомендации">
          {visible.map((item) => (
            <article className="recommendation-card" key={item.id}>
              <button
                type="button"
                className="recommendation-card-open"
                data-recommendation-id={item.id}
                data-reason-code={item.reason_code}
                onClick={() => onOpen?.(item)}
                aria-label={`Открыть ${item.title}: ${recommendationReasonText(item.reason_code)}`}
              >
                <span
                  className="recommendation-preview"
                  style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined}
                  aria-hidden="true"
                >
                  {!item.preview_url && <Sparkles size={20} />}
                </span>
                <span className="recommendation-copy">
                  <b>{item.title}</b>
                  <small>{recommendationReasonText(item.reason_code)}</small>
                  <em>{recommendationDetail(item)}</em>
                </span>
              </button>
            </article>
          ))}
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {status === 'ready' ? `Показано ${visible.length} рекомендаций` : status === 'loading' ? 'Загружаем рекомендации' : 'Рекомендации недоступны'}
      </span>
    </section>
  );
}
