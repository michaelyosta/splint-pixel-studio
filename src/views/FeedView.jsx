import { Flag, Heart, LoaderCircle, Send } from 'lucide-react';
import { DEV_USER_ID } from '../api/client';
import ArtworkPreview from '../components/ArtworkPreview';
import { formatTimeAgo } from '../lib/formatTime';
import { hapticSelection } from '../lib/telegram';

export default function FeedView({
  feed,
  feedMode,
  onChangeFeedMode,
  openProfile,
  onToggleFollow,
  followingAuthorId,
  onToggleLike,
  likingPostId,
  onToggleComments,
  openCommentsPostId,
  commentsByPost,
  onReport,
  onSubmitComment,
  commentDraft,
  onChangeCommentDraft,
  submittingComment,
  onRetryFeed,
  feedError,
  onNavigate,
  currentUser,
}) {
  const renderFeedLegacy = () => {
    const viewerId = currentUser?.id || DEV_USER_ID;
    return <section className="page"><div className="page-heading"><div><p className="eyebrow">СООБЩЕСТВО</p><h1>Лента работ</h1></div></div><div className="feed-list">{feed.map((post) => <article className="feed-post" key={post.id}><div className="post-author"><button className="author-button" onClick={() => openProfile(post.author_id)}><img loading="lazy" src={post.author?.avatar_url || '/favicon.svg'} alt="" /><span><b>{post.author?.nickname || 'Автор'}</b><small>{post.title}</small></span></button>{post.author_id !== viewerId && <button className="follow-button" style={{ minWidth: 120 }} disabled={followingAuthorId === post.author_id} aria-busy={followingAuthorId === post.author_id} onClick={() => onToggleFollow(post)}>{followingAuthorId === post.author_id ? <LoaderCircle className="spin" size={14} /> : post.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div><ArtworkPreview src={post.artwork?.image_url} alt={post.title} /><p>{post.caption}</p><div className="post-actions"><button className={`${post.is_liked ? 'liked' : ''} ${likingPostId === post.id ? 'loading' : ''}`} disabled={likingPostId === post.id} onClick={() => onToggleLike(post)} aria-label={post.is_liked ? 'Убрать лайк' : 'Поставить лайк'}><Heart size={18} fill={post.is_liked ? 'currentColor' : 'none'} /> {post.like_count}</button>{post.comments_enabled && <button onClick={() => onToggleComments(post.id)} aria-label="Комментарии"><Send size={17} /> {post.comment_count}</button>}<button className="report-button" onClick={() => onReport(post.id)} aria-label="Пожаловаться"><Flag size={16} /></button></div>{openCommentsPostId === post.id && <div className="comments-panel">{(commentsByPost[post.id] || []).map((comment) => <div className="comment-row" key={comment.id}><img loading="lazy" src={comment.author?.avatar_url || '/favicon.svg'} alt="" /><div className="comment-body"><div className="comment-meta"><b>{comment.author?.nickname || 'Автор'}</b>{comment.created_at && <span className="comment-time">{formatTimeAgo(comment.created_at)}</span>}</div><span>{comment.text}</span></div></div>)}{!(commentsByPost[post.id] || []).length && <p className="comments-empty">Пока нет комментариев.</p>}<form onSubmit={(event) => onSubmitComment(event, post.id)}><input value={commentDraft} maxLength="300" placeholder="Напишите комментарий" onChange={(event) => onChangeCommentDraft(event.target.value)} /><button type="submit" disabled={submittingComment}>{submittingComment ? <LoaderCircle className="spin" size={14} /> : '→'}</button></form></div>}</article>)}{!feed.length ? feedError ? <div className="error-retry"><p>Не удалось загрузить ленту</p><button className="secondary-button" onClick={onRetryFeed}>Повторить</button></div> : <p className="empty-state">Лента загружается…<button className="secondary-button" onClick={() => onNavigate('catalog')}>Перейти в каталог</button></p> : null}</div></section>;
  };

  if (import.meta.env.VITE_USE_LEGACY_FEED === 'true') return renderFeedLegacy();
  const viewerId = currentUser?.id || DEV_USER_ID;
  const feedTabs = [
    { id: 'recommended', label: 'Для вас' },
    { id: 'following', label: 'Подписки' },
  ];
  return <section className="page feed-page feed-page--redesigned">
    <div className="page-heading"><div><p className="eyebrow">СООБЩЕСТВО</p><h1>Работы людей</h1></div></div>
    <div className="feed-tabs" role="tablist" aria-label="Лента сообщества">{feedTabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={feedMode === tab.id} className={feedMode === tab.id ? 'active' : ''} onClick={() => { hapticSelection(); onChangeFeedMode(tab.id); }}>{tab.label}</button>)}</div>
    <div className="feed-list">{feed.map((post) => <article className="feed-post" key={post.id}>
      <div className="post-author"><button className="author-button" type="button" onClick={() => openProfile(post.author_id)}><img loading="lazy" src={post.author?.avatar_url || '/favicon.svg'} alt="" /><span><b>{post.author?.nickname || 'Автор'}</b><small>{formatTimeAgo(post.published_at || post.created_at) || post.title}</small></span></button>{post.author_id !== viewerId && <button className="follow-button" type="button" disabled={followingAuthorId === post.author_id} aria-busy={followingAuthorId === post.author_id} onClick={() => onToggleFollow(post)}>{followingAuthorId === post.author_id ? <LoaderCircle className="spin" size={14} /> : post.is_following ? 'Вы подписаны' : 'Подписаться'}</button>}</div>
      <ArtworkPreview src={post.artwork?.image_url} alt={post.title} />
      {post.caption && <p>{post.caption}</p>}
      <div className="post-actions"><button className={`${post.is_liked ? 'liked' : ''} ${likingPostId === post.id ? 'loading' : ''}`} type="button" disabled={likingPostId === post.id} onClick={() => onToggleLike(post)} aria-label={post.is_liked ? 'Убрать лайк' : 'Поставить лайк'}><Heart size={18} fill={post.is_liked ? 'currentColor' : 'none'} /> {post.like_count}</button>{post.comments_enabled && <button type="button" onClick={() => onToggleComments(post.id)} aria-label="Комментарии"><Send size={17} /> {post.comment_count}</button>}<button className="report-button" type="button" onClick={() => onReport(post.id)} aria-label="Пожаловаться"><Flag size={16} /></button></div>
      {openCommentsPostId === post.id && <div className="comments-panel">{(commentsByPost[post.id] || []).map((comment) => <div className="comment-row" key={comment.id}><img loading="lazy" src={comment.author?.avatar_url || '/favicon.svg'} alt="" /><div className="comment-body"><div className="comment-meta"><b>{comment.author?.nickname || 'Автор'}</b>{comment.created_at && <span className="comment-time">{formatTimeAgo(comment.created_at)}</span>}</div><span>{comment.text}</span></div></div>)}{!(commentsByPost[post.id] || []).length && <p className="comments-empty">Пока нет комментариев.</p>}<form onSubmit={(event) => onSubmitComment(event, post.id)}><input value={commentDraft} maxLength="300" placeholder="Напишите комментарий" onChange={(event) => onChangeCommentDraft(event.target.value)} /><button type="submit" disabled={submittingComment} aria-label="Отправить комментарий">{submittingComment ? <LoaderCircle className="spin" size={14} /> : '→'}</button></form></div>}
    </article>)}{!feed.length ? feedError ? <div className="error-retry"><p>Не удалось загрузить ленту</p><button className="secondary-button" type="button" onClick={onRetryFeed}>Повторить</button></div> : <div className="feed-empty"><span>✦</span><h2>{feedMode === 'following' ? 'Пока нет работ от подписок' : 'Лента готовится'}</h2><p>{feedMode === 'following' ? 'Подпишитесь на авторов, чтобы их новые работы появились здесь.' : 'Завершите картину и поделитесь ею с сообществом.'}</p><button className="secondary-button" type="button" onClick={() => onNavigate(feedMode === 'following' ? 'catalog' : 'create')}>{feedMode === 'following' ? 'Открыть каталог' : 'Создать работу'}</button></div> : null}</div>
  </section>;
}
