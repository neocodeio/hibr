import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FavouriteIcon,
  BubbleChatIcon,
  Share01Icon,
  Bookmark02Icon,
  ArrowRight01Icon,
  Clock01Icon,
} from 'hugeicons-react';
import { useAuth } from '../lib/AuthContext';
import { useSocial } from '../lib/SocialContext';
import { supabase } from '../lib/supabase';
import { formatRelativeTime } from '../lib/date';
import { getProfilePath, normalizeSlugParam } from '../lib/posts';
import {
  fetchPostsStats,
  fetchComments,
  addComment,
  updateComment,
  subscribePostsRealtime,
} from '../lib/interactions';
import { usePostLike } from '../lib/usePostLike';
import { notifyLikeChange, notifyNewComment } from '../lib/notifications';
import { renderMarkdown } from '../lib/markdown';
import { useDocumentMeta } from '../lib/documentMeta';
import type { Post, PostComment } from '../types';
import ShareModal from '../components/post/ShareModal';
import Button from '../components/ui/Button';
import './PostPage.css';

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0) : 'ح';
}

function scrollToComments() {
  document.getElementById('comments')?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
    block: 'start',
  });
}

function formatReadTime(minutes: number): string {
  if (minutes <= 1) return 'دقيقة';
  if (minutes === 2) return 'دقيقتين';
  if (minutes <= 10) return `${minutes} دقايق`;
  return `${minutes} دقيقة`;
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
  const [readProgress, setReadProgress] = useState(0);
  const [coverOk, setCoverOk] = useState(true);

  const bodyHtml = useMemo(() => renderMarkdown(content), [content]);

  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentsCount, setCommentsCount] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyPosting, setReplyPosting] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Single-level threads: top-level comments with their replies grouped.
  const topComments = useMemo(
    () => comments.filter((c) => !c.parentId),
    [comments]
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, PostComment[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [comments]);

  const like = usePostLike(
    post?.id || '',
    user?.id ?? null,
    getSupabaseToken,
    false,
    post?.likesCount || 0
  );
  const { sync: syncLike } = like;
  const { bookmarkIds, bookmarksOn, toggleBookmark } = useSocial();
  useDocumentMeta(post?.title, post?.excerpt || undefined, post?.coverImageUrl || undefined);

  // Reset the comments loading flag whenever a different post is shown
  // (render-phase derived state — the effect below only clears it).
  if (post && commentsPostId !== post.id) {
    setCommentsPostId(post.id);
    setCommentsLoading(true);
  }

  // Reading progress bar — pure scroll position, no layout side effects.
  useEffect(() => {
    if (!post) return;
    const onScroll = () => {
      const el = document.documentElement;
      const total = el.scrollHeight - el.clientHeight;
      if (total <= 0) {
        setReadProgress(0);
        return;
      }
      const pct = Math.min(1, Math.max(0, el.scrollTop / total));
      setReadProgress(pct);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [post]);

  useEffect(() => {
    async function loadPost() {
      if (!slug) return;
      setIsLoading(true);

      // Shared links may arrive percent-encoded (Arabic slugs) while the DB
      // stores the raw value — try the decoded form first, then the raw
      // param, so old and new links both resolve.
      const decoded = normalizeSlugParam(slug);
      const candidates = decoded === slug ? [slug] : [decoded, slug];

      try {
        type PostRow = {
          id: string;
          slug: string;
          title: string;
          excerpt?: string | null;
          content?: string | null;
          published_at?: string | null;
          read_time?: number | null;
          likes_count?: number | null;
          comments_count?: number | null;
          author_id?: string | null;
          tags?: unknown;
          is_published?: boolean | null;
          cover_image_url?: string | null;
          author?: {
            id?: string | null;
            name?: string | null;
            avatar_url?: string | null;
            username?: string | null;
          } | null;
        };
        let data: PostRow | null = null;
        for (const candidate of candidates) {
          const result = await supabase
            .from('posts')
            .select('*, author:users!posts_author_id_fkey(*)')
            .eq('slug', candidate)
            .maybeSingle();
          if (result.data && !result.error) {
            data = result.data as PostRow;
            break;
          }
        }

        if (data) {
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
              id: data.author?.id || data.author_id || '',
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
            isPublished: data.is_published !== false,
            coverImageUrl:
              typeof data.cover_image_url === 'string' && data.cover_image_url
                ? data.cover_image_url
                : undefined,
          };
          setPost(formattedPost);
          setContent(data.content || data.excerpt || '');
          setCoverOk(true);
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
          <span className="sr-only">نحمّل المقال...</span>
          <div className="post-page__skeleton" aria-hidden="true">
            <div className="post-page__skeleton-pill" />
            <div className="post-page__skeleton-title" />
            <div className="post-page__skeleton-title post-page__skeleton-title--short" />
            <div className="post-page__skeleton-author">
              <div className="post-page__skeleton-avatar" />
              <div className="post-page__skeleton-meta" />
            </div>
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
          <p className="post-page__not-found-kicker">404</p>
          <h1>المقال مو موجود</h1>
          <p>ما لقينا المقال اللي تدور عليه. يمكن انحذف أو تغيّر رابطه.</p>
          <Link to="/" className="post-page__back post-page__back--center">
            <ArrowRight01Icon size={16} strokeWidth={2} />
            <span>ارجع للمقالات</span>
          </Link>
        </div>
      </main>
    );
  }

  const handleLike = async () => {
    if (!isAuthenticated || !user) {
      requireAuth();
      return;
    }
    const next = await like.toggle();
    if (next === null || !post) return;
    const token = await getSupabaseToken();
    notifyLikeChange(post.id, post.slug, post.author.id, user.id, token, next);
  };

  const isSaved = post ? bookmarkIds.has(post.id) : false;

  const handleBookmark = () => {
    if (post) void toggleBookmark(post.id);
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
      notifyNewComment({
        postId: post.id,
        postSlug: post.slug,
        commentId: created.id,
        postAuthorId: post.author.id,
        actorId: user.id,
        token,
        isReply: false,
      });
    } catch (err: unknown) {
      setCommentError(
        err instanceof Error && err.message
          ? err.message
          : 'ما قدرنا ننشر التعليق، حاول مرة ثانية.'
      );
    } finally {
      setCommentPosting(false);
    }
  };

  const openReply = (parent: PostComment) => {
    if (!user) {
      requireAuth();
      return;
    }
    setEditingCommentId(null);
    setReplyTo(parent.id);
    setReplyDraft('');
    setReplyError('');
  };

  const handleReplySubmit = async (e: React.FormEvent, parent: PostComment) => {
    e.preventDefault();
    if (!user) {
      requireAuth();
      return;
    }
    if (replyPosting) return;
    setReplyPosting(true);
    setReplyError('');

    try {
      const token = await getSupabaseToken();
      const created = await addComment(post.id, user.id, replyDraft, token, parent.id);
      setComments((prev) => [...prev, created]);
      setCommentsCount((c) => c + 1);
      setReplyDraft('');
      setReplyTo(null);
      notifyNewComment({
        postId: post.id,
        postSlug: post.slug,
        commentId: created.id,
        postAuthorId: post.author.id,
        parentAuthorId: parent.author.id,
        actorId: user.id,
        token,
        isReply: true,
      });
    } catch (err: unknown) {
      setReplyError(
        err instanceof Error && err.message
          ? err.message
          : 'ما قدرنا ننشر الرد، حاول مرة ثانية.'
      );
    } finally {
      setReplyPosting(false);
    }
  };

  const openEdit = (comment: PostComment) => {
    setReplyTo(null);
    setEditingCommentId(comment.id);
    setEditDraft(comment.content);
  };

  const handleEditSave = async (comment: PostComment) => {
    if (!user || editSaving) return;
    setEditSaving(true);
    try {
      const token = await getSupabaseToken();
      const updated = await updateComment(comment.id, user.id, editDraft, token);
      setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingCommentId(null);
    } catch (err: unknown) {
      setCommentError(
        err instanceof Error && err.message
          ? err.message
          : 'ما قدرنا نحفظ التعديل، حاول مرة ثانية.'
      );
    } finally {
      setEditSaving(false);
    }
  };



  return (
    <main className="post-page" id="main-content">
      <div
        className="post-page__progress"
        aria-hidden="true"
      >
        <span style={{ transform: `scaleX(${readProgress})` }} />
      </div>

      <div className="post-page__container">
        <nav className="post-page__topbar" aria-label="تنقل المقال">
          <Link to="/" className="post-page__back">
            <ArrowRight01Icon size={16} strokeWidth={2} />
            <span>المقالات</span>
          </Link>
          <button
            type="button"
            className="post-page__share-top"
            onClick={() => setIsShareOpen(true)}
            aria-label="مشاركة المقال"
          >
            <Share01Icon size={17} strokeWidth={1.75} />
            <span>مشاركة</span>
          </button>
        </nav>

        <article className="post-page__article">
          <header className="post-page__header">
            {post.tags && post.tags.length > 0 && (
              <div className="post-page__tags" aria-label="وسوم المقال">
                {post.tags.map((tag) => (
                  <span key={tag} className="post-page__tag">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <h1 className="post-page__title">{post.title}</h1>

            {post.excerpt && <p className="post-page__lede">{post.excerpt}</p>}

            <div className="post-page__byline">
              <Link
                to={getProfilePath(post.author)}
                className="post-page__author"
                aria-label={`الملف الشخصي لـ ${post.author.name}`}
              >
                <span className="post-page__avatar" aria-hidden="true">
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
                </span>
                <span className="post-page__author-text">
                  <span className="post-page__author-name">{post.author.name}</span>
                  <span className="post-page__meta">
                    <time dateTime={post.publishedAt}>
                      {formatRelativeTime(post.publishedAt)}
                    </time>
                    <span className="post-page__dot" aria-hidden="true">·</span>
                    <span className="post-page__readtime">
                      <Clock01Icon size={13} strokeWidth={2} />
                      {formatReadTime(post.readTime)}
                    </span>
                  </span>
                </span>
              </Link>
            </div>
          </header>

          {post.coverImageUrl && coverOk && (
            <figure className="post-page__cover">
              <img
                src={post.coverImageUrl}
                alt=""
                loading="lazy"
                onError={() => setCoverOk(false)}
              />
            </figure>
          )}

          <div
            className="post-page__body"
            // Sanitized by renderMarkdown (marked + DOMPurify) — no raw HTML
            // from the database ever reaches the DOM unsanitized.
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />

          <footer className="post-page__footer">
            <div className="post-page__actions" role="group" aria-label="التفاعل مع المقال">
              <button
                type="button"
                className={`post-page__action${like.liked ? ' post-page__action--liked' : ''}`}
                onClick={handleLike}
                aria-pressed={like.liked}
                aria-label={like.liked ? 'إلغاء الإعجاب' : 'أعجبني'}
              >
                <FavouriteIcon
                  size={18}
                  strokeWidth={1.75}
                  fill={like.liked ? 'currentColor' : 'none'}
                />
                <span className="post-page__action-label">{like.likesCount}</span>
              </button>

              <span className="post-page__divider" aria-hidden="true" />

              <button
                type="button"
                className="post-page__action"
                onClick={scrollToComments}
                aria-label={`التعليقات — ${commentsCount}`}
              >
                <BubbleChatIcon size={18} strokeWidth={1.75} />
                <span className="post-page__action-label">
                  {commentsCount}
                </span>
              </button>

              <span className="post-page__divider" aria-hidden="true" />

              <button
                type="button"
                className="post-page__action"
                onClick={() => setIsShareOpen(true)}
                aria-label="مشاركة المقال"
              >
                <Share01Icon size={18} strokeWidth={1.75} />
              </button>

              {bookmarksOn && (
                <>
                  <span className="post-page__divider" aria-hidden="true" />

                  <button
                    type="button"
                    className={`post-page__action${isSaved ? ' post-page__action--saved' : ''}`}
                    onClick={handleBookmark}
                    aria-pressed={isSaved}
                    aria-label={isSaved ? 'محفوظ' : 'احفظ المقال'}
                  >
                    <Bookmark02Icon
                      size={18}
                      strokeWidth={1.75}
                      fill={isSaved ? 'currentColor' : 'none'}
                    />
                  </button>
                </>
              )}
            </div>
            <p className="post-page__hint">عجبك المقال؟ شاركه مع اللي يستاهل يقراه.</p>
          </footer>
        </article>

        <section
          id="comments"
          className="post-page__comments"
          aria-label="التعليقات"
        >
          <div className="post-page__comments-head">
            <h2 className="post-page__comments-title">
              التعليقات
              <span className="post-page__comments-count">{commentsCount}</span>
            </h2>
          </div>

          {isAuthenticated && user ? (
            <form
              className="post-page__comment-form"
              onSubmit={handleCommentSubmit}
            >
              <div className="post-page__comment-box">
                <span className="post-page__comment-avatar" aria-hidden="true">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{getInitial(user.name)}</span>
                  )}
                </span>
                <div className="post-page__comment-field">
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
                    placeholder="عطنا رأيك بالمقال..."
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    disabled={commentPosting}
                  />
                  <div className="post-page__comment-actions">
                    <span className="post-page__comment-hint">
                     خلك راقي ومحترم بالنقاش
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      type="submit"
                      disabled={commentPosting || !commentDraft.trim()}
                    >
                      {commentPosting ? 'ننشر تعليقك...' : 'نشر التعليق'}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          ) : (
            <div className="post-page__comment-signin">
              <p>سجّل دخولك عشان تشارك بالنقاش.</p>
              <Button variant="ghost" size="sm" onClick={openSignInModal}>
                سجّل دخولك للتعليق
              </Button>
            </div>
          )}

          <div className="post-page__comment-list">
            {commentsLoading ? (
              <div className="post-page__comment-loading" aria-live="polite">
                <span className="post-page__spinner" aria-hidden="true" />
                نحمّل التعليقات...
              </div>
            ) : topComments.length === 0 ? (
              <div className="post-page__empty">
                <BubbleChatIcon size={22} strokeWidth={1.5} />
                <p>توه ما فيه تعليقات.<br />خلك أول واحد يبدأ النقاش.</p>
              </div>
            ) : (
              topComments.map((comment) => (
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
                    {editingCommentId === comment.id ? (
                      <div className="post-page__comment-edit">
                        <label htmlFor={`edit-${comment.id}`} className="sr-only">
                          عدّل تعليقك
                        </label>
                        <textarea
                          id={`edit-${comment.id}`}
                          className="post-page__comment-input post-page__comment-input--inline"
                          rows={2}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          disabled={editSaving}
                        />
                        <div className="post-page__comment-edit-actions">
                          <button
                            type="button"
                            className="post-page__comment-link"
                            onClick={() => setEditingCommentId(null)}
                            disabled={editSaving}
                          >
                            إلغاء
                          </button>
                          <Button
                            variant="primary"
                            size="sm"
                            type="button"
                            disabled={editSaving || !editDraft.trim()}
                            onClick={() => void handleEditSave(comment)}
                          >
                            {editSaving ? 'نحفظ...' : 'حفظ'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="post-page__comment-text">{comment.content}</p>
                    )}
                    <div className="post-page__comment-tools">
                      <button
                        type="button"
                        className="post-page__comment-link"
                        onClick={() => openReply(comment)}
                      >
                        رد
                      </button>
                      {user && user.id === comment.author.id && editingCommentId !== comment.id && (
                        <button
                          type="button"
                          className="post-page__comment-link"
                          onClick={() => openEdit(comment)}
                        >
                          تعديل
                        </button>
                      )}
                    </div>

                    {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                      <article key={reply.id} className="post-page__comment post-page__comment--reply">
                        <div
                          className="post-page__comment-avatar"
                          aria-hidden="true"
                        >
                          {reply.author.avatarUrl ? (
                            <img
                              src={reply.author.avatarUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span>{getInitial(reply.author.name)}</span>
                          )}
                        </div>
                        <div className="post-page__comment-content">
                          <div className="post-page__comment-meta">
                            <Link
                              to={getProfilePath(reply.author)}
                              className="post-page__comment-author"
                            >
                              {reply.author.name}
                            </Link>
                            <time
                              className="post-page__comment-date"
                              dateTime={reply.createdAt}
                            >
                              {formatRelativeTime(reply.createdAt)}
                            </time>
                          </div>
                          {editingCommentId === reply.id ? (
                            <div className="post-page__comment-edit">
                              <label htmlFor={`edit-${reply.id}`} className="sr-only">
                                عدّل ردك
                              </label>
                              <textarea
                                id={`edit-${reply.id}`}
                                className="post-page__comment-input post-page__comment-input--inline"
                                rows={2}
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                disabled={editSaving}
                              />
                              <div className="post-page__comment-edit-actions">
                                <button
                                  type="button"
                                  className="post-page__comment-link"
                                  onClick={() => setEditingCommentId(null)}
                                  disabled={editSaving}
                                >
                                  إلغاء
                                </button>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  type="button"
                                  disabled={editSaving || !editDraft.trim()}
                                  onClick={() => void handleEditSave(reply)}
                                >
                                  {editSaving ? 'نحفظ...' : 'حفظ'}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="post-page__comment-text">{reply.content}</p>
                          )}
                          {user && user.id === reply.author.id && editingCommentId !== reply.id && (
                            <div className="post-page__comment-tools">
                              <button
                                type="button"
                                className="post-page__comment-link"
                                onClick={() => openEdit(reply)}
                              >
                                تعديل
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}

                    {replyTo === comment.id && (
                      <form
                        className="post-page__reply-form"
                        onSubmit={(e) => void handleReplySubmit(e, comment)}
                      >
                        {replyError && (
                          <p className="post-page__comment-error" role="alert">
                            {replyError}
                          </p>
                        )}
                        <label htmlFor={`reply-${comment.id}`} className="sr-only">
                          اكتب ردك
                        </label>
                        <textarea
                          id={`reply-${comment.id}`}
                          className="post-page__comment-input post-page__comment-input--inline"
                          rows={2}
                          placeholder={`رد على ${comment.author.name}...`}
                          value={replyDraft}
                          onChange={(e) => setReplyDraft(e.target.value)}
                          disabled={replyPosting}
                          autoFocus
                        />
                        <div className="post-page__comment-edit-actions">
                          <button
                            type="button"
                            className="post-page__comment-link"
                            onClick={() => setReplyTo(null)}
                            disabled={replyPosting}
                          >
                            إلغاء
                          </button>
                          <Button
                            variant="primary"
                            size="sm"
                            type="submit"
                            disabled={replyPosting || !replyDraft.trim()}
                          >
                            {replyPosting ? 'ننشر الرد...' : 'نشر الرد'}
                          </Button>
                        </div>
                      </form>
                    )}
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
