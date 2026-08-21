import { useEffect, useMemo, useReducer, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, ExternalLink, LoaderCircle, RefreshCw, Share2, Sparkles, X } from 'lucide-react';
import {
  CHECKOUT_STATES,
  PACK_STATES,
  canCheckout,
  checkoutStateLabel,
  normalizeStorePacks,
  packStateLabel,
  reduceCheckoutState,
} from '../lib/packStore';
import { buildPackDeepLink, shareViaTelegram } from '../lib/telegram';
import { formatContentMetadataDetail } from '../lib/contentMetadata.js';

function paymentResultIsSuccessful(result) {
  return Boolean(
    (result?.success === true || result === true)
      && (result?.server_confirmed === true
        || result?.entitlement_status === 'active'
        || result?.entitlement?.status === 'active'),
  );
}

function paymentResultIsCancelled(result) {
  return result?.cancelled === true || result?.status === CHECKOUT_STATES.CANCELLED;
}

function initialCheckoutState() {
  return reduceCheckoutState(undefined, { type: 'RESET' });
}

function packCopy(pack) {
  if (pack.pack_state === PACK_STATES.OWNED) return 'Открыто в вашем профиле';
  if (pack.pack_state === PACK_STATES.FREE) return 'Бесплатный набор · можно начать сейчас';
  if (pack.pack_state === PACK_STATES.PAID) return `${pack.price_in_stars} Stars · покупка пока отключена`;
  return 'Этот набор сейчас недоступен';
}

