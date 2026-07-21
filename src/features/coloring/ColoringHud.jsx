export default function ColoringHud({
  isAuto,
  onToggleAuto,
  onNextCluster,
  onOverview,
  combo,
}) {
  return (
    <div className="coloring-hud">
      <button
        className={`hud-btn ${isAuto ? 'active' : ''}`}
        onClick={onToggleAuto}
        title={isAuto ? 'Автокамера включена' : 'Включить автокамеру'}
      >
        <CameraIcon active={isAuto} />
        <span>{isAuto ? 'Авто' : 'Ручн'}</span>
      </button>
      <button className="hud-btn" onClick={onNextCluster} title="Следующий участок">
        <span>→</span>
        <span>Далее</span>
      </button>
      <button className="hud-btn" onClick={onOverview} title="Показать всю картину">
        <span>⊞</span>
        <span>Обзор</span>
      </button>
      {combo > 1 && <div className="combo-badge">×{combo}</div>}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4m0 12v4m-10-10h4m12 0h4" />
    </svg>
  );
}
