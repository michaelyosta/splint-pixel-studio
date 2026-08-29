import { useCallback, useState } from 'react';
import { api, metaApi } from '../api/client';
import { hapticImpact } from '../lib/telegram';

export function useFeedData({ showNotice }) {
  const [feed, setFeed] = useState([]);
  const [feedMode, setFeedMode] = useState('recommended');
  const [feedError, setFeedError] = useState(false);
  const [commentsByPost, setCommentsByPost] = useState({});
  const [openCommentsPostId, setOpenCommentsPostId] = useState(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [likingPostId, setLikingPostId] = useState(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [followingAuthorId, setFollowingAuthorId] = useState(null);

  const loadFeed = useCallback(async (mode = 'recommended') => {
    try {
      const page = await api(`/feed/${mode}?limit=20`);
      setFeed(Array.isArray(page) ? page : (page.items || []));
      setFeedError(false);
    } catch (error) {
      showNotice(error.message, 'error');
      setFeedError(true);
    }
  }, [showNotice]);

  const selectFeedMode = useCallback((mode) => {
    setFeedMode(mode);
    setOpenCommentsPostId(null);
  }, []);

  const toggleLike = useCallback(async (post) => {
    if (likingPostId) return;
    hapticImpact('light');
    setLikingPostId(post.id);
    try {
      await api(`/posts/${post.id}/like`, { method: post.is_liked ? 'DELETE' : 'POST' });
      loadFeed(feedMode);
      metaApi.track('like', { post: post.id });
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setLikingPostId(null);
    }
  }, [feedMode, likingPostId, loadFeed, showNotice]);

  const toggleComments = useCallback(async (postId) => {
    if (openCommentsPostId === postId) {
      setOpenCommentsPostId(null);
      return;
    }
    try {
      const comments = await api(`/posts/${postId}/comments`);
      setCommentsByPost((current) => ({ ...current, [postId]: comments }));
      setOpenCommentsPostId(postId);
      setCommentDraft('');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [openCommentsPostId, showNotice]);

  const submitComment = useCallback(async (event, postId) => {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!text || submittingComment) return;
    setSubmittingComment(true);
    try {
      const comment = await api(`/posts/${postId}/comments`, { method: 'POST', body: { text } });
      setCommentsByPost((current) => ({ ...current, [postId]: [...(current[postId] || []), comment] }));
      setCommentDraft('');
      setFeed((current) => current.map((post) => post.id === postId ? { ...post, comment_count: post.comment_count + 1 } : post));
      metaApi.track('comment', { post: postId });
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setSubmittingComment(false);
    }
  }, [commentDraft, showNotice, submittingComment]);

  const toggleFollow = useCallback(async (post) => {
    if (followingAuthorId) return;
    hapticImpact('light');
    setFollowingAuthorId(post.author_id);
    try {
      const result = await api(`/users/${post.author_id}/follow`, { method: 'POST' });
      const isFollowing = result.is_following;
      setFeed((current) => current.map((item) => item.author_id === post.author_id ? { ...item, is_following: isFollowing } : item));
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setFollowingAuthorId(null);
    }
  }, [followingAuthorId, showNotice]);

  const reportPost = useCallback(async (postId) => {
    try {
      await api(`/posts/${postId}/report`, { method: 'POST', body: { reason: 'other' } });
      showNotice('Жалоба отправлена на проверку', 'success');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [showNotice]);

  return {
    feed,
    feedMode,
    feedError,
    commentsByPost,
    openCommentsPostId,
    commentDraft,
    setCommentDraft,
    likingPostId,
    submittingComment,
    followingAuthorId,
    loadFeed,
    selectFeedMode,
    toggleLike,
    toggleComments,
    submitComment,
    toggleFollow,
    reportPost,
  };
}
