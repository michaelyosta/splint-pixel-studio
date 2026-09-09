/**
 * Requested pack ids are deep-link input for the catalog. Once the user has
 * explicitly entered the store, the same state must not pull the app back to
 * the catalog.
 */
export function shouldResolveRequestedPackRoute({ view, requestedPackId, collections = [] } = {}) {
  return view === 'catalog'
    && Boolean(requestedPackId)
    && Array.isArray(collections)
    && collections.length > 0;
}
