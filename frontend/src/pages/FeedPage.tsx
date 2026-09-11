import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PostCard from '../components/post/PostCard';
import { usePosts } from '../lib/PostsContext';
import { useAuth } from '../lib/AuthContext';
import { useSocial } from '../lib/SocialContext';
import './FeedPage.css';

type FeedTab = 'all' | 'following';

function pluralPosts(count: number): string {
  if (count === 1) return 'مقال';
  if (count === 2) return 'مقالين';
  if (count <= 10) return 'مقالات';
  return 'مقال';
}

function FeedPage() {
  // Posts are cached app-wide (PostsProvider loads once). Returning to the
  // feed never refetches — it renders the cached list instantly.
  const { posts, stats, isLoading, hasLoaded, removePost } = usePosts();
  const { isAuthenticated } = useAuth();
  const { followingIds, followsOn } = useSocial();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTag = searchParams.get('tag') ?? '';
  // Search query lives in the URL (?q=) — set from the navbar from anywhere.
  const query = searchParams.get('q') ?? '';
  const [feedTab, setFeedTab] = useState<FeedTab>('all');

  const showInitialLoading = isLoading && !hasLoaded;
  const showFollowingTab = isAuthenticated && followsOn;

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return posts.filter((post) => {
      if (feedTab === 'following' && !followingIds.has(post.author.id)) return false;
      if (activeTag && !(post.tags ?? []).includes(activeTag)) return false;
      if (words.length === 0) return true;
      const haystack =
        `${post.title}\n${post.excerpt}\n${post.author.name}\n${(post.tags ?? []).join(' ')}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [posts, query, activeTag, feedTab, followingIds]);

  const isFiltering = query.trim().length > 0 || activeTag.length > 0 || feedTab === 'following';

  const clearFilters = () => {
    setSearchParams({}, { replace: true });
    setFeedTab('all');
  };

  return (
    <main className="feed" id="main-content">
      <div className="feed__wrapper">
        {/* Tab bar */}
        <div className="feed__bar">
          <h1>المقالات</h1>
        </div>

        {/* Feed tabs */}
        {showFollowingTab && (
          <div className="feed__tabs" role="tablist" aria-label="نوع المقالات">
            <button
              type="button"
              role="tab"
              aria-selected={feedTab === 'all'}
              className={`feed__tab${feedTab === 'all' ? ' feed__tab--active' : ''}`}
              onClick={() => setFeedTab('all')}
            >
              الكل
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={feedTab === 'following'}
              className={`feed__tab${feedTab === 'following' ? ' feed__tab--active' : ''}`}
              onClick={() => setFeedTab('following')}
            >
              اللي أتابعهم
            </button>
          </div>
        )}

        {/* Active filter summary */}
        {isFiltering && !showInitialLoading && (
          <div className="feed__filter-meta">
            <span className="feed__filter-count">
              {filtered.length} {pluralPosts(filtered.length)}
              {activeTag ? ` بوسم ${activeTag}` : ''}
            </span>
            <button
              type="button"
              className="feed__filter-clear"
              onClick={clearFilters}
            >
              امسح الفلتر
            </button>
          </div>
        )}

        {/* Post list */}
        <section className="feed__list" aria-label="قائمة المقالات">
          <h1 className="sr-only">المقالات</h1>
          {showInitialLoading ? (
            <div className="feed__loading" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-muted)' }}>
              نحمّل المقالات...
            </div>
          ) : filtered.length === 0 ? (
            <div className="feed__loading" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-muted)' }}>
              {feedTab === 'following' && !query.trim() && !activeTag ? (
                followingIds.size === 0 ? (
                  <p>ما تتابع أحد للحين — تابع كتّاب يعجبونك وتشوف مقالاتهم هنا.</p>
                ) : (
                  <p>اللي تتابعهم ما نشروا شي للحين.</p>
                )
              ) : isFiltering ? (
                <>
                  <p style={{ marginBottom: '1rem' }}>ما لقينا شي يطابق بحثك.</p>
                  <button
                    type="button"
                    className="feed__filter-clear"
                    onClick={clearFilters}
                  >
                    امسح الفلتر
                  </button>
                </>
              ) : (
                'ما فيه مقالات للحين.'
              )}
            </div>
          ) : (
            filtered.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onDeleted={removePost}
                stats={stats}
              />
            ))
          )}
        </section>
      </div>
    </main>
  );
}

export default FeedPage;
