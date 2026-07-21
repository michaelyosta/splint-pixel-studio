export default function ColoringHud({
  isAutoActive,
  isTemporarilyPaused,
  onToggleAuto,
  onNextCluster,
  onOverview,
  combo,
}) {
  const isOn = isAutoActive;
  const label = isAutoActive ? 'Авто' : isTemporarilyPaused ? 'Пауза' : 'Ручн';
  const title = isAutoActive ? 'Автокамера включена'
    : isTemporarilyPaused ? 'Нажмите для возврата автокамеры'
    : 'Включить автокамеру';

  return (
    <div className="coloring-hud">
      <button
        className={`hud-btn ${isOn ? 'active' : ''}`}
        onClick={onToggleAuto}
        title={title}
      >
        <CameraIcon />
        <span>{label}</span>
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
