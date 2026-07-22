import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function getTransactionContext() {
  return storage.getStore() ?? null;
}

export function runInTransactionContext(context, callback) {
  return storage.run(context, callback);
}