function PackPreview({ pack, onSelect }) {
  const progress = pack.total_count > 0 ? Math.round((pack.completed_count / pack.total_count) * 100) : 0;
  const metadata = formatContentMetadataDetail(pack);
  return (
    <button
      className={`store-pack-card store-pack-card--${pack.pack_state}`}
      type="button"
      data-pack-id={pack.id}
      data-pack-state={pack.pack_state}
      onClick={() => onSelect(pack.id)}
    >
      <span
        className="store-pack-art"
        style={pack.image_url ? { backgroundImage: `url(${pack.image_url})` } : undefined}
      >
        <BookOpen size={22} aria-hidden="true" />
        <em>{packStateLabel(pack.pack_state)}</em>
      </span>
      <span className="store-pack-copy">
        <b>{pack.title}</b>
        <small>{pack.description || `${pack.total_count || 0} работ · ${pack.rarity}`}</small>
        <small data-content-metadata={metadata.assessed ? 'authoritative' : 'unassessed'}>{metadata.line}</small>
        <span className="store-pack-meta">{packCopy(pack)}</span>
        {pack.total_count > 0 && (
          <span className="store-pack-progress" aria-label={`${pack.completed_count} из ${pack.total_count} завершено`}>
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>
      <ArrowRight size={17} aria-hidden="true" />
    </button>
  );
}

export default function StoreView({
  collections = [],
  unlockSnapshot = null,
  requestedPackId = null,
  loading = false,
  error = false,
  paymentsMode = 'disabled',
  onRetry,
  onOpenCollection,
  onBack,
  onTrack = () => {},
  onNotice = () => {},
  onPurchase = null,
  onRestore = null,
}) {
  const packs = useMemo(() => normalizeStorePacks(collections, unlockSnapshot, {
    paymentsMode,
    limit: 12,
    paidLimit: 1,
  }), [collections, paymentsMode, unlockSnapshot]);
  const [selectedPackId, setSelectedPackId] = useState(requestedPackId || null);
  const [checkout, dispatchCheckout] = useReducer(reduceCheckoutState, undefined, initialCheckoutState);
  const [shareLink, setShareLink] = useState('');

  useEffect(() => {
    if (requestedPackId && packs.some((pack) => pack.id === requestedPackId)) setSelectedPackId(requestedPackId);
  }, [packs, requestedPackId]);

  useEffect(() => {
    if (!packs.length) return;
    if (selectedPackId && packs.some((pack) => pack.id === selectedPackId)) return;
    setSelectedPackId(packs[0].id);
  }, [packs, selectedPackId]);

  const selected = packs.find((pack) => pack.id === selectedPackId) || null;
  const selectedMetadata = formatContentMetadataDetail(selected);

  useEffect(() => {
    dispatchCheckout({ type: 'RESET' });
    setShareLink('');
  }, [selected?.id]);

  function selectPack(packId) {
    setSelectedPackId(packId);
    onTrack('pack_preview_opened', { collection_id: packId });
  }

  async function runPayment(kind) {
    if (!selected || !canCheckout(selected, paymentsMode)) return;
    const callback = kind === 'restore' ? onRestore : onPurchase;
    dispatchCheckout({ type: kind === 'restore' ? 'RESTORE' : 'BEGIN', requestId: `${kind}:${selected.id}` });
    if (typeof callback !== 'function') {
      dispatchCheckout({ type: 'FAIL', error: 'Платежи пока недоступны' });
      return;
    }
    try {
      const result = await callback(selected);
      if (paymentResultIsCancelled(result)) {
        dispatchCheckout({ type: 'CANCEL', reason: 'user' });
      } else if (paymentResultIsSuccessful(result)) {
        dispatchCheckout({ type: kind === 'restore' ? 'RESTORE_SUCCESS' : 'SUCCESS', operationId: result.operation_id });
        onTrack(kind === 'restore' ? 'pack_purchase_restored' : 'pack_purchase_confirmed', { collection_id: selected.id });
      } else {
        dispatchCheckout({ type: 'FAIL', error: result?.success ? 'Платёж принят, но доступ ещё не подтверждён сервером' : (result?.error || 'Не удалось подтвердить покупку') });
      }
    } catch (paymentError) {
      if (paymentError?.name === 'AbortError' || paymentError?.code === 'CANCELLED') {
        dispatchCheckout({ type: 'CANCEL', reason: 'user' });
      } else {
        dispatchCheckout({ type: 'FAIL', error: paymentError?.message || 'Не удалось подтвердить покупку' });
      }
    }
  }

  async function sharePack() {
    if (!selected) return;
    const url = buildPackDeepLink(selected.id);
    const text = `Посмотри набор «${selected.title}» в SPLINT Pixel Studio.`;
    setShareLink(url);
    try {
      const channel = await shareViaTelegram({ url, text });
      if (channel === 'telegram') onTrack('share_telegram', { collection_id: selected.id, object: 'pack' });
      else if (channel === 'native') onTrack('share_native', { collection_id: selected.id, object: 'pack' });
      else onNotice('Ссылка на набор готова — скопируйте её ниже.', 'info');
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') onNotice('Не удалось открыть меню отправки.', 'error');
    }
  }

  async function copyPackLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard?.writeText(shareLink);
      onNotice('Ссылка скопирована.', 'success');
    } catch {
      onNotice('Скопируйте ссылку вручную.', 'info');
    }
  }

  function openSelected() {
    if (!selected || !onOpenCollection) return;
    onTrack('pack_opened', { collection_id: selected.id, state: selected.pack_state });
    onOpenCollection(selected);
  }

  const checkoutEnabled = selected ? canCheckout(selected, paymentsMode) : false;
  const retryable = checkout.status === CHECKOUT_STATES.ERROR || checkout.status === CHECKOUT_STATES.CANCELLED;

  return (
    <section className="page store-page" data-store-page data-payments-mode={paymentsMode}>
      <div className="page-heading store-heading">
        <div>
          <p className="eyebrow">ВИТРИНА</p>
          <h1>Наборы, к которым хочется вернуться</h1>
        </div>
        {onBack && <button className="store-back-button" type="button" onClick={onBack}><ArrowLeft size={16} /> Каталог</button>}
      </div>

      <div className="store-intro">
        <Sparkles size={18} aria-hidden="true" />
        <p>Один showcase-набор и ваши открытые коллекции. Здесь нет бустеров, энергии или скрытых условий.</p>
      </div>

      {loading && !packs.length ? (
        <div className="loading" role="status"><LoaderCircle className="spin" size={17} /> Загружаем наборы…</div>
      ) : error && !packs.length ? (
        <div className="error-retry" data-store-error="true"><p>Не удалось загрузить наборы.</p><button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={15} /> Повторить</button></div>
      ) : !packs.length ? (
        <div className="store-empty"><BookOpen size={24} /><p>Наборы появятся после загрузки каталога.</p></div>
      ) : (
        <>
          <div className="store-pack-list" aria-label="Наборы">
            {packs.map((pack) => <PackPreview key={pack.id} pack={pack} onSelect={selectPack} />)}
          </div>

          {selected && <section className={`store-detail store-detail--${selected.pack_state}`} data-selected-pack={selected.id} data-pack-state={selected.pack_state}>
            <div className="store-detail-head">
              <span className="store-detail-preview" style={selected.image_url ? { backgroundImage: `url(${selected.image_url})` } : undefined}><BookOpen size={24} aria-hidden="true" /></span>
              <div><p className="eyebrow">{packStateLabel(selected.pack_state)}</p><h2>{selected.title}</h2><small>{selected.total_count || 0} работ · {selected.rarity}</small><small data-content-metadata={selectedMetadata.assessed ? 'authoritative' : 'unassessed'}>{selectedMetadata.line}</small></div>
            </div>
            {selected.description && <p className="store-detail-description">{selected.description}</p>}

            {selected.pack_state === PACK_STATES.PAID && <div className="store-payment-notice" data-payment-availability={checkoutEnabled ? 'enabled' : 'disabled'}>
              <strong>{selected.price_in_stars} Stars</strong>
              <span>{checkoutEnabled ? 'Покупка проходит через подтверждённый Telegram-поток.' : 'Платежи пока отключены. Можно сохранить набор и вернуться позже.'}</span>
            </div>}

            {checkout.status !== CHECKOUT_STATES.IDLE && <div className={`store-checkout-status store-checkout-status--${checkout.status}`} data-checkout-state={checkout.status} role="status">
              {checkout.status === CHECKOUT_STATES.PENDING || checkout.status === CHECKOUT_STATES.RESTORING ? <LoaderCircle className="spin" size={16} /> : checkout.status === CHECKOUT_STATES.SUCCESS ? <Check size={16} /> : <X size={16} />}
              <span>{checkoutStateLabel(checkout.status) || checkout.reason || checkout.error}</span>
              {checkout.status === CHECKOUT_STATES.PENDING && <button type="button" onClick={() => dispatchCheckout({ type: 'CANCEL', reason: 'user' })}>Отмена</button>}
            </div>}

            <div className="store-detail-actions">
              {(selected.pack_state === PACK_STATES.FREE || selected.pack_state === PACK_STATES.OWNED) && <button className="primary-button" type="button" onClick={openSelected}><ArrowRight size={16} /> Открыть набор</button>}
              {selected.pack_state === PACK_STATES.PAID && <button className="primary-button" type="button" disabled={!checkoutEnabled || checkout.status === CHECKOUT_STATES.PENDING || checkout.status === CHECKOUT_STATES.RESTORING} onClick={() => runPayment('purchase')} data-purchase-action="buy">{checkout.status === CHECKOUT_STATES.PENDING ? <><LoaderCircle className="spin" size={16} /> Проверяем…</> : `Купить за ${selected.price_in_stars} Stars`}</button>}
              {retryable && checkoutEnabled && <button className="secondary-button" type="button" onClick={() => runPayment('purchase')} data-purchase-action="retry"><RefreshCw size={15} /> Попробовать снова</button>}
              {selected.pack_state === PACK_STATES.PAID && <button className="secondary-button" type="button" disabled={!checkoutEnabled || checkout.status === CHECKOUT_STATES.RESTORING} onClick={() => runPayment('restore')} data-purchase-action="restore"><RefreshCw size={15} /> Восстановить покупку</button>}
              {selected.pack_state === PACK_STATES.UNAVAILABLE && <p className="store-unavailable-copy">Этот набор сейчас недоступен.</p>}
              <button className="store-share-button" type="button" onClick={sharePack}><Share2 size={16} /> Поделиться набором</button>
            </div>

            {shareLink && <div className="store-share-link" data-share-link="true"><ExternalLink size={14} aria-hidden="true" /><code>{shareLink}</code><button type="button" onClick={copyPackLink} aria-label="Скопировать ссылку"><Copy size={15} /></button></div>}
          </section>}
        </>
      )}
    </section>
  );
}
