import { Link } from 'react-router-dom';
import { FavouriteIcon, BubbleChatIcon, Share01Icon } from 'hugeicons-react';

import { useAuth } from '../../lib/AuthContext';
import type { Post } from '../../types';
import './PostCard.css';

interface PostCardProps {
  post: Post;
}

function getInitial(name: string): string {
  return name.trim().charAt(0);
}

function PostCard({ post }: PostCardProps) {
  const { isAuthenticated, requireAuth } = useAuth();

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
    if (!isAuthenticated) requireAuth();
  };

  return (
    <article className="post-card">

      {/* Author row */}
      <div className="post-card__author-row">
        <div className="post-card__avatar" aria-hidden="true">
          {post.author.avatarUrl ? (
            <img
              className="post-card__avatar-image"
              src={post.author.avatarUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            getInitial(post.author.name)
          )}
        </div>
        <div className="post-card__author-meta">
          <span className="post-card__author-name">{post.author.name}</span>
          <span className="post-card__date">{post.publishedAt}</span>
        </div>
      </div>

      {/* Content */}
      <Link to={`/post/${post.slug}`} className="post-card__content">
        <h2 className="post-card__title">{post.title}</h2>
        <p className="post-card__excerpt">{post.excerpt}</p>
      </Link>

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
          >
            <Share01Icon size={18} strokeWidth={1.5} />
          </button>
        </div>

        <span className="post-card__read-time">{post.readTime} د قراءة</span>
      </div>
    </article>
  );
}

export default PostCard;
