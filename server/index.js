// server/index.js — Express entry point
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { getDb, initDb, bootstrapSystemData, seedDemoData } from './db.js';

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
import { validateProductionConfiguration } from './config.js';

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
app.use('/meta',        metaRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error({
    method: req.method,
    path: req.originalUrl,
    error: err,
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
