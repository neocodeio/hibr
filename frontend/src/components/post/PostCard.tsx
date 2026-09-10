import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  FavouriteIcon,
  BubbleChatIcon,
  Share01Icon,
  MoreHorizontalIcon,
  Delete02Icon,
} from 'hugeicons-react';

import { useAuth } from '../../lib/AuthContext';
import { formatRelativeTime } from '../../lib/date';
import { getProfilePath, getPostPath, deletePostFromSupabase } from '../../lib/posts';
import { usePostLike } from '../../lib/usePostLike';
import type { Post } from '../../types';
import type { PostsStats } from '../../lib/interactions';
import ShareModal from './ShareModal';
import './PostCard.css';

interface PostCardProps {
  post: Post;
  onDeleted?: (postId: string) => void;
  stats?: PostsStats | null;
}

function getInitial(name: string): string {
  return name.trim().charAt(0);
}

function PostCard({ post, onDeleted, stats = null }: PostCardProps) {
  const { isAuthenticated, requireAuth, user, getSupabaseToken } = useAuth();
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [commentsCount, setCommentsCount] = useState(post.commentsCount);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleId = `post-card-title-${post.id}`;

  const isOwner = Boolean(isAuthenticated && user && user.id === post.author.id);
  const like = usePostLike(
    post.id,
    user?.id ?? null,
    getSupabaseToken,
    false,
    post.likesCount
  );

  // Live stats arrive after mount (one batch query per list). Apply them
  // during render (the documented derived-state pattern) so a late stats
  // object never leaves the card showing stale counts.
  const [appliedStats, setAppliedStats] = useState<PostsStats | null>(null);
  if (stats !== appliedStats) {
    setAppliedStats(stats);
    if (stats) {
      like.sync(stats.likedIds.has(post.id), stats.likesCounts.get(post.id));
      const cc = stats.commentsCounts.get(post.id);
      if (cc !== undefined) setCommentsCount(cc);
    }
  }

  // Close the owner menu on outside click or Escape.
  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleLike = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated || !user) {
      requireAuth();
      return;
    }
    void like.toggle();
  };

  const handleShare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsShareOpen(true);
  };

  const handleMenuToggle = () => {
    setDeleteError('');
    setIsMenuOpen((open) => !open);
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError('');

    try {
      const token = await getSupabaseToken();
      await deletePostFromSupabase(post.id, post.author.id, token);
      setIsMenuOpen(false);
      if (onDeleted) onDeleted(post.id);
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error && err.message
          ? err.message
          : 'حدث خطأ أثناء حذف المقال، يرجى المحاولة مرة أخرى.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <article
      className={`post-card${isMenuOpen ? ' post-card--menu-open' : ''}`}
      aria-labelledby={titleId}
    >

      {/* Author row */}
      <Link
        to={getProfilePath(post.author)}
        className={`post-card__author-row${isOwner ? ' post-card__author-row--with-menu' : ''}`}
        aria-label={`الملف الشخصي لـ ${post.author.name}`}
      >
        <div className="post-card__avatar" aria-hidden="true">
          {post.author.avatarUrl ? (
            <img
              className="post-card__avatar-image"
              src={post.author.avatarUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className="post-card__avatar-fallback">{getInitial(post.author.name)}</span>
          )}
        </div>
        <div className="post-card__author-meta">
          <span className="post-card__author-name">{post.author.name}</span>
          <div className="post-card__meta-info">
            <time className="post-card__date" dateTime={post.publishedAt}>
              {formatRelativeTime(post.publishedAt)}
            </time>
          </div>
        </div>
      </Link>

      {/* Owner menu (three dots → delete) */}
      {isOwner && (
        <div className="post-card__menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="post-card__menu-btn"
            onClick={handleMenuToggle}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            aria-label="خيارات المقال"
          >
            <MoreHorizontalIcon size={18} strokeWidth={1.5} />
          </button>

          {isMenuOpen && (
            <div className="post-card__menu" role="menu" aria-label="خيارات المقال">
              {deleteError && (
                <p className="post-card__menu-error" role="alert">
                  {deleteError}
                </p>
              )}
              <button
                type="button"
                className="post-card__menu-item post-card__menu-item--danger"
                role="menuitem"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Delete02Icon size={18} strokeWidth={1.5} />
                <span>{isDeleting ? 'جاري الحذف...' : 'حذف المقال'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <Link to={getPostPath(post)} className="post-card__content">
        <h2 className="post-card__title" id={titleId}>{post.title}</h2>
        <p className="post-card__excerpt">{post.excerpt}</p>
      </Link>

      {/* Tags */}
      {post.tags && post.tags.length > 0 && (
        <div className="post-card__tags">
          {post.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="post-card__tag">{tag}</span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="post-card__footer">
        <div className="post-card__actions">
          <button
            type="button"
            className={`post-card__action${like.liked ? ' post-card__action--liked' : ''}`}
            onClick={handleLike}
            aria-pressed={like.liked}
            aria-label={`أعجبني — ${like.likesCount}`}
          >
            <FavouriteIcon
              size={18}
              strokeWidth={1.5}
              fill={like.liked ? 'currentColor' : 'none'}
            />
            <span className="post-card__action-count">{like.likesCount}</span>
          </button>

          <Link
            to={`${getPostPath(post)}#comments`}
            className="post-card__action"
            aria-label={`تعليقات — ${commentsCount}`}
          >
            <BubbleChatIcon size={18} strokeWidth={1.5} />
            <span className="post-card__action-count">{commentsCount}</span>
          </Link>

          <button
            type="button"
            className="post-card__action"
            onClick={handleShare}
            aria-label="مشاركة"
            title="مشاركة"
          >
            <Share01Icon size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <ShareModal post={isShareOpen ? post : null} onClose={() => setIsShareOpen(false)} />
    </article>
  );
}

export default PostCard;
