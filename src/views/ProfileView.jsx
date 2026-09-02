import { BookOpen, Eye, EyeOff, Grid3X3, Heart, Trash2 } from 'lucide-react';

const artworkImage = (work) => work?.preview_url || work?.thumbnail_url || work?.image_url || '';
const isRare = (work) => ['rare', 'epic', 'limited', 'legendary'].includes(String(work?.rarity || '').toLowerCase());

function ArtworkCard({ work, onOpen, featured = false, children = null }) {
  const source = artworkImage(work);
  const openId = work?.template_id || work?.id;
  return <article className={`profile-showcase-card${featured ? ' is-featured' : ''}`}>
    <button type="button" className="profile-showcase-open" onClick={() => onOpen?.(openId)} aria-label={`Открыть ${work.title}`}>
      {source ? <img loading="lazy" src={source} alt="" /> : <span className="profile-work-fallback"><Grid3X3 size={24} /></span>}
      <span className="profile-showcase-caption"><b>{work.title}</b>{isRare(work) && <small>{work.rarity}</small>}</span>
    </button>
    {children}
  </article>;
}

export default function ProfileView({
  profile,
  currentUser,
  profileArtworks = [],
  mine = [],
  favoriteTemplates = [],
  collections = [],
  onOpen,
  onNavigate,
  onToggleFollow,
  onOpenCollection,
  publishingTemplateId,
  onToggleVisibility,
  onDelete,
}) {
  if (!profile) return <section className="page profile-page"><div className="skeleton-block skeleton-profile" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></section>;

  const isOwnProfile = profile.id === currentUser?.id;
  const completedWorks = isOwnProfile ? mine.filter((item) => Number(item.progress?.percent) === 100) : profileArtworks;
  const createdWorks = isOwnProfile
    ? mine.filter((item) => item.owner_id === currentUser?.id || item.is_owner || item.created_by_me)
    : profileArtworks.filter((item) => item.owner_id === profile.id || item.created_by_me);
  const favorites = isOwnProfile ? favoriteTemplates : [];
  const showcase = [...favorites, ...completedWorks]
    .filter((item, index, all) => item?.id && all.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 5);
  const rareWorks = [...completedWorks, ...createdWorks]
    .filter((item, index, all) => isRare(item) && all.findIndex((candidate) => candidate.id === item.id) === index);
  const publicCollections = [...new Map(profileArtworks
    .filter((artwork) => artwork.collection_id)
    .map((artwork) => [artwork.collection_id, {
      id: artwork.collection_id,
      title: artwork.collection_title || 'Коллекция',
      image_url: artworkImage(artwork),
      completed_count: profileArtworks.filter((candidate) => candidate.collection_id === artwork.collection_id).length,
      total_count: profileArtworks.filter((candidate) => candidate.collection_id === artwork.collection_id).length,
    }])).values()];
  const visibleCollections = (isOwnProfile ? collections.filter((collection) => collection.pack_type !== 'premium') : publicCollections).slice(0, 6);

  return <section className="page profile-page profile-page--showcase" data-profile-showcase="true">
    <section className="profile-hero profile-hero--collection">
      <img className="profile-hero-avatar" src={profile.avatar_url || '/favicon.svg'} alt="" />
      <div className="profile-hero-copy"><p className="eyebrow">{isOwnProfile ? 'МОЯ КОЛЛЕКЦИЯ' : 'КОЛЛЕКЦИЯ АВТОРА'}</p><h1>{profile.nickname}</h1><p>{profile.status || 'Собираю и создаю пиксельные картины.'}</p></div>
      {!isOwnProfile && <button className="follow-button" type="button" onClick={onToggleFollow}>{profile.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}
    </section>

    <div className="profile-content-metrics" aria-label="Коллекция профиля">
      <span><b>{completedWorks.length}</b><small>картин</small></span>
      <span><b>{visibleCollections.length}</b><small>коллекций</small></span>
      <span><b>{rareWorks.length}</b><small>редких</small></span>
    </div>

    {showcase.length > 0 && <section className="profile-section profile-featured-section">
      <div className="section-heading"><div><p className="eyebrow">ВИТРИНА</p><h2>Избранные работы</h2></div></div>
      <div className="profile-featured-grid">{showcase.map((work, index) => <ArtworkCard key={work.id} work={work} featured={index === 0} onOpen={onOpen} />)}</div>
    </section>}

    {visibleCollections.length > 0 && <section className="profile-section">
      <div className="section-heading"><div><p className="eyebrow">КОЛЛЕКЦИИ</p><h2>Собранные серии</h2></div></div>
      <div className="profile-collection-list">{visibleCollections.map((collection) => <button type="button" key={collection.id} onClick={() => onOpenCollection(collection)}><span style={collection.image_url ? { backgroundImage: `url(${collection.image_url})` } : undefined}><BookOpen size={18} /></span><div><b>{collection.title}</b><small>{collection.completed_count || 0} / {collection.total_count || collection.total_artworks || 0}</small></div></button>)}</div>
    </section>}

    {rareWorks.length > 0 && <section className="profile-section">
      <div className="section-heading"><div><p className="eyebrow">ОСОБЫЕ</p><h2>Редкие работы</h2></div></div>
      <div className="profile-work-grid">{rareWorks.slice(0, 6).map((work) => <ArtworkCard key={work.id} work={work} onOpen={onOpen} />)}</div>
    </section>}

    {completedWorks.length > 0 && <section className="profile-section">
      <div className="section-heading"><div><p className="eyebrow">ЗАВЕРШЕНО</p><h2>Готовые картины</h2></div></div>
      <div className="profile-work-grid">{completedWorks.slice(0, 12).map((work) => <ArtworkCard key={work.id} work={work} onOpen={onOpen} />)}</div>
    </section>}

    {isOwnProfile && <section className="profile-section profile-created-section">
      <div className="section-heading"><div><p className="eyebrow">СОЗДАНО МНОЙ</p><h2>Мои раскраски</h2></div><button type="button" onClick={() => onNavigate('create')}>Создать</button></div>
      {createdWorks.length > 0 ? <div className="profile-work-grid">{createdWorks.slice(0, 12).map((work) => <ArtworkCard key={work.id} work={work} onOpen={onOpen}>
        <div className="profile-owner-actions">
          <button type="button" disabled={publishingTemplateId === work.id} onClick={() => onToggleVisibility(work)} aria-label={work.visibility === 'public' ? `Скрыть ${work.title}` : `Опубликовать ${work.title}`}>{work.visibility === 'public' ? <Eye size={16} /> : <EyeOff size={16} />}</button>
          <button type="button" onClick={() => onDelete(work)} aria-label={`Удалить ${work.title}`}><Trash2 size={16} /></button>
        </div>
      </ArtworkCard>)}</div> : <div className="profile-empty profile-empty--compact"><Heart size={22} /><p>Созданные вами работы появятся здесь.</p><button className="primary-button" type="button" onClick={() => onNavigate('create')}>Загрузить изображение</button></div>}
    </section>}

    {!showcase.length && !completedWorks.length && !createdWorks.length && <div className="profile-empty"><span>✦</span><p>Коллекция начнётся с первой завершённой картины.</p><button className="primary-button" type="button" onClick={() => onNavigate('catalog')}>Открыть каталог</button></div>}
  </section>;
}
