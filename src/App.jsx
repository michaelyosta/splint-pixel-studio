import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { metaApi, telegramStarsApi, unlocksApi } from './api/client';
import PlayerView from './views/PlayerView';
import CatalogView from './views/CatalogView';
import FeedView from './views/FeedView';
import ProfileView from './views/ProfileView';
import CreatorView from './views/CreatorView';
import GalleryView from './views/GalleryView';
import CollectionsView from './views/CollectionsView';
import AchievementsView from './views/AchievementsView';
import StoreView from './views/StoreView';
import BottomNavigation from './components/BottomNavigation';
import BrowserAuthPage from './components/BrowserAuthPage';
import CreateHub from './components/CreateHub';
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
import { formatDifficulty } from './lib/catalogMeta';
import { getRequestedColoringId, getRequestedPackId, getRequestedProfileId, hapticSelection } from './lib/telegram';
import { shouldResolveRequestedPackRoute } from './lib/navigation.js';
import { readCurrentResumeSnapshot } from './lib/resumeState.js';
import { resolveCoreFeelExperiment } from './features/coreFeel/coreFeelExperiment.js';
import { resolveSessionGameExperiment } from './features/sessionGame/sessionGameExperiment.js';
import { useBrowserAuth } from './hooks/useBrowserAuth.js';
import './App.css';
import './features/unlocks/unlocks.css';

