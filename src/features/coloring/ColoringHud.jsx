import { useRef, useLayoutEffect, useCallback, useState } from 'react';
import { AUTO_STATE } from './engine/autoState.js';

export default function ColoringHud({
  autoState,
  onToggleAuto,
  onNextCluster,
  onOverview,
  onFindRemaining,
  combo,
  isPainting,
  onResize,
}) {
  const hudRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);

  const measure = useCallback(() => {
    if (!hudRef.current || !onResize) return;
    const rect = hudRef.current.getBoundingClientRect();
    onResize(rect.width, rect.height, rect.left, rect.top);
  }, [onResize]);

  useLayoutEffect(() => {
    measure();
  }, [measure, collapsed, autoState]);

  useLayoutEffect(() => {
    const el = hudRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const isOn = autoState === AUTO_STATE.ACTIVE;
  const isPaused = autoState === AUTO_STATE.PAUSED;

  let autoLabel;
  let autoTitle;
  if (isOn) {
    autoLabel = 'Авто';
    autoTitle = 'Автокамера включена — нажмите для выключения';
  } else if (isPaused) {
    autoLabel = 'Пауза';
    autoTitle = 'Автокамера на паузе — нажмите для продолжения';
  } else {
    autoLabel = 'Ручн';
    autoTitle = 'Автокамера выключена — нажмите для включения';
  }

  if (collapsed) {
    return (
      <div className="coloring-hud coloring-hud--collapsed" ref={hudRef}>
        <button
          className="hud-btn hud-btn--expand"
          onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}
          title="Показать управление"
        >
          <span className="hud-icon-dot" />
          <span className="hud-icon-dot" />
          <span className="hud-icon-dot" />
        </button>
        {combo > 1 && <div className="combo-badge">×{combo}</div>}
      </div>
    );
  }

  return (
    <div className="coloring-hud" ref={hudRef}>
      <button
        className={`hud-btn ${isOn ? 'active' : ''} ${isPaused ? 'paused' : ''}`}
        onClick={onToggleAuto}
        title={autoTitle}
      >
        <CameraIcon />
        <span>{autoLabel}</span>
      </button>
      <button className="hud-btn" onClick={onNextCluster} title="Следующий участок">
        <span>→</span>
        <span>Далее</span>
      </button>
      <button className="hud-btn" onClick={onOverview} title="Показать всю картину">
        <span>⊞</span>
        <span>Обзор</span>
      </button>
      <button className="hud-btn" onClick={onFindRemaining} title="Найти оставшееся">
        <FindIcon />
        <span>Найти</span>
      </button>
      <button
        className="hud-btn hud-btn--collapse"
        onClick={() => setCollapsed(true)}
        title="Свернуть панель"
      >
        <span>−</span>
      </button>
      {combo > 1 && <div className="combo-badge">×{combo}</div>}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4m0 12v4m-10-10h4m12 0h4" />
    </svg>
  );
}

function FindIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
