import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, BookOpen, ChevronRight, CircleAlert, FilePlus2, LoaderCircle, Minus, Plus, Save, Send, Undo2 } from 'lucide-react';
import { creatorCollectionsApi } from '../../api/client';
import {
  collectionStatusLabel,
  getAvailableCollectionTemplates,
  getOwnedUserTemplates,
  getPublicationBlocker,
} from './creatorCollectionsUtils';
import './creatorCollectionsManager.css';

const EMPTY_DRAFT = { title: '', description: '' };

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

/**
 * Independent creator-set manager. It intentionally offers no commercial
 * controls: the API only supports free collections and payouts are not live.
 */
export default function CreatorCollectionsManager({ templates = [], onCollectionChange = null }) {
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [newDraft, setNewDraft] = useState(EMPTY_DRAFT);
  const [metadata, setMetadata] = useState(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [action, setAction] = useState(null);
  const [notice, setNotice] = useState(null);
  const requestIdRef = useRef(0);

  const ownedTemplates = useMemo(() => getOwnedUserTemplates(templates), [templates]);
  const availableTemplates = useMemo(() => getAvailableCollectionTemplates(ownedTemplates, selected), [ownedTemplates, selected]);
  const publicationBlocker = useMemo(() => getPublicationBlocker(selected), [selected]);
  const isDraft = selected?.status === 'draft';
  const isBusy = Boolean(action);

  const notifyParent = useCallback((change) => {
    try { onCollectionChange?.(change); } catch { /* Parent notifications must not break creator work. */ }
  }, [onCollectionChange]);

  const showNotice = useCallback((text, type = 'info') => setNotice({ text, type }), []);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const next = await creatorCollectionsApi.mine();
      setCollections(Array.isArray(next) ? next : []);
      setNotice(null);
    } catch (error) {
      showNotice(errorMessage(error, 'Не удалось загрузить ваши наборы.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotice]);

  const selectCollection = useCallback(async (id) => {
    if (!id) return;
    const requestId = ++requestIdRef.current;
    setSelectedId(id);
    setLoadingSelected(true);
    try {
      const next = await creatorCollectionsApi.get(id);
      if (requestId !== requestIdRef.current) return;
      setSelected(next);
      setMetadata({ title: next.title || '', description: next.description || '' });
      setNotice(null);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setSelected(null);
        showNotice(errorMessage(error, 'Не удалось открыть набор.'), 'error');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoadingSelected(false);
    }
  }, [showNotice]);

  useEffect(() => { loadCollections(); }, [loadCollections]);

  const updateListItem = useCallback((updated) => {
    setCollections((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
  }, []);

  const createDraft = useCallback(async (event) => {
    event.preventDefault();
    const title = newDraft.title.trim();
    if (!title) {
      showNotice('Укажите название набора.', 'error');
      return;
    }
    setAction('create');
    try {
      const created = await creatorCollectionsApi.create({ title, description: newDraft.description.trim() });
      setNewDraft(EMPTY_DRAFT);
      setCollections((items) => [created, ...items]);
      notifyParent({ type: 'created', collection: created });
      showNotice('Приватный черновик создан.', 'success');
      await selectCollection(created.id);
    } catch (error) {
      showNotice(errorMessage(error, 'Не удалось создать черновик.'), 'error');
    } finally {
      setAction(null);
    }
  }, [newDraft, notifyParent, selectCollection, showNotice]);

  const saveMetadata = useCallback(async (event) => {
    event.preventDefault();
    if (!selected) return;
    const title = metadata.title.trim();
    if (!title) {
      showNotice('Укажите название набора.', 'error');
      return;
    }
    setAction('metadata');
    try {
      const updated = await creatorCollectionsApi.update(selected.id, { title, description: metadata.description.trim() });
      setSelected((current) => current ? { ...current, ...updated } : current);
      updateListItem(updated);
      notifyParent({ type: 'updated', collection: updated });
      showNotice('Изменения сохранены.', 'success');
    } catch (error) {
      showNotice(errorMessage(error, 'Не удалось сохранить изменения.'), 'error');
    } finally {
      setAction(null);
    }
  }, [metadata, notifyParent, selected, showNotice, updateListItem]);

  const addTemplate = useCallback(async (template) => {
    if (!selected || !isDraft || !template?.id) return;
    setAction(`add:${template.id}`);
    try {
      await creatorCollectionsApi.addTemplate(selected.id, template.id, selected.templates?.length || 0);
      notifyParent({ type: 'template-added', collectionId: selected.id, templateId: template.id });
      showNotice(`«${template.title}» добавлена в набор.`, 'success');
      await selectCollection(selected.id);
      await loadCollections();
    } catch (error) {
      showNotice(errorMessage(error, 'Не удалось добавить раскраску.'), 'error');
    } finally {
      setAction(null);
    }
  }, [isDraft, loadCollections, notifyParent, selectCollection, selected, showNotice]);

  const removeTemplate = useCallback(async (template) => {
    if (!selected || !isDraft || !template?.id) return;
    setAction(`remove:${template.id}`);
    try {
      await creatorCollectionsApi.removeTemplate(selected.id, template.id);
      notifyParent({ type: 'template-removed', collectionId: selected.id, templateId: template.id });
      showNotice(`«${template.title}» удалена из набора.`, 'success');
      await selectCollection(selected.id);
      await loadCollections();
    } catch (error) {
      showNotice(errorMessage(error, 'Не удалось удалить раскраску.'), 'error');
    } finally {
      setAction(null);
    }
  }, [isDraft, loadCollections, notifyParent, selectCollection, selected, showNotice]);

  const publish = useCallback(async () => {
    if (!selected || !isDraft) return;
    if (publicationBlocker) {
      showNotice(publicationBlocker, 'error');
      return;
    }
    setAction('publish');
    try {
      const updated = await creatorCollectionsApi.update(selected.id, { status: 'published', visibility: 'public' });
      setSelected((current) => current ? { ...current, ...updated } : current);
      updateListItem(updated);
      notifyParent({ type: 'published', collection: updated });
      showNotice('Набор опубликован бесплатно.', 'success');
    } catch (error) {
      showNotice(errorMessage(error, 'Набор пока нельзя опубликовать.'), 'error');
    } finally {
      setAction(null);
    }
  }, [isDraft, notifyParent, publicationBlocker, selected, showNotice, updateListItem]);

  const returnToDraft = useCallback(async () => {
    if (!selected || selected.status !== 'published') return;
    setAction('draft');
    try {
      const updated = await creatorCollectionsApi.update(selected.id, { status: 'draft', visibility: 'private' });
      setSelected((current) => current ? { ...current, ...updated } : current);
      updateListItem(updated);
      notifyParent({ type: 'returned-to-draft', collection: updated });
      showNotice('Набор снова приватный черновик.', 'success');
    } catch (error) {
      showNotice(errorMessage(error, 'Не удалось вернуть набор в черновики.'), 'error');
    } finally {
      setAction(null);
    }
  }, [notifyParent, selected, showNotice, updateListItem]);

  const archive = useCallback(async () => {
    if (!selected || !window.confirm(`Архивировать набор «${selected.title}»? Картины останутся у вас, но набор исчезнет из списка.`)) return;
    setAction('archive');
    try {
      await creatorCollectionsApi.archive(selected.id);
      requestIdRef.current += 1;
      setCollections((items) => items.filter((item) => item.id !== selected.id));
      setSelected(null);
      setSelectedId(null);
      notifyParent({ type: 'archived', collectionId: selected.id });
      showNotice('Набор перенесён в архив.', 'success');
    } catch (error) {
      showNotice(errorMessage(error, 'Не удалось архивировать набор.'), 'error');
    } finally {
      setAction(null);
    }
  }, [notifyParent, selected, showNotice]);

  return (
    <section className="creator-collections-manager" aria-labelledby="creator-collections-title">
      <header className="creator-collections-manager__header">
        <div>
          <p className="creator-collections-manager__eyebrow">СВОИ НАБОРЫ</p>
          <h2 id="creator-collections-title">Соберите коллекцию</h2>
          <p>Сначала создайте приватный черновик, добавьте свои раскраски и только потом публикуйте его бесплатно.</p>
        </div>
      </header>

      <form className="creator-collections-manager__new" onSubmit={createDraft}>
        <label>
          Название набора
          <input value={newDraft.title} maxLength="80" disabled={isBusy} onChange={(event) => setNewDraft((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label>
          Описание
          <textarea value={newDraft.description} maxLength="280" rows="3" disabled={isBusy} onChange={(event) => setNewDraft((current) => ({ ...current, description: event.target.value }))} />
        </label>
        <div className="creator-collections-manager__new-footer">
          <span><CircleAlert size={16} aria-hidden="true" /> Новый набор будет приватным черновиком.</span>
          <button type="submit" disabled={isBusy}><FilePlus2 size={18} aria-hidden="true" /> {action === 'create' ? 'Создаём…' : 'Создать черновик'}</button>
        </div>
      </form>

      <div className="creator-collections-manager__layout">
        <aside className="creator-collections-manager__list" aria-label="Мои наборы">
          <div className="creator-collections-manager__section-title"><h3>Мои наборы</h3><button type="button" onClick={loadCollections} disabled={loading || isBusy}>Обновить</button></div>
          {loading ? <p className="creator-collections-manager__loading"><LoaderCircle className="creator-collections-manager__spin" size={18} /> Загружаем…</p> : null}
          {!loading && !collections.length ? <p className="creator-collections-manager__empty">Пока нет наборов. Создайте первый черновик выше.</p> : null}
          {!loading && collections.map((collection) => (
            <button
              type="button"
              key={collection.id}
              className={`creator-collections-manager__collection ${selectedId === collection.id ? 'is-selected' : ''}`}
              aria-pressed={selectedId === collection.id}
              disabled={isBusy}
              onClick={() => selectCollection(collection.id)}
            >
              <span><b>{collection.title}</b><small>{collection.item_count || 0} картин · {collection.visibility === 'public' ? 'публичный' : 'приватный'}</small></span>
              <em className={`creator-collections-manager__badge is-${collection.status}`}>{collectionStatusLabel(collection.status)}</em>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ))}
        </aside>

        <div className="creator-collections-manager__detail" aria-live="polite">
          {loadingSelected ? <p className="creator-collections-manager__loading"><LoaderCircle className="creator-collections-manager__spin" size={18} /> Открываем набор…</p> : null}
          {!loadingSelected && !selected ? <p className="creator-collections-manager__empty">Выберите набор, чтобы добавить в него свои раскраски.</p> : null}
          {!loadingSelected && selected ? <>
            <div className="creator-collections-manager__detail-heading">
              <div><p className="creator-collections-manager__eyebrow">{collectionStatusLabel(selected.status)}</p><h3>{selected.title}</h3></div>
              <span>{selected.templates?.length || 0} шт.</span>
            </div>

            <form className="creator-collections-manager__metadata" onSubmit={saveMetadata}>
              <label>Название<input value={metadata.title} maxLength="80" disabled={isBusy} onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))} /></label>
              <label>Описание<textarea value={metadata.description} maxLength="280" rows="3" disabled={isBusy} onChange={(event) => setMetadata((current) => ({ ...current, description: event.target.value }))} /></label>
              <button type="submit" disabled={isBusy}><Save size={18} aria-hidden="true" /> {action === 'metadata' ? 'Сохраняем…' : 'Сохранить описание'}</button>
            </form>

            <div className="creator-collections-manager__publication">
              {isDraft ? <>
                <div><b>Бесплатная публикация</b><p>{publicationBlocker || 'Набор готов к проверке API и бесплатной публикации.'}</p></div>
                <button type="button" disabled={isBusy || Boolean(publicationBlocker)} onClick={publish}><Send size={18} aria-hidden="true" /> {action === 'publish' ? 'Публикуем…' : 'Опубликовать'}</button>
              </> : <>
                <div><b>Набор опубликован</b><p>Верните его в черновики, если хотите изменить состав.</p></div>
                <button type="button" disabled={isBusy} onClick={returnToDraft}><Undo2 size={18} aria-hidden="true" /> {action === 'draft' ? 'Возвращаем…' : 'Вернуть в черновики'}</button>
              </>}
            </div>

            <section className="creator-collections-manager__items" aria-labelledby="collection-items-title">
              <div className="creator-collections-manager__section-title"><h4 id="collection-items-title">Картины в наборе</h4><span>{selected.templates?.length || 0}</span></div>
              {!selected.templates?.length ? <p className="creator-collections-manager__empty">Добавьте хотя бы одну свою загруженную раскраску.</p> : null}
              {(selected.templates || []).map((template) => (
                <article key={template.id} className="creator-collections-manager__template">
                  <span className="creator-collections-manager__thumbnail" style={template.preview_url ? { backgroundImage: `url(${template.preview_url})` } : undefined} aria-hidden="true"><BookOpen size={18} /></span>
                  <span><b>{template.title}</b><small>{template.visibility === 'public' ? 'Публичная' : 'Приватная'} · {template.difficulty || 'Своя'}</small></span>
                  {isDraft && <button type="button" aria-label={`Удалить «${template.title}» из набора`} disabled={isBusy} onClick={() => removeTemplate(template)}><Minus size={18} aria-hidden="true" /> Убрать</button>}
                </article>
              ))}
            </section>

            {isDraft && <section className="creator-collections-manager__items" aria-labelledby="available-templates-title">
              <div className="creator-collections-manager__section-title"><h4 id="available-templates-title">Ваши раскраски</h4><span>{availableTemplates.length}</span></div>
              {!ownedTemplates.length ? <p className="creator-collections-manager__empty">Сначала создайте раскраску из изображения или в ручном редакторе.</p> : null}
              {ownedTemplates.length > 0 && !availableTemplates.length ? <p className="creator-collections-manager__empty">Все подходящие раскраски уже добавлены.</p> : null}
              {availableTemplates.map((template) => (
                <article key={template.id} className="creator-collections-manager__template">
                  <span className="creator-collections-manager__thumbnail" style={template.preview_url ? { backgroundImage: `url(${template.preview_url})` } : undefined} aria-hidden="true"><BookOpen size={18} /></span>
                  <span><b>{template.title}</b><small>{template.visibility === 'public' ? 'Публичная' : 'Приватная'} · {template.width}×{template.height}</small></span>
                  <button type="button" aria-label={`Добавить «${template.title}» в набор`} disabled={isBusy} onClick={() => addTemplate(template)}><Plus size={18} aria-hidden="true" /> Добавить</button>
                </article>
              ))}
            </section>}

            <button type="button" className="creator-collections-manager__archive" disabled={isBusy} onClick={archive}><Archive size={18} aria-hidden="true" /> {action === 'archive' ? 'Архивируем…' : 'Архивировать набор'}</button>
          </> : null}
        </div>
      </div>

      {notice && <p className={`creator-collections-manager__notice is-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.text}</p>}
    </section>
  );
}
