function sparkOfferKind(offer) {
  if (!offer || typeof offer !== 'object') return null;
  if (offer.kind) return String(offer.kind).toLowerCase();
  return Array.isArray(offer.target_options) ? 'spark' : null;
}

/**
 * Spark no longer asks the player to compare anonymous A/B rectangles. The
 * server persists one deterministic default target; the client only advances
 * that existing offer through the normal CAS/idempotent use_spark action.
 * Older two-option offers are compatible and deterministically use the first
 * persisted option when they are recovered after reload.
 */
export function autoSparkActionForOffer(offer) {
  if (sparkOfferKind(offer) !== 'spark') return null;
  const options = Array.isArray(offer.target_options) ? offer.target_options : [];
  const defaultOptionId = String(offer.default_option_id || options[0]?.option_id || '');
  if (!offer.special_id || !offer.offer_token || !defaultOptionId) return null;
  if (!options.some((option) => String(option?.option_id || '') === defaultOptionId)) return null;
  return {
    type: 'use_spark',
    special_id: offer.special_id,
    offer_token: offer.offer_token,
    option_id: defaultOptionId,
    experiment_group: 'treatment',
  };
}

export function autoSparkActionKey(action) {
  if (!action) return '';
  return `${action.special_id}:${action.offer_token}:${action.option_id}`;
}

export async function submitAutoSparkAction(onSpecialAction, action) {
  if (typeof onSpecialAction !== 'function' || !action) return false;
  try {
    return await onSpecialAction(action) !== false;
  } catch {
    return false;
  }
}

export function specialOfferDecisionCount(offer) {
  if (autoSparkActionForOffer(offer)) return 0;
  if (Array.isArray(offer?.choice_options)) return 1;
  if (offer?.kind === 'bomb' || offer?.kind === 'fuse' || offer?.kind === 'hazard') return 1;
  return 0;
}
