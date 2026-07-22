export class TransactionClosedError extends Error {
  constructor() {
    super('Transaction is already closed. You cannot use a transaction adapter after the callback has returned.');
    this.name = 'TransactionClosedError';
  }
}

export class NestedTransactionError extends Error {
  constructor() {
    super('Nested transactions are not supported.');
    this.name = 'NestedTransactionError';
  }
}

const dbStates = new Map();

function getState(sqlite) {
  let state = dbStates.get(sqlite);
  if (!state) {
    state = { lockQueue: [], lockActive: false, depth: 0 };
    dbStates.set(sqlite, state);
  }
  return state;
}

function acquireLock(state) {
  return new Promise((resolve) => {
    state.lockQueue.push(resolve);
    processNext(state);
  });
}

function releaseLock(state) {
  state.lockActive = false;
  processNext(state);
}

function processNext(state) {
  if (state.lockActive || state.lockQueue.length === 0) return;
  state.lockActive = true;
  const next = state.lockQueue.shift();
  next();
}

function createPostgresTx(client) {
  let closed = false;

  function checkClosed() {
    if (closed) throw new TransactionClosedError();
  }

  return {
    async get(sql, params = []) {
      checkClosed();
      const result = await client.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      checkClosed();
      const result = await client.query(sql, params);
      return result.rows;
    },
    async run(sql, params = []) {
      checkClosed();
      await client.query(sql, params);
    },
    markClosed() {
      closed = true;
    },
  };
}

function createSqliteTx(sqlite) {
  let closed = false;

  function checkClosed() {
    if (closed) throw new TransactionClosedError();
  }

  return {
    get(sql, params = []) {
      checkClosed();
      const stmt = sqlite.prepare(sql);
      stmt.bind(params);
      let row = null;
      if (stmt.step()) row = stmt.getAsObject();
      stmt.free();
      return row ?? null;
    },
    all(sql, params = []) {
      checkClosed();
      const stmt = sqlite.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    run(sql, params = []) {
      checkClosed();
      sqlite.run(sql, params);
    },
    markClosed() {
      closed = true;
    },
  };
}

export async function withTransaction(db, callback) {
  if (db.mode === 'postgres') {
    return withPostgresTransaction(db, callback);
  }
  return withSqliteTransaction(db, callback);
}

async function withPostgresTransaction(db, callback) {
  const { pool } = db;
  const client = await pool.connect();

  const tx = createPostgresTx(client);

  try {
    await client.query('BEGIN');
    const result = await callback(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    tx.markClosed();
    client.release();
  }
}

async function withSqliteTransaction(db, callback) {
  const { sqlite, persistFn } = db;
  const state = getState(sqlite);

  if (state.depth > 0) {
    throw new NestedTransactionError();
  }

  await acquireLock(state);

  if (state.depth > 0) {
    releaseLock(state);
    throw new NestedTransactionError();
  }

  state.depth++;

  const tx = createSqliteTx(sqlite);

  try {
    sqlite.run('BEGIN IMMEDIATE');

    const result = await callback(tx);

    sqlite.run('COMMIT');

    if (persistFn) persistFn();

    return result;
  } catch (error) {
    try { sqlite.run('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    tx.markClosed();
    state.depth--;
    releaseLock(state);
  }
}
