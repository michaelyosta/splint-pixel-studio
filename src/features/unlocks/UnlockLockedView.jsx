import { ArrowRight, ChevronLeft, Lock, RefreshCw } from 'lucide-react';
import {
  formatRequirement,
  reasonText,
  reasonTitle,
  stateDescription,
  UNLOCK_STATES,
} from '../../lib/unlockState';
import UnlockStateChip from './UnlockStateChip';

export default function UnlockLockedView({
  unlock,
  nextRecommendation = null,
  onBack,
  onBrowse,
  onContinue,
  onPremium,
}) {
  if (!unlock) return null;
  const premium = unlock.state === UNLOCK_STATES.PREMIUM_LOCKED;
  const requirements = Array.isArray(unlock.requirements) ? unlock.requirements : [];
  const readyNow = unlock.state === UNLOCK_STATES.AVAILABLE || unlock.unlockable_now;

  return (
    <section className="page unlock-locked-page" data-unlock-locked="true" data-locked-state={unlock.state} data-locked-reason={unlock.reason_code} data-locked-requirement-count={requirements.length}>
      <div className="player-topbar unlock-locked-topbar">
        <button className="back-button" type="button" onClick={onBack} aria-label="Назад в каталог">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="player-topbar-title">{unlock.title || 'Раскраска'}</span>
        {premium ? <span className="unlock-locked-unavailable-chip">Недоступно</span> : <UnlockStateChip state={unlock.state} reasonCode={unlock.reason_code} />}
      </div>

      <div className={`unlock-locked-hero${premium ? ' unlock-locked-hero--unavailable' : ' unlock-locked-hero--progression'}`}>
        <span className="unlock-locked-icon" aria-hidden="true">
          <Lock size={26} />
        </span>
        <p className="eyebrow">{premium ? 'КОНТЕНТ НЕДОСТУПЕН' : 'КОНТЕНТ ЕЩЁ ЗАКРЫТ'}</p>
        <h1>{premium ? 'Контент сейчас недоступен' : reasonTitle(unlock.reason_code)}</h1>
        <p className="unlock-locked-reason">{reasonText(unlock.reason_code)}</p>
        {!premium && !readyNow && <p className="unlock-locked-gate">Сервер подтвердил: прямой доступ к этой раскраске заблокирован, пока условия не выполнены.</p>}
      </div>

      <div className="unlock-locked-requirements">
        {premium ? <p className="unlock-locked-static-status">Этот контент сейчас недоступен.</p> : <>
          <h2>Что нужно, чтобы открыть</h2>
          {requirements.length ? requirements.map((requirement, index) => {
            const formatted = formatRequirement(requirement);
            if (!formatted) return null;
            return (
              <div
                className={`unlock-requirement${formatted.satisfied ? ' is-satisfied' : ''}`}
                key={`${formatted.rule_type}-${formatted.target_value}-${index}`}
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
          }) : (
            <p className="unlock-locked-empty">Условия появятся после первого прогресса.</p>
          )}
        </>}
      </div>

      <div className="unlock-locked-actions">
        {premium ? (
          <>
            <button className="primary-button" type="button" onClick={onPremium}>
              <ArrowRight size={17} aria-hidden="true" />
              Посмотреть набор
            </button>
            <p className="unlock-locked-unavailable">Покупка пока не подключена. Можно посмотреть preview и сохранить желание.</p>
          </>
        ) : readyNow ? (
          <button className="primary-button" type="button" onClick={onBrowse}>
            <ArrowRight size={17} aria-hidden="true" />
            Открыть
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={onBrowse}>
            <ArrowRight size={17} aria-hidden="true" />
            К следующей цели
          </button>
        )}
        {nextRecommendation && (
          <button className="secondary-button" type="button" onClick={onContinue}>
            <RefreshCw size={16} aria-hidden="true" />
            Рекомендация: {nextRecommendation.title}
          </button>
        )}
        <button className="secondary-button" type="button" onClick={onBack}>В каталог</button>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {unlock.title}: {stateDescription(unlock.state)}. {reasonText(unlock.reason_code)}
      </span>
    </section>
  );
}
