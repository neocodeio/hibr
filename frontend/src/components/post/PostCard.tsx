import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FavouriteIcon, BubbleChatIcon, Share01Icon } from 'hugeicons-react';

import { useAuth } from '../../lib/AuthContext';
import { formatRelativeTime } from '../../lib/date';
import { getProfilePath } from '../../lib/posts';
import type { Post } from '../../types';
import ShareModal from './ShareModal';
import './PostCard.css';

interface PostCardProps {
  post: Post;
}

function getInitial(name: string): string {
  return name.trim().charAt(0);
}

function PostCard({ post }: PostCardProps) {
  const { isAuthenticated, requireAuth } = useAuth();
  const [isShareOpen, setIsShareOpen] = useState(false);
  const titleId = `post-card-title-${post.id}`;

  const handleLike = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) requireAuth();
  };

  const handleComment = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) requireAuth();
  };

  const handleShare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsShareOpen(true);
  };

  return (
    <article className="post-card" aria-labelledby={titleId}>

      {/* Author row */}
      <Link
        to={getProfilePath(post.author)}
        className="post-card__author-row"
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

      {/* Content */}
      <Link to={`/post/${post.slug}`} className="post-card__content">
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
            className="post-card__action"
            onClick={handleLike}
            aria-label={`أعجبني — ${post.likesCount}`}
          >
            <FavouriteIcon size={18} strokeWidth={1.5} />
            <span className="post-card__action-count">{post.likesCount}</span>
          </button>

          <button
            type="button"
            className="post-card__action"
            onClick={handleComment}
            aria-label={`تعليقات — ${post.commentsCount}`}
          >
            <BubbleChatIcon size={18} strokeWidth={1.5} />
            <span className="post-card__action-count">{post.commentsCount}</span>
          </button>

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
