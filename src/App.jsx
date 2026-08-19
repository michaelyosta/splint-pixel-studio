import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { metaApi } from './api/client';
import PlayerView from './views/PlayerView';
import HomeView from './views/HomeView';
import CatalogView from './views/CatalogView';
import FeedView from './views/FeedView';
import ProfileView from './views/ProfileView';
import CreatorView from './views/CreatorView';
import GalleryView from './views/GalleryView';
import CollectionsView from './views/CollectionsView';
import AchievementsView from './views/AchievementsView';
import BottomNavigation from './components/BottomNavigation';
import CreateHub from './components/CreateHub';
import ManualPixelEditor from './features/creator/ManualPixelEditor';
import CreatorCollectionsManager from './features/creator/CreatorCollectionsManager';
import UnlockLockedView from './features/unlocks/UnlockLockedView';
import { useUnlockData } from './features/unlocks/useUnlockData';
import { useHomeData } from './hooks/useHomeData';
import { useProductProfileData } from './hooks/useProductProfileData';
import { useCatalogData } from './hooks/useCatalogData';
import { useFeedData } from './hooks/useFeedData';
import { useProfileData } from './hooks/useProfileData';
import { useCreatorData } from './hooks/useCreatorData';
import { useColoringSession } from './hooks/useColoringSession';
import { useDirectorData } from './hooks/useDirectorData';
import { formatDifficulty } from './lib/catalogMeta';
import { getRequestedColoringId, hapticSelection } from './lib/telegram';
import { readCurrentResumeSnapshot } from './lib/resumeState.js';
import { resolveCoreFeelExperiment } from './features/coreFeel/coreFeelExperiment.js';
import { resolveSessionGameExperiment } from './features/sessionGame/sessionGameExperiment.js';
import './App.css';
import './features/unlocks/unlocks.css';

