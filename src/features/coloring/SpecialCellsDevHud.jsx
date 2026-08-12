import { useState } from 'react';
import {
  formatSpecialCellsDiagnostics,
  isSpecialCellsDiagnosticsEnabled,
} from '../../lib/specialCellsDiagnostics.js';

function compactSummary(snapshot) {
  const cohort = String(snapshot.cohort || '-').toUpperCase();
  const override = snapshot.override_unknown
    ? '?'
    : snapshot.override
      ? 'OVERRIDE ON'
      : 'OVERRIDE OFF';
  const targetCount = snapshot.current_target_specials?.count ?? 0;
  const targetKinds = snapshot.current_target_specials
    ? Object.entries(snapshot.current_target_specials.by_type || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .map(([kind, count]) => `${kind}:${count}`)
      .join(',')
    : '';
  const telegram = snapshot.telegram || {};
  const capability = telegram.available
    ? `TG ${telegram.version || '?'}`
    : 'TG off';
  return `${cohort} ${override} · tgt ${targetCount}${targetKinds ? ` (${targetKinds})` : ''} · ${capability}`;
}

function kindSummary(counts) {
  if (!counts || typeof counts !== 'object') return '-';
  const entries = Object.entries(counts)
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([kind, count]) => `${kind[0]}${count}`);
  return entries.length ? entries.join(' ') : '0';
}

