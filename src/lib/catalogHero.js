import { isCompletedArtwork, progressPercent } from './galleryProgression.js';

function isCreatedByViewer(item, userId) {
  return Boolean(item?.is_owner || item?.created_by_me)
    || (userId != null && item?.owner_id != null && String(item.owner_id) === String(userId));
}

function isFinished(item) {
  return Boolean(item?.is_completed || item?.completed || isCompletedArtwork(item));
}

export function selectHeroPaintable(items = [], mine = [], userId = null) {
  const viewerItems = new Map(mine.map((item) => [String(item.id), item]));
  const eligibleFree = items.filter((item) => {
    const ownedWork = viewerItems.get(String(item.id));
    return item.access !== 'premium'
      && !isFinished(item)
      && !isCreatedByViewer(item, userId)
      && !isFinished(ownedWork)
      && !isCreatedByViewer(ownedWork, userId);
  });

  return eligibleFree.find((item) => progressPercent(viewerItems.get(String(item.id)) || item) <= 0)
    || eligibleFree.find((item) => progressPercent(viewerItems.get(String(item.id)) || item) > 0)
    || eligibleFree[0]
    || null;
}

export function getCatalogHeroState(mine = [], userId = null) {
  const viewerWorks = mine.filter((item) => isCreatedByViewer(item, userId) || isFinished(item) || progressPercent(item) > 0);
  const unfinished = viewerWorks
    .filter((item) => !isFinished(item))
    .filter((item) => progressPercent(item) > 0)
    .sort((first, second) => progressPercent(second) - progressPercent(first))[0] || null;
  const finishedCount = viewerWorks.filter(isFinished).length;
  const createdCount = viewerWorks.filter((item) => isCreatedByViewer(item, userId)).length;

  return {
    kind: unfinished ? 'continue' : (finishedCount > 0 || createdCount > 0 ? 'returning' : 'fresh'),
    unfinished,
    finishedCount,
    createdCount,
  };
}
