import { Router } from 'express';
import { get } from '../db.js';
import { asyncRoute } from '../middleware/asyncRoute.js';
import { readMediaObject } from '../services/media-storage.js';

const router = Router();

export function isCatalogDeliveryKey(storageKey) {
  const normalized = String(storageKey || '').replaceAll('\\', '/');
  const isPreview = normalized.startsWith('catalog/previews/');
  const isCover = normalized.startsWith('catalog/covers/') && !normalized.startsWith('catalog/covers/source/');
  if (!isPreview && !isCover) return false;
  return normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function contentTypeForKey(storageKey) {
  return /\.(jpe?g)$/i.test(storageKey) ? 'image/jpeg' : 'image/png';
}

// Only canonical artwork and catalog delivery objects are public. Original
// uploads, masters, and full-size catalog objects never pass this route.
router.get('/*', asyncRoute(async (req, res) => {
  const storageKey = req.params[0];
  if (isCatalogDeliveryKey(storageKey)) {
    let body;
    try {
      body = await readMediaObject(storageKey);
    } catch {
      return res.status(404).end();
    }
    if (!body) return res.status(404).end();
    res.set({
      'Content-Type': contentTypeForKey(storageKey),
      'Content-Length': String(body.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(body);
  }
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
