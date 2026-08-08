import { BookOpen, Grid3X3, Star } from 'lucide-react';
import UnlockJourneyCard from '../features/unlocks/UnlockJourneyCard';

export default function ProfileView({
  profile,
  currentUser,
  profileArtworks,
  mine,
  profileShelf,
  onChangeShelf,
  favoriteTemplates,
  recentTemplates,
  collections,
  achievements,
  progression,
  streak,
  unlockData,
  onOpen,
  onNavigate,
  onToggleFollow,
  onOpenCollection,
  onSetView,
  onOpenUnlockSubject,
}) {
  const renderProfileLegacy = () => {
    if (!profile) return <section className="page profile-page"><div className="skeleton-block skeleton-profile" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></section>;
    const isOwnProfile = profile.id === currentUser?.id;
    return <section className="page profile-page"><div className="page-heading"><div><p className="eyebrow">ПРОФИЛЬ</p><h1>{profile.nickname}</h1></div>{!isOwnProfile && <button className="follow-button" onClick={onToggleFollow}>{profile.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><div className="profile-card"><img loading="lazy" src={profile.avatar_url || '/favicon.svg'} alt="" /><div><b>{profile.nickname}</b><p>{profile.status || 'Любит раскрашивать пиксели по номерам.'}</p></div><div className="profile-stats"><span><b>{profile.posts_count}</b>публикаций</span><span><b>{profile.followers_count}</b>подписчиков</span><span><b>{profile.following_count}</b>подписок</span></div></div><h2 className="section-title">Готовые работы</h2><div className="profile-artworks">{profileArtworks.map((artwork) => <img loading="lazy" key={artwork.id} src={artwork.image_url} alt={artwork.title} title={artwork.title} />)}{!profileArtworks.length && <p className="empty-state">Готовых работ пока нет.{isOwnProfile && <button className="secondary-button" onClick={() => onSetView('catalog')}>Начать раскрашивать</button>}</p>}</div>
      <h2 className="section-title">Серия и достижения</h2>
      <div className="profile-stats"><span><b>{streak?.current_streak || 0}</b>дней подряд</span><span><b>{streak?.longest_streak || 0}</b>рекорд</span><span><b>{achievements.filter((a) => a.unlocked).length}</b>наград</span></div>
    </section>;
  };

  if (import.meta.env.VITE_USE_LEGACY_PROFILE === 'true') return renderProfileLegacy();
  if (!profile) return <section className="page profile-page"><div className="skeleton-block skeleton-profile" /><div className="skeleton-block skeleton-line" /><div className="skeleton-block skeleton-line short" /></section>;
  const isOwnProfile = profile.id === currentUser?.id;
  const completedWorks = isOwnProfile ? mine.filter((item) => item.progress?.percent === 100) : profileArtworks;
  const achievementsUnlocked = achievements.filter((achievement) => achievement.unlocked);
  const visibleCollections = collections.slice(0, 4);
  const displayShelf = isOwnProfile ? profileShelf : 'works';
  const shelfItems = displayShelf === 'favorites' ? favoriteTemplates
    : displayShelf === 'history' ? recentTemplates
    : completedWorks;
  const shelfTitle = displayShelf === 'favorites' ? 'Избранные раскраски'
    : displayShelf === 'history' ? 'Недавно открытые'
    : 'Завершённые работы';
  const shelfEmpty = displayShelf === 'favorites' ? 'Добавляйте картины сердцем в каталоге.'
    : displayShelf === 'history' ? 'Здесь появятся недавно открытые раскраски.'
    : 'Здесь появятся завершённые картины.';
  const xpProgress = progression?.xp_per_level
    ? Math.round(((progression.xp_total % progression.xp_per_level) / progression.xp_per_level) * 100)
    : 0;
  return <section className="page profile-page profile-page--redesigned">
    <section className="profile-hero">
      <img className="profile-hero-avatar" src={profile.avatar_url || '/favicon.svg'} alt="" />
      <div className="profile-hero-copy"><p className="eyebrow">{isOwnProfile ? 'ВАША СТУДИЯ' : 'ПРОФИЛЬ АВТОРА'}</p><h1>{profile.nickname}</h1><p>{profile.status || 'Любит раскрашивать пиксели по номерам.'}</p></div>
      {!isOwnProfile && <button className="follow-button" type="button" onClick={onToggleFollow}>{profile.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}
    </section>

    <div className="profile-metric-grid" aria-label="Статистика профиля">
      <span><b>{completedWorks.length}</b><small>работы</small></span>
      <span><b>{progression?.level || profile.level || 1}</b><small>уровень</small></span>
      <span><b>{profile.followers_count || 0}</b><small>подписчики</small></span>
      <span><b>{streak?.current_streak || 0}</b><small>дней подряд</small></span>
    </div>

    {isOwnProfile && progression && <div className="profile-xp"><span><b>{progression.xp_total} XP</b><small>До следующего уровня: {progression.xp_to_next_level} XP</small></span><i><i style={{ width: `${xpProgress}%` }} /></i></div>}

    {isOwnProfile && <UnlockJourneyCard
      journey={unlockData.journey}
      status={unlockData.snapshotStatus}
      error={unlockData.snapshotError}
      onRetry={() => unlockData.refresh()}
      onOpen={onOpenUnlockSubject}
      compact
    />}

    {isOwnProfile && <div className="profile-quick-actions" role="tablist" aria-label="Раздел профиля"><button type="button" role="tab" aria-selected={profileShelf === 'works'} className={profileShelf === 'works' ? 'active' : ''} onClick={() => onChangeShelf('works')}>Работы</button><button type="button" role="tab" aria-selected={profileShelf === 'favorites'} className={profileShelf === 'favorites' ? 'active' : ''} onClick={() => onChangeShelf('favorites')}>Избранное</button><button type="button" role="tab" aria-selected={profileShelf === 'history'} className={profileShelf === 'history' ? 'active' : ''} onClick={() => onChangeShelf('history')}>История</button><button type="button" onClick={() => onNavigate('create')}>Создать</button></div>}

    <section className="profile-section">
      <div className="section-heading"><div><p className="eyebrow">МОЯ КОЛЛЕКЦИЯ</p><h2>{isOwnProfile ? shelfTitle : 'Завершённые работы'}</h2></div>{isOwnProfile && profileShelf === 'works' && <button type="button" onClick={() => onSetView('gallery')}>Смотреть все</button>}</div>
      <div className="profile-work-grid">{shelfItems.slice(0, 9).map((work) => {
        const source = work.preview_url || work.thumbnail_url || work.image_url;
        const canOpen = isOwnProfile && Boolean(work.id) && (displayShelf !== 'works' || mine.some((item) => item.id === work.id));
        return <button className="profile-work-card" type="button" key={work.id} onClick={() => canOpen && onOpen(work.id)} disabled={!canOpen} aria-label={canOpen ? `Открыть ${work.title}` : work.title}>
          {source ? <img loading="lazy" src={source} alt="" /> : <span className="profile-work-fallback"><Grid3X3 size={22} /></span>}<b>{work.title}</b>{isOwnProfile && work.progress && <small>{work.progress.percent}%</small>}
        </button>;
      })}{!shelfItems.length && <div className="profile-empty"><span>✦</span><p>{shelfEmpty}</p><button className="secondary-button" type="button" onClick={() => onNavigate('catalog')}>Открыть каталог</button></div>}</div>
    </section>

    <section className="profile-section">
      <div className="section-heading"><div><p className="eyebrow">КОЛЛЕКЦИИ</p><h2>Ваш прогресс</h2></div><button type="button" onClick={() => onSetView('collections')}>Все</button></div>
      <div className="profile-collection-list">{visibleCollections.map((collection) => <button type="button" key={collection.id} onClick={() => onOpenCollection(collection)}><span style={collection.image_url ? { backgroundImage: `url(${collection.image_url})` } : undefined}><BookOpen size={18} /></span><div><b>{collection.title}</b><small>{collection.completed_count || 0}/{collection.total_count || collection.total_artworks || 0} завершено</small></div></button>)}{!visibleCollections.length && <p className="profile-inline-empty">Коллекции появятся после загрузки каталога.</p>}</div>
    </section>

    <section className="profile-section">
      <div className="section-heading"><div><p className="eyebrow">ДОСТИЖЕНИЯ</p><h2>{achievementsUnlocked.length} из {achievements.length || 0}</h2></div><button type="button" onClick={() => onSetView('achievements')}>Все</button></div>
      <div className="profile-achievements">{achievements.slice(0, 4).map((achievement) => <span className={achievement.unlocked ? 'unlocked' : ''} key={achievement.id}><Star size={15} fill={achievement.unlocked ? 'currentColor' : 'none'} /><b>{achievement.title}</b></span>)}{!achievements.length && <p className="profile-inline-empty">Достижения загружаются…</p>}</div>
    </section>
  </section>;
}
