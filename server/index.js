// server/index.js — Express entry point
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { all, get, getDb, initDb, closeDb, withDbTransaction, bootstrapSystemData, seedDemoData } from './db.js';

import feedRouter        from './routes/feed.js';
import postsRouter       from './routes/posts.js';
import likesRouter       from './routes/likes.js';
import commentsRouter, { commentActionsRouter } from './routes/comments.js';
import followsRouter     from './routes/follows.js';
import profilesRouter    from './routes/profiles.js';
import messagesRouter    from './routes/messages.js';
import moderationRouter  from './routes/moderation.js';
import coloringsRouter   from './routes/colorings.js';
import metaRouter        from './routes/meta.js';
import mediaRouter       from './routes/media.js';
import creatorCollectionsRouter from './routes/creator-collections.js';
import unlocksRouter from './routes/unlocks.js';
import directorRouter from './routes/director.js';
import { validateProductionConfiguration } from './config.js';
import { checkMediaStorage } from './services/media-storage.js';
import { cleanupExpiredPaymentRequests } from './services/message-cleanup.js';
import { metricsSnapshot, requestObservability, safeErrorClass } from './observability.js';
import { asyncRoute } from './middleware/asyncRoute.js';
import { drainRenderJobs } from './services/render-outbox.js';

const PORT = process.env.PORT || 3001;
const productionConfig = validateProductionConfiguration();
const { isProduction, allowedOrigins, trustProxy } = productionConfig;

// ── Init DB before serving ────────────────────────────────────────────────────
await initDb();
const db = getDb();
console.log(`${db.mode} database ready`);

if (process.env.SEED_DEMO_DATA === 'true') {
  await bootstrapSystemData();
  await seedDemoData();
  console.log('System bootstrapped and demo data seeded');
}

const app = express();
let accepting = true;
if (trustProxy) app.set('trust proxy', trustProxy);

// ── Security & Parsing ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: isProduction
    ? (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin))
    : '*',
  credentials: isProduction,
}));

