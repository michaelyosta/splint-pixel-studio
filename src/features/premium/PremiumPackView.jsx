import { ArrowRight, BookOpen, Check, ChevronLeft, Clock3, Crown, Heart, Lock, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  PREMIUM_PACK_STATES,
  SHOWCASE_PREMIUM_PACK,
  isPremiumPackState,
  packStateLabel,
  packTotalMinutes,
} from '../../lib/premiumPack.js';
import './premiumPack.css';

const WISH_KEY = 'splint:premium-pack-wishes';

function readWishes() {
  try {
    const value = JSON.parse(window.localStorage.getItem(WISH_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeWish(packId) {
  try {
    const wishes = readWishes();
    wishes[packId] = true;
    window.localStorage.setItem(WISH_KEY, JSON.stringify(wishes));
  } catch {
    // Private mode and Telegram's restricted storage are both valid cases.
  }
}

function stateClass(state) {
  return isPremiumPackState(state) ? state : PREMIUM_PACK_STATES.UNAVAILABLE;
}

function PackStateChip({ state }) {
  const Icon = state === PREMIUM_PACK_STATES.OWNED
    ? Check
    : state === PREMIUM_PACK_STATES.PAID
      ? Crown
      : state === PREMIUM_PACK_STATES.LOCKED
        ? Lock
        : Sparkles;
  return <span className={`premium-pack-state premium-pack-state--${stateClass(state)}`} data-premium-state-chip={state}>
    <Icon size={13} aria-hidden="true" />
    {packStateLabel(state)}
  </span>;
}

function stateDescription(state, pack) {
  switch (state) {
    case PREMIUM_PACK_STATES.PREVIEW:
      return 'Посмотрите стиль и будущий маршрут. Предпросмотр не меняет доступ.';
    case PREMIUM_PACK_STATES.FREE:
      return 'Набор доступен без оплаты. Открытие закрепит его в профиле.';
    case PREMIUM_PACK_STATES.OWNED:
      return 'Доступ привязан к вашему профилю. Можно продолжить с любой сцены.';
    case PREMIUM_PACK_STATES.PAID:
      return `Платный доступ — ${pack.price_in_stars} Stars. Этот экран только показывает гипотезу, покупка здесь не выполняется.`;
    case PREMIUM_PACK_STATES.LOCKED:
      return 'Сначала завершите бесплатный маршрут — после этого набор станет следующим шагом.';
    case PREMIUM_PACK_STATES.UNAVAILABLE:
    default:
      return 'Платёжный режим пока отключён. Stars не списываются, entitlement не создаётся.';
  }
}

function ItemPreview({ item, state, onOpen }) {
  const canOpen = state === PREMIUM_PACK_STATES.OWNED || state === PREMIUM_PACK_STATES.FREE;
  return <article className={`premium-pack-item${canOpen ? ' is-openable' : ''}`} data-premium-item-id={item.id} data-premium-item-state={state}>
    <div className="premium-pack-item-image" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined}>
      {!canOpen && <span className="premium-pack-item-preview-label">ПРЕВЬЮ</span>}
    </div>
    <div className="premium-pack-item-copy">
      <div className="premium-pack-item-title"><b>{item.title}</b><small>{item.dimensions} · {item.est_minutes} мин</small></div>
      <p>{item.description}</p>
      {canOpen ? <button type="button" className="premium-pack-item-action" onClick={() => onOpen?.(item.id)}>
        {state === PREMIUM_PACK_STATES.OWNED ? 'Открыть' : 'Начать'} <ArrowRight size={14} aria-hidden="true" />
      </button> : <span className="premium-pack-item-locked"><Lock size={12} aria-hidden="true" /> Доступ после открытия набора</span>}
    </div>
  </article>;
}

export function PremiumPackTeaser({ pack = SHOWCASE_PREMIUM_PACK, state = PREMIUM_PACK_STATES.UNAVAILABLE, onOpen }) {
  return <button className="premium-pack-teaser" type="button" onClick={onOpen} data-premium-pack-teaser="true" data-premium-state={stateClass(state)}>
    <span className="premium-pack-teaser-image" style={pack.image_url ? { backgroundImage: `url(${pack.image_url})` } : undefined}>
      <Crown size={17} aria-hidden="true" />
    </span>
    <span className="premium-pack-teaser-copy"><small>{pack.eyebrow}</small><b>{pack.title}</b><span>{pack.items.length} работы · {packTotalMinutes(pack)} мин · {packStateLabel(state)}</span></span>
    <ArrowRight size={17} aria-hidden="true" />
  </button>;
}

export default function PremiumPackView({
  pack = SHOWCASE_PREMIUM_PACK,
  state = PREMIUM_PACK_STATES.UNAVAILABLE,
  onBack,
  onOpenItem,
  onOpenFree,
  onPurchaseIntent,
  onSaveWish,
  prerequisite = null,
}) {
  const safeState = stateClass(state);
  const [wishSaved, setWishSaved] = useState(() => Boolean(readWishes()[pack.id]));

  function saveWish() {
    writeWish(pack.id);
    setWishSaved(true);
    onSaveWish?.(pack);
  }

  function requestAccess() {
    saveWish();
    onPurchaseIntent?.(pack);
  }

  const primaryAction = safeState === PREMIUM_PACK_STATES.OWNED
    ? { label: 'Продолжить набор', onClick: () => onOpenItem?.(pack.items[0]?.id) }
    : safeState === PREMIUM_PACK_STATES.FREE
      ? { label: 'Открыть бесплатно', onClick: onOpenFree }
      : safeState === PREMIUM_PACK_STATES.PAID
        ? { label: `Запросить доступ · ${pack.price_in_stars} Stars`, onClick: requestAccess }
        : safeState === PREMIUM_PACK_STATES.LOCKED
          ? { label: 'Продолжить бесплатный путь', onClick: onOpenFree }
          : { label: wishSaved ? 'Желание сохранено' : 'Сохранить желание', onClick: saveWish };

  return <section className="premium-pack-page" data-premium-pack="true" data-premium-state={safeState} data-premium-entitlement={safeState === PREMIUM_PACK_STATES.OWNED ? 'owned' : 'not-owned'}>
    <div className="premium-pack-topbar">
      <button type="button" className="premium-pack-back" onClick={onBack} aria-label="Назад в каталог"><ChevronLeft size={18} aria-hidden="true" /></button>
      <span>Витрина наборов</span>
      <PackStateChip state={safeState} />
    </div>

    <div className="premium-pack-hero" style={pack.image_url ? { '--premium-pack-image': `url(${pack.image_url})` } : undefined}>
      <div className="premium-pack-hero-art" aria-hidden="true" />
      <div className="premium-pack-hero-copy">
        <p className="eyebrow">{pack.eyebrow}</p>
        <h1>{pack.title}</h1>
        <p>{pack.description}</p>
        <span className="premium-pack-creator"><Sparkles size={13} aria-hidden="true" /> {pack.creator}</span>
      </div>
    </div>

    <div className="premium-pack-meta" aria-label="Состав набора">
      <span><BookOpen size={14} aria-hidden="true" /><b>{pack.items.length}</b> работы</span>
      <span><Clock3 size={14} aria-hidden="true" /><b>{packTotalMinutes(pack)}</b> минут</span>
      <span><Crown size={14} aria-hidden="true" /><b>{pack.price_in_stars}</b> Stars</span>
    </div>

    <div className={`premium-pack-entitlement premium-pack-entitlement--${safeState}`} role="status" data-premium-entitlement-message="true">
      {safeState === PREMIUM_PACK_STATES.OWNED ? <Check size={17} aria-hidden="true" /> : safeState === PREMIUM_PACK_STATES.UNAVAILABLE ? <Lock size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
      <p>{stateDescription(safeState, pack)}</p>
    </div>

    {safeState === PREMIUM_PACK_STATES.LOCKED && prerequisite && <div className="premium-pack-prerequisite" data-premium-prerequisite="true">
      <div><span>Бесплатный маршрут</span><b>{prerequisite.current} / {prerequisite.total}</b></div>
      <span className="premium-pack-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((prerequisite.current / Math.max(1, prerequisite.total)) * 100)}><i style={{ width: `${Math.min(100, Math.max(0, prerequisite.current / Math.max(1, prerequisite.total) * 100))}%` }} /></span>
    </div>}

    <div className="premium-pack-actions">
      <button type="button" className="primary-button" onClick={primaryAction.onClick} disabled={safeState === PREMIUM_PACK_STATES.OWNED && !pack.items.length} data-premium-primary-action="true">
        {primaryAction.label} <ArrowRight size={16} aria-hidden="true" />
      </button>
      {safeState !== PREMIUM_PACK_STATES.OWNED && safeState !== PREMIUM_PACK_STATES.FREE && <button type="button" className="secondary-button premium-pack-wish-button" onClick={saveWish} aria-pressed={wishSaved} data-premium-wish="true"><Heart size={15} fill={wishSaved ? 'currentColor' : 'none'} aria-hidden="true" /> {wishSaved ? 'В списке желаний' : 'Сохранить в список желаний'}</button>}
    </div>

    <div className="premium-pack-section-heading"><div><p className="eyebrow">ПРЕДПРОСМОТР</p><h2>Что внутри</h2></div><span>Quality gate {pack.quality_gate_version}</span></div>
    <div className="premium-pack-items">{pack.items.map((item) => <ItemPreview key={item.id} item={item} state={safeState} onOpen={onOpenItem} />)}</div>
    <p className="premium-pack-footnote"><Sparkles size={13} aria-hidden="true" /> Честные previews, короткие сцены и финальный reveal — без оплаты за удобство игры.</p>
  </section>;
}