function truncate(value, max = 56) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export default function SpecialCellsDevHud({ snapshot }) {
  const [dumpOpen, setDumpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!isSpecialCellsDiagnosticsEnabled(import.meta.env) || !snapshot) return null;

  const dump = formatSpecialCellsDiagnostics(snapshot);
  const compact = compactSummary(snapshot);
  const telegram = snapshot.telegram || {};
  const telegramLabel = telegram.available
    ? ['on', telegram.initData && 'init', telegram.haptics && 'haptics', telegram.backButton && 'back', telegram.openTelegramLink && 'link']
      .filter(Boolean)
      .join(' ')
    : 'off';

  const copyDump = async () => {
    try {
      await navigator.clipboard.writeText(dump);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be unavailable in embedded WebViews; the dump body
      // remains visible for manual selection.
    }
  };

  const target = snapshot.current_target;
  const targetLabel = target
    ? `c${target.color ?? '?'} ${target.cells ?? '-'}cells${target.specialPity ? ' · pity' : ''}`
    : '-';
  const offer = snapshot.active_offer;
  const offerLabel = offer
    ? `${offer.kind}${offer.hasToken ? ' tok' : ''} ${offer.optionCount ?? 0}opts`
    : '-';
  const error = snapshot.last_error;
  const errorLabel = error
    ? `${error.code || error.name || 'err'}${error.status ? ` (${error.status})` : ''} ${truncate(error.message)}`
    : '-';
  const swipeLabel = telegram.verticalSwipe?.apiSupported
    ? telegram.verticalSwipe.uncertain
      ? 'uncertain'
      : telegram.verticalSwipe.protectionApplied ? 'protected' : 'open'
    : '';

  return (
    <div
      className="special-cells-dev-hud"
      data-special-diagnostics-expanded={dumpOpen ? 'true' : 'false'}
      data-special-diagnostics-compact={compact}
      data-special-diagnostics
      data-special-diagnostics-cohort={snapshot.cohort || ''}
      data-special-diagnostics-override={snapshot.override ? 'true' : 'false'}
      data-special-diagnostics-counts={snapshot.counts
        ? `u${snapshot.counts.unseen ?? 0} o${snapshot.counts.offered ?? 0} c${snapshot.counts.consumed ?? 0} s${snapshot.counts.skipped ?? 0}`
        : ''}
      data-special-diagnostics-by-type={kindSummary(snapshot.by_type?.server)}
      data-special-diagnostics-visible-count={snapshot.visible?.length ?? 0}
      data-special-diagnostics-target={targetLabel}
      data-special-diagnostics-target-specials={snapshot.current_target_specials?.count ?? 0}
      data-special-diagnostics-target-special-types={snapshot.current_target_specials
        ? Object.entries(snapshot.current_target_specials.by_type || {})
          .filter(([, count]) => Number(count || 0) > 0)
          .map(([kind, count]) => `${kind}:${count}`)
          .join(',')
        : ''}
      data-special-diagnostics-offer={offerLabel}
      data-special-diagnostics-metadata-loaded={snapshot.metadata?.loaded ?? snapshot.visible?.length ?? 0}
      data-special-diagnostics-metadata-visible={snapshot.metadata?.visible ?? snapshot.visible?.length ?? 0}
      data-special-diagnostics-server-candidates={snapshot.metadata?.server_candidates ?? ''}
      data-special-diagnostics-server-candidates-unknown={snapshot.metadata?.server_candidates_unknown ? 'true' : ''}
      data-special-diagnostics-pity={snapshot.pity?.due ? 'due' : (snapshot.pity?.cells_to_next ?? '-')}
      data-special-diagnostics-last-error-code={error?.code || ''}
      data-special-diagnostics-telegram={telegram.available ? 'on' : 'off'}
      data-special-diagnostics-telegram-swipe={telegram.verticalSwipe?.apiSupported
        ? `${swipeLabel} prev=${telegram.verticalSwipe.previousState ?? '-'} cur=${telegram.verticalSwipe.currentState ?? '-'}`
        : ''}
      data-special-diagnostics-telegram-fullscreen={telegram.fullscreen?.current == null ? '' : String(telegram.fullscreen.current)}
      aria-label="Special Cells development diagnostics"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        zIndex: 35,
        width: dumpOpen ? 'min(300px, calc(100% - 8px))' : 'auto',
        maxWidth: dumpOpen ? '300px' : 'calc(100% - 8px)',
        maxHeight: 'calc(100% - 8px)',
        overflow: 'auto',
        background: 'rgba(0,0,0,0.86)',
        color: '#8d9fa5',
        fontFamily: 'monospace',
        fontSize: '10px',
        lineHeight: '1.5',
        padding: '6px 8px',
        borderRadius: '0 0 0 6px',
        pointerEvents: 'auto',
        userSelect: 'text',
      }}
    >
      <button
        type="button"
        data-special-diagnostics-toggle
        aria-expanded={dumpOpen}
        onClick={() => setDumpOpen((value) => !value)}
        style={{ display: 'block', width: '100%', color: '#cfe3e8', font: 'inherit', textAlign: 'left', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
      >
        {compact}
      </button>
      {dumpOpen && (
        <>
          <div style={{ marginTop: '4px' }}>
            <button type="button" data-special-diagnostics-copy onClick={copyDump}>{copied ? 'copied' : 'copy dump'}</button>
          </div>
          <div><b style={{ color: '#fff' }}>cohort:</b> {snapshot.cohort || '-'}
            {' '}<span style={{ color: snapshot.override ? '#fc0' : '#aaa' }}>
              {snapshot.override_unknown ? 'override UNKNOWN' : snapshot.override ? 'OVERRIDE ON' : 'OVERRIDE OFF'}
            </span></div>
          <div><b style={{ color: '#aaa' }}>place:</b> v{snapshot.placement?.generation_version ?? '-'}
            {' '}· {snapshot.placement?.special_count ?? 0}
            {snapshot.template?.storage_mode ? ` · ${snapshot.template.storage_mode}` : ''}</div>
          <div><b style={{ color: '#aaa' }}>counts:</b> {snapshot.counts
            ? `u${snapshot.counts.unseen ?? 0} o${snapshot.counts.offered ?? 0} c${snapshot.counts.consumed ?? 0} s${snapshot.counts.skipped ?? 0}`
            : '-'}</div>
          <div><b style={{ color: '#aaa' }}>byType:</b> {kindSummary(snapshot.by_type?.server)}
            {snapshot.by_type?.server_missing ? ' (server missing)' : ''}
            {' '}<span>· loaded {snapshot.metadata?.loaded ?? snapshot.visible?.length ?? 0}</span></div>
          <div><b style={{ color: '#aaa' }}>cands:</b> {snapshot.metadata?.server_candidates_unknown
            ? 'unknown (server field absent)'
            : (snapshot.metadata?.server_candidates ?? 0)}</div>
          <div><b style={{ color: '#aaa' }}>target:</b> {targetLabel}</div>
          <div><b style={{ color: '#aaa' }}>inTgt:</b> {snapshot.current_target_specials?.count ?? 0}
            {' '}{kindSummary(snapshot.current_target_specials?.by_type)}</div>
          <div><b style={{ color: '#aaa' }}>disc:</b> {snapshot.discovered
            ? `${snapshot.discovered.kind}${snapshot.discovered.missed ? ' missed' : ''}`
            : '-'}</div>
          <div><b style={{ color: '#aaa' }}>offer:</b> {offerLabel}</div>
          <div><b style={{ color: '#aaa' }}>recent:</b> {snapshot.recent_targets ?? 0}</div>
          <div><b style={{ color: '#aaa' }}>done:</b> {snapshot.completed?.percent ?? 0}%
            {' '}{snapshot.completed?.completed_cells ?? 0}/{snapshot.completed?.total_cells || '-'}
            {snapshot.completed?.artwork_id ? ' · art' : ''}
            {snapshot.completed?.consumed != null ? ` · c${snapshot.completed.consumed}` : ''}</div>
          <div><b style={{ color: '#aaa' }}>pity:</b> {snapshot.pity?.due
            ? 'due'
            : (snapshot.pity?.cells_to_next ?? '-')}</div>
          <div><b style={{ color: error ? '#f66' : '#aaa' }}>err:</b> {errorLabel}</div>
          <div><b style={{ color: '#aaa' }}>tg:</b> {telegramLabel}</div>
      <div><b style={{ color: '#aaa' }}>swipe:</b> {telegram.verticalSwipe?.apiSupported
        ? `${swipeLabel} prev=${telegram.verticalSwipe.previousState ?? '-'} cur=${telegram.verticalSwipe.currentState ?? '-'}`
        : '-'}</div>
          <div><b style={{ color: '#aaa' }}>fs:</b> {telegram.fullscreen?.current == null
            ? '-'
            : `${telegram.fullscreen.current ? 'on' : 'off'} exp=${telegram.fullscreen.expanded == null ? '-' : (telegram.fullscreen.expanded ? 'on' : 'off')} vph=${telegram.fullscreen.viewportStableHeight ?? '-'}`}</div>
        </>
      )}
      {dumpOpen && (
        <pre data-special-diagnostics-dump-body style={{
          margin: '4px 0 0',
          maxHeight: '220px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          color: '#cfe3e8',
        }}>{dump}</pre>
      )}
    </div>
  );
}
