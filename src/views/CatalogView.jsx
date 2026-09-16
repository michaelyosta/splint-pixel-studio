import { ArrowRight, BookOpen, Crown, Flame, Heart, Sparkles, Star, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MOODS, THEMES } from '../lib/catalogMeta';
import { prefetchColoring } from '../lib/coloringPrefetch';
import { hapticImpact, hapticSelection } from '../lib/telegram';
import { formatContentMetadataDetail } from '../lib/contentMetadata.js';
import {
  PREMIUM_PACK_STATES,
  SHOWCASE_PREMIUM_PACK,
  findPremiumEntitlement,
  mergeShowcasePackServerProjection,
  resolvePremiumPackState,
} from '../lib/premiumPack.js';
import { createPremiumPackPurchaseIntent } from '../lib/premiumPurchase.js';
import PremiumPackView, { PremiumPackTeaser } from '../features/premium/PremiumPackView.jsx';

export default function CatalogView({
  templates,
  shelves = [],
  loading,
  catalogError,
  mine,
  today,
  streak,
  filters,
  onChangeFilters,
  collections,
  requestedPackId = null,
  catalogChip,
  onChangeChip,
  catalogQuery,
  onChangeQuery,
  catalogCollection,
  onResetScope,
  visibleCount,
  onShowMore,
  onOpen,
  onRetryCatalog,
  onRate,
  ratingTemplateId,
  currentUser,
  onToggleFavorite,
  favoriteSavingId,
  onOpenCollection,
  unlockData,
  onOpenPremiumItem,
  onOpenFreePack,
  onPremiumWish,
  paymentsMode = 'disabled',
  onOpenStore,
  onTrack = () => {},
}) {
  const [activeShelfId, setActiveShelfId] = useState(null);
  const renderCatalogLegacy = () => {
    const progressMap = {};
    mine.forEach((item) => { if (item.progress?.percent > 0) progressMap[item.id] = item.progress.percent; });
    const continueItem = mine
      .filter((item) => item.progress?.percent > 0 && item.progress.percent < 100)
      .sort((first, second) => second.progress.percent - first.progress.percent)[0];
    const visibleTemplates = templates.slice(0, visibleCount);
    return <section className="page catalog-page">
      <div className="page-heading"><div><p className="eyebrow">PIXEL BY NUMBERS</p><h1>Раскраски</h1></div></div>
      {continueItem && <div className="continue-banner">
        <p className="eyebrow">Продолжить</p>
        <button className="continue-card" onClick={() => onOpen(continueItem.id)}>
          <span className="continue-preview" style={continueItem.preview_url ? { backgroundImage: `url(${continueItem.preview_url})` } : undefined} />
          <span className="continue-info">
            <b>{continueItem.title}</b>
            <span className="continue-track"><span className="continue-fill" style={{ width: `${continueItem.progress.percent}%` }} /></span>
          </span>
          <span className="continue-pct">{continueItem.progress.percent}%</span>
        </button>
      </div>}
      {today?.for_you && <div className="editorial-banner">
        <p className="eyebrow">СЕГОДНЯ ДЛЯ ВАС</p>
        <button className="editorial-card" onClick={() => onOpen(today.for_you.id)}>
          <span className="editorial-preview" style={today.for_you.preview_url ? { backgroundImage: `url(${today.for_you.preview_url})` } : undefined} />
          <span className="editorial-info"><b>{today.for_you.title}</b><small>{formatContentMetadataDetail(today.for_you).line} · {today.for_you.width}×{today.for_you.height}</small></span>
          <Sparkles size={18} />
        </button>
      </div>}
      {streak && <div className="streak-banner">
        <Flame size={18} className={streak.done_today ? 'lit' : ''} />
        <span>{streak.done_today ? `Серия ${streak.current_streak} дн. — сегодня готово!` : `Серия ${streak.current_streak} дн. — раскрасьте сегодня!`}</span>
      </div>}
      {today?.quick?.length > 0 && <div className="quick-row">
        <span className="quick-label">Быстрая до 3 мин</span>
        <div className="quick-scroll">{today.quick.map((item) => <button key={item.id} className="quick-chip" onClick={() => onOpen(item.id)}>
          <span className="quick-chip-preview" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined} />
          <small>{formatContentMetadataDetail(item).duration}</small>
        </button>)}</div>
      </div>}
      <div className="filter-bar">
        <select value={filters.mood} onChange={(e) => { hapticSelection(); onChangeFilters({ mood: e.target.value }); }}>
          {MOODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select value={filters.theme} onChange={(e) => { hapticSelection(); onChangeFilters({ theme: e.target.value }); }}>
          {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={filters.max_minutes} onChange={(e) => { hapticSelection(); onChangeFilters({ max_minutes: e.target.value }); }}>
          <option value="">Любая длит.</option>
          <option value="3">≤ 3 мин</option>
          <option value="5">≤ 5 мин</option>
        </select>
      </div>
      {loading && !templates.length ? <div className="skeleton-grid" aria-label="Загружаем каталог">{[0, 1, 2, 3].map((i) => <div className="skeleton-card" key={i}><div className="skeleton-block skeleton-preview" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /><div className="skeleton-block skeleton-line" /></div>)}</div> : catalogError && !templates.length ? <div className="error-retry"><p>Не удалось загрузить каталог</p><button className="secondary-button" onClick={onRetryCatalog}>Повторить</button></div> : <>
        <div className="coloring-grid">{visibleTemplates.map((item) => <article className="coloring-card" key={item.id} onMouseEnter={() => prefetchColoring(item.id)} onTouchStart={() => prefetchColoring(item.id)}>
          <div className="card-preview" style={item.preview_url ? { backgroundImage: `linear-gradient(180deg, transparent, #14222e), url(${item.preview_url})` } : undefined}>{progressMap[item.id] > 0 ? <span className="progress-badge">{progressMap[item.id]}%</span> : <span>{formatContentMetadataDetail(item).duration}</span>}</div>
          <div className="card-body"><h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.title}</h2><p style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: '2.6em' }}>{item.description}</p><small data-content-metadata={formatContentMetadataDetail(item).assessed ? 'authoritative' : 'unassessed'} style={{ minHeight: '1.4em', display: 'block' }}>{item.width}×{item.height} · {formatContentMetadataDetail(item).line}</small>
            <div className="template-rating" aria-label={`Рейтинг ${item.rating_average ? item.rating_average.toFixed(1) : 'без оценок'}`}>
              <div className="rating-stars">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" disabled={ratingTemplateId === item.id || item.owner_id === currentUser?.id} className={value <= (item.viewer_rating || 0) ? 'selected' : ''} onClick={() => onRate(item, value)} aria-label={`Оценить на ${value}`}><Star size={15} fill={value <= (item.viewer_rating || 0) ? 'currentColor' : 'none'} /></button>)}</div>
              <span>{item.rating_count ? `${item.rating_average.toFixed(1)} · ${item.rating_count}` : 'Нет оценок'}</span>
            </div>
            <button className="primary-button" onClick={() => { hapticImpact('light'); onOpen(item.id); }}>Начать</button></div>
        </article>)}</div>
        {templates.length > visibleCount && <div className="show-more-wrap"><button className="secondary-button" onClick={onShowMore}>Показать ещё ({templates.length - visibleCount})</button></div>}
      </>}
    </section>;
  };

  useEffect(() => {
    if (!shelves.length) return;
    shelves.forEach((shelf) => onTrack('shelf_view', { shelf_id: shelf.id, item_count: shelf.total_count }));
  }, [onTrack, shelves]);

  useEffect(() => {
    if (catalogQuery.trim()) onTrack('search_used', { query_length: Math.min(100, catalogQuery.trim().length) });
  }, [catalogQuery, onTrack]);

  if (import.meta.env.VITE_USE_LEGACY_CATALOG === 'true') return renderCatalogLegacy();

  const normalize = (value) => String(value || '').toLocaleLowerCase('ru-RU');
  const query = normalize(catalogQuery.trim());
  const matchesSearch = (item) => !query || [item.title, item.description, item.category, item.theme, item.mood, item.collection_title, item.album_title, ...(item.tags || [])]
    .some((value) => normalize(value).includes(query));
  const searchedTemplates = templates.filter(matchesSearch);
  const freeTemplates = searchedTemplates.filter((item) => item.access !== 'premium');
  const activeShelf = shelves.find((shelf) => shelf.id === activeShelfId) || null;
  const activeShelfItemIds = activeShelf ? new Set(activeShelf.item_ids || activeShelf.items.map((item) => item.id)) : null;
  const shelfTemplates = activeShelfItemIds
    ? searchedTemplates.filter((item) => activeShelfItemIds.has(item.id))
    : searchedTemplates;
  const popularTemplates = [...searchedTemplates]
    .sort((first, second) => ((second.rating_count || 0) * 10 + (second.rating_average || 0)) - ((first.rating_count || 0) * 10 + (first.rating_average || 0)));
  const todayNewest = Array.isArray(today?.newest) ? today.newest : [];
  const newestTemplates = (todayNewest.length ? todayNewest : searchedTemplates)
    .filter(matchesSearch)
    .sort((first, second) => new Date(second.added_at || second.created_at || 0) - new Date(first.added_at || first.created_at || 0));
  const catalogCollections = collections.filter((collection) => collection.is_catalog);
  const freeCollections = catalogCollections.filter((collection) => collection.access !== 'premium');
  const requestedPremiumCollection = collections.find((collection) => String(collection.id) === String(requestedPackId || '') && collection.pack_type === 'premium');
  const showcaseCollections = (requestedPremiumCollection
    ? [requestedPremiumCollection]
    : collections.filter((collection) => collection.pack_type === 'premium' && collection.price_in_stars > 0)).slice(0, 1);
  const serverPremiumPack = mergeShowcasePackServerProjection(SHOWCASE_PREMIUM_PACK, showcaseCollections[0]);
  const premiumPreviewItems = searchedTemplates.filter((item) => item.access === 'premium').slice(0, 6).map((item) => ({
    ...item,
    dimensions: item.dimensions || `${item.width}×${item.height}`,
    first_segment: item.first_segment || item.album_title || 'Первая сцена',
    visual_beats: item.visual_beats || 3,
    micro_region_ratio: Number.isFinite(Number(item.micro_region_ratio)) ? item.micro_region_ratio : 0.05,
    final_reveal: item.final_reveal !== false,
    identity: item.identity !== false,
    editorial_quality: item.editorial_quality || 'fair',
  }));
  const premiumCount = Number(serverPremiumPack.premium_count || premiumPreviewItems.length);
  const premiumAlbumCount = catalogCollections.reduce((total, collection) => total + (collection.albums || []).filter((album) => album.premium_count > 0).length, 0);
  const premiumPack = {
    ...serverPremiumPack,
    items: premiumPreviewItems.length >= 2 ? premiumPreviewItems : serverPremiumPack.items,
    total_count: Number(serverPremiumPack.total_count || premiumCount),
    premium_count: premiumCount,
    description: `Доступ ко всей Premium Gallery Splint: ${premiumCount} работ${premiumAlbumCount ? ` в ${premiumAlbumCount} альбомах` : ''}. Яркие миры, неон, существа и атмосферные сцены — одна покупка, полный маршрут.`,
  };
  const premiumEntitlement = findPremiumEntitlement(unlockData?.snapshot, SHOWCASE_PREMIUM_PACK.id);
  const premiumState = unlockData?.snapshotStatus === 'loading' && !unlockData?.snapshot
    ? PREMIUM_PACK_STATES.PREVIEW
    : resolvePremiumPackState({
      pack: premiumPack,
      entitlement: premiumEntitlement,
      snapshotStatus: unlockData?.snapshotStatus || 'error',
      paymentsMode,
    });
  const currentTemplates = activeShelf ? shelfTemplates : catalogChip === 'popular' ? popularTemplates
    : catalogChip === 'new' ? newestTemplates
    : catalogChip === 'free' ? freeTemplates
    : searchedTemplates;
  const visibleTemplates = currentTemplates.slice(0, visibleCount);
  const chipItems = [
    { id: 'all', label: 'Все' },
    { id: 'free', label: 'Бесплатно' },
    { id: 'collections', label: 'Коллекции' },
  ];
  const progressById = new Map(mine.map((item) => [item.id, item.progress?.percent || 0]));

  const openArtwork = (item, context = {}) => {
    onTrack(item.access === 'premium' ? 'premium_preview_open' : 'coloring_open', {
      coloring_id: item.id,
      collection_id: item.collection_id || null,
      album_id: item.album_id || null,
      ...context,
    });
    onOpen(item.id);
  };

  const renderArtworkGrid = (items, label) => <div className="catalog-art-grid" aria-label={label}>{items.map((item) => {
    const progressPercent = progressById.get(item.id) || 0;
    const metadata = formatContentMetadataDetail(item);
    return <article className="catalog-art-card" key={item.id} onMouseEnter={() => prefetchColoring(item.id)} onTouchStart={() => prefetchColoring(item.id)}>
      <button className="catalog-art-open" type="button" onClick={() => { hapticImpact('light'); openArtwork(item); }} aria-label={`Открыть раскраску ${item.title}`}>
        <span className="catalog-art-preview" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined}>
          {progressPercent > 0 ? <em className="catalog-art-progress">{progressPercent}%</em> : <em>{metadata.duration}</em>}
        </span>
        <span className="catalog-art-copy"><b>{item.title}</b><small data-content-metadata={metadata.assessed ? 'authoritative' : 'unassessed'}>{item.width}×{item.height} · {metadata.line}</small></span>
      </button>
      <div className="catalog-art-footer"><span>{item.rating_count ? `★ ${item.rating_average?.toFixed?.(1) || item.rating_average} · ${item.rating_count}` : 'Новая работа'}</span><button className={item.is_favorite ? 'is-favorite' : ''} type="button" onClick={() => onToggleFavorite(item)} disabled={favoriteSavingId === item.id} aria-label={item.is_favorite ? `Удалить ${item.title} из избранного` : `Добавить ${item.title} в избранное`}><Heart size={16} fill={item.is_favorite ? 'currentColor' : 'none'} /></button></div>
    </article>;
  })}</div>;

  const renderShelf = (shelf) => <section className="catalog-shelf" key={shelf.id} data-shelf-id={shelf.id}>
    <div className="catalog-section-heading"><div><p className="eyebrow">{shelf.id === 'new' ? 'PHASE 2' : 'DISCOVER'}</p><h2>{shelf.label}</h2><small>{shelf.description}</small></div><button type="button" onClick={() => {
      onTrack('shelf_open', { shelf_id: shelf.id });
      if (shelf.id === 'premium') { setActiveShelfId(null); onChangeChip('premium'); return; }
      if (shelf.id === 'free') { setActiveShelfId(null); onChangeChip('free'); return; }
      setActiveShelfId(shelf.id);
      onChangeChip('all');
      onChangeQuery('');
    }}>{shelf.total_count} работ <ArrowRight size={14} aria-hidden="true" /></button></div>
    <div className="catalog-shelf-scroll" aria-label={shelf.label}>{shelf.items.map((item) => {
      const metadata = formatContentMetadataDetail(item);
      return <article className="catalog-shelf-card" key={`${shelf.id}:${item.id}`} data-access={item.access}>
        <button type="button" className="catalog-shelf-open" onClick={() => openArtwork(item, { shelf_id: shelf.id })} aria-label={`Открыть ${item.title}`}>
          <span className="catalog-shelf-image" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined}>
            {item.access === 'premium' ? <Crown size={13} aria-label="Premium" /> : <Zap size={13} aria-label="Бесплатно" />}
          </span>
          <span className="catalog-shelf-title">{item.title}</span>
          <small>{item.album_title || item.collection_title || metadata.line}</small>
        </button>
      </article>;
    })}</div>
  </section>;

  const renderCollectionGrid = (items, label) => <div className="catalog-collection-grid" aria-label={label}>{items.map((collection) => <button className="catalog-collection-card" type="button" key={collection.id} onClick={() => {
    onTrack('collection_open', { collection_id: collection.id });
    onOpenCollection(collection);
  }}>
    <span className="catalog-collection-preview" style={collection.catalog_cover_url || collection.image_url ? { backgroundImage: `url(${collection.catalog_cover_url || collection.image_url})` } : undefined}><BookOpen size={20} /></span>
    <span><b>{collection.title}</b><small>{collection.free_count || 0} free · {collection.premium_count || 0} premium</small><small>{collection.albums?.length || 0} альбома · {collection.total_count || collection.total_artworks || 0} работ</small></span>
  </button>)}</div>;

  return <section className="page catalog-page catalog-page--redesigned">
    <div className="page-heading catalog-heading"><div><p className="eyebrow">{activeShelf ? activeShelf.label : 'КАТАЛОГ'}</p><h1>{catalogCollection ? (catalogCollection.album_title || catalogCollection.title) : activeShelf ? `${activeShelf.total_count} работ` : 'Что раскрасить следующим?'}</h1></div><div className="catalog-heading-actions">{(catalogCollection || activeShelf) && <button className="catalog-reset" type="button" onClick={() => { setActiveShelfId(null); onResetScope(); }}>Все работы</button>}</div></div>
    <label className="catalog-search"><span aria-hidden="true">⌕</span><input value={catalogQuery} onChange={(event) => onChangeQuery(event.target.value)} placeholder="Поиск картин и тем" type="search" /><button type="button" onClick={() => onChangeQuery('')} aria-label="Очистить поиск" hidden={!catalogQuery}>×</button></label>
    <div className="catalog-chips" role="tablist" aria-label="Раздел каталога">{chipItems.map((chip) => <button key={chip.id} type="button" className={catalogChip === chip.id && !activeShelfId ? 'active' : ''} role="tab" aria-selected={catalogChip === chip.id && !activeShelfId} onClick={() => { hapticSelection(); setActiveShelfId(null); onChangeChip(chip.id); }}>{chip.label}</button>)}<button type="button" className="catalog-store-chip" onClick={() => { onTrack('store_open_from_content', { source: 'catalog_header' }); onOpenStore?.(); }}><Crown size={13} /> Premium Gallery</button></div>

    {loading && !templates.length ? <div className="skeleton-grid" aria-label="Загружаем каталог">{[0, 1, 2, 3].map((item) => <div className="skeleton-card" key={item}><div className="skeleton-block skeleton-preview" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></div>)}</div> : catalogError && !templates.length ? <div className="error-retry"><p>Не удалось загрузить каталог</p><button className="secondary-button" type="button" onClick={onRetryCatalog}>Повторить</button></div> : <>
      {catalogChip === 'all' && !catalogCollection && !activeShelf && <>
        <section className="catalog-hero" data-catalog-hero>
          <div><p className="eyebrow">SPLINT · DIGITAL COLORING STUDIO</p><h2>Выбери свой следующий мир</h2><p>320 сцен — от voxel-приключений и неона до спокойных историй. Начни бесплатно, сохрани любимые темы и собери Premium Gallery.</p></div>
          <div className="catalog-hero-stats"><span><b>{templates.length}</b><small>работ</small></span><span><b>{catalogCollections.length}</b><small>коллекций</small></span><span><b>{premiumPack.total_count || premiumPack.items.length}</b><small>Premium</small></span></div>
        </section>
        <section className="catalog-featured-grid">
          <div className="catalog-section-heading"><div><p className="eyebrow">БЫСТРЫЙ СТАРТ</p><h2>Открой любую сцену</h2><small>Несколько работ для мгновенного входа в раскрашивание.</small></div></div>
          {renderArtworkGrid(searchedTemplates.slice(0, 12), 'Рекомендованные картины')}
        </section>
        {shelves.filter((shelf) => ['new', 'free', 'premium'].includes(shelf.id)).map(renderShelf)}
        <PremiumPackTeaser pack={premiumPack} state={premiumState} onOpen={() => onChangeChip('premium')} />
        {shelves.filter((shelf) => !['new', 'free', 'premium'].includes(shelf.id)).slice(0, 6).map(renderShelf)}
        {catalogCollections.length > 0 && <><div className="catalog-section-heading"><div><p className="eyebrow">КОЛЛЕКЦИИ</p><h2>Соберите свою полку</h2></div></div>{renderCollectionGrid(catalogCollections.slice(0, 8), 'Коллекции')}</>}
      </>}

      {catalogChip === 'premium' ? <PremiumPackView
        pack={premiumPack}
        state={premiumState}
        onBack={() => onChangeChip('all')}
        onOpenItem={onOpenPremiumItem}
        onOpenFree={onOpenFreePack}
        onSaveWish={onPremiumWish}
        onPurchaseIntent={createPremiumPackPurchaseIntent(premiumPack.id, onOpenStore)}
      /> : catalogChip === 'collections' && !catalogCollection ? <>
        <div className="catalog-section-heading catalog-section-heading--single"><div><p className="eyebrow">КОЛЛЕКЦИИ</p><h2>Серии картин</h2></div></div>
        {renderCollectionGrid(catalogCollections, 'Коллекции каталога')}
        {!catalogCollections.length && <p className="catalog-empty">Коллекции пока не загружены.</p>}
      </> : catalogChip !== 'all' || catalogCollection || activeShelf ? <>
        <div className="catalog-section-heading catalog-section-heading--single"><div><p className="eyebrow">{activeShelf ? activeShelf.label : catalogChip === 'popular' ? 'ПОПУЛЯРНОЕ' : catalogChip === 'new' ? 'НОВИНКИ' : catalogChip === 'free' ? 'БЕСПЛАТНО' : 'КОЛЛЕКЦИЯ'}</p><h2>{catalogCollection ? (catalogCollection.album_title || catalogCollection.title) : `${currentTemplates.length} работ`}</h2>{activeShelf && <small>{activeShelf.description}</small>}</div></div>
        {renderArtworkGrid(visibleTemplates, 'Картины каталога')}
        {!visibleTemplates.length && <p className="catalog-empty">По этому запросу ничего не найдено.</p>}
        {currentTemplates.length > visibleCount && <div className="show-more-wrap"><button className="secondary-button" type="button" onClick={onShowMore}>Показать ещё ({currentTemplates.length - visibleCount})</button></div>}
        {catalogChip === 'free' && freeCollections.length > 0 && <><div className="catalog-section-heading"><div><p className="eyebrow">БЕСПЛАТНЫЕ НАБОРЫ</p><h2>Коллекции</h2></div></div>{renderCollectionGrid(freeCollections, 'Бесплатные наборы')}</>}
      </> : null}
    </>}
  </section>;
}
