import { ArrowRight, BookOpen, Check, ChevronLeft, Clock3, Crown, Heart, Lock, Paintbrush, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  PREMIUM_PACK_STATES,
  SHOWCASE_PREMIUM_PACK,
  isPremiumPackState,
  packStateLabel,
} from '../../lib/premiumPack.js';
import { formatContentMetadataDetail, formatPackContentMetadata, hasContentMetadata } from '../../lib/contentMetadata.js';
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

function packMetadata(pack) {
  const serverMetadata = formatContentMetadataDetail(pack);
  const items = Array.isArray(pack?.items) ? pack.items : [];
  if (serverMetadata.assessed) return { ...serverMetadata, line: formatPackContentMetadata(pack) };
  return {
    line: formatPackContentMetadata(pack),
    assessed: items.length > 0 && items.every(hasContentMetadata),
  };
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
      return 'Это примеры работ из набора. Просмотр не открывает сцены и не меняет ваш доступ.';
    case PREMIUM_PACK_STATES.FREE:
      return 'Этот набор доступен бесплатно. Откройте его и раскрашивайте в своём темпе.';
    case PREMIUM_PACK_STATES.OWNED:
      return 'Оплата подтверждена, набор открыт для вашего профиля. Прогресс и результаты сохраняются.';
    case PREMIUM_PACK_STATES.PAID:
      return `Одна покупка за ${pack.price_in_stars} Telegram Stars. После подтверждения оплаты откроются все ${pack.total_count || pack.items.length} сцены; прогресс и результаты сохраняются так же, как в бесплатных работах.`;
    case PREMIUM_PACK_STATES.LOCKED:
      return 'Сначала откройте бесплатный маршрут. После этого можно будет решить, нужен ли вам этот набор.';
    case PREMIUM_PACK_STATES.UNAVAILABLE:
    default:
      return 'Покупка сейчас недоступна. Оплата не запускается, набор остаётся закрытым.';
  }
}

function ItemPreview({ item, state, onOpen, featured = false }) {
  const canOpen = state === PREMIUM_PACK_STATES.OWNED || state === PREMIUM_PACK_STATES.FREE;
  const metadata = formatContentMetadataDetail(item);
  const dimensions = item.dimensions || (item.width && item.height ? `${item.width}×${item.height}` : 'Премиум-сцена');
  return <article className={`premium-pack-item${canOpen ? ' is-openable' : ''}${featured ? ' is-featured' : ''}`} data-premium-item-id={item.id} data-premium-item-state={state}>
    <div className="premium-pack-item-image" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined}>
      {!canOpen && <span className="premium-pack-item-preview-label">ПРИМЕР · ДОСТУП ЗАКРЫТ</span>}
      {!canOpen && <span className="premium-pack-item-lock" aria-hidden="true"><Lock size={15} /></span>}
    </div>
    <div className="premium-pack-item-copy">
      <div className="premium-pack-item-title"><b>{item.title}</b><small data-content-metadata={metadata.assessed ? 'authoritative' : 'unassessed'}>{dimensions} · {metadata.line}</small></div>
      <p>{item.description}</p>
      {canOpen ? <button type="button" className="premium-pack-item-action" onClick={() => onOpen?.(item.id)}>
        {state === PREMIUM_PACK_STATES.OWNED ? 'Открыть' : 'Начать'} <ArrowRight size={14} aria-hidden="true" />
      </button> : <span className="premium-pack-item-locked"><Lock size={12} aria-hidden="true" /> Доступ после открытия набора</span>}
    </div>
  </article>;
}

