import { memo } from 'react';

export default memo(function DevDiagnostics({
  autoState, routeState, routingColor, template,
  windowsCount, workingWindows, filled, safeArea, camera,
  containerSize, onTrack,
}) {
  // The preview canvas is user-facing even in development, so diagnostics are
  // opt-in instead of appearing in every local or tunneled session.
  if (!import.meta.env.DEV || import.meta.env.VITE_SHOW_COLORING_DIAGNOSTICS !== 'true') return null;

  const remainingGlobal = filled ? filled.reduce((c, f) => c + (f === -1 ? 1 : 0), 0) : 0;
  const remainingColor = (routingColor != null && template)
    ? template.cells.reduce((c, t, i) => c + (t === routingColor && filled[i] === -1 ? 1 : 0), 0)
    : null;

  const left = safeArea?.left || 0;
  const top = safeArea?.top || 0;
  const right = (containerSize?.width || 0) - (safeArea?.right || 0);
  const bottom = (containerSize?.height || 0) - (safeArea?.bottom || 0);

  let routeStatusStyle = {};
  if (routeState.status === 'focused') routeStatusStyle = { color: '#0f0' };
  else if (routeState.status === 'recovering') routeStatusStyle = { color: '#fc0' };
  else if (routeState.status === 'error') routeStatusStyle = { color: '#f44' };

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, zIndex: 40,
      background: 'rgba(0,0,0,0.82)', color: '#8d9fa5',
      fontFamily: 'monospace', fontSize: '10px', lineHeight: '1.5',
      padding: '6px 8px', borderRadius: '0 0 6px 0',
      maxWidth: '280px', pointerEvents: 'none', userSelect: 'none',
    }}>
      <div><b style={{ color: '#fff' }}>AUTO:</b> {autoState}</div>
      <div><b style={routeStatusStyle}>route:</b> {routeState.status}</div>
      <div><b style={{ color: '#aaa' }}>gen:</b> {routeState.generation} |
        <b style={{ color: '#aaa' }}> tgt:</b> {routeState.targetId?.slice(-8) || '-'}</div>
      {routeState.reason && <div><b style={{ color: '#aaa' }}>reason:</b> {routeState.reason}</div>}
      <div><b style={{ color: '#aaa' }}>wins:</b> {windowsCount} |
        <b style={{ color: '#aaa' }}> color:</b> {routingColor != null ? routingColor : 'all'}</div>
      {remainingColor != null && <div><b style={{ color: '#aaa' }}>rem col:</b> {remainingColor}</div>}
      <div><b style={{ color: '#aaa' }}>rem vis:</b> {routeState.visibleRemaining ?? '-'} |
        <b style={{ color: '#aaa' }}> rem tgt:</b> {routeState.targetRemaining ?? '-'} |
        <b style={{ color: '#aaa' }}> rem glob:</b> {remainingGlobal}</div>
      <div><b style={{ color: '#aaa' }}>cam:</b> x={camera.x.toFixed(0)} y={camera.y.toFixed(0)} z={camera.zoom.toFixed(3)}</div>
      <div><b style={{ color: '#aaa' }}>safe:</b> L{left} T{top} R{right} B{bottom}</div>
    </div>
  );
});
