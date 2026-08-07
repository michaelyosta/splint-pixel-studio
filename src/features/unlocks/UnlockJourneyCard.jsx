import { ArrowRight, LoaderCircle, Map, RefreshCw } from 'lucide-react';
import {
  formatRequirement,
  reasonText,
  stateDescription,
  UNLOCK_STATES,
} from '../../lib/unlockState';
import UnlockStateChip from './UnlockStateChip';

function JourneyStatus({ status, onRetry, children }) {
  if (status === 'loading') {
    return (
      <div className="unlock-journey-status" data-journey-status="loading" role="status">
        <LoaderCircle className="spin" size={16} aria-hidden="true" />
        Загружаем открытия…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="unlock-journey-status unlock-journey-status--error" data-journey-status="error">
        <p>Не удалось загрузить путь открытий.</p>
        <button className="secondary-button" type="button" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          Повторить
        </button>
      </div>
    );
  }
  return children;
}

function RequirementRow({ requirement }) {
  const formatted = formatRequirement(requirement);
  if (!formatted) return null;
  return (
    <div
      className={`unlock-requirement${formatted.satisfied ? ' is-satisfied' : ''}`}
      data-requirement-type={formatted.rule_type}
      data-satisfied={formatted.satisfied ? 'true' : 'false'}
    >
      <div className="unlock-requirement-head">
        <span><b>{formatted.label}</b><small>{formatted.progressText}</small></span>
        <strong>{formatted.percent}%</strong>
      </div>
      <span
        className="unlock-requirement-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={formatted.percent}
        aria-label={`${formatted.label}: ${formatted.percent}%`}
      >
        <i style={{ width: `${formatted.percent}%` }} />
      </span>
      <p className="unlock-requirement-action">{formatted.nextAction}</p>
    </div>
  );
}

export default function UnlockJourneyCard({
  journey,
  status = 'loading',
  onRetry,
  onOpen,
  compact = false,
}) {
  const current = journey?.current || null;
  const next = journey?.next || null;
  const premiumOnly = journey && !current && journey.counts.premium_locked > 0;
  const allOpen = journey && !current && !premiumOnly;

  return (
    <section className={`unlock-journey-card${compact ? ' is-compact' : ''}`} data-unlock-journey="true">
      <div className="section-heading unlock-journey-heading">
        <div>
          <p className="eyebrow">ПУТЬ ОТКРЫТИЙ</p>
          <h2>Следующие коллекции</h2>
        </div>
        {journey && (
          <span className="unlock-journey-counts" aria-label={`${journey.counts.available} доступно, ${journey.counts.owned} открыто, ${journey.counts.progression_locked} закрыто прогрессом, ${journey.counts.premium_locked} premium`}>
            <Map size={14} aria-hidden="true" />
            {journey.counts.available} · {journey.counts.owned} · {journey.counts.progression_locked} · {journey.counts.premium_locked}
          </span>
        )}
      </div>

      <JourneyStatus status={status} onRetry={onRetry}>
        {premiumOnly ? (
          <div className="unlock-journey-empty" data-journey-status="ready">
            <p>Осталось {journey.counts.premium_locked} Premium-наборов. Их можно купить за Stars, прогресс их не открывает.</p>
            {onOpen && <button className="secondary-button" type="button" onClick={() => onOpen(null, 'premium')}>Premium-наборы</button>}
          </div>
        ) : allOpen ? (
          <div className="unlock-journey-empty" data-journey-status="ready">
            <p>Все текущие открытия доступны. Возвращайтесь за новыми после завершения работ.</p>
          </div>
        ) : current ? (
          <div className="unlock-journey-current" data-journey-current-id={current.subject_id} data-journey-state={current.state}>
            <div className="unlock-journey-title-row">
              <span>
                <b>{current.title}</b>
                <small>{current.subject_type === 'collection' ? 'Коллекция' : 'Раскраска'}</small>
              </span>
              <UnlockStateChip state={current.state} reasonCode={current.reason_code} />
            </div>
            <p className="unlock-journey-reason">{reasonText(current.reason_code)}</p>
            <div className="unlock-requirement-list">
              {current.requirements.length ? current.requirements.map((requirement, index) => (
                <RequirementRow key={`${requirement.rule_type}-${requirement.target_value}-${index}`} requirement={requirement} />
              )) : (
                <div className="unlock-requirement unlock-requirement--ready">
                  <p>{reasonText(current.reason_code)}</p>
                </div>
              )}
            </div>
            {current.state === UNLOCK_STATES.AVAILABLE || current.unlockable_now ? (
              <button className="primary-button unlock-journey-cta" type="button" onClick={() => onOpen?.(current)}>
                Открыть сейчас <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : current.state === UNLOCK_STATES.PREMIUM_LOCKED ? (
              <button className="secondary-button unlock-journey-cta" type="button" onClick={() => onOpen?.(current, 'premium')}>
                Как купить Premium
              </button>
            ) : (
              <p className="unlock-journey-hint">Раскрашивайте картины — условия обновляются автоматически.</p>
            )}
          </div>
        ) : (
          <div className="unlock-journey-empty" data-journey-status="ready">
            <p>Путь открытий загружается.</p>
          </div>
        )}
      </JourneyStatus>

      {next && (
        <div className="unlock-journey-next" data-journey-next-id={next.subject_id} data-journey-next-state={next.state}>
          <span>Дальше</span>
          <b>{next.title}</b>
          <UnlockStateChip state={next.state} reasonCode={next.reason_code} />
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {current ? `${current.title}: ${stateDescription(current.state)}` : ''}
      </span>
    </section>
  );
}
