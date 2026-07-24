import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function getFreePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
  });
}

test('PostgreSQL report concurrency and moderation audit are transactional', { skip: !databaseUrl }, async (t) => {
  const pg = (await import('pg')).default;
  const schema = `security_pg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path="${schema}",public`,
  });
  const { runMigrations } = await import('../database/migrations.js');
  await runMigrations({
    mode: 'postgres',
    pool,
    sqlite: null,
    persistFn: null,
    migrationsDir: join(serverDir, 'migrations'),
  });

  const port = await getFreePort();
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGOPTIONS: `-c search_path="${schema}",public`,
      PORT: String(port),
      ALLOW_DEV_AUTH: 'true',
      NODE_ENV: 'test',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopServer(server);
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  const now = new Date().toISOString();
  await pool.query(`INSERT INTO users (id,nickname,role,created_at,updated_at) VALUES
    ('author','Author','user',$1,$1),
    ('reporter1','Reporter 1','user',$1,$1),
    ('reporter2','Reporter 2','user',$1,$1),
    ('reporter3','Reporter 3','user',$1,$1),
    ('reporter4','Reporter 4','user',$1,$1),
    ('moderator','Moderator','moderator',$1,$1)`, [now]);
  await pool.query(`INSERT INTO posts
    (id,author_id,post_type,title,status,published_at,created_at,updated_at) VALUES
    ('concurrent_post','author','user_art','Concurrent','active',$1,$1,$1),
    ('concurrent_auto_post','author','user_art','Concurrent auto','active',$1,$1,$1),
    ('auto_post','author','user_art','Auto','active',$1,$1,$1),
    ('manual_post','author','user_art','Manual','active',$1,$1,$1),
    ('rollback_post','author','user_art','Rollback','active',$1,$1,$1)`, [now]);

  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`PostgreSQL security API did not start: ${stderr}`)), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('exit', (code) => reject(new Error(`PostgreSQL security API exited ${code}: ${stderr}`)));
  });

  async function request(path, { userId, method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, json: await response.json().catch(() => ({})) };
  }

  const concurrent = await Promise.all([
    request('/posts/concurrent_post/report', { userId: 'reporter1', method: 'POST', body: { reason: 'spam' } }),
    request('/posts/concurrent_post/report', { userId: 'reporter1', method: 'POST', body: { reason: 'spam' } }),
  ]);
  assert.deepStrictEqual(concurrent.map(({ response }) => response.status).sort(), [200, 409]);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM reports WHERE target_id='concurrent_post'")).rows[0].count), 1);

  await assert.rejects(
    pool.query(`INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at)
      VALUES ('forced_duplicate','reporter1','post','concurrent_post','other','pending',NOW())`),
    /unique/i,
  );

  const concurrentUnique = await Promise.all(['reporter1', 'reporter2', 'reporter3'].map((userId) =>
    request('/posts/concurrent_auto_post/report', { userId, method: 'POST', body: { reason: 'spam' } })));
  assert.deepStrictEqual(concurrentUnique.map(({ response }) => response.status), [200, 200, 200]);
  assert.equal((await pool.query("SELECT status FROM posts WHERE id='concurrent_auto_post'")).rows[0].status, 'hidden');
  assert.equal(
    Number((await pool.query("SELECT COUNT(*) AS count FROM moderation_actions WHERE action='auto_hide' AND target_id='concurrent_auto_post'")).rows[0].count),
    1,
  );

  for (const reporterId of ['reporter1', 'reporter2']) {
    const result = await request('/posts/auto_post/report', {
      userId: reporterId, method: 'POST', body: { reason: 'spam' },
    });
    assert.equal(result.response.status, 200);
    assert.equal((await pool.query("SELECT status FROM posts WHERE id='auto_post'")).rows[0].status, 'active');
  }
  const threshold = await request('/posts/auto_post/report', {
    userId: 'reporter3', method: 'POST', body: { reason: 'spam' },
  });
  assert.equal(threshold.response.status, 200);
  assert.equal((await pool.query("SELECT status FROM posts WHERE id='auto_post'")).rows[0].status, 'hidden');
  assert.equal(
    Number((await pool.query("SELECT COUNT(*) AS count FROM moderation_actions WHERE action='auto_hide' AND target_id='auto_post'")).rows[0].count),
    1,
  );
  assert.equal(
    (await request('/posts/auto_post/report', { userId: 'reporter4', method: 'POST', body: { reason: 'spam' } })).response.status,
    404,
  );
  assert.equal(
    Number((await pool.query("SELECT COUNT(*) AS count FROM moderation_actions WHERE action='auto_hide' AND target_id='auto_post'")).rows[0].count),
    1,
  );

  const manual = await request('/moderation/hide', {
    userId: 'moderator',
    method: 'POST',
    body: { targetType: 'post', targetId: 'manual_post', reason: 'manual reason', actorUserId: 'spoofed' },
  });
  assert.equal(manual.response.status, 200);
  const manualAction = (await pool.query("SELECT * FROM moderation_actions WHERE action='hide' AND target_id='manual_post'")).rows[0];
  assert.equal(manualAction.actor_user_id, 'moderator');
  assert.equal(manualAction.reason, 'manual reason');
  assert.equal(manualAction.previous_state, 'active');
  assert.equal(manualAction.new_state, 'hidden');

  await pool.query(`
    CREATE FUNCTION fail_rollback_audit() RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.target_id = 'rollback_post' THEN
        RAISE EXCEPTION 'forced audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER moderation_actions_forced_failure
      BEFORE INSERT ON moderation_actions
      FOR EACH ROW EXECUTE FUNCTION fail_rollback_audit();
  `);
  const rollback = await request('/moderation/hide', {
    userId: 'moderator',
    method: 'POST',
    body: { targetType: 'post', targetId: 'rollback_post', reason: 'must roll back' },
  });
  assert.equal(rollback.response.status, 500);
  assert.equal((await pool.query("SELECT status FROM posts WHERE id='rollback_post'")).rows[0].status, 'active');
  assert.equal(
    Number((await pool.query("SELECT COUNT(*) AS count FROM moderation_actions WHERE target_id='rollback_post'")).rows[0].count),
    0,
  );

  assert.equal((await request('/moderation/actions', { userId: 'reporter1' })).response.status, 403);
});
