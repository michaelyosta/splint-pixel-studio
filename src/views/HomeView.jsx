import { useEffect, useMemo, useRef } from 'react';
import { ArrowRight, Clock3, Flame, Sparkles } from 'lucide-react';
import RecommendationsStrip from '../features/unlocks/RecommendationsStrip';
import UnlockJourneyCard from '../features/unlocks/UnlockJourneyCard';

function fallbackAction(item, type) {
  if (!item) return null;
  const percent = item.progress?.percent || item.progress_percent || 0;
  return {
    id: `action_${type}_${item.id}`,
    type,
    template_id: item.id,
    title: item.title,
    preview_url: item.preview_url || null,
    reason: type === 'resume' ? 'CONTINUE_PROGRESS' : 'COLD_START',
    estimated_time: `${item.est_minutes || 3} мин`,
    reward: type === 'resume'
      ? `Осталось ${100 - percent}% картины`
      : 'Первая раскрытая картина',
    progress_percent: percent,
  };
}

function browseAction() {
  return {
    id: 'action_browse',
    type: 'browse',
    template_id: null,
    title: 'Выбрать другую картину',
    estimated_time: '—',
    reward: 'Каталог',
    reason: 'EXPLORE',
  };
}

function hasUnfinishedProgress(item) {
  const progress = item?.progress;
  if (!progress) return false;
  const completed = Number(progress.completed_cells);
  const total = Number(progress.total_cells);
  if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
    return completed > 0 && completed < total;
  }
  return progress.percent > 0 && progress.percent < 100;
}

function dailyFallback(dailyChallenge) {
  if (!dailyChallenge?.template_id) return null;
  const target = Math.max(1, Number(dailyChallenge.target_cells) || 1);
  return {
    id: 'action_daily',
    type: 'daily',
    template_id: dailyChallenge.template_id,
    title: 'Ежедневная картина',
    estimated_time: '≈5 мин',
    reward: `+${dailyChallenge.xp_reward || 30} XP`,
    reason: 'DAILY',
    progress_percent: Math.min(100, Math.round((Number(dailyChallenge.progress_cells) || 0) / target * 100)),
  };
}

