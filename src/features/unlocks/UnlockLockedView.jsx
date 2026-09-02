import { ArrowRight, ChevronLeft, Lock, RefreshCw } from 'lucide-react';
import {
  stateDescription,
  UNLOCK_STATES,
} from '../../lib/unlockState';

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
  const requirements = (Array.isArray(unlock.requirements) ? unlock.requirements : [])
    .filter((requirement) => requirement && typeof requirement === 'object' && !Array.isArray(requirement));
  const premiumRequirements = premium
    ? requirements.filter((requirement) => (
      String(requirement.rule_type || requirement.kind || '').trim() === 'premium'
      || String(requirement.reason_code || '').trim() === 'PREMIUM_REQUIRED'
    ))
    : [];

  return (
    <section className="page unlock-locked-page" data-unlock-locked="true" data-locked-state={unlock.state} data-locked-reason={unlock.reason_code} data-locked-requirement-count={requirements.length}>
      <div className="player-topbar unlock-locked-topbar">
        <button className="back-button" type="button" onClick={onBack} aria-label="Назад в каталог">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="player-topbar-title">{unlock.title || 'Раскраска'}</span>
        <span className="unlock-locked-unavailable-chip">Недоступно</span>
      </div>

      <div className="unlock-locked-hero unlock-locked-hero--unavailable">
        <span className="unlock-locked-icon" aria-hidden="true">
          <Lock size={26} />
        </span>
        <p className="eyebrow">КОНТЕНТ НЕДОСТУПЕН</p>
        <h1>Эта работа пока недоступна</h1>
        <p className="unlock-locked-reason">Выберите доступную картину в каталоге. Условия старой системы прогресса больше не являются частью Splint.</p>
      </div>

      <div className="unlock-locked-requirements">
        <p className="unlock-locked-static-status">Доступ не выдан сервером. Splint не предлагает обходных способов открытия.</p>
        {premiumRequirements.map((requirement, index) => (
          <span
            className="sr-only"
            key={`premium-requirement-${String(requirement.target_value ?? requirement.target ?? index)}`}
            data-requirement-type="premium"
            data-requirement-reason-code={String(requirement.reason_code || 'PREMIUM_REQUIRED')}
            data-requirement-target-value={String(requirement.target_value ?? '')}
            data-requirement-satisfied={requirement.satisfied ? 'true' : 'false'}
          />
        ))}
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
        ) : (
          <button className="primary-button" type="button" onClick={onBrowse}>
            <ArrowRight size={17} aria-hidden="true" />
            Выбрать доступную картину
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
        {unlock.title}: {stateDescription(unlock.state)}. Контент недоступен.
      </span>
    </section>
  );
}