export function PremiumPackTeaser({ pack = SHOWCASE_PREMIUM_PACK, state = PREMIUM_PACK_STATES.UNAVAILABLE, onOpen }) {
  const metadata = packMetadata(pack);
  const totalCount = pack.total_count || pack.items.length;
  const price = Number(pack.price_in_stars) || 0;
  return <button className="premium-pack-teaser" type="button" onClick={onOpen} data-premium-pack-teaser="true" data-premium-state={stateClass(state)}>
    <span className="premium-pack-teaser-image" style={pack.image_url ? { backgroundImage: `url(${pack.image_url})` } : undefined}>
      <Crown size={17} aria-hidden="true" />
    </span>
    <span className="premium-pack-teaser-copy"><small>PREMIUM GALLERY · РАЗОВАЯ ПОКУПКА</small><b>{pack.title}</b><span data-content-metadata={metadata.assessed ? 'authoritative' : 'unassessed'}>{totalCount} работ · яркие миры и атмосферные истории</span><span className="premium-pack-teaser-offer">{price} ⭐ один раз · без подписки <i>{packStateLabel(state)}</i></span></span>
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
  const metadata = packMetadata(pack);
  const totalCount = pack.total_count || pack.items.length;
  const previewItems = Array.isArray(pack.items) ? pack.items : [];
  const price = Number(pack.price_in_stars) || 0;
  const [wishSaved, setWishSaved] = useState(() => Boolean(readWishes()[pack.id]));
  const pageRef = useRef(null);

  useEffect(() => {
    const page = pageRef.current;
    const scrollArea = page?.closest('.screen-content');
    if (!page || !scrollArea) return undefined;
    const pageTop = page.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top + scrollArea.scrollTop;
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'instant' : 'smooth';
    scrollArea.scrollTo({ top: Math.max(0, pageTop), behavior });
    return undefined;
  }, []);

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
          ? { label: `Купить набор · ${price} Stars`, onClick: requestAccess }
        : safeState === PREMIUM_PACK_STATES.LOCKED
          ? { label: 'Продолжить бесплатный путь', onClick: onOpenFree }
          : { label: wishSaved ? 'Желание сохранено' : 'Сохранить желание', onClick: saveWish };

  return <section ref={pageRef} className="premium-pack-page" data-premium-pack="true" data-premium-state={safeState} data-premium-entitlement={safeState === PREMIUM_PACK_STATES.OWNED ? 'owned' : 'not-owned'}>
    <div className="premium-pack-topbar">
      <button type="button" className="premium-pack-back" onClick={onBack} aria-label="Назад в каталог"><ChevronLeft size={18} aria-hidden="true" /></button>
      <span>Premium Gallery</span>
      <PackStateChip state={safeState} />
    </div>

    <div className="premium-pack-hero" style={pack.image_url ? { '--premium-pack-image': `url(${pack.image_url})` } : undefined}>
      <div className="premium-pack-hero-art" aria-hidden="true" />
      <div className="premium-pack-hero-copy">
        <p className="eyebrow">БОЛЬШЕ МИРОВ ДЛЯ РАСКРАШИВАНИЯ</p>
        <h1>{pack.title}</h1>
        <p>{pack.description}</p>
        <span className="premium-pack-creator"><Sparkles size={13} aria-hidden="true" /> {pack.creator}</span>
      </div>
    </div>

    <div className="premium-pack-meta" aria-label="Состав набора">
      <span><BookOpen size={14} aria-hidden="true" /><b>{totalCount}</b> сцен в наборе</span>
      <span data-content-metadata={metadata.assessed ? 'authoritative' : 'unassessed'}><Clock3 size={14} aria-hidden="true" /><b>{metadata.line}</b></span>
      <span><Crown size={14} aria-hidden="true" /><b>{price} ⭐</b> разовая покупка</span>
    </div>

    <div className={`premium-pack-entitlement premium-pack-entitlement--${safeState}`} role="status" data-premium-entitlement-message="true">
      {safeState === PREMIUM_PACK_STATES.OWNED ? <Check size={17} aria-hidden="true" /> : safeState === PREMIUM_PACK_STATES.UNAVAILABLE ? <Lock size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
      <p>{stateDescription(safeState, pack)}</p>
    </div>

    <div className="premium-pack-actions">
      <button type="button" className="primary-button" onClick={primaryAction.onClick} disabled={safeState === PREMIUM_PACK_STATES.OWNED && !pack.items.length} data-premium-primary-action="true">
        {primaryAction.label} <ArrowRight size={16} aria-hidden="true" />
      </button>
      {safeState !== PREMIUM_PACK_STATES.OWNED && safeState !== PREMIUM_PACK_STATES.FREE && safeState !== PREMIUM_PACK_STATES.UNAVAILABLE && <button type="button" className="secondary-button premium-pack-wish-button" onClick={saveWish} aria-pressed={wishSaved} data-premium-wish="true"><Heart size={15} fill={wishSaved ? 'currentColor' : 'none'} aria-hidden="true" /> {wishSaved ? 'В списке желаний' : 'Сохранить в список желаний'}</button>}
    </div>

    {safeState === PREMIUM_PACK_STATES.LOCKED && prerequisite && <div className="premium-pack-prerequisite" data-premium-prerequisite="true">
      <div><span>Бесплатный маршрут</span><b>{prerequisite.current} / {prerequisite.total}</b></div>
      <span className="premium-pack-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((prerequisite.current / Math.max(1, prerequisite.total)) * 100)}><i style={{ width: `${Math.min(100, Math.max(0, prerequisite.current / Math.max(1, prerequisite.total) * 100))}%` }} /></span>
    </div>}

    <section className="premium-pack-value" aria-labelledby="premium-value-title">
      <div className="premium-pack-section-heading"><div><p className="eyebrow">БЕЗ СЮРПРИЗОВ</p><h2 id="premium-value-title">Что вы получаете</h2></div></div>
      <ul className="premium-pack-benefits">
        <li><BookOpen size={17} aria-hidden="true" /><span><b>{totalCount} дополнительных сцен</b><small>Космические, неоновые и спокойные миры для вашей коллекции.</small></span></li>
        <li><Paintbrush size={17} aria-hidden="true" /><span><b>Все сцены набора открыты</b><small>После подтверждения оплаты можно выбрать любую и начать раскрашивать.</small></span></li>
        <li><ShieldCheck size={17} aria-hidden="true" /><span><b>Ваш прогресс остаётся вашим</b><small>Раскрашивание, сохранение и готовый результат работают как в бесплатных сценах.</small></span></li>
      </ul>
      <div className="premium-pack-choice"><span><b>Бесплатно</b><small>Полноценные работы, которые уже можно раскрашивать и сохранять.</small></span><span><b>Premium</b><small>Ещё {totalCount} миров, доступных после одной покупки.</small></span></div>
      <div className="premium-pack-price"><span><b>{price} ⭐</b><small>Telegram Stars · один раз</small></span><p>Без подписки. Это цифровой набор для личного раскрашивания; выплаты авторам и продажи работ на площадке не входят.</p></div>
    </section>

    <div className="premium-pack-section-heading"><div><p className="eyebrow">НЕБОЛЬШАЯ ВЫБОРКА</p><h2>Посмотрите на работы</h2></div><span>{previewItems.length} примера из {totalCount}</span></div>
    <div className="premium-pack-items">{previewItems.map((item, index) => <ItemPreview key={item.id} item={item} state={safeState} onOpen={onOpenItem} featured={index === 0} />)}</div>
    <p className="premium-pack-footnote"><Sparkles size={13} aria-hidden="true" /> Бесплатная часть остаётся полноценной: Premium добавляет выбор, а не ограничивает уже доступные работы.</p>
  </section>;
}
