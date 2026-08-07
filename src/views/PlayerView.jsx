import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, Download, LoaderCircle, Share2, Sparkles, Star, Target, X } from 'lucide-react';
import ColoringSession from '../features/coloring/ColoringSession';
import ProgressiveColoringSession from '../features/coloring/large-grid/ProgressiveColoringSession.jsx';
import LegacyPixelCanvas from '../components/LegacyPixelCanvas';
import SessionGoalCard from '../features/goals/SessionGoalCard';
import { useSessionGoals } from '../features/goals/useSessionGoals';
import { getContextGoal } from '../lib/playLoop';
import { isProgressComplete } from '../lib/pixelColoring';
import { renderNumberedPreview } from '../lib/imageCrop';
import { isLargeGridTemplate } from '../lib/tileGrid';
import { bindTelegramBackButton } from '../lib/telegram';

const USE_NEW_COLORING_ENGINE = import.meta.env.VITE_NEW_COLORING_ENGINE !== 'false';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Keeps Tab navigation inside a modal container while it is open. */
function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active) return undefined;
    const container = ref.current;
    if (!container) return undefined;
    const handleKey = (event) => {
      if (event.key !== 'Tab') return;
      const focusables = [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((el) => !el.disabled && el.getClientRects().length > 0);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [ref, active]);
}

/** Turns a container into a swipe-down-to-close surface (mobile sheets). */
function useSwipeDown(onClose) {
  const dragRef = useRef(null);
  const onTouchStart = useCallback((event) => {
    const el = event.currentTarget;
    if (el.scrollTop > 0) return;
    dragRef.current = { y: event.touches[0].clientY, el, dy: 0 };
  }, []);
  const onTouchMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = event.touches[0].clientY - drag.y;
    if (dy <= 0) return;
    drag.dy = dy;
    drag.el.classList.add('dragging');
    drag.el.style.transform = `translateY(${dy}px)`;
  }, []);
  const onTouchEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    drag.el.classList.remove('dragging');
    drag.el.style.transform = '';
    if (drag.dy > 90) onClose();
  }, [onClose]);
  return { onTouchStart, onTouchMove, onTouchEnd };
}

/** «До/после» слайдер: пронумерованная сетка против готовой картины. */
function CompareSlider({ before, after, title }) {
  const trackRef = useRef(null);
  const setSplit = useCallback((clientX) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.min(96, Math.max(4, ((clientX - rect.left) / rect.width) * 100));
    track.style.setProperty('--split', `${pct}%`);
  }, []);
  const handlePointer = useCallback((event) => {
    if (event.type === 'pointerdown') event.currentTarget.setPointerCapture(event.pointerId);
    if (event.buttons !== 1 && event.type !== 'pointerdown') return;
    setSplit(event.clientX);
  }, [setSplit]);
  return (
    <div
      className="compare-slider"
      ref={trackRef}
      role="img"
      aria-label={`Сравнение сетки и готовой работы ${title}`}
      onPointerDown={handlePointer}
      onPointerMove={handlePointer}
    >
      <img className="compare-after" src={after} alt="" />
      <img className="compare-before" src={before} alt="" />
      <span className="compare-handle" aria-hidden="true" />
      <span className="compare-tag before">Сетка</span>
      <span className="compare-tag after">Готово</span>
    </div>
  );
}

