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
import {
  fetchPostsStats,
  fetchComments,
  addComment,
  subscribePostsRealtime,
} from '../lib/interactions';
import { usePostLike } from '../lib/usePostLike';
import type { Post, PostComment } from '../types';
import ShareModal from '../components/post/ShareModal';
import Button from '../components/ui/Button';
import './PostPage.css';

function getInitial(name: string): string {
  return name.trim().charAt(0);
}

function scrollToComments() {
  document.getElementById('comments')?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
    block: 'start',
  });
}

function PostPage() {
  const { slug } = useParams<{ slug: string }>();
  const {
    isAuthenticated,
    user,
    requireAuth,
    openSignInModal,
    getSupabaseToken,
  } = useAuth();

  const [post, setPost] = useState<Post | null>(null);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isShareOpen, setIsShareOpen] = useState(false);

  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentsCount, setCommentsCount] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);
  const [commentError, setCommentError] = useState('');

  const like = usePostLike(
    post?.id || '',
    user?.id ?? null,
    getSupabaseToken,
    false,
    post?.likesCount || 0
  );
  const { sync: syncLike } = like;

  // Reset the comments loading flag whenever a different post is shown
  // (render-phase derived state — the effect below only clears it).
  if (post && commentsPostId !== post.id) {
    setCommentsPostId(post.id);
    setCommentsLoading(true);
  }

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
              username: data.author?.username || null,
            },
            tags: Array.isArray(data.tags)
              ? data.tags
                  .filter((tag: unknown): tag is string => typeof tag === 'string')
                  .slice(0, 5)
              : undefined,
          };
          setPost(formattedPost);
          setContent(data.content || data.excerpt || '');
          setCommentsCount(formattedPost.commentsCount);
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

  // Live like state + comments once the post identity is known,
  // kept fresh by a realtime subscription (no refresh needed).
  useEffect(() => {
    const postId = post?.id;
    if (!postId) return;
    let cancelled = false;
    const uid = isAuthenticated && user ? user.id : null;

    const refresh = async () => {
      try {
        const stats = await fetchPostsStats([postId], uid);
        if (cancelled) return;
        syncLike(stats.likedIds.has(postId), stats.likesCounts.get(postId));
        const cc = stats.commentsCounts.get(postId);
        if (cc !== undefined) setCommentsCount(cc);
      } catch (err) {
        console.warn('Error fetching post stats:', err);
      }

      try {
        const rows = await fetchComments(postId);
        if (!cancelled) setComments(rows);
      } catch (err) {
        console.warn('Error fetching comments:', err);
      }
    };

    void refresh().finally(() => {
      if (!cancelled) setCommentsLoading(false);
    });
    const unsubscribe = subscribePostsRealtime([postId], () => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [post?.id, isAuthenticated, user, syncLike]);

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

  const handleLike = () => {
    if (!isAuthenticated || !user) {
      requireAuth();
      return;
    }
    void like.toggle();
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      requireAuth();
      return;
    }
    if (commentPosting) return;
    setCommentPosting(true);
    setCommentError('');

    try {
      const token = await getSupabaseToken();
      const created = await addComment(post.id, user.id, commentDraft, token);
      setComments((prev) => [...prev, created]);
      setCommentsCount((c) => c + 1);
      setCommentDraft('');
    } catch (err: unknown) {
      setCommentError(
        err instanceof Error && err.message
          ? err.message
          : 'تعذر نشر التعليق، يرجى المحاولة مرة أخرى.'
      );
    } finally {
      setCommentPosting(false);
    }
  };

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
                className={`post-page__action${like.liked ? ' post-page__action--liked' : ''}`}
                onClick={handleLike}
                aria-pressed={like.liked}
                aria-label={`أعجبني — ${like.likesCount}`}
              >
                <FavouriteIcon
                  size={18}
                  strokeWidth={1.5}
                  fill={like.liked ? 'currentColor' : 'none'}
                />
                <span className="post-page__action-label">{like.likesCount}</span>
              </button>

              <button
                type="button"
                className="post-page__action"
                onClick={scrollToComments}
                aria-label={`تعليقات — ${commentsCount}`}
              >
                <BubbleChatIcon size={18} strokeWidth={1.5} />
                <span className="post-page__action-label">
                  {commentsCount} تعليق
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

        <section
          id="comments"
          className="post-page__comments"
          aria-label="التعليقات"
        >
          <h2 className="post-page__comments-title">
            التعليقات
            <span className="post-page__comments-count">({commentsCount})</span>
          </h2>

          {isAuthenticated && user ? (
            <form
              className="post-page__comment-form"
              onSubmit={handleCommentSubmit}
            >
              {commentError && (
                <p className="post-page__comment-error" role="alert">
                  {commentError}
                </p>
              )}
              <label htmlFor="comment-text" className="sr-only">
                اكتب تعليقك
              </label>
              <textarea
                id="comment-text"
                className="post-page__comment-input"
                rows={3}
                placeholder="شارك رأيك في المقال..."
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                disabled={commentPosting}
              />
              <div className="post-page__comment-actions">
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={commentPosting || !commentDraft.trim()}
                >
                  {commentPosting ? 'جاري النشر...' : 'نشر التعليق'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="post-page__comment-signin">
              <p>سجّل دخولك للمشاركة في النقاش.</p>
              <Button variant="ghost" size="sm" onClick={openSignInModal}>
                سجّل دخولك للتعليق
              </Button>
            </div>
          )}

          <div className="post-page__comment-list">
            {commentsLoading ? (
              <p className="post-page__comment-status">جاري تحميل التعليقات...</p>
            ) : comments.length === 0 ? (
              <p className="post-page__comment-status">
                لا توجد تعليقات بعد. كن أول من يعلّق.
              </p>
            ) : (
              comments.map((comment) => (
                <article key={comment.id} className="post-page__comment">
                  <div
                    className="post-page__comment-avatar"
                    aria-hidden="true"
                  >
                    {comment.author.avatarUrl ? (
                      <img
                        src={comment.author.avatarUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span>{getInitial(comment.author.name)}</span>
                    )}
                  </div>
                  <div className="post-page__comment-content">
                    <div className="post-page__comment-meta">
                      <Link
                        to={getProfilePath(comment.author)}
                        className="post-page__comment-author"
                      >
                        {comment.author.name}
                      </Link>
                      <time
                        className="post-page__comment-date"
                        dateTime={comment.createdAt}
                      >
                        {formatRelativeTime(comment.createdAt)}
                      </time>
                    </div>
                    <p className="post-page__comment-text">{comment.content}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <ShareModal post={isShareOpen ? post : null} onClose={() => setIsShareOpen(false)} />
    </main>
  );
}

export default PostPage;
