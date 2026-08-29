// server/routes/director.js — guided-path Next Best Action.
import { Router } from 'express';
import { withDbTransaction } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { buildNextBestAction } from '../services/director.js';

const router = Router();

// GET /director/next — bounded primary action, secondary choices, unlock preview.
router.get('/next', authMiddleware, asyncRoute(async (req, res) => {
  const exclude = typeof req.query.exclude === 'string'
    ? req.query.exclude.slice(0, 100)
    : null;
  const result = await withDbTransaction((tx) => buildNextBestAction(tx, req.userId, {
    excludeTemplateId: exclude,
  }));
  res.json(result);
}));

export default router;
