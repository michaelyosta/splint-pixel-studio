export function createPremiumPackPurchaseIntent(packId, openStore) {
  if (typeof openStore !== 'function') return null;
  return () => openStore(packId);
}
