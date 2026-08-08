export function getOwnedUserTemplates(templates) {
  const seen = new Set();
  return (Array.isArray(templates) ? templates : []).filter((template) => {
    if (!template?.id || seen.has(template.id) || template.source_type !== 'user' || template.status === 'archived' || template.status === 'deleted') return false;
    seen.add(template.id);
    return true;
  });
}

export function getCollectionTemplateIds(collection) {
  return new Set((collection?.templates || []).map((template) => template.id).filter(Boolean));
}

export function getAvailableCollectionTemplates(templates, collection) {
  const selectedIds = getCollectionTemplateIds(collection);
  return getOwnedUserTemplates(templates).filter((template) => !selectedIds.has(template.id));
}

export function getPublicationBlocker(collection) {
  const items = collection?.templates || [];
  if (!items.length) return 'Добавьте хотя бы одну свою раскраску.';
  if (items.some((template) => template.visibility !== 'public')) {
    return 'Перед публикацией сделайте все раскраски набора публичными.';
  }
  return null;
}

export function collectionStatusLabel(status) {
  if (status === 'published') return 'Опубликован';
  if (status === 'archived') return 'В архиве';
  return 'Черновик';
}
