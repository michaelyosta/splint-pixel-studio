// server/routes/feed.js — GET /feed/recommended  GET /feed/following
import { Router } from 'express';
import { all, get } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/asyncRoute.js';

const router = Router();

async function enrichPost(post, userId) {
  const author  = await get('SELECT id,nickname,avatar_url,karma,messages_disabled,followers_only,paid_open,price_in_stars FROM users WHERE id=?', [post.author_id]);
  let artwork = post.artwork_id ? await get('SELECT * FROM artworks WHERE id=?', [post.artwork_id]) : null;
  if (artwork && (!artwork.image_url || (artwork.image_url.startsWith('data:') && artwork.image_url.length < 100))) {
    const template = artwork.collection_id ? await get('SELECT preview_url FROM coloring_templates WHERE id=?', [artwork.collection_id]) : null;
    const fallback = template?.preview_url && (!template.preview_url.startsWith('data:') || template.preview_url.length >= 100) ? template.preview_url : '/assets/catalog/neon-cat-pixel.png';
    artwork = { ...artwork, image_url: fallback };
  }
  const isLiked = !!await get('SELECT 1 FROM likes WHERE user_id=? AND post_id=?', [userId, post.id]);
  const isFollowing = !!await get('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?', [userId, post.author_id]);
  return { ...post, author, artwork, is_liked: isLiked, is_following: isFollowing };
}

// GET /feed/recommended
router.get('/recommended', authMiddleware, asyncRoute(async (req, res) => {
  const posts = await all(`SELECT * FROM posts WHERE status='active' ORDER BY (like_count*2 + comment_count*5) DESC, published_at DESC LIMIT 50`);
  res.json(await Promise.all(posts.map((post) => enrichPost(post, req.userId))));
}));

// GET /feed/following
router.get('/following', authMiddleware, asyncRoute(async (req, res) => {
  const posts = await all(`
    SELECT p.* FROM posts p
    INNER JOIN follows f ON f.following_id = p.author_id
    WHERE f.follower_id=? AND p.status='active'
    ORDER BY p.published_at DESC LIMIT 50
  `, [req.userId]);
  res.json(await Promise.all(posts.map((post) => enrichPost(post, req.userId))));
}));

export default router;
