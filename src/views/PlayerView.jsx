import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Download, LoaderCircle, Share2, Sparkles, Star, Target, X } from 'lucide-react';
import ColoringSession from '../features/coloring/ColoringSession';
import LegacyPixelCanvas from '../components/LegacyPixelCanvas';
import { getContextGoal } from '../lib/playLoop';

const USE_NEW_COLORING_ENGINE = import.meta.env.VITE_NEW_COLORING_ENGINE !== 'false';

export default function PlayerView({
  template,
  progress,
  gameProgress,
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

  if (!template || !progress || !gameProgress) {
    return <div className="loading"><LoaderCircle className="spin" /> Загружаем…</div>;
  }

  const isComplete = gameProgress.percent === 100;
  const totalXp = gameProgress.completed * 10;
  const level = Math.floor(totalXp / 1000) + 1;
  const contextGoal = getContextGoal(zones, zoneIndices, template, progress.filled);

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
        <button className="player-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Меню игры"><span>•••</span></button>
      </div>

      <div className={`player-hint ${hudHidden ? 'faded' : ''}`} onClick={showHud}>
        <span className="player-hint-target"><Target size={14} /> {contextGoal}</span>
      </div>

      {zoneReward && <div className="milestone zone"><Target size={17} /> {zoneReward}</div>}

      {import.meta.env.DEV && <div className={`engine-badge ${USE_NEW_COLORING_ENGINE ? 'smart' : 'legacy'}`}>{USE_NEW_COLORING_ENGINE ? 'Engine: Smart' : 'Engine: Legacy'}</div>}

      {USE_NEW_COLORING_ENGINE ? (
        <ColoringSession
          template={template}
          progress={progress}
          selectedColor={selectedColor}
          onSelectColor={onSelectColor}
          onSaveProgress={(nextFilled, operation) => {
            declutter();
            onStrokeCommitted(nextFilled, operation);
          }}
          onFirstPaint={onFirstPaint}
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
              onFirstPaint={(index) => { declutter(); onFirstPaint(index); }}
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
        <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label="Меню игры" onClick={(e) => e.stopPropagation()}>
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
            <button onClick={() => { onUndo(); setMenuOpen(false); }} disabled={!history.length}>Отмена</button>
            <button onClick={() => { onRedo(); setMenuOpen(false); }} disabled={!future.length}>Повтор</button>
            <button onClick={() => { if (window.confirm('Сбросить весь прогресс?')) { onResetProgress(); setMenuOpen(false); } }}>Сбросить</button>
          </div>
        </section>
      </div>}

      {onboarding !== null && <div className="onboarding-overlay" role="dialog" aria-label="Обучение">
        <div className="onboarding-card">
          <b>{['Выберите цвет в палитре и касайтесь нужных клеток', 'Каждая цифра показывает номер цвета на палитре', 'Проведите пальцем, чтобы закрасить несколько клеток'][onboarding]}</b>
          <div className="onboarding-dots">{['', '', ''].map((_, i) => <span key={i} className={i === onboarding ? 'active' : ''} />)}</div>
          <div className="onboarding-actions">
            {onboarding < 2 ? <button className="primary-button" onClick={() => setOnboarding(onboarding + 1)}>Далее</button> : <button className="primary-button" onClick={onDismissOnboarding}>Продолжить</button>}
            <button className="secondary-button" onClick={onDismissOnboarding}>Пропустить</button>
          </div>
        </div>
      </div>}

      {isComplete && completionOpen && <div className="completion-overlay" role="presentation">
        <section className="completion-dialog" ref={completionDialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="completion-title">
          <button className="completion-close" onClick={() => setCompletionOpen(false)} aria-label="Закрыть карточку результата"><X size={20} /></button>
          <div className="confetti" aria-hidden="true">✦ ◆ ✦</div>
          <img src={completedPreview} alt={`Готовая работа ${template.title}`} />
          <p className="eyebrow">Картина раскрыта · {formatDifficulty(template.difficulty)}</p>
          <h2 id="completion-title">Картина раскрыта!</h2>
          <p className="completion-work-title">{template.title}</p>
          <div className="completion-rewards"><span><Sparkles size={16} /> Новая работа в галерее</span><span><Star size={16} /> +500 XP</span></div>
          <p className="completion-copy">Прекрасный финал. Сохраните результат или покажите его друзьям.</p>
          <div className="completion-actions">
            <button className="primary-button" onClick={onShareResult} disabled={sharing}>{sharing ? <><LoaderCircle className="spin" size={17} /> Открываем…</> : <><Share2 size={17} /> Поделиться</>}</button>
            <button className="secondary-button" onClick={onDownloadResult}><Download size={17} /> Сохранить результат</button>
          </div>
          <div className="completion-links">
            <button onClick={onPublishCompleted} disabled={publishDisabled}>{publishLabel}</button>
            <button onClick={() => { setCompletionOpen(false); setView('catalog'); }}>К каталогу</button>
          </div>
        </section>
      </div>}
    </section>
  );
}
