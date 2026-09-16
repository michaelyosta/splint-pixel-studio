import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '../api/client';

const ENTITY_LABELS = { collection: 'Коллекция', album: 'Альбом', coloring: 'Раскраска', shelf: 'Полка', product: 'Товар' };

function rowsFor(catalog, type) {
  if (type === 'collection') return catalog.collections || [];
  if (type === 'album') return catalog.albums || [];
  if (type === 'coloring') return catalog.colorings || [];
  if (type === 'shelf') return catalog.shelves || [];
  return catalog.products || [];
}

function rowTitle(row, type) {
  return type === 'product' ? `${row.title || row.id} · ${row.price_xtr} XTR` : `${row.title || row.id} · ${row.id}`;
}

function editableSnapshot(row, type) {
  if (!row) return {};
  if (type === 'collection') return { title: row.title, description: row.description || '', visibility: row.visibility, status: row.status, catalog_theme: row.catalog_theme, catalog_mood: row.catalog_mood, catalog_tags: row.catalog_tags || [], catalog_rank: Number(row.catalog_rank || 0), catalog_cover_url: row.catalog_cover_url || null };
  if (type === 'album') return { collection_id: row.collection_id, slug: row.slug, title: row.title, description: row.description || '', visibility: row.visibility, status: row.status, cover_url: row.cover_url || null, sort_rank: Number(row.sort_rank || 0), featured: Boolean(row.featured), is_new: Boolean(row.is_new), tags: row.tags || [] };
  if (type === 'coloring') return { collection_id: row.collection_id, album_id: row.album_id, title: row.title, description: row.description || '', visibility: row.visibility, status: row.status, access_type: row.access_type, featured_rank: Number(row.featured_rank || 0), is_new: Boolean(row.is_new), tags: row.tags || [], season: row.season || [], audience: row.audience || [] };
  if (type === 'shelf') return { title: row.title, description: row.description || '', status: row.status, sort_rank: Number(row.sort_rank || 0), cover_url: row.cover_url || null, filter: row.filter || {} };
  return { price_xtr: Number(row.price_xtr) };
}

export default function AdminView({ access, onBack, onNotice }) {
  const [catalog, setCatalog] = useState(null);
  const [audit, setAudit] = useState([]);
  const [acl, setAcl] = useState([]);
  const [entityType, setEntityType] = useState('collection');
  const [entityId, setEntityId] = useState('');
  const [payload, setPayload] = useState('{}');
  const [draft, setDraft] = useState(null);
  const [impact, setImpact] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => rowsFor(catalog || {}, entityType), [catalog, entityType]);
  const selected = rows.find((row) => String(row.id) === String(entityId)) || rows[0] || null;

  useEffect(() => {
    if (!selected) { setEntityId(''); setPayload('{}'); return; }
    setEntityId(selected.id);
    setPayload(JSON.stringify(editableSnapshot(selected, entityType), null, 2));
  }, [entityType, selected]);

  const refresh = useCallback(async () => {
    const [nextCatalog, nextAudit] = await Promise.all([adminApi.catalog(), adminApi.audit()]);
    setCatalog(nextCatalog); setAudit(nextAudit);
    if (access?.role === 'owner') setAcl(await adminApi.acl());
  }, [access?.role]);

  useEffect(() => { refresh().catch((error) => onNotice?.(error.message, 'error')); }, [refresh, onNotice]);

  async function createOrUpdateDraft() {
    let changes;
    try { changes = JSON.parse(payload); } catch { onNotice?.('Изменения должны быть валидным JSON', 'error'); return; }
    setBusy(true);
    try {
      const result = draft ? await adminApi.updateDraft(draft.id, changes) : await adminApi.createDraft(entityType, entityId, changes);
      setDraft(result.draft); setImpact(null); onNotice?.('Черновик сохранён', 'success');
    } catch (error) { onNotice?.(error.message, 'error'); } finally { setBusy(false); }
  }

  async function preview() {
    if (!draft) return;
    setBusy(true);
    try { const result = await adminApi.previewDraft(draft.id); setDraft(result.draft); setImpact(result.impact); onNotice?.('Предпросмотр проверен', 'success'); }
    catch (error) { onNotice?.(error.message, 'error'); } finally { setBusy(false); }
  }

  async function publish() {
    if (!draft || draft.status !== 'preview') return;
    if (!window.confirm('Опубликовать изменения? Действие попадёт в неизменяемый аудит.')) return;
    setBusy(true);
    try { await adminApi.publishDraft(draft.id); setDraft(null); setImpact(null); await refresh(); onNotice?.('Изменения опубликованы', 'success'); }
    catch (error) { onNotice?.(error.message, 'error'); } finally { setBusy(false); }
  }

  if (!access) return null;
  return <section className="page admin-page" data-admin-console>
    <div className="admin-page__head">
      <div><p className="eyebrow">ЗАКРЫТАЯ ЗОНА · {access.role.toUpperCase()}</p><h1>Merchandising control plane</h1><p>Изменения проходят через Draft → Preview → Publish и записываются в audit log.</p></div>
      <button type="button" className="secondary-button" onClick={onBack}>Назад</button>
    </div>
    <section className="admin-card">
      <div className="admin-toolbar"><label>Сущность<select value={entityType} onChange={(event) => { setEntityType(event.target.value); setDraft(null); setImpact(null); }}>{Object.entries(ENTITY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Объект<select value={entityId} onChange={(event) => { const row = rows.find((candidate) => candidate.id === event.target.value); setEntityId(event.target.value); setDraft(null); setImpact(null); setPayload(JSON.stringify(editableSnapshot(row, entityType), null, 2)); }}>{rows.map((row) => <option key={row.id} value={row.id}>{rowTitle(row, entityType)}</option>)}</select></label></div>
      <label className="admin-json-field">Изменения JSON<textarea value={payload} onChange={(event) => setPayload(event.target.value)} spellCheck="false" rows={16} /></label>
      <div className="admin-actions"><button type="button" disabled={busy || !entityId} onClick={createOrUpdateDraft}>Сохранить draft</button><button type="button" disabled={busy || !draft} onClick={preview}>Preview</button><button type="button" className="primary-button" disabled={busy || draft?.status !== 'preview'} onClick={publish}>Publish</button></div>
      {draft && <p className="admin-status" role="status">Draft: {draft.status} · {draft.id}</p>}
      {impact && <p className="admin-impact">Затронуто объектов: <b>{impact.affected_items}</b>. Перед публикацией проверьте область изменения.</p>}
    </section>
    <section className="admin-card"><div className="section-heading"><div><p className="eyebrow">IMMUTABLE</p><h2>Audit log</h2></div></div>{audit.length ? <div className="admin-audit-list">{audit.map((entry) => <article key={entry.id}><b>{entry.action}</b><span>{entry.entity_type}/{entry.entity_id}</span><small>{entry.actor_role} · {new Date(entry.created_at).toLocaleString()}</small></article>)}</div> : <p>Записей пока нет.</p>}</section>
    {access.role === 'owner' && <section className="admin-card"><div className="section-heading"><div><p className="eyebrow">OWNER ONLY</p><h2>ACL</h2></div></div><p>Выдача и отзыв ролей разрешены только владельцу. Последний owner защищён сервером.</p><div className="admin-audit-list">{acl.map((entry) => <article key={entry.user_id}><b>{entry.nickname || entry.user_id}</b><span>{entry.role} · {entry.permissions.length} permissions</span><small>{entry.telegram_id || 'без Telegram ID'}</small></article>)}</div></section>}
  </section>;
}
