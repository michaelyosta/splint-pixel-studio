import { formatContentMetadataLine, hasContentMetadata } from './contentMetadata.js';

/**
 * Small, view-only helpers for the Phase 4 collection surface.
 *
 * The gallery is deliberately derived from the existing /colorings/mine
 * payload.  It does not create another progression source or make claims
 * about a more precise completion time than the catalog can support.
 */

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function progressPercent(item) {
  const progress = item?.progress;
  if (!progress) return 0;
  const total = asNumber(progress.total_cells);
  const completed = asNumber(progress.completed_cells);
  if (total > 0) return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
  return Math.max(0, Math.min(100, asNumber(progress.percent)));
}

export function isCompletedArtwork(item) {
  return progressPercent(item) >= 100 || Boolean(item?.progress?.completed_at);
}

export function isInProgressArtwork(item) {
  const percent = progressPercent(item);
  return percent > 0 && percent < 100;
}

function activityTime(item) {
  const value = Date.parse(item?.progress?.updated_at || item?.updated_at || item?.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

/** Completed results first, then active works, with the most recently touched
 * active work at the top.  This makes a return to the gallery actionable. */
export function sortGalleryItems(items = []) {
  return [...items].sort((first, second) => {
    const firstCompleted = isCompletedArtwork(first);
    const secondCompleted = isCompletedArtwork(second);
    if (firstCompleted !== secondCompleted) return firstCompleted ? 1 : -1;
    const activityDelta = activityTime(second) - activityTime(first);
    if (activityDelta) return activityDelta;
    return String(first?.title || first?.id || '').localeCompare(String(second?.title || second?.id || ''), 'ru');
  });
}

export function buildGallerySummary(items = []) {
  return items.reduce((summary, item) => {
    if (isCompletedArtwork(item)) summary.completed += 1;
    else if (isInProgressArtwork(item)) summary.inProgress += 1;
    else summary.unopened += 1;
    return summary;
  }, { completed: 0, inProgress: 0, unopened: 0 });
}

/**
 * Duration is intentionally bucketed.  An estimate such as "3 мин" is not a
 * promise that a player will finish the work in exactly three minutes.
 */
export function formatArtworkDuration(item) {
  const minutes = asNumber(item?.est_minutes, 0);
  if (minutes <= 0) {
    const area = asNumber(item?.width) * asNumber(item?.height);
    if (area >= 1024 * 1024) return 'длинная сессия';
    if (area >= 256 * 256) return 'средняя сессия';
    return 'короткая сессия';
  }
  if (minutes <= 3) return 'до 3 мин';
  if (minutes <= 5) return '3–5 мин';
  if (minutes <= 10) return '5–10 мин';
  return '10+ мин';
}

export function formatArtworkComplexity(item) {
  const difficulty = String(item?.difficulty || '').toLowerCase();
  if (/expert|hard|слож|труд|высок/.test(difficulty)) return 'сложная';
  if (/medium|normal|сред/.test(difficulty)) return 'средняя';
  if (/easy|лег|прост|low/.test(difficulty)) return 'лёгкая';
  const area = asNumber(item?.width) * asNumber(item?.height);
  if (area >= 1024 * 1024) return 'много деталей';
  if (area >= 256 * 256) return 'с деталями';
  return 'спокойный старт';
}

export function formatArtworkMeta(item) {
  if (hasContentMetadata(item)) return formatContentMetadataLine(item);
  return `${formatArtworkDuration(item)} · ${formatArtworkComplexity(item)} · Метаданные не проверены`;
}

/**
 * A truthful resume promise: we know that the next beat is a new reveal, but
 * we intentionally do not invent a region name or a countdown the API does
 * not provide.
 */
export function formatResumeBeat(item) {
  const percent = progressPercent(item);
  if (percent <= 0) return 'Первый reveal-фрагмент';
  if (percent >= 100) return 'Готовый результат';
  return `Следующий reveal-фрагмент · раскрыто ${percent}%`;
}

export function buildCollectionProgress(collection, mine = []) {
  const members = mine.filter((item) => item?.collection_id === collection?.id);
  const locallyCompleted = members.filter(isCompletedArtwork).length;
  const serverCompleted = Math.max(0, asNumber(collection?.completed_count));
  const completed = Math.max(serverCompleted, locallyCompleted);
  const memberCount = members.length;
  const serverTotal = Math.max(0, asNumber(collection?.total_count || collection?.total_artworks));
  const total = Math.max(serverTotal, memberCount);
  const boundedCompleted = total > 0 ? Math.min(completed, total) : completed;
  const percent = total > 0 ? Math.round((boundedCompleted / total) * 100) : 0;
  return {
    ...collection,
    completed_count: boundedCompleted,
    total_count: total,
    progress_percent: percent,
    state: percent >= 100 && total > 0 ? 'complete' : boundedCompleted > 0 ? 'in_progress' : 'unstarted',
  };
}

export function sortCollectionsForShelf(collections = [], mine = []) {
  return collections
    .filter((collection) => collection?.pack_type !== 'premium')
    .map((collection) => buildCollectionProgress(collection, mine))
    .sort((first, second) => {
      if (first.state !== second.state) {
        const rank = { in_progress: 0, unstarted: 1, complete: 2 };
        return (rank[first.state] ?? 3) - (rank[second.state] ?? 3);
      }
      return String(first.title || first.id).localeCompare(String(second.title || second.id), 'ru');
    });
}
