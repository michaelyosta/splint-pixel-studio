import { BookOpen, Flame, Heart, Sparkles, Star } from 'lucide-react';
import { MOODS, THEMES } from '../lib/catalogMeta';
import { prefetchColoring } from '../lib/coloringPrefetch';
import { hapticImpact, hapticSelection } from '../lib/telegram';
import { formatContentMetadataDetail } from '../lib/contentMetadata.js';
import {
  PREMIUM_PACK_STATES,
  SHOWCASE_PREMIUM_PACK,
  findPremiumEntitlement,
  resolvePremiumPackState,
} from '../lib/premiumPack.js';
import PremiumPackView, { PremiumPackTeaser } from '../features/premium/PremiumPackView.jsx';

export default function CatalogView({
  templates,
  loading,
  catalogError,
  mine,
  today,
  streak,
  filters,
  onChangeFilters,
  collections,
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
  onOpenStore,
  unlockData,
  onOpenPremiumItem,
  onOpenFreePack,
  onPremiumWish,
}) {
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

  if (import.meta.env.VITE_USE_LEGACY_CATALOG === 'true') return renderCatalogLegacy();

  const normalize = (value) => String(value || '').toLocaleLowerCase('ru-RU');
  const query = normalize(catalogQuery.trim());
  const matchesSearch = (item) => !query || [item.title, item.description, item.category, item.theme, item.mood]
    .some((value) => normalize(value).includes(query));
  const searchedTemplates = templates.filter(matchesSearch);
  const popularTemplates = [...searchedTemplates]
    .sort((first, second) => ((second.rating_count || 0) * 10 + (second.rating_average || 0)) - ((first.rating_count || 0) * 10 + (first.rating_average || 0)));
  const todayNewest = Array.isArray(today?.newest) ? today.newest : [];
  const newestTemplates = (todayNewest.length ? todayNewest : searchedTemplates)
    .filter(matchesSearch)
    .sort((first, second) => new Date(second.added_at || second.created_at || 0) - new Date(first.added_at || first.created_at || 0));
  const freeCollections = collections.filter((collection) => collection.pack_type !== 'premium');
  const showcaseCollections = collections.filter((collection) => collection.pack_type === 'premium' && collection.price_in_stars > 0).slice(0, 1);
  const premiumEntitlement = findPremiumEntitlement(unlockData?.snapshot, SHOWCASE_PREMIUM_PACK.id);
  const premiumState = unlockData?.snapshotStatus === 'loading' && !unlockData?.snapshot
    ? PREMIUM_PACK_STATES.PREVIEW
    : resolvePremiumPackState({
      pack: SHOWCASE_PREMIUM_PACK,
      entitlement: premiumEntitlement,
      snapshotStatus: unlockData?.snapshotStatus || 'error',
      paymentsMode: import.meta.env.VITE_PAYMENTS_MODE || 'disabled',
    });
  const currentTemplates = catalogChip === 'popular' ? popularTemplates
    : catalogChip === 'new' ? newestTemplates
    : catalogChip === 'free' ? searchedTemplates
    : searchedTemplates;
  const visibleTemplates = currentTemplates.slice(0, visibleCount);
  const chipItems = [
    { id: 'all', label: 'Все' },
    { id: 'popular', label: 'Популярное' },
    { id: 'new', label: 'Новинки' },
    { id: 'free', label: 'Бесплатно' },
    { id: 'premium', label: 'Витрина' },
  ];
  const progressById = new Map(mine.map((item) => [item.id, item.progress?.percent || 0]));

  const renderArtworkGrid = (items, label) => <div className="catalog-art-grid" aria-label={label}>{items.map((item) => {
    const progressPercent = progressById.get(item.id) || 0;
    const metadata = formatContentMetadataDetail(item);
    return <article className="catalog-art-card" key={item.id} onMouseEnter={() => prefetchColoring(item.id)} onTouchStart={() => prefetchColoring(item.id)}>
      <button className="catalog-art-open" type="button" onClick={() => { hapticImpact('light'); onOpen(item.id); }} aria-label={`Открыть раскраску ${item.title}`}>
        <span className="catalog-art-preview" style={item.preview_url ? { backgroundImage: `url(${item.preview_url})` } : undefined}>
          {progressPercent > 0 ? <em className="catalog-art-progress">{progressPercent}%</em> : <em>{metadata.duration}</em>}
        </span>
        <span className="catalog-art-copy"><b>{item.title}</b><small data-content-metadata={metadata.assessed ? 'authoritative' : 'unassessed'}>{item.width}×{item.height} · {metadata.line}</small></span>
      </button>
      <div className="catalog-art-footer"><span>{item.rating_count ? `★ ${item.rating_average?.toFixed?.(1) || item.rating_average} · ${item.rating_count}` : 'Новая работа'}</span><button className={item.is_favorite ? 'is-favorite' : ''} type="button" onClick={() => onToggleFavorite(item)} disabled={favoriteSavingId === item.id} aria-label={item.is_favorite ? `Удалить ${item.title} из избранного` : `Добавить ${item.title} в избранное`}><Heart size={16} fill={item.is_favorite ? 'currentColor' : 'none'} /></button></div>
    </article>;
  })}</div>;

  const renderCollectionGrid = (items, label) => <div className="catalog-collection-grid" aria-label={label}>{items.map((collection) => <button className="catalog-collection-card" type="button" key={collection.id} onClick={() => onOpenCollection(collection)}>
    <span className="catalog-collection-preview" style={collection.image_url ? { backgroundImage: `url(${collection.image_url})` } : undefined}><BookOpen size={20} /></span>
    <span><b>{collection.title}</b><small>{collection.completed_count || 0}/{collection.total_count || collection.total_artworks || 0} завершено</small></span>
  </button>)}</div>;

  return <section className="page catalog-page catalog-page--redesigned">
    <div className="page-heading catalog-heading"><div><p className="eyebrow">КАТАЛОГ</p><h1>{catalogCollection ? catalogCollection.title : 'Найдите свою картину'}</h1></div><div className="catalog-heading-actions">{showcaseCollections.length > 0 && onOpenStore && <button className="catalog-store-link" type="button" onClick={() => onOpenStore(showcaseCollections[0].id)} aria-label="Открыть витрину наборов"><Sparkles size={15} /> Витрина</button>}{catalogCollection && <button className="catalog-reset" type="button" onClick={onResetScope}>Все работы</button>}</div></div>
    <label className="catalog-search"><span aria-hidden="true">⌕</span><input value={catalogQuery} onChange={(event) => onChangeQuery(event.target.value)} placeholder="Поиск картин и тем" type="search" /><button type="button" onClick={() => onChangeQuery('')} aria-label="Очистить поиск" hidden={!catalogQuery}>×</button></label>
    <div className="catalog-chips" role="tablist" aria-label="Раздел каталога">{chipItems.map((chip) => <button key={chip.id} type="button" className={catalogChip === chip.id ? 'active' : ''} role="tab" aria-selected={catalogChip === chip.id} onClick={() => { hapticSelection(); onChangeChip(chip.id); }}>{chip.label}</button>)}</div>

    {loading && !templates.length ? <div className="skeleton-grid" aria-label="Загружаем каталог">{[0, 1, 2, 3].map((item) => <div className="skeleton-card" key={item}><div className="skeleton-block skeleton-preview" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></div>)}</div> : catalogError && !templates.length ? <div className="error-retry"><p>Не удалось загрузить каталог</p><button className="secondary-button" type="button" onClick={onRetryCatalog}>Повторить</button></div> : <>
      {catalogChip === 'all' && !catalogCollection && <>
        <div className="catalog-section-heading"><div><p className="eyebrow">ПОПУЛЯРНОЕ</p><h2>Сейчас выбирают</h2></div><button type="button" onClick={() => onChangeChip('popular')}>Смотреть все</button></div>
        {renderArtworkGrid(popularTemplates.slice(0, 4), 'Популярные работы')}
        <div className="catalog-section-heading"><div><p className="eyebrow">НОВИНКИ</p><h2>Свежие картины</h2></div><button type="button" onClick={() => onChangeChip('new')}>Смотреть все</button></div>
        {renderArtworkGrid(newestTemplates.slice(0, 4), 'Новые работы')}
        {freeCollections.length > 0 && <><div className="catalog-section-heading"><div><p className="eyebrow">КОЛЛЕКЦИИ</p><h2>Соберите свою полку</h2></div></div>{renderCollectionGrid(freeCollections.slice(0, 4), 'Коллекции')}</>}
        <div className="catalog-section-heading"><div><p className="eyebrow">КУРАТОРСКАЯ ВИТРИНА</p><h2>Следующий красивый альбом</h2></div></div>
        <PremiumPackTeaser pack={SHOWCASE_PREMIUM_PACK} state={premiumState} onOpen={() => onChangeChip('premium')} />
      </>}

      {catalogChip === 'premium' ? <PremiumPackView
        pack={SHOWCASE_PREMIUM_PACK}
        state={premiumState}
        onBack={() => onChangeChip('all')}
        onOpenItem={onOpenPremiumItem}
        onOpenFree={onOpenFreePack}
        onSaveWish={onPremiumWish}
      /> : catalogChip !== 'all' || catalogCollection ? <>
        <div className="catalog-section-heading catalog-section-heading--single"><div><p className="eyebrow">{catalogChip === 'popular' ? 'ПОПУЛЯРНОЕ' : catalogChip === 'new' ? 'НОВИНКИ' : catalogChip === 'free' ? 'БЕСПЛАТНО' : 'КОЛЛЕКЦИЯ'}</p><h2>{catalogCollection ? catalogCollection.title : `${currentTemplates.length} работ`}</h2></div></div>
        {renderArtworkGrid(visibleTemplates, 'Картины каталога')}
        {!visibleTemplates.length && <p className="catalog-empty">По этому запросу ничего не найдено.</p>}
        {currentTemplates.length > visibleCount && <div className="show-more-wrap"><button className="secondary-button" type="button" onClick={onShowMore}>Показать ещё ({currentTemplates.length - visibleCount})</button></div>}
        {catalogChip === 'free' && freeCollections.length > 0 && <><div className="catalog-section-heading"><div><p className="eyebrow">БЕСПЛАТНЫЕ НАБОРЫ</p><h2>Коллекции</h2></div></div>{renderCollectionGrid(freeCollections, 'Бесплатные наборы')}</>}
      </> : null}
    </>}
  </section>;
}