export default function PlayerView({
  template,
  progress,
  gameProgress,
  progression,
  streak,
  isOnline = true,
  saveState = 'saved',
  latestReward,
  nextRecommendation,
  onContinue,
  selectedColor,
  onSelectColor,
  zones,
  zoneReward,
  combo,
  calmMode,
  hideNumbers,
  hintMode,
  hintsRemaining,
  setHintsRemaining,
  playMode,
  fillMode,
  history,
  future,
  onboarding,
  setOnboarding,
  completionOpen,
  setCompletionOpen,
  sharing,
  saving,
  onRetrySave = () => {},
  publishing,
  setView,
  setPlayMode,
  setFillMode,
  setCalmMode,
  setHideNumbers,
  setHintMode,
  onUndo,
  onRedo,
  onFirstPaint,
  onWrongCell,
  onFillAt,
  onStrokeCommitted,
  onTiledStrokeCommitted,
  onResetProgress,
  onShareResult,
  onDownloadResult,
  onPublishCompleted,
  onDismissOnboarding,
  onTrack,
  formatDifficulty,
  completedPreview,
  zoneIndices,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);
  const startPaintTimerRef = useRef(null);
  const completionDialogRef = useRef(null);
  const bottomSheetRef = useRef(null);
  const onboardingCardRef = useRef(null);

  // Нативная кнопка «назад» Telegram ведёт в каталог, пока открыт плеер.
  useEffect(() => bindTelegramBackButton(() => setView('catalog')), [setView]);

  useFocusTrap(bottomSheetRef, menuOpen);
  useFocusTrap(onboardingCardRef, onboarding !== null);
  useFocusTrap(completionDialogRef, completionOpen);

  const sessionGoals = useSessionGoals({
    template,
    progress,
    zones,
    zoneIndices,
    isOnline,
    storage: typeof window !== 'undefined' ? window.localStorage : null,
    onTrack,
  });

  const handleFirstPaint = () => {
    sessionGoals.markFirstPaint();
    onFirstPaint?.();
  };

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeCompletion = useCallback(() => setCompletionOpen(false), [setCompletionOpen]);
  const menuSwipe = useSwipeDown(closeMenu);
  const completionSwipe = useSwipeDown(closeCompletion);

  useEffect(() => {
    return () => {
      if (startPaintTimerRef.current) clearTimeout(startPaintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!completionOpen) return undefined;
    completionDialogRef.current?.focus();
    const closeOnEscape = (event) => { if (event.key === 'Escape') setCompletionOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [completionOpen, setCompletionOpen]);

  const declutter = () => {
    window.clearTimeout(startPaintTimerRef.current);
    startPaintTimerRef.current = window.setTimeout(() => setHudHidden(true), 2500);
  };
  const showHud = () => { setHudHidden(false); declutter(); };

  // «До» для слайдера сравнения: пронумерованная сетка этой же раскраски.
  const isTiled = isLargeGridTemplate(template);
  const complete = gameProgress ? (isTiled
    ? gameProgress.completed === gameProgress.total
    : isProgressComplete(gameProgress)) : false;
  const beforePreview = useMemo(() => {
    if (!complete || !template || isTiled) return null;
    try {
      return renderNumberedPreview(template.width, template.height, template.palette, template.cells);
    } catch {
      return null;
    }
  }, [complete, isTiled, template]);

  if (!template || !progress || !gameProgress) {
    return <div className="loading"><LoaderCircle className="spin" /> Загружаем…</div>;
  }

  const isComplete = isProgressComplete(gameProgress);
  const totalXp = progression?.xp_total ?? 0;
  const level = progression?.level ?? 1;
  const saveLabel = !isOnline || saveState === 'offline'
    ? 'Сохранено локально'
    : saveState === 'pending'
      ? 'Ожидает отправки'
      : saving || saveState === 'syncing'
        ? 'Синхронизация…'
        : 'Сохранено';
  const contextGoal = isTiled
    ? `${gameProgress.percent}% карты раскрыто`
    : getContextGoal(zones, zoneIndices, template, progress.filled);

  const publishLabel = saving || !progress?.artwork_id
    ? 'Сохраняем работу…'
    : publishing
    ? 'Публикуем…'
    : 'Опубликовать в ленту';
  const publishDisabled = saving || !progress?.artwork_id || publishing;

  return (
    <section className="page player-page">
      <div className="player-topbar">
        <button className="back-button" onClick={() => setView('catalog')}><ChevronLeft size={18} /></button>
        <span className="player-topbar-title">{template.title}</span>
        <span className={`save-status${saving || saveState === 'syncing' ? ' saving' : ''}${!isOnline || saveState === 'offline' ? ' offline' : ''}`} role="status" aria-live="polite">
          <span className="save-dot" aria-hidden="true" />{saveLabel}
        </span>
        {(saveState === 'pending' || saveState === 'offline') && <button className="save-retry" type="button" onClick={onRetrySave} disabled={!isOnline}>Повторить</button>}
        <span className="player-progress" title={`Прогресс: ${gameProgress.percent}%`} aria-hidden="true">
          <svg viewBox="0 0 38 38">
            <circle className="player-progress-track" cx="19" cy="19" r="15" />
            <circle className="player-progress-fill" cx="19" cy="19" r="15" style={{ strokeDasharray: `${(gameProgress.percent / 100) * 94.25} 94.25` }} />
          </svg>
          <b>{gameProgress.percent}</b>
        </span>
        <button className="player-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Меню игры"><span>•••</span></button>
      </div>

      <div className={`player-hint ${hudHidden ? 'faded' : ''}`} onClick={showHud}>
        <span className="player-hint-target"><Target size={14} /> {contextGoal}</span>
      </div>

      <SessionGoalCard
        goal={sessionGoals.view}
        reward={latestReward?.amount ? { amount: latestReward.amount } : null}
        streak={streak?.current_streak}
        celebration={sessionGoals.celebration}
        nextActionLabel={
          sessionGoals.view?.id === 'picture' && complete
            ? 'Показать результат'
            : sessionGoals.celebration?.type === 'expired'
              ? 'К следующей цели'
              : 'Следующая цель'
        }
        onNextAction={() => {
          if (sessionGoals.view?.id === 'picture' && complete) {
            setCompletionOpen(true);
          } else {
            sessionGoals.dismissCelebration();
          }
        }}
      />

      {zoneReward && <div className="milestone zone"><Target size={17} /> {zoneReward}</div>}

      {import.meta.env.DEV && import.meta.env.VITE_SHOW_ENGINE_BADGE === 'true' && <div className={`engine-badge ${USE_NEW_COLORING_ENGINE ? 'smart' : 'legacy'}`}>{USE_NEW_COLORING_ENGINE ? 'Engine: Smart' : 'Engine: Legacy'}</div>}

      {isTiled ? (
        <ProgressiveColoringSession
          template={template}
          progress={progress}
          selectedColor={selectedColor}
          onSelectColor={onSelectColor}
          onStrokeCommitted={onTiledStrokeCommitted}
          onFirstPaint={handleFirstPaint}
          onWrongCell={onWrongCell}
          interactionMode={playMode}
          hideNumbers={hideNumbers}
          hintMode={playMode === 'classic' && hintMode}
          onOpenMenu={() => setMenuOpen(true)}
        />
      ) : USE_NEW_COLORING_ENGINE ? (
        <ColoringSession
          template={template}
          progress={progress}
          selectedColor={selectedColor}
          onSelectColor={onSelectColor}
          onSaveProgress={(nextFilled, operation) => {
            declutter();
            onStrokeCommitted(nextFilled, operation);
          }}
          onFirstPaint={handleFirstPaint}
          onWrongCell={onWrongCell}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={history.length > 0}
          canRedo={future.length > 0}
          calmMode={calmMode}
          hideNumbers={hideNumbers}
          hintMode={playMode === 'classic' && hintMode}
          interactionMode={playMode}
          fillMode={fillMode}
          combo={combo}
          onFillAt={fillMode ? onFillAt : undefined}
          onOpenMenu={() => setMenuOpen(true)}
          onTrack={onTrack}
        />
      ) : (
        <>
          <div className="player-canvas-area" onClick={showHud} onMouseMove={showHud}>
            <LegacyPixelCanvas
              template={template}
              filled={progress.filled}
              selectedColor={selectedColor}
              onPaint={(index, color) => {
                declutter();
                const nextFilled = [...progress.filled];
                nextFilled[index] = color;
                onStrokeCommitted(nextFilled, {
                  type: 'single',
                  timestamp: Date.now(),
                  changes: [{ index, from: -1, to: color }],
                });
              }}
              onWrong={(index) => { declutter(); onWrongCell(index); }}
              onFirstPaint={(index) => { declutter(); handleFirstPaint(index); }}
              calmMode={calmMode}
              hideFilledNumbers={playMode === 'reveal' || hideNumbers}
              hintMode={playMode === 'classic' && hintMode}
              interactionMode={playMode}
              onTapCell={fillMode ? onFillAt : undefined}
            />
          </div>
          <div className="player-dock" onClick={showHud}>
            <div className="player-dock-mode">
              <button className={playMode === 'classic' ? 'active' : ''} onClick={() => { setPlayMode('classic'); setFillMode(false); }}>По номерам</button>
              <button className={playMode === 'reveal' ? 'active' : ''} onClick={() => setPlayMode('reveal')}>Раскрытие</button>
            </div>
            {playMode === 'classic' && <div className="palette" aria-label="Палитра цветов">{template.palette.map((color, index) => {
              const remaining = template.cells.reduce((total, target, cellIndex) => total + (target === index && progress.filled[cellIndex] === -1 ? 1 : 0), 0);
              return <button key={color} className={`color-swatch ${selectedColor === index ? 'selected' : ''}`} onClick={() => { onSelectColor(index); window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); }} title={`Цвет ${index + 1}`}><i style={{ background: color }} /><span>{index + 1}</span><small>{remaining}</small></button>;
            })}</div>}
          </div>
        </>
      )}

      {menuOpen && <div className="bottom-sheet-overlay" role="presentation" onClick={() => setMenuOpen(false)} onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false); }}>
        <section
          className="bottom-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Меню игры"
          ref={bottomSheetRef}
          onClick={(e) => e.stopPropagation()}
          {...menuSwipe}
        >
          <span className="bottom-sheet-handle" aria-hidden="true" />
          <button className="bottom-sheet-close" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню"><X size={20} /></button>
          <h3>Меню игры</h3>
          <div className="bottom-sheet-zone">
            <b>Прогресс по участкам</b>
            <div className="zone-track">{zones.map((zone) => <button key={zone.id} className={`zone-pill ${zone.percent === 100 ? 'done' : ''}`} disabled title={zone.title}>
              <span className="zone-fill" style={{ width: `${zone.percent}%` }} />
              <span className="zone-text">{zone.title}</span>
              <span className="zone-pct">{zone.percent}%</span>
            </button>)}</div>
          </div>
          <div className="bottom-sheet-info"><span>XP: {totalXp} · Уровень {level}</span><span>Комбо: ×{combo}</span></div>
          <div className="bottom-sheet-actions">
            <button onClick={() => { setPlayMode((v) => v === 'classic' ? 'reveal' : 'classic'); setMenuOpen(false); }}>{playMode === 'classic' ? 'Режим раскрытия' : 'По номерам'}</button>
            <button onClick={() => { setFillMode((value) => !value); setMenuOpen(false); }} className={fillMode ? 'active' : ''}>Заполнять область</button>
            {playMode === 'classic' && <>
              <button onClick={() => { setHintMode((v) => { if (!v && hintsRemaining > 0) setHintsRemaining((h) => h - 1); return !v; }); setMenuOpen(false); }} disabled={hintsRemaining <= 0 && !hintMode}>Подсказка ({hintsRemaining})</button>
              <button onClick={() => { setCalmMode((v) => !v); setMenuOpen(false); }} className={calmMode ? 'active' : ''}>Спокойный режим</button>
              <button onClick={() => { setHideNumbers((v) => !v); setMenuOpen(false); }} className={hideNumbers ? 'active' : ''}>Скрыть номера</button>
            </>}
            <hr />
            <button onClick={() => { setOnboarding(0); setMenuOpen(false); }}>Показать обучение снова</button>
            <button onClick={() => { onUndo(); setMenuOpen(false); }} disabled={isTiled || !history.length}>Отмена</button>
            <button onClick={() => { onRedo(); setMenuOpen(false); }} disabled={isTiled || !future.length}>Повтор</button>
            <button disabled={isTiled} onClick={() => { if (window.confirm('Сбросить весь прогресс?')) { onResetProgress(); setMenuOpen(false); } }}>Сбросить</button>
          </div>
        </section>
      </div>}

      {onboarding !== null && <div className="onboarding-overlay" role="dialog" aria-label="Обучение">
        <div className="onboarding-card" ref={onboardingCardRef}>
          <b>{[
            'Начнём с этого участка. Закрась выделенные клетки.',
            `Используй цвет №${selectedColor + 1}. Проведи по клеткам, чтобы закрасить сразу несколько.`,
            'После завершения мы покажем следующий участок.',
          ][onboarding]}</b>
          <div className="onboarding-dots">{['', '', ''].map((_, i) => <span key={i} className={i === onboarding ? 'active' : ''} />)}</div>
          <div className="onboarding-actions">
            {onboarding < 2 ? <button className="primary-button" onClick={() => setOnboarding(onboarding + 1)}>Далее</button> : <button className="primary-button" onClick={onDismissOnboarding}>Понятно</button>}
            <button className="secondary-button" onClick={onDismissOnboarding}>Пропустить обучение</button>
          </div>
        </div>
      </div>}

      {isComplete && completionOpen && <div className="completion-overlay" role="presentation">
        <section
          className="completion-dialog"
          ref={completionDialogRef}
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
          aria-labelledby="completion-title"
          {...completionSwipe}
        >
          <button className="completion-close" onClick={() => setCompletionOpen(false)} aria-label="Закрыть карточку результата"><X size={20} /></button>
          <div className="confetti" aria-hidden="true">✦ ◆ ✦</div>
          {beforePreview
            ? <CompareSlider before={beforePreview} after={completedPreview} title={template.title} />
            : <img src={completedPreview} alt={`Готовая работа ${template.title}`} />}
          <p className="eyebrow">Картина раскрыта · {formatDifficulty(template.difficulty)}</p>
          <h2 id="completion-title">Картина раскрыта!</h2>
          <p className="completion-work-title">{template.title}</p>
          <div className="completion-rewards">
            <span><Sparkles size={16} /> Новая работа в галерее</span>
            <span><Star size={16} /> {latestReward?.amount ? `+${latestReward.amount} XP` : 'Награда синхронизирована'}</span>
          </div>
          <p className="completion-copy">Прекрасный финал. Сохраните результат или покажите его друзьям.</p>
          <div className="completion-actions">
            <button className="primary-button" onClick={onShareResult} disabled={sharing}>{sharing ? <><LoaderCircle className="spin" size={17} /> Открываем…</> : <><Share2 size={17} /> Поделиться</>}</button>
            <button className="secondary-button" onClick={onDownloadResult}><Download size={17} /> Сохранить результат</button>
          </div>
          <div className="completion-links">
            <button onClick={onPublishCompleted} disabled={publishDisabled}>{publishLabel}</button>
            <button onClick={onContinue}>{nextRecommendation ? `Следующая: ${nextRecommendation.title}` : 'К следующей работе'}</button>
            <button onClick={() => { setCompletionOpen(false); setView('catalog'); }}>К каталогу</button>
          </div>
        </section>
      </div>}
    </section>
  );
}
