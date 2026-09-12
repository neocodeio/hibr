import { useMemo } from 'react';
import PostCard from '../components/post/PostCard';
import { usePosts } from '../lib/PostsContext';
import { useDocumentMeta } from '../lib/documentMeta';
import './FeedPage.css';

function scorePost(likes: number, comments: number): number {
  return likes * 2 + comments * 3;
}

function TrendingPage() {
  const { posts, stats, isLoading, hasLoaded, removePost } = usePosts();
  useDocumentMeta('الرائج', 'الأكثر تفاعلاً في حِبر — مقالات يقراها ويحبها الناس الحين.');
  const showInitialLoading = isLoading && !hasLoaded;

  const trending = useMemo(
    () =>
      [...posts]
        .filter((post) => post.isPublished !== false)
        .sort(
          (a, b) =>
            scorePost(b.likesCount, b.commentsCount) - scorePost(a.likesCount, a.commentsCount)
        )
        .slice(0, 20),
    [posts]
  );

  return (
    <main className="feed" id="main-content">
      <div className="feed__wrapper">
        <div className="feed__bar">
          <h1>الرائج</h1>
        </div>

        <section className="feed__list" aria-label="المقالات الرائجة">
          <h1 className="sr-only">المقالات الرائجة</h1>
          {showInitialLoading ? (
            <div className="feed__loading" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-muted)' }}>
              نحمّل المقالات...
            </div>
          ) : trending.length === 0 ? (
            <div className="feed__loading" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-muted)' }}>
              ما فيه مقالات للحين.
            </div>
          ) : (
            trending.map((post) => (
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

export default TrendingPage;
