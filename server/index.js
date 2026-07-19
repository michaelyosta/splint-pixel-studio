// server/index.js — Express entry point
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { getDb, initDb } from './db.js';

import feedRouter        from './routes/feed.js';
import postsRouter       from './routes/posts.js';
import likesRouter       from './routes/likes.js';
import commentsRouter    from './routes/comments.js';
import followsRouter     from './routes/follows.js';
import profilesRouter    from './routes/profiles.js';
import messagesRouter    from './routes/messages.js';
import moderationRouter  from './routes/moderation.js';
import coloringsRouter   from './routes/colorings.js';
import metaRouter        from './routes/meta.js';

const PORT = process.env.PORT || 3001;

// ── Init DB before serving ────────────────────────────────────────────────────
await initDb();
console.log(`✅  ${getDb().mode} database ready`);

const app = express();

// ── Security & Parsing ────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' })); // In production, restrict to your frontend domain
app.use(express.json({ limit: '15mb' }));

// ── Global Rate Limit (100 req/min per IP) ────────────────────────────────────
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте через минуту' }
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/feed',        feedRouter);
app.use('/posts',       postsRouter);
app.use('/posts',       likesRouter);       // POST /posts/:id/like
app.use('/posts',       commentsRouter);    // GET/POST /posts/:id/comments
app.use('/users',       followsRouter);     // POST /users/:id/follow
app.use('/users',       profilesRouter);    // GET /users/:id/profile etc.
app.use('/messages',    messagesRouter);
app.use('/moderation',  moderationRouter);
app.use('/colorings',   coloringsRouter);
app.use('/meta',        metaRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`🚀  Splint API server running on http://localhost:${PORT}`);
});
