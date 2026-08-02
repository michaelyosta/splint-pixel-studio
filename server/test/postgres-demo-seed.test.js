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
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function startDemoSeedServer(schema) {
  const port = await getFreePort();
  let output = '';
  const server = spawn('node', ['index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGOPTIONS: `-c search_path="${schema}",public`,
      PORT: String(port),
      NODE_ENV: 'test',
      ALLOW_DEV_AUTH: 'true',
      SEED_DEMO_DATA: 'true',
      RATE_LIMIT_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { output += chunk.toString(); });
  server.stderr.on('data', (chunk) => { output += chunk.toString(); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Demo seed server did not start: ${output}`)), 15_000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Demo seed server exited ${code}: ${output}`));
    });
  });
  return server;
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
    server.kill();
  });
}

test('PostgreSQL demo seed starts twice and hides obsolete catalog templates', { skip: !databaseUrl }, async (t) => {
  const pg = (await import('pg')).default;
  const schema = `demo_seed_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path="${schema}",public` });
  const servers = [];

  t.after(async () => {
    for (const server of servers) await stopServer(server);
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  let server = await startDemoSeedServer(schema);
  servers.push(server);
  await stopServer(server);

  const now = new Date().toISOString();
  await pool.query(`INSERT INTO coloring_templates
    (id,title,width,height,palette_json,cells_json,source_type,visibility,status,created_at,updated_at)
    VALUES ($1,$2,8,8,$3,$4,'catalog','public','active',$5,$5)`,
  ['obsolete_catalog_template', 'Obsolete catalog template', JSON.stringify(['#000000', '#ffffff']), JSON.stringify(Array(64).fill(0)), now]);

  server = await startDemoSeedServer(schema);
  servers.push(server);
  await stopServer(server);

  const catalog = await pool.query("SELECT id, status, visibility FROM coloring_templates WHERE source_type='catalog'");
  const obsolete = catalog.rows.find((row) => row.id === 'obsolete_catalog_template');
  assert.equal(obsolete?.status, 'hidden');
  assert.equal(catalog.rows.filter((row) => row.status === 'active' && row.visibility === 'public').length, 6);
});