// ── Global Rate Limit (100 req/min per IP, configurable via RATE_LIMIT_MAX) ──
app.use(rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте через минуту' }
}));
app.use(express.json({ limit: '15mb' }));
app.use(requestObservability);
app.use((req, res, next) => {
  if (!accepting && !['/health', '/ready', '/live'].includes(req.path)) return res.status(503).json({ error: 'Server is shutting down' });
  return next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/feed',        feedRouter);
app.use('/posts',       postsRouter);
app.use('/posts',       likesRouter);       // POST /posts/:id/like
app.use('/posts',       commentsRouter);    // GET/POST /posts/:id/comments
app.use('/comments',    commentActionsRouter);
app.use('/users',       followsRouter);     // POST /users/:id/follow
app.use('/users',       profilesRouter);    // GET /users/:id/profile etc.
app.use('/messages',    messagesRouter);
app.use('/moderation',  moderationRouter);
app.use('/colorings',   coloringsRouter);
app.use('/collections', creatorCollectionsRouter);
app.use('/meta',        metaRouter);
app.use('/unlocks',     unlocksRouter);
app.use('/director',    directorRouter);
app.use('/media',       mediaRouter);

// ── Health and readiness ─────────────────────────────────────────────────────
app.get('/live', (_req, res) => res.json({ status: 'alive' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

let readinessCache = { at: 0, result: null };
app.get('/ready', asyncRoute(async (_req, res) => {
  if (Date.now() - readinessCache.at > 30_000 || !readinessCache.result) {
    const checks = {};
    try { await get('SELECT 1'); checks.database = 'ok'; } catch { checks.database = 'error'; }
    try { await checkMediaStorage(); checks.object_storage = 'ok'; } catch { checks.object_storage = 'error'; }
    checks.configuration = isProduction ? 'ok' : 'development';
    readinessCache = { at: Date.now(), result: { ready: Object.values(checks).every((value) => value === 'ok' || value === 'development'), checks } };
  }
  return res.status(readinessCache.result.ready ? 200 : 503).json(readinessCache.result);
}));
app.get('/metrics', (_req, res) => res.json(metricsSnapshot()));

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error({
    method: req.method,
    path: req.originalUrl,
    error_class: safeErrorClass(err),
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(
    Number.isInteger(err.status)
      ? err.status
      : 500,
  ).json({
    error:
      err.publicMessage ||
      'Внутренняя ошибка сервера',
  });
});

const server = app.listen(PORT, () => {
  console.log(`Splint API server running on http://localhost:${PORT}`);
});

// ── Tiled guidance index backfill (bounded background job) ────────────────
// Templates created before migration 021 have no static guidance index. The
// backfill is idempotent (completion marker), restartable (one template per
// transaction), and throttled so it never saturates the request path. The
// guidance endpoint also performs a bounded one-template build as a safety
// net, so the first open of an old 1200x1200 template works even before this
// job reaches it. Disable with GUIDANCE_BACKFILL_AUTO=false.
import { backfillGuidanceIndex } from './services/tiled-guidance-backfill.js';
let guidanceBackfillTimer = null;
if (process.env.GUIDANCE_BACKFILL_AUTO !== 'false') {
  const backfillBudget = Number(process.env.GUIDANCE_BACKFILL_BUDGET || 0);
  const backfillDelay = Math.max(50, Number(process.env.GUIDANCE_BACKFILL_DELAY_MS) || 300);
  let backfilledCount = 0;
  let backfillStopped = false;
  const guidanceBackfillTick = async () => {
    if (backfillStopped) return;
    try {
      // The backfill service consumes the small { get, all, run } adapter
      // contract; getDb() is the storage handle ({ mode, sqlite, pool }).
      const result = await backfillGuidanceIndex({ get, all }, { limit: 1, templateLimit: 1 });
      backfilledCount += result.processed;
      if (result.processed === 0 || (backfillBudget > 0 && backfilledCount >= backfillBudget)) {
        backfillStopped = true;
        console.log(`Tiled guidance backfill finished: ${backfilledCount} template(s), ${result.remaining} remaining`);
        return;
      }
    } catch (error) {
      console.error(JSON.stringify({ type: 'guidance_backfill_error', error_class: safeErrorClass(error), message: error.message }));
    }
    guidanceBackfillTimer = setTimeout(guidanceBackfillTick, backfillDelay);
    guidanceBackfillTimer.unref?.();
  };
  guidanceBackfillTimer = setTimeout(guidanceBackfillTick, 1_500);
  guidanceBackfillTimer.unref?.();
}

// ── Test-only e2e seed hooks ───────────────────────────────────────────────
// Mounted only when E2E_SEED_HOOKS=true (e2e runtime); never in production.
if (process.env.E2E_SEED_HOOKS === 'true') {
  const e2eHooksRouter = (await import('./routes/e2e-hooks.js')).default;
  app.use('/__e2e', e2eHooksRouter);
  console.log('E2E seed hooks enabled');
}

const cleanupTimer = setInterval(() => cleanupExpiredPaymentRequests().catch(() => {}), 15 * 60 * 1000);
cleanupTimer.unref?.();

// Durable render worker. Disabled by default outside production so integration
// tests stay deterministic; production defaults to enabled.
const renderOutboxEnabled = process.env.RENDER_OUTBOX_ENABLED === 'true'
  || (isProduction && process.env.RENDER_OUTBOX_ENABLED !== 'false');
const renderOutboxPollMs = Math.max(50, Number(process.env.RENDER_OUTBOX_POLL_MS) || 5_000);
const renderOutboxWorkerId = `api-${process.pid}`;
let renderOutboxTimer = null;
if (renderOutboxEnabled) {
  const renderOutboxTick = async () => {
    try {
      await drainRenderJobs({ withTransaction: withDbTransaction }, {
        workerId: renderOutboxWorkerId,
        batchSize: Number(process.env.RENDER_OUTBOX_BATCH_SIZE) || 16,
      });
    } catch (error) {
      console.error(JSON.stringify({ type: 'render_outbox_error', error_class: safeErrorClass(error) }));
    }
  };
  renderOutboxTick();
  renderOutboxTimer = setInterval(renderOutboxTick, renderOutboxPollMs);
  renderOutboxTimer.unref?.();
  console.log(`Render outbox worker enabled (poll ${renderOutboxPollMs}ms)`);
}

async function gracefulShutdown(signal) {
  if (!accepting) return;
  accepting = false;
  readinessCache = { at: Date.now(), result: { ready: false, checks: { shutdown: 'in_progress' } } };
  clearInterval(cleanupTimer);
  if (renderOutboxTimer) clearInterval(renderOutboxTimer);
  const timeout = setTimeout(() => process.exit(1), Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000);
  try {
    await new Promise((resolve) => server.close(resolve));
    await closeDb();
    clearTimeout(timeout);
    console.log(JSON.stringify({ type: 'shutdown', signal, forced: false }));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ type: 'shutdown', signal, forced: true, error_class: safeErrorClass(error) }));
    process.exit(1);
  }
}

process.once('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.once('SIGINT', () => { gracefulShutdown('SIGINT'); });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nERROR: Port ${PORT} is already in use.`);
    console.error('Another process is already listening on this port.');
    console.error('');
    console.error('To resolve:');
    console.error(`  1. Find the process: Get-NetTCPConnection -LocalPort ${PORT} -State Listen`);
    console.error('  2. Kill it by PID: taskkill /PID <pid> /T /F');
    console.error('  3. Then restart: npm run dev:api');
    console.error('');
    process.exit(1);
  }
  throw err;
});
