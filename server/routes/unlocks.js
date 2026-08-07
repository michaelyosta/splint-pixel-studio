// server/routes/unlocks.js - bounded unlock state and next-actionable API.
import { Router } from 'express';
import { withDbTransaction } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import {
  getCollectionUnlockState,
  getTemplateUnlockState,
  getUserUnlockSnapshot,
  SUBJECT_COLLECTION,
  SUBJECT_TEMPLATE,
} from '../services/unlock-service.js';

const router = Router();

// GET /unlocks/me - current unlock state, bounded next-actionable unlocks.
router.get('/me', authMiddleware, asyncRoute(async (req, res) => {
  const snapshot = await withDbTransaction((tx) => getUserUnlockSnapshot(tx, req.userId));
  res.json(snapshot);
}));

// GET /unlocks/collections/:id - one collection's durable gate and progress.
router.get('/collections/:id', authMiddleware, asyncRoute(async (req, res) => {
  const result = await withDbTransaction(async (tx) => {
    const collection = await tx.get('SELECT * FROM collections WHERE id=?', [req.params.id]);
    if (!collection) return { notFound: true };
    const state = await getCollectionUnlockState(tx, req.userId, collection);
    return {
      subject_type: SUBJECT_COLLECTION,
      subject_id: collection.id,
      title: collection.title,
      ...state,
    };
  });
  if (result.notFound) return res.status(404).json({ error: 'Коллекция не найдена' });
  res.json(result);
}));

// GET /unlocks/templates/:id - one template's durable gate and progress.
router.get('/templates/:id', authMiddleware, asyncRoute(async (req, res) => {
  const result = await withDbTransaction(async (tx) => {
    const template = await tx.get(
      "SELECT id, owner_id, title, collection_id FROM coloring_templates WHERE id=? AND status='active'",
      [req.params.id],
    );
    if (!template) return { notFound: true };
    const state = await getTemplateUnlockState(tx, req.userId, template);
    return {
      subject_type: SUBJECT_TEMPLATE,
      subject_id: template.id,
      title: template.title,
      ...state,
    };
  });
  if (result.notFound) return res.status(404).json({ error: 'Раскраска не найдена' });
  res.json(result);
}));

export default router;
