import { useState, useEffect } from 'react';
import type { Post } from '../types';
import { fetchAllPosts } from '../lib/posts';
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
  const { isCreatePostOpen, closeCreatePostModal } = useAuth();
  // const [activeTab, setActiveTab] = useState('all');
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPosts() {
      setIsLoading(true);
      const data = await fetchAllPosts();
      setPosts(data);
      setIsLoading(false);
    }
    loadPosts();
  }, []);

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
              <PostCard key={post.id} post={post} onDeleted={handlePostDeleted} />
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
