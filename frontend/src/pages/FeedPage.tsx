import { useState, useEffect } from 'react';
import type { Post } from '../types';
import { fetchAllPosts } from '../lib/posts';
import { fetchPostsStats, subscribePostsRealtime } from '../lib/interactions';
import type { PostsStats } from '../lib/interactions';
import { useAuth } from '../lib/AuthContext';
import PostCard from '../components/post/PostCard';
import CreatePostModal from '../components/post/CreatePostModal';
import './FeedPage.css';

// const TABS = [
//   { id: 'all', label: 'الكل' },
//   { id: 'trending', label: 'ترند' },
//   { id: 'new', label: 'جديد' },
// ];

function FeedPage() {
  const { isCreatePostOpen, closeCreatePostModal, isAuthenticated, user } = useAuth();
  // const [activeTab, setActiveTab] = useState('all');
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<PostsStats | null>(null);

  useEffect(() => {
    async function loadPosts() {
      setIsLoading(true);
      const data = await fetchAllPosts();
      setPosts(data);
      setIsLoading(false);
    }
    loadPosts();
  }, []);

  // Live like states + counts for all visible posts (single batch query),
  // kept fresh by a realtime subscription (no refresh needed).
  // NOTE: no stats reset when the list empties — nothing renders then, and
  // the next non-empty list always triggers a fresh fetch below.
  useEffect(() => {
    if (posts.length === 0) return;
    let cancelled = false;
    const ids = posts.map((post) => post.id);
    const uid = isAuthenticated && user ? user.id : null;
    const refresh = () => {
      fetchPostsStats(ids, uid).then((s) => {
        if (!cancelled) setStats(s);
      });
    };
    refresh();
    const unsubscribe = subscribePostsRealtime(ids, refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [posts, isAuthenticated, user]);

  const handlePostCreated = (newPost: Post) => {
    setPosts((prev) => [newPost, ...prev]);
  };

  const handlePostDeleted = (postId: string) => {
    setPosts((prev) => prev.filter((post) => post.id !== postId));
  };

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
          {isLoading ? (
            <div className="feed__loading" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-muted)' }}>
              جاري تحميل المقالات...
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onDeleted={handlePostDeleted}
                stats={stats}
              />
            ))
          )}
        </section>

        {/* Post Creation Modal */}
        <CreatePostModal
          isOpen={isCreatePostOpen}
          onClose={closeCreatePostModal}
          onPostCreated={handlePostCreated}
        />
      </div>
    </main>
  );
}

export default FeedPage;