function App() {
  const coreFeelExperiment = useMemo(() => resolveCoreFeelExperiment(), []);
  const sessionGameExperiment = useMemo(() => resolveSessionGameExperiment(), []);
  const browserAuth = useBrowserAuth();
  const canUseApp = browserAuth.isAuthenticated;
  const authError = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('auth_error');
  }, []);
  const initialResume = useMemo(() => readCurrentResumeSnapshot(), []);
  const initialRequestedId = useMemo(() => getRequestedColoringId(), []);
  const initialRequestedPackId = useMemo(() => getRequestedPackId(), []);
  const initialRequestedProfileId = useMemo(() => getRequestedProfileId(), []);
  const [view, setView] = useState(() => {
    if (coreFeelExperiment.enabled || initialRequestedId) return 'play';
    if (initialRequestedPackId) return 'catalog';
    if (initialRequestedProfileId) return 'profile';
    if (initialResume?.route === 'play') return 'play';
    return ['catalog', 'create', 'profile'].includes(initialResume?.route) ? initialResume.route : 'catalog';
  });
  const [requestedPackId, setRequestedPackId] = useState(initialRequestedPackId);
  const [viewedProfileId, setViewedProfileId] = useState(initialRequestedProfileId);
  const [notice, setNotice] = useState(null);
  const [unlockRefreshKey, setUnlockRefreshKey] = useState(0);
  const [paymentsMode, setPaymentsMode] = useState('disabled');
  const [paymentProductIds, setPaymentProductIds] = useState([]);
  const noticeTimerRef = useRef(null);
  const resumeHandledRef = useRef(false);
  const coreFeelHandledRef = useRef(false);
  const unlockData = useUnlockData({ enabled: !coreFeelExperiment.enabled && canUseApp, refreshKey: unlockRefreshKey });
  const { refresh: refreshUnlockData } = unlockData;

  const showNotice = useCallback((text, type = 'info') => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice({ text, type });
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const trackEvent = useCallback((event, payload) => {
    metaApi.track(event, payload).catch(() => {});
  }, []);

  const refreshUnlocks = useCallback(() => setUnlockRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    telegramStarsApi.config()
      .then((config) => {
        if (!active || config?.mode !== 'telegram_stars_controlled') {
          if (active) {
            setPaymentsMode('disabled');
            setPaymentProductIds([]);
          }
          return;
        }
        setPaymentsMode(config.mode);
        setPaymentProductIds(Array.isArray(config.product_ids) ? config.product_ids.map(String) : []);
      })
      .catch(() => {
        if (active) {
          setPaymentsMode('disabled');
          setPaymentProductIds([]);
        }
      });
    return () => { active = false; };
  }, []);

  const purchaseTelegramStars = useCallback(async (pack) => {
    const openInvoice = window.Telegram?.WebApp?.openInvoice;
    if (typeof openInvoice !== 'function') return { success: false, error: 'Telegram invoice UI недоступен' };
    const idempotencyKey = globalThis.crypto?.randomUUID?.() || `xtr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const created = await telegramStarsApi.createOrder(pack.id, idempotencyKey);
    const order = created?.order;
    if (!order?.id || !order.invoice_url) return { success: false, error: 'Счёт не был создан сервером' };

    const invoiceStatus = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(String(value || 'pending').toLowerCase());
      };
      const timer = window.setTimeout(() => finish('pending'), 25_000);
      try {
        openInvoice(order.invoice_url, finish);
      } catch {
        finish('failed');
      }
    });

    if (invoiceStatus === 'cancelled') return { cancelled: true, status: 'cancelled' };
    if (invoiceStatus === 'failed') return { success: false, error: 'Telegram не подтвердил счёт' };

    // The invoice callback is only a UI signal. Proof comes from the durable
    // order written by successful_payment and the unlock endpoint.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const current = (await telegramStarsApi.order(order.id))?.order;
        if (current?.status === 'paid') {
          const entitlement = await unlocksApi.collection(pack.id);
          if (entitlement?.owned !== true && entitlement?.state !== 'owned') {
            return { success: false, error: 'Платёж принят, но доступ ещё не подтверждён сервером' };
          }
          await refreshUnlockData();
          return { success: true, server_confirmed: true, entitlement_status: 'active', operation_id: order.id };
        }
        if (current?.status === 'refunded' || current?.status === 'partially_refunded') {
          return { success: false, error: 'Покупка была возвращена до выдачи доступа' };
        }
      } catch {
        // A short provider/webhook delay is expected; retry with the same
        // order id instead of creating another invoice.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    return { pending_confirmation: true, status: 'pending_confirmation', operation_id: order.id };
  }, [refreshUnlockData]);

  const restoreTelegramStars = useCallback(async (pack) => {
    const entitlement = await unlocksApi.collection(pack.id);
    if (entitlement?.owned === true && entitlement?.state === 'owned') {
      await refreshUnlockData();
      return { success: true, server_confirmed: true, entitlement_status: 'active', restored: true };
    }
    return { success: false, error: 'Покупка для восстановления не найдена' };
  }, [refreshUnlockData]);

  const product = useProductProfileData({ showNotice });
  const home = useHomeData();
  const catalog = useCatalogData({
    showNotice,
    setFavoriteTemplates: product.setFavoriteTemplates,
    onNavigate: setView,
  });
  const {
    openCatalogCollection,
    setCatalogChip,
    setCatalogCollection,
  } = catalog;
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
  useEffect(() => {
    if (coreFeelExperiment.enabled || !canUseApp) return;
    catalog.loadCatalog();
    home.loadCollections();
    profile.loadCurrentUser();
    catalog.loadMine();
    product.loadProductProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseApp, catalog.loadCatalog, catalog.loadMine, coreFeelExperiment.enabled, home.loadCollections, product.loadProductProfile, profile.loadCurrentUser]);

  useEffect(() => {
    if (!coreFeelExperiment.enabled && canUseApp) metaApi.track('app_open').catch(() => {});
  }, [canUseApp, coreFeelExperiment.enabled]);

  useEffect(() => {
    if (!coreFeelExperiment.enabled || !canUseApp || coreFeelHandledRef.current) return;
    coreFeelHandledRef.current = true;
    session.openColoring(coreFeelExperiment.referenceTemplateId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseApp, coreFeelExperiment.enabled, coreFeelExperiment.referenceTemplateId]);

  // Explicit deep link wins over the local resume pointer. A cold standalone
  // launch without a query reopens the last artwork that was actually active.
  useEffect(() => {
    if (coreFeelExperiment.enabled || !canUseApp || resumeHandledRef.current) return;
    const requestedId = getRequestedColoringId();
    const requestedPack = getRequestedPackId();
    const requestedProfile = getRequestedProfileId();
    const persisted = requestedId || requestedPack || requestedProfile ? null : readCurrentResumeSnapshot();
    const persistedPlay = persisted?.route === 'play' ? persisted : null;
    const id = requestedId || persistedPlay?.artworkId;
    if (!id) {
      resumeHandledRef.current = true;
      if (requestedPack) {
        setView('catalog');
      }
      return;
    }
    resumeHandledRef.current = true;
    session.openColoring(id, {
      resumeSnapshot: persistedPlay,
      usePersistedResume: !requestedId,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseApp, coreFeelExperiment.enabled, session.openColoring]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canUseApp && (view === 'gallery' || view === 'home')) catalog.loadMine(); }, [canUseApp, view, catalog.loadMine]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canUseApp && view === 'catalog') catalog.loadMine(); }, [canUseApp, view, catalog.loadMine]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canUseApp && view === 'feed') feed.loadFeed(feed.feedMode); }, [canUseApp, view, feed.feedMode, feed.loadFeed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canUseApp && view === 'profile') profile.loadProfile(viewedProfileId || null); }, [canUseApp, view, viewedProfileId, profile.loadProfile]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canUseApp && (view === 'profile' || view === 'home')) product.loadProductProfile(); }, [canUseApp, view, product.loadProductProfile]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canUseApp && view === 'collections') home.loadCollections(); }, [canUseApp, view, home.loadCollections]);

  useEffect(() => {
    if (typeof window === 'undefined' || !['success', 'telegram_denied', 'telegram_verification_failed'].some((value) => value === authError)) return;
    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, '', cleanUrl);
  }, [authError]);

  useEffect(() => {
    if (!shouldResolveRequestedPackRoute({ view, requestedPackId, collections: home.collections })) return;
    const requestedPack = home.collections.find((collection) => String(collection.id) === String(requestedPackId));
    if (!requestedPack) {
      showNotice('Коллекция по ссылке не найдена', 'error');
      setRequestedPackId(null);
      return;
    }
    if (requestedPack.pack_type === 'premium') {
      setCatalogCollection(null);
      setCatalogChip('premium');
      setView('catalog');
      return;
    }
    openCatalogCollection(requestedPack);
  }, [home.collections, openCatalogCollection, requestedPackId, setCatalogChip, setCatalogCollection, showNotice, view]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  function navigatePrimary(nextView) {
    hapticSelection();
    session.setLockedUnlock(null);
    if (nextView === 'catalog') {
      setRequestedPackId(null);
      catalog.resetCatalogScope();
    }
    if (nextView === 'profile') setViewedProfileId(null);
    setView(nextView);
  }

  function openStore(packId = null) {
    setRequestedPackId(packId);
    setView('store');
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

  const completionChoices = useMemo(() => [
    { id: 'open_profile', type: 'profile', title: 'Открыть в профиле', reward: 'Работа сохранена в коллекции', recommended: true },
    { id: 'browse_catalog', type: 'browse', title: 'Выбрать следующую', reward: 'Вернуться в каталог' },
  ], []);

  function handleCompletionChoice(option) {
    metaApi.track('choice_selected', {
      id: option.id,
      type: option.type,
      template_id: option.template_id || null,
      screen: 'completion',
    }).catch(() => {});
    session.setCompletionOpen(false);
    if (option.type === 'profile') {
      // Switch immediately so a slow mobile request cannot leave the player
      // mounted while the async profile/catalog refresh is still in flight.
      // The profile view effect performs its own authoritative load on mount.
      setView('profile');
      // Start the handoff explicitly; the view effect remains the authoritative refresh path.
      profile.loadProfile(null);
      catalog.loadMine();
      product.loadProductProfile();
      return;
    }
    if (option.template_id) {
      metaApi.track('next_session_started', { id: option.template_id }).catch(() => {});
      session.openColoring(option.template_id);
      return;
    }
    if (option.type === 'browse') {
      setView('catalog');
      return;
    }
    setView('catalog');
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
    setView('catalog');
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
        onBrowse={() => { session.setLockedUnlock(null); setView('catalog'); }}
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
        onDismissOnboarding={session.dismissOnboarding}
        onTrack={trackEvent}
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
      openProfile={(userId) => { setViewedProfileId(userId); profile.openProfile(userId); }}
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
    content = <CreateHub onImport={() => setView('creator')} onCreatePack={() => setView('packs')} />;
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
      publishingTemplateId={catalog.publishingTemplateId}
      onToggleVisibility={catalog.setColoringVisibility}
      onDelete={catalog.deleteColoring}
    />;
  } else if (view === 'collections') {
    content = <CollectionsView collections={home.collections} mine={catalog.mine} onOpenCollection={catalog.openCatalogCollection} onNavigate={navigatePrimary} />;
  } else if (view === 'store') {
    content = <StoreView
      collections={home.collections}
      unlockSnapshot={unlockData.snapshot}
      requestedPackId={requestedPackId}
      // No browser-side invoice adapter is mounted yet. Keep the product
      // surface controlled by the authenticated server configuration.
      paymentsMode={paymentsMode}
      allowedProductIds={paymentProductIds}
      onPurchase={purchaseTelegramStars}
      onRestore={restoreTelegramStars}
      onRetry={home.loadCollections}
      onOpenCollection={catalog.openCatalogCollection}
      onBack={() => setView('catalog')}
      onTrack={(event, payload) => metaApi.track(event, payload).catch(() => {})}
      onNotice={showNotice}
    />;
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
      requestedPackId={requestedPackId}
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
      unlockData={unlockData}
      onOpenPremiumItem={session.openColoring}
      onOpenFreePack={() => { catalog.setCatalogChip('free'); catalog.setCatalogCollection(null); }}
      onPremiumWish={() => showNotice('Желание сохранено — сообщим, когда витрина откроется', 'success')}
      paymentsMode={paymentsMode}
      onOpenStore={openStore}
    />;
  }

  if (browserAuth.platform.isBrowser && !canUseApp) {
    content = <BrowserAuthPage
      status={browserAuth.status}
      error={authError === 'telegram_denied' ? 'Вход отменён.' : authError ? 'Не удалось подтвердить вход через Telegram.' : null}
      onLogin={browserAuth.login}
    />;
  }

  // The primary-navigation contract is intentionally explicit: view !== 'play' && !coreFeelExperiment.enabled && <BottomNavigation activeView={view} onNavigate={navigatePrimary} />
  const showChrome = view !== 'play' && !coreFeelExperiment.enabled;
  return <main className="telegram-frame" data-platform={browserAuth.platform.isTelegram ? 'telegram' : 'browser'} data-auth-mode={browserAuth.platform.authMode}><div className="app-container">{showChrome && <header className="app-header app-header--redesigned"><button className="brand-button" type="button" onClick={() => navigatePrimary('catalog')}><span className="brand-mark" aria-hidden="true" /><span className="brand-text"><span className="header-logo">SPLINT</span><small>pixel studio</small></span></button><div className="header-actions">{browserAuth.status === 'authenticated' && browserAuth.platform.isBrowser && <button className="header-logout-button" type="button" onClick={() => browserAuth.logout().catch(() => showNotice('Не удалось завершить сессию', 'error'))}>Выйти</button>}<button className="header-profile-button" type="button" onClick={() => navigatePrimary('profile')} aria-label="Открыть профиль"><img src={profile.currentUser?.avatar_url || profile.profile?.avatar_url || '/favicon.svg'} alt="" /></button></div></header>}<div ref={session.screenContentRef} className={`screen-content${view === 'play' ? ' screen-content--play' : ''}`}>{content}</div>{showChrome && canUseApp && <BottomNavigation activeView={view} onNavigate={navigatePrimary} />}</div>{notice && (!coreFeelExperiment.enabled || notice.type === 'error') && <div className={`toast ${notice.type}`}>{notice.text}</div>}</main>;
}

export default App;