function App() {
  const coreFeelExperiment = useMemo(() => resolveCoreFeelExperiment(), []);
  const sessionGameExperiment = useMemo(() => resolveSessionGameExperiment(), []);
  const initialResume = useMemo(() => readCurrentResumeSnapshot(), []);
  const initialRequestedId = useMemo(() => getRequestedColoringId(), []);
  const [view, setView] = useState(() => {
    if (coreFeelExperiment.enabled || initialRequestedId || initialResume?.route === 'play') return 'play';
    return initialResume?.route || 'home';
  });
  const [notice, setNotice] = useState(null);
  const [unlockRefreshKey, setUnlockRefreshKey] = useState(0);
  const noticeTimerRef = useRef(null);
  const resumeHandledRef = useRef(false);
  const coreFeelHandledRef = useRef(false);
  const unlockData = useUnlockData({ enabled: !coreFeelExperiment.enabled, refreshKey: unlockRefreshKey });

  const showNotice = useCallback((text, type = 'info') => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice({ text, type });
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const refreshUnlocks = useCallback(() => setUnlockRefreshKey((key) => key + 1), []);

  const product = useProductProfileData({ showNotice });
  const home = useHomeData();
  const catalog = useCatalogData({
    showNotice,
    setFavoriteTemplates: product.setFavoriteTemplates,
    onNavigate: setView,
  });
  const feed = useFeedData({ showNotice });
  const profile = useProfileData({ showNotice, onNavigate: setView });
  const creator = useCreatorData({
    showNotice,
    onLoadMine: catalog.loadMine,
    onLoadCatalog: catalog.loadCatalog,
    onNavigate: setView,
  });
  const session = useColoringSession({
    view,
    feedMode: feed.feedMode,
    showNotice,
    onRewards: product.applyRewards,
    onLoadFeed: feed.loadFeed,
    onNavigate: setView,
    onUnlockRefresh: refreshUnlocks,
    setLoading: catalog.setLoading,
    setLatestReward: product.setLatestReward,
    setServerCompletedTemplateId: product.setServerCompletedTemplateId,
    serverCompletedTemplateId: product.serverCompletedTemplateId,
    coreFeelExperiment,
    sessionGameExperiment,
  });
  const director = useDirectorData({
    enabled: !coreFeelExperiment.enabled,
    refreshKey: unlockRefreshKey,
    exclude: view === 'play' && session?.template?.id ? session.template.id : null,
  });

  useEffect(() => {
    if (coreFeelExperiment.enabled) return;
    catalog.loadCatalog();
    home.loadToday();
    home.loadStreak();
    home.loadAchievements();
    home.loadCollections();
    profile.loadProfile();
    catalog.loadMine();
    product.loadProductProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.loadCatalog, catalog.loadMine, coreFeelExperiment.enabled, home.loadAchievements, home.loadCollections, home.loadStreak, home.loadToday, product.loadProductProfile, profile.loadProfile]);

  useEffect(() => {
    if (!coreFeelExperiment.enabled) metaApi.track('app_open').catch(() => {});
  }, [coreFeelExperiment.enabled]);

  useEffect(() => {
    if (!coreFeelExperiment.enabled || coreFeelHandledRef.current) return;
    coreFeelHandledRef.current = true;
    session.openColoring(coreFeelExperiment.referenceTemplateId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreFeelExperiment.enabled, coreFeelExperiment.referenceTemplateId]);

  // Explicit deep link wins over the local resume pointer. A cold standalone
  // launch without a query reopens the last artwork that was actually active.
  useEffect(() => {
    if (coreFeelExperiment.enabled || resumeHandledRef.current) return;
    const requestedId = getRequestedColoringId();
    const persisted = requestedId ? null : readCurrentResumeSnapshot();
    const persistedPlay = persisted?.route === 'play' ? persisted : null;
    const id = requestedId || persistedPlay?.artworkId;
    if (!id) {
      resumeHandledRef.current = true;
      return;
    }
    resumeHandledRef.current = true;
    session.openColoring(id, {
      resumeSnapshot: persistedPlay,
      usePersistedResume: !requestedId,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreFeelExperiment.enabled, session.openColoring]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'gallery' || view === 'home') catalog.loadMine(); }, [view, catalog.loadMine]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'catalog') catalog.loadMine(); }, [view, catalog.loadMine]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'feed') feed.loadFeed(feed.feedMode); }, [view, feed.feedMode, feed.loadFeed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'profile') profile.loadProfile(); }, [view, profile.loadProfile]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'profile' || view === 'home') product.loadProductProfile(); }, [view, product.loadProductProfile]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'collections') home.loadCollections(); }, [view, home.loadCollections]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  function navigatePrimary(nextView) {
    hapticSelection();
    session.setLockedUnlock(null);
    if (nextView === 'catalog') catalog.resetCatalogScope();
    setView(nextView);
  }

  const nextRecommendation = useMemo(() => {
    const serverNext = unlockData.recommendations.find((item) => item.id !== session.template?.id);
    if (serverNext) return serverNext;
    const unfinished = catalog.templates.find((item) => item.id !== session.template?.id && item.progress?.percent < 100);
    return unfinished || catalog.templates.find((item) => item.id !== session.template?.id) || null;
  }, [catalog.templates, session.template?.id, unlockData.recommendations]);

  function continueToRecommendation() {
    session.setLockedUnlock(null);
    session.setCompletionOpen(false);
    if (nextRecommendation) session.openColoring(nextRecommendation.id);
    else setView('catalog');
  }

  const completionChoices = useMemo(() => {
    const options = [];
    const primary = director.nextAction?.primary_action;
    const secondary = director.nextAction?.secondary_actions || [];
    const currentId = session.template?.id;
    if (primary && (!primary.template_id || primary.template_id !== currentId)) {
      options.push({ ...primary, recommended: true });
    }
    for (const action of secondary) {
      if (action.template_id && action.template_id === currentId) continue;
      if (options.some((item) => item.id === action.id || (action.template_id && item.template_id === action.template_id))) continue;
      if (options.length >= 2) break;
      options.push(action);
    }
    if (!options.some((item) => item.type === 'stop')) {
      options.push({
        id: 'done_today',
        type: 'stop',
        title: 'Завершить на сегодня',
        reward: 'Серия и прогресс сохранятся',
        reason: 'NATURAL_EXIT',
      });
    }
    return options.slice(0, 3);
  }, [director.nextAction, session.template?.id]);

  function handleCompletionChoice(option) {
    metaApi.track('choice_selected', {
      id: option.id,
      type: option.type,
      template_id: option.template_id || null,
      screen: 'completion',
    }).catch(() => {});
    session.setCompletionOpen(false);
    if (option.type === 'stop') {
      metaApi.track('session_natural_exit', { id: session.template?.id }).catch(() => {});
      director.refresh();
      setView('home');
      return;
    }
    if (option.template_id) {
      metaApi.track('next_session_started', { id: option.template_id }).catch(() => {});
      session.openColoring(option.template_id);
      return;
    }
    if (option.type === 'browse' || option.type === 'collections' || option.type === 'feed') {
      setView(option.type === 'collections' ? 'collections' : option.type === 'feed' ? 'feed' : 'catalog');
      return;
    }
    director.refresh();
    setView('home');
  }

  function handleUnlockSubject(subject, mode = 'journey') {
    if (mode === 'premium' || subject?.state === 'premium_locked') {
      catalog.setCatalogChip('premium');
      catalog.setCatalogCollection(null);
      setView('catalog');
      return;
    }
    if (!subject) return;
    if (subject.subject_type === 'template' && (subject.state === 'available' || subject.unlockable_now)) {
      session.openColoring(subject.subject_id);
      return;
    }
    if (subject.subject_type === 'collection' && (subject.state === 'available' || subject.unlockable_now)) {
      catalog.openCatalogCollection({ id: subject.subject_id, title: subject.title });
      return;
    }
    setView('home');
  }

  const creatorViewProps = {
    file: creator.file,
    onFileSelected: creator.handleFileSelected,
    title: creator.title,
    onChangeTitle: creator.setTitle,
    creatorImageUrl: creator.creatorImageUrl,
    creatorGrid: creator.creatorGrid,
    onChangeGrid: creator.setCreatorGrid,
    creatorColors: creator.creatorColors,
    onChangeColors: creator.setCreatorColors,
    creatorCrop: creator.creatorCrop,
    onChangeCrop: creator.setCreatorCrop,
    creatorCropMode: creator.creatorCropMode,
    onChangeCropMode: creator.setCreatorCropMode,
    creatorPreviews: creator.creatorPreviews,
    creatorQuality: creator.creatorQuality,
    creatorComputing: creator.creatorComputing,
    creating: creator.creating,
    creatorResult: creator.creatorResult,
    createdColoring: creator.createdColoring,
    onComputePreview: creator.computeCreatorPreview,
    onSaveDraft: creator.saveDraftColoring,
    onOpen: session.openColoring,
    onGoToProfile: () => { creator.setCreatedColoring(null); setView('profile'); },
  };

  let content;
  if (view === 'play') {
    content = session.lockedUnlock ? (
      <UnlockLockedView
        unlock={session.lockedUnlock}
        nextRecommendation={nextRecommendation}
        onBack={() => { session.setLockedUnlock(null); setView('catalog'); }}
        onBrowse={() => { session.setLockedUnlock(null); setView('home'); }}
        onContinue={continueToRecommendation}
        onPremium={() => { catalog.setCatalogChip('premium'); catalog.setCatalogCollection(null); session.setLockedUnlock(null); setView('catalog'); }}
      />
    ) : (
      <PlayerView
        template={session.template}
        progress={session.progress}
        gameProgress={session.gameProgress}
        progression={product.progression}
        streak={home.streak}
        isOnline={session.isOnline}
        saveState={session.saveState}
        latestReward={product.latestReward}
        nextRecommendation={nextRecommendation}
        onContinue={continueToRecommendation}
        completionChoices={completionChoices}
        onCompletionChoice={handleCompletionChoice}
        selectedColor={session.selectedColor}
        onSelectColor={session.setSelectedColor}
        resumeSnapshot={session.resumeSnapshot}
        onResumeStateChange={session.persistResumeState}
        zones={session.zones}
        zoneReward={session.zoneReward}
        combo={session.combo}
        calmMode={session.calmMode}
        hideNumbers={session.hideNumbers}
        hintMode={session.hintMode}
        hintsRemaining={session.hintsRemaining}
        setHintsRemaining={session.setHintsRemaining}
        playMode={session.playMode}
        fillMode={session.fillMode}
        history={session.history}
        future={session.future}
        onboarding={session.onboarding}
        setOnboarding={session.setOnboarding}
        completionOpen={session.completionOpen}
        setCompletionOpen={session.setCompletionOpen}
        sharing={session.sharing}
        saving={session.saving}
        onRetrySave={session.retryPendingSave}
        publishing={session.publishing}
        setView={session.handlePlayerSetView}
        setPlayMode={session.setPlayMode}
        setFillMode={session.setFillMode}
        setCalmMode={session.setCalmMode}
        setHideNumbers={session.setHideNumbers}
        setHintMode={session.setHintMode}
        onUndo={session.undo}
        onRedo={session.redo}
        onFirstPaint={session.handleFirstPaint}
        onWrongCell={session.handleWrongCell}
        onFillAt={session.handleFillAt}
        onStrokeCommitted={session.handleStrokeCommitted}
        onTiledStrokeCommitted={session.handleTiledStrokeCommitted}
        onTiledSpecialAction={session.queueTiledSpecialAction}
        tiledSpecialOffer={session.tiledSpecialOffer}
        tiledSpecialApplied={session.tiledSpecialApplied}
        tiledSpecialDiscovered={session.tiledSpecialDiscovered}
        tiledReconciledChanges={session.tiledReconciledChanges}
        onResetProgress={session.resetProgress}
        onShareResult={session.shareResult}
        onDownloadResult={session.downloadResult}
        onPublishCompleted={session.publishCompleted}
        onDismissOnboarding={session.dismissOnboarding}
        onTrack={(event, payload) => metaApi.track(event, payload).catch(() => {})}
        formatDifficulty={formatDifficulty}
        completedPreview={session.completedPreview}
        zoneIndices={session.zoneIndicesRef.current}
        coreFeelExperiment={coreFeelExperiment}
        sessionGameExperiment={sessionGameExperiment}
      />
    );
  } else if (view === 'home' && coreFeelExperiment.enabled) {
    content = (
      <section className="core-feel-stop-page" data-core-feel-stop-page>
        <img src="/assets/catalog/astro-whale-pixel.png" alt="Космический кит" />
        <p className="eyebrow">Сессия сохранена</p>
        <h1>Хорошая точка остановки.</h1>
        <p>Контур останется на месте. Вернись, когда захочется раскрыть следующий фрагмент.</p>
        <button type="button" className="primary-button" onClick={() => session.openColoring(coreFeelExperiment.referenceTemplateId)}>
          Продолжить кита
        </button>
      </section>
    );
  } else if (view === 'home') {
    content = <HomeView
      profile={profile.profile}
      streak={home.streak}
      progression={product.progression}
      today={home.today}
      templates={catalog.templates}
      loading={catalog.loading}
      mine={catalog.mine}
      dailyChallenge={product.dailyChallenge}
      weeklyChallenge={product.weeklyChallenge}
      unlockData={unlockData}
      director={director}
      onOpen={session.openColoring}
      onNavigate={navigatePrimary}
      onOpenUnlockSubject={handleUnlockSubject}
      onShowPopular={() => { catalog.setCatalogChip('popular'); setView('catalog'); }}
      onTrack={(event, payload) => metaApi.track(event, payload).catch(() => {})}
    />;
  } else if (view === 'gallery') {
    content = <GalleryView
      mine={catalog.mine}
      mineError={catalog.mineError}
      publishingTemplateId={catalog.publishingTemplateId}
      onRetry={catalog.loadMine}
      onOpen={session.openColoring}
      onToggleVisibility={catalog.setColoringVisibility}
      onDelete={catalog.deleteColoring}
      onNavigate={setView}
    />;
  } else if (view === 'feed') {
    content = <FeedView
      feed={feed.feed}
      feedMode={feed.feedMode}
      onChangeFeedMode={feed.selectFeedMode}
      openProfile={profile.openProfile}
      onToggleFollow={feed.toggleFollow}
      followingAuthorId={feed.followingAuthorId}
      onToggleLike={feed.toggleLike}
      likingPostId={feed.likingPostId}
      onToggleComments={feed.toggleComments}
      openCommentsPostId={feed.openCommentsPostId}
      commentsByPost={feed.commentsByPost}
      onReport={feed.reportPost}
      onSubmitComment={feed.submitComment}
      commentDraft={feed.commentDraft}
      onChangeCommentDraft={feed.setCommentDraft}
      submittingComment={feed.submittingComment}
      onRetryFeed={() => feed.loadFeed(feed.feedMode)}
      feedError={feed.feedError}
      onNavigate={navigatePrimary}
      currentUser={profile.currentUser}
    />;
  } else if (view === 'create') {
    content = <CreateHub onImport={() => setView('creator')} onManualDraw={() => setView('manual')} onCreatePack={() => setView('packs')} />;
  } else if (view === 'manual') {
    content = <ManualPixelEditor onCreate={creator.saveManualColoring} disabled={creator.creating} />;
  } else if (view === 'packs') {
    content = <CreatorCollectionsManager templates={catalog.mine} onCollectionChange={() => { home.loadCollections(); product.loadProductProfile(); }} />;
  } else if (view === 'creator') {
    content = <CreatorView {...creatorViewProps} />;
  } else if (view === 'created') {
    content = <CreatorView {...creatorViewProps} />;
  } else if (view === 'profile') {
    content = <ProfileView
      profile={profile.profile}
      currentUser={profile.currentUser}
      profileArtworks={profile.profileArtworks}
      mine={catalog.mine}
      profileShelf={profile.profileShelf}
      onChangeShelf={profile.setProfileShelf}
      favoriteTemplates={product.favoriteTemplates}
      recentTemplates={product.recentTemplates}
      collections={home.collections}
      achievements={home.achievements}
      progression={product.progression}
      streak={home.streak}
      unlockData={unlockData}
      onOpen={session.openColoring}
      onNavigate={navigatePrimary}
      onToggleFollow={profile.toggleProfileFollow}
      onOpenCollection={catalog.openCatalogCollection}
      onSetView={setView}
      onOpenUnlockSubject={handleUnlockSubject}
    />;
  } else if (view === 'collections') {
    content = <CollectionsView collections={home.collections} onOpenCollection={catalog.openCatalogCollection} />;
  } else if (view === 'achievements') {
    content = <AchievementsView achievements={home.achievements} />;
  } else {
    content = <CatalogView
      templates={catalog.templates}
      loading={catalog.loading}
      catalogError={catalog.catalogError}
      mine={catalog.mine}
      today={home.today}
      streak={home.streak}
      filters={catalog.filters}
      onChangeFilters={catalog.changeFilters}
      collections={home.collections}
      catalogChip={catalog.catalogChip}
      onChangeChip={catalog.setCatalogChip}
      catalogQuery={catalog.catalogQuery}
      onChangeQuery={catalog.setCatalogQuery}
      catalogCollection={catalog.catalogCollection}
      onResetScope={catalog.resetCatalogScope}
      visibleCount={catalog.visibleCount}
      onShowMore={catalog.showMore}
      onOpen={session.openColoring}
      onRetryCatalog={catalog.loadCatalog}
      onRate={catalog.rateColoring}
      ratingTemplateId={catalog.ratingTemplateId}
      currentUser={profile.currentUser}
      onToggleFavorite={catalog.toggleTemplateFavorite}
      favoriteSavingId={catalog.favoriteSavingId}
      onOpenCollection={catalog.openCatalogCollection}
    />;
  }

  return <main className="telegram-frame"><div className="app-container">{view !== 'play' && !coreFeelExperiment.enabled && <header className="app-header app-header--redesigned"><button className="brand-button" type="button" onClick={() => navigatePrimary('home')}><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><span className="header-logo">SPLINT</span><small>pixel studio</small></span></button><button className="header-profile-button" type="button" onClick={() => navigatePrimary('profile')} aria-label="Открыть профиль"><img src={profile.currentUser?.avatar_url || profile.profile?.avatar_url || '/favicon.svg'} alt="" /></button></header>}<div ref={session.screenContentRef} className={`screen-content${view === 'play' ? ' screen-content--play' : ''}`}>{content}</div>{view !== 'play' && !coreFeelExperiment.enabled && <BottomNavigation activeView={view} onNavigate={navigatePrimary} />}</div>{notice && (!coreFeelExperiment.enabled || notice.type === 'error') && <div className={`toast ${notice.type}`}>{notice.text}</div>}</main>;
}

export default App;
