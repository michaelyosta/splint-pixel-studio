import { useCallback, useEffect, useState } from 'react';
import { api, catalogApi, metaApi } from '../api/client';
import { CATALOG_PAGE_SIZE } from '../lib/catalogMeta';
import { hapticSelection } from '../lib/telegram';

export function useCatalogData({ showNotice, setFavoriteTemplates, onNavigate }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [mine, setMine] = useState([]);
  const [mineError, setMineError] = useState(false);
  const [filters, setFilters] = useState({ mood: '', theme: '', max_minutes: '' });
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogChip, setCatalogChip] = useState('all');
  const [catalogCollection, setCatalogCollection] = useState(null);
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [favoriteSavingId, setFavoriteSavingId] = useState(null);
  const [ratingTemplateId, setRatingTemplateId] = useState(null);
  const [publishingTemplateId, setPublishingTemplateId] = useState(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const data = await catalogApi.list(filters);
      setTemplates(data);
      setCatalogError(false);
    } catch (error) {
      showNotice(error.message, 'error');
      setCatalogError(true);
    } finally {
      setLoading(false);
    }
  }, [filters, showNotice]);

  const loadMine = useCallback(async () => {
    try {
      setMine(await api('/colorings/mine'));
      setMineError(false);
    } catch (error) {
      showNotice(error.message, 'error');
      setMineError(true);
    }
  }, [showNotice]);

  const openCatalogCollection = useCallback(async (collection) => {
    try {
      const items = await metaApi.collectionTemplates(collection.id);
      setTemplates(items);
      setCatalogCollection(collection);
      setCatalogChip('collections');
      setCatalogQuery('');
      onNavigate('catalog');
      showNotice(`Открыта коллекция «${collection.title}»`, 'info');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [onNavigate, showNotice]);

  const resetCatalogScope = useCallback(() => {
    setCatalogCollection(null);
    setCatalogChip('all');
    setCatalogQuery('');
    loadCatalog();
  }, [loadCatalog]);

  const rateColoring = useCallback(async (item, rating) => {
    if (ratingTemplateId) return;
    hapticSelection();
    setRatingTemplateId(item.id);
    try {
      const clearRating = item.viewer_rating === rating;
      const updated = await api(`/colorings/${item.id}/rating`, {
        method: clearRating ? 'DELETE' : 'PUT',
        body: clearRating ? undefined : { rating },
      });
      setTemplates((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry));
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setRatingTemplateId(null);
    }
  }, [ratingTemplateId, showNotice]);

  const toggleTemplateFavorite = useCallback(async (item) => {
    if (favoriteSavingId) return;
    const nextFavorite = !item.is_favorite;
    hapticSelection();
    setFavoriteSavingId(item.id);
    try {
      await catalogApi.setFavorite(item.id, nextFavorite);
      setTemplates((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_favorite: nextFavorite } : entry));
      setFavoriteTemplates((current) => nextFavorite
        ? [{ ...item, is_favorite: true }, ...current.filter((entry) => entry.id !== item.id)]
        : current.filter((entry) => entry.id !== item.id));
      showNotice(nextFavorite ? 'Добавлено в избранное' : 'Удалено из избранного', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setFavoriteSavingId(null);
    }
  }, [favoriteSavingId, setFavoriteTemplates, showNotice]);

  const setColoringVisibility = useCallback(async (item) => {
    if (publishingTemplateId) return;
    const visibility = item.visibility === 'public' ? 'private' : 'public';
    if (visibility === 'public' && !window.confirm('Опубликовать раскраску в общем каталоге? Убедитесь, что у вас есть право делиться исходным изображением.')) return;
    setPublishingTemplateId(item.id);
    try {
      const updated = await api(`/colorings/${item.id}/visibility`, { method: 'PATCH', body: { visibility } });
      setMine((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry));
      await loadCatalog();
      showNotice(visibility === 'public' ? 'Раскраска опубликована в каталоге' : 'Раскраска снята с публикации', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setPublishingTemplateId(null);
    }
  }, [loadCatalog, publishingTemplateId, showNotice]);

  const deleteColoring = useCallback(async (item) => {
    if (!window.confirm(`Удалить раскраску «${item.title}» и связанный прогресс?`)) return;
    try {
      await api(`/colorings/${item.id}`, { method: 'DELETE' });
      await Promise.all([loadMine(), loadCatalog()]);
      showNotice('Раскраска удалена', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [loadCatalog, loadMine, showNotice]);

  const changeFilters = useCallback((patch) => setFilters((current) => ({ ...current, ...patch })), []);
  const showMore = useCallback(() => setVisibleCount((count) => count + CATALOG_PAGE_SIZE), []);

  useEffect(() => { setVisibleCount(CATALOG_PAGE_SIZE); }, [templates]);
  useEffect(() => { setVisibleCount(CATALOG_PAGE_SIZE); }, [catalogChip, catalogQuery, catalogCollection]);

  return {
    templates,
    loading,
    setLoading,
    catalogError,
    mine,
    mineError,
    filters,
    changeFilters,
    catalogQuery,
    setCatalogQuery,
    catalogChip,
    setCatalogChip,
    catalogCollection,
    setCatalogCollection,
    visibleCount,
    showMore,
    favoriteSavingId,
    ratingTemplateId,
    publishingTemplateId,
    loadCatalog,
    loadMine,
    openCatalogCollection,
    resetCatalogScope,
    rateColoring,
    toggleTemplateFavorite,
    setColoringVisibility,
    deleteColoring,
  };
}
