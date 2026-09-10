import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FavouriteIcon,
  BubbleChatIcon,
  Share01Icon,
  ArrowRight01Icon,
} from 'hugeicons-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { formatRelativeTime } from '../lib/date';
import { getProfilePath } from '../lib/posts';
import type { Post } from '../types';
import ShareModal from '../components/post/ShareModal';
import './PostPage.css';

function getInitial(name: string): string {
  return name.trim().charAt(0);
}

function PostPage() {
  const { slug } = useParams<{ slug: string }>();
  const { requireAuth } = useAuth();

  const [post, setPost] = useState<Post | null>(null);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isShareOpen, setIsShareOpen] = useState(false);

  useEffect(() => {
    async function loadPost() {
      if (!slug) return;
      setIsLoading(true);

      try {
        const { data, error } = await supabase
          .from('posts')
          .select('*, author:users!posts_author_id_fkey(*)')
          .eq('slug', slug)
          .single();

        if (data && !error) {
          const formattedPost: Post = {
            id: data.id,
            slug: data.slug,
            title: data.title,
            excerpt: data.excerpt || '',
            publishedAt: data.published_at || new Date().toISOString(),
            readTime: data.read_time || 5,
            likesCount: data.likes_count || 0,
            commentsCount: data.comments_count || 0,
            author: {
              id: data.author?.id || data.author_id,
              name: data.author?.name || 'كاتب حِبر',
              handle: (data.author?.name || 'author').toLowerCase().replace(/\s+/g, '-'),
              avatarUrl: data.author?.avatar_url || '',
            },
            tags: Array.isArray(data.tags)
              ? data.tags
                  .filter((tag: unknown): tag is string => typeof tag === 'string')
                  .slice(0, 5)
              : undefined,
          };
          setPost(formattedPost);
          setContent(data.content || data.excerpt || '');
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Error fetching post from Supabase:', err);
      }

      setIsLoading(false);
    }

    loadPost();
  }, [slug]);

  if (isLoading) {
    return (
      <main className="post-page" id="main-content">
        <div className="post-page__container" role="status" aria-live="polite">
          <span className="sr-only">جاري تحميل المقال...</span>
          <div className="post-page__skeleton" aria-hidden="true">
            <div className="post-page__skeleton-back" />
            <div className="post-page__skeleton-title" />
            <div className="post-page__skeleton-title post-page__skeleton-title--short" />
            <div className="post-page__skeleton-meta" />
            <div className="post-page__skeleton-line" />
            <div className="post-page__skeleton-line" />
            <div className="post-page__skeleton-line" />
            <div className="post-page__skeleton-line post-page__skeleton-line--short" />
          </div>
        </div>
      </main>
    );
  }

  if (!post) {
    return (
      <main className="post-page" id="main-content">
        <div className="post-page__not-found">
          <h1>المقال غير موجود</h1>
          <p>لم نتمكن من إيجاد المقال الذي تبحث عنه.</p>
          <Link to="/" className="post-page__back">
            <ArrowRight01Icon size={16} strokeWidth={2} />
            <span>العودة إلى المقالات</span>
          </Link>
        </div>
      </main>
    );
  }

  const paragraphs = content
    .split('\n')
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return (
    <main className="post-page" id="main-content">
      <div className="post-page__container">
        <Link to="/" className="post-page__back">
          <ArrowRight01Icon size={16} strokeWidth={2} />
          <span>العودة إلى المقالات</span>
        </Link>

        <article className="post-page__article">
          <header className="post-page__header">
            {post.tags && post.tags.length > 0 && (
              <div className="post-page__tags" aria-label="وسوم المقال">
                {post.tags.map((tag) => (
                  <span key={tag} className="post-page__tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <h1 className="post-page__title">{post.title}</h1>

            {post.excerpt && <p className="post-page__lede">{post.excerpt}</p>}

            <div className="post-page__author-row">
              <div className="post-page__avatar" aria-hidden="true">
                {post.author.avatarUrl ? (
                  <img
                    className="post-page__avatar-image"
                    src={post.author.avatarUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="post-page__avatar-fallback">
                    {getInitial(post.author.name)}
                  </span>
                )}
              </div>
              <div className="post-page__author-meta">
                <Link
                  to={getProfilePath(post.author)}
                  className="post-page__author-name"
                  aria-label={`الملف الشخصي لـ ${post.author.name}`}
                >
                  {post.author.name}
                </Link>
                <div className="post-page__meta">
                  <time dateTime={post.publishedAt}>
                    {formatRelativeTime(post.publishedAt)}
                  </time>
                </div>
              </div>
            </div>
          </header>

          <div className="post-page__body">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <footer className="post-page__footer">
            <div className="post-page__actions">
              <button
                type="button"
                className="post-page__action"
                onClick={() => requireAuth()}
                aria-label={`أعجبني — ${post.likesCount}`}
              >
                <FavouriteIcon size={18} strokeWidth={1.5} />
                <span className="post-page__action-label">{post.likesCount}</span>
              </button>

              <button
                type="button"
                className="post-page__action"
                onClick={() => requireAuth()}
                aria-label={`تعليقات — ${post.commentsCount}`}
              >
                <BubbleChatIcon size={18} strokeWidth={1.5} />
                <span className="post-page__action-label">
                  {post.commentsCount} تعليق
                </span>
              </button>

              <button
                type="button"
                className="post-page__action"
                onClick={() => setIsShareOpen(true)}
                aria-label="مشاركة المقال"
              >
                <Share01Icon size={18} strokeWidth={1.5} />
                <span className="post-page__action-label">مشاركة</span>
              </button>
            </div>
          </footer>
        </article>
      </div>

      <ShareModal post={isShareOpen ? post : null} onClose={() => setIsShareOpen(false)} />
    </main>
  );
}

export default PostPage;
