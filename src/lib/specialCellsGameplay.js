function sparkOfferKind(offer) {
  if (!offer || typeof offer !== 'object') return null;
  if (offer.kind) return String(offer.kind).toLowerCase();
  return Array.isArray(offer.target_options) ? 'spark' : null;
}

/** Resolve persisted offers deterministically with the existing action types. */
export function autoSpecialActionForOffer(offer, { cameraCenter = null } = {}) {
  if (!offer?.special_id || !offer?.offer_token) return null;
  const kind = sparkOfferKind(offer);
  const base = {
    special_id: offer.special_id,
    offer_token: offer.offer_token,
    experiment_group: 'treatment',
  };
  if (kind === 'spark' || (!kind && Array.isArray(offer.target_options))) {
    const options = Array.isArray(offer.target_options) ? offer.target_options : [];
    const optionId = String(offer.default_option_id || options[0]?.option_id || '');
    if (!options.some((option) => String(option?.option_id || '') === optionId)) return null;
    return { type: 'use_spark', ...base, option_id: optionId };
  }
  if (kind === 'bomb') {
    const centerX = Number(offer.center_x);
    const centerY = Number(offer.center_y);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
    return { type: 'use_bomb', ...base, center_x: centerX, center_y: centerY };
  }
  if (kind === 'fuse') return { type: 'disarm_fuse', ...base };
  if (kind === 'hazard') return { type: 'disarm_hazard', ...base };
  if (kind === 'choice' || Array.isArray(offer.choice_options)) {
    const options = Array.isArray(offer.choice_options) ? offer.choice_options : [];
    const optionId = String(offer.default_option_id || options[0]?.option_id || '');
    if (!optionId || !options.some((option) => String(option?.option_id || '') === optionId)) return null;
    return {
      type: 'use_choice',
      ...base,
      option_id: optionId,
      ...(cameraCenter ? { camera_center: cameraCenter } : {}),
    };
  }
  // Unknown future offers still take their first server-provided option using
  // the closest existing action envelope; the server remains authoritative.
  if (Array.isArray(offer.target_options) && offer.target_options.length) {
    const optionId = String(offer.default_option_id || offer.target_options[0]?.option_id || '');
    if (optionId && offer.target_options.some((option) => String(option?.option_id || '') === optionId)) {
      return { type: 'use_spark', ...base, option_id: optionId };
    }
  }
  if (Array.isArray(offer.choice_options) && offer.choice_options.length) {
    const optionId = String(offer.default_option_id || offer.choice_options[0]?.option_id || '');
    if (optionId && offer.choice_options.some((option) => String(option?.option_id || '') === optionId)) {
      return { type: 'use_choice', ...base, option_id: optionId };
    }
  }
  return null;
}

export function autoSparkActionForOffer(offer) {
  const action = autoSpecialActionForOffer(offer);
  return action?.type === 'use_spark' ? action : null;
}

export function autoSparkActionKey(action, offer = null) {
  if (!action) return '';
  return `${action.special_id}:${action.offer_token}:${action.type}:${action.option_id || ''}:${action.center_x ?? ''}:${action.center_y ?? ''}:${offer?.progress_revision ?? ''}:${offer?.steps?.[0]?.distance ?? ''}`;
}

export async function submitAutoSpecialAction(onSpecialAction, action) {
  if (typeof onSpecialAction !== 'function' || !action) return false;
  try {
    return await onSpecialAction(action) !== false;
  } catch {
    return false;
  }
}

export async function submitAutoSparkAction(onSpecialAction, action) {
  return submitAutoSpecialAction(onSpecialAction, action);
}

export function specialOfferDecisionCount() {
  return 0;
}
