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

let nestedDepth = 0;
let lockQueue = [];
let lockActive = false;

function acquireLock() {
  return new Promise((resolve) => {
    lockQueue.push(resolve);
    processNext();
  });
}

function releaseLock() {
  lockActive = false;
  processNext();
}

function processNext() {
  if (lockActive || lockQueue.length === 0) return;
  lockActive = true;
  const next = lockQueue.shift();
  next();
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
    tx.markClosed();
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    tx.markClosed();
    throw error;
  } finally {
    client.release();
  }
}

async function withSqliteTransaction(db, callback) {
  const { sqlite, persistFn } = db;

  if (nestedDepth > 0) {
    throw new NestedTransactionError();
  }

  await acquireLock();

  if (nestedDepth > 0) {
    releaseLock();
    throw new NestedTransactionError();
  }

  nestedDepth++;

  try {
    sqlite.run('BEGIN IMMEDIATE');

    const tx = createSqliteTx(sqlite);

    const result = await callback(tx);

    sqlite.run('COMMIT');
    tx.markClosed();

    if (persistFn) persistFn();

    return result;
  } catch (error) {
    try { sqlite.run('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    nestedDepth--;
    releaseLock();
  }
}
