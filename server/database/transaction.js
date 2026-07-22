import { getTransactionContext, runInTransactionContext } from './runtime-context.js';
import { scheduleSqliteOperation } from './sqlite-scheduler.js';

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

function toPostgres(sql) {
  let position = 0;
  return sql
    .replace(/\?/g, () => `$${++position}`)
    .replace(/MAX\(0,\s*([^)]+)\)/gi, 'GREATEST(0, $1)');
}

function createPostgresTx(client) {
  let closed = false;

  function checkClosed() {
    if (closed) throw new TransactionClosedError();
  }

  return {
    async get(sql, params = []) {
      checkClosed();
      const result = await client.query(toPostgres(sql), params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      checkClosed();
      const result = await client.query(toPostgres(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      checkClosed();
      const result = await client.query(toPostgres(sql), params);
      return { changes: result.rowCount };
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
      return { changes: sqlite.getRowsModified() };
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

  const existingCtx = getTransactionContext();
  if (existingCtx && existingCtx.databaseIdentity === pool) {
    throw new NestedTransactionError();
  }

  const client = await pool.connect();
  const tx = createPostgresTx(client);
  const context = { mode: 'postgres', databaseIdentity: pool, tx };

  try {
    await client.query('BEGIN');
    const result = await runInTransactionContext(context, () => callback(tx));
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

  const existingCtx = getTransactionContext();
  if (existingCtx && existingCtx.databaseIdentity === sqlite) {
    throw new NestedTransactionError();
  }

  const tx = createSqliteTx(sqlite);
  const context = { mode: 'sqlite', databaseIdentity: sqlite, tx };

  try {
    const result = await scheduleSqliteOperation(sqlite, async () => {
      sqlite.run('BEGIN IMMEDIATE');

      try {
        const cbResult = await runInTransactionContext(context, () => callback(tx));
        sqlite.run('COMMIT');
        if (persistFn) persistFn();
        return cbResult;
      } catch (error) {
        try { sqlite.run('ROLLBACK'); } catch { /* ignore */ }
        throw error;
      }
    });
    return result;
  } finally {
    tx.markClosed();
  }
}
