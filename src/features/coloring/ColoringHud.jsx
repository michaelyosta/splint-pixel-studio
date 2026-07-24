import { useRef, useLayoutEffect, useCallback, useState } from 'react';
export default function ColoringHud({
  routeState,
  onReturnToTarget,
  onNextCluster,
  onOverview,
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
  }, [measure, collapsed, routeState]);

  useLayoutEffect(() => {
    const el = hudRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const isFree = routeState?.status === 'freeExploration';

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
      {isFree && <button className="hud-btn active" onClick={onReturnToTarget} title="Вернуться к текущему участку"><CameraIcon /><span>Вернуться к участку</span></button>}
      <button className="hud-btn" onClick={onNextCluster} title="Следующий участок">
        <span>→</span>
        <span>Следующий участок</span>
      </button>
      <button className="hud-btn" onClick={onOverview} title="Показать всю картину">
        <span>⊞</span>
        <span>Обзор</span>
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
