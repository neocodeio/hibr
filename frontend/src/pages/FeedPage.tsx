import PostCard from '../components/post/PostCard';
import { usePosts } from '../lib/PostsContext';
import './FeedPage.css';

// const TABS = [
//   { id: 'all', label: 'الكل' },
//   { id: 'trending', label: 'ترند' },
//   { id: 'new', label: 'جديد' },
// ];

function FeedPage() {
  // Posts are cached app-wide (PostsProvider loads once). Returning to the
  // feed never refetches — it renders the cached list instantly.
  const { posts, stats, isLoading, hasLoaded, removePost } = usePosts();

  const showInitialLoading = isLoading && !hasLoaded;

  return (
    <main className="feed" id="main-content">
      <div className="feed__wrapper">
        {/* Tab bar */}
        <div className="feed__bar" role="tablist" aria-label="تصفية المقالات">
          {/* <div className="feed__tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`feed__tab${activeTab === tab.id ? ' feed__tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div> */}
          <h1>المقالات</h1>
        </div>

        {/* Post list */}
        <section className="feed__list" aria-label="قائمة المقالات">
          <h1 className="sr-only">المقالات</h1>
          {showInitialLoading ? (
            <div className="feed__loading" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-muted)' }}>
              جاري تحميل المقالات...
            </div>
          ) : posts.length === 0 ? (
            <div className="feed__loading" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-muted)' }}>
              لا توجد مقالات بعد.
            </div>
          ) : (
            posts.map((post) => (
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
