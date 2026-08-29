import { Router } from 'express';
import { get } from '../db.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { readMediaObject } from '../services/media-storage.js';

const router = Router();

// Only canonical artwork objects are public. Original uploads never pass this route.
router.get('/*', asyncRoute(async (req, res) => {
  const storageKey = req.params[0];
  if (!storageKey?.startsWith('artworks/') && !storageKey?.startsWith('thumbnails/')) return res.status(404).end();

  const artwork = await get(`SELECT a.storage_key,a.thumbnail_key,a.mime_type,a.render_status
    FROM artworks a
    INNER JOIN posts p ON p.artwork_id=a.id
    WHERE (a.storage_key=? OR a.thumbnail_key=?) AND a.render_status='ready' AND p.status='active' AND p.visibility='public'
    LIMIT 1`, [storageKey, storageKey]);
  if (!artwork) return res.status(404).end();

  const mediaKey = storageKey === artwork.thumbnail_key ? artwork.thumbnail_key : artwork.storage_key;
  let body;
  try {
    body = await readMediaObject(mediaKey);
  } catch {
    return res.status(404).end();
  }
  if (!body) return res.status(404).end();
  res.set({
    'Content-Type': artwork.mime_type || 'image/png',
    'Content-Length': String(body.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(body);
}));

export default router;