export default function HomeView({
  profile,
  streak,
  progression,
  today,
  templates,
  loading,
  mine,
  dailyChallenge,
  unlockData,
  director,
  onOpen,
  onNavigate,
  onOpenUnlockSubject,
  onTrack,
}) {
  const continueItem = mine
    .filter(hasUnfinishedProgress)
    .sort((first, second) => {
      const firstActivity = Date.parse(first.progress?.updated_at || '') || 0;
      const secondActivity = Date.parse(second.progress?.updated_at || '') || 0;
      if (secondActivity !== firstActivity) return secondActivity - firstActivity;
      return String(first.id).localeCompare(String(second.id));
    })[0];
  const featured = today?.for_you || templates[0];
  const directorPrimary = director?.nextAction?.primary_action || null;
  const primary = directorPrimary
    || fallbackAction(continueItem, 'resume')
    || fallbackAction(featured, 'start');
  const unlockPreview = director?.nextAction?.unlock_preview || null;

  const secondary = useMemo(() => {
    const list = [...(director?.nextAction?.secondary_actions || [])].slice(0, 2);
    if (!list.length) {
      const daily = dailyFallback(dailyChallenge);
      if (daily) list.push(daily);
      list.push(browseAction());
    }
    return list;
  }, [director?.nextAction, dailyChallenge]);

  const seenPrimaryRef = useRef(null);
  const seenChoiceRef = useRef(false);

  useEffect(() => {
    if (!primary?.id || seenPrimaryRef.current === primary.id) return;
    seenPrimaryRef.current = primary.id;
    onTrack?.('primary_action_seen', {
      id: primary.template_id || primary.id,
      type: primary.type,
      reason: primary.reason,
    });
  }, [primary?.id, primary?.template_id, primary?.type, primary?.reason, onTrack]);

  useEffect(() => {
    if (!secondary.length || seenChoiceRef.current) return;
    seenChoiceRef.current = true;
    onTrack?.('choice_window_seen', { screen: 'home', options: secondary.length });
  }, [secondary.length, onTrack]);

  const handlePrimary = () => {
    onTrack?.('primary_action_started', {
      id: primary.template_id || primary.id,
      type: primary.type,
      reason: primary.reason,
    });
    if (primary.template_id) onOpen(primary.template_id);
    else if (primary.type === 'browse') onNavigate('catalog');
    else onNavigate('catalog');
  };

  const handleChoice = (option) => {
    onTrack?.('choice_selected', {
      id: option.id,
      type: option.type,
      template_id: option.template_id || null,
      screen: 'home',
    });
    if (option.template_id) onOpen(option.template_id);
    else if (option.type === 'browse') onNavigate('catalog');
    else if (option.type === 'collections') onNavigate('collections');
    else if (option.type === 'feed') onNavigate('feed');
    else onNavigate('catalog');
  };

  return <section className="page home-page home-page--guided">
    <div className="home-greeting">
      <div>
        <p className="eyebrow">SPLINT PIXEL STUDIO</p>
        <h1>Привет{profile?.nickname ? `, ${profile.nickname}` : ''}!</h1>
        <p>Продолжим путь: у тебя уже есть следующий шаг.</p>
      </div>
      <button className="home-avatar" type="button" onClick={() => onNavigate('profile')} aria-label="Открыть профиль">
        <img src={profile?.avatar_url || '/favicon.svg'} alt="" />
      </button>
    </div>

    <section className="home-goal-strip home-goal-strip--compact" aria-label="Текущая игровая цель">
      <span className="home-goal-icon"><Flame size={18} /></span>
      <div>
        <b>{streak?.done_today ? `Серия ${streak.current_streak} дн. продолжается` : `Серия ${streak?.current_streak || 0} дн. — раскрась немного сегодня`}</b>
        <small>{progression ? `${progression.xp_to_next_level} XP до уровня ${progression.level + 1}` : 'Загружаем следующий шаг…'}</small>
      </div>
      <strong>{progression?.xp_total ?? 0}<small>XP</small></strong>
    </section>

    {primary ? <section className="home-block home-guided-primary" data-guided-primary="true" data-action-type={primary.type}>
      <div className="section-heading">
        <div><p className="eyebrow">{primary.type === 'resume' ? 'ТВОЙ ПУТЬ ПРОДОЛЖАЕТСЯ' : 'ПЕРВАЯ КАРТИНА'}</p><h2>Продолжить путь</h2></div>
      </div>
      <button
        className={`home-guided-card ${primary.type === 'resume' ? 'home-continue-card' : 'home-featured-card'}`}
        type="button"
        onClick={handlePrimary}
        data-guided-action="primary"
      >
        <span className="home-guided-preview" style={primary.preview_url ? { backgroundImage: `url(${primary.preview_url})` } : undefined} aria-hidden="true" />
        <span className="home-guided-copy">
          <b>{primary.title}</b>
          <small>{primary.estimated_time || '3 мин'} · {primary.reward}</small>
          <span className="home-guided-meta"><Clock3 size={13} /> {primary.type === 'resume' ? `${primary.progress_percent}% готово` : 'Начать раскрывать'}</span>
        </span>
        <ArrowRight className="home-guided-arrow" size={18} aria-hidden="true" />
      </button>
      {unlockPreview && (
        <button className="home-unlock-preview" type="button" onClick={() => onTrack?.('unlock_preview_seen', { subject_id: unlockPreview.subject_id })}>
          <Sparkles size={14} aria-hidden="true" />
          Почти открыто: {unlockPreview.title}
        </button>
      )}
    </section> : <section className="home-block">
      <div className="section-heading"><div><p className="eyebrow">ПУТЬ СВОБОДЕН</p><h2>Выбери первую картину</h2></div></div>
      {loading
        ? <div className="home-empty" role="status">Загружаем путь…</div>
        : <button className="home-empty" type="button" onClick={() => onNavigate('catalog')}>Открыть каталог</button>}
    </section>}

    <section className="home-block home-session-choices" data-choice-window="home">
      <div className="section-heading"><div><p className="eyebrow">ВЫБОР СЕССИИ</p><h2>Что делаем сейчас?</h2></div></div>
      <div className="home-choice-list">
        {secondary.map((option) => (
          <button className="home-choice-card" type="button" key={option.id} data-choice-id={option.id} onClick={() => handleChoice(option)}>
            <span><b>{option.title}</b><small>{option.estimated_time || '—'} · {option.reward || 'Начать'}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>

    <section className="home-explore-row" aria-label="Исследование">
      <button type="button" onClick={() => onNavigate('catalog')}>Каталог</button>
      <button type="button" onClick={() => onNavigate('collections')}>Коллекции</button>
      <button type="button" onClick={() => onNavigate('feed')}>Лента</button>
    </section>

    <section className="home-block home-explore-more">
      <div className="section-heading"><div><p className="eyebrow">ЕЩЁ ВАРИАНТЫ</p><h2>Рекомендации</h2></div></div>
      <RecommendationsStrip
        items={unlockData.recommendations}
        status={unlockData.recommendationsStatus}
        error={unlockData.recommendationsError}
        onRetry={() => unlockData.refresh()}
        onOpen={(item) => { onTrack?.('recommendation_opened', { id: item.id }); onOpen(item.id); }}
      />
    </section>

    <section className="home-block home-explore-unlocks">
      <div className="section-heading"><div><p className="eyebrow">ОТКРЫТИЯ</p><h2>Следующие коллекции</h2></div></div>
      <UnlockJourneyCard
        journey={unlockData.journey}
        status={unlockData.snapshotStatus}
        error={unlockData.snapshotError}
        onRetry={() => unlockData.refresh()}
        onOpen={onOpenUnlockSubject}
      />
    </section>
  </section>;
}
