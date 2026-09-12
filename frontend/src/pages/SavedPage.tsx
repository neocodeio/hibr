import { Link } from 'react-router-dom';
import { ArrowRight01Icon } from 'hugeicons-react';
import { useAuth } from '../lib/AuthContext';
import { usePosts } from '../lib/PostsContext';
import { useSocial } from '../lib/SocialContext';
import PostCard from '../components/post/PostCard';
import Button from '../components/ui/Button';
import { useDocumentMeta } from '../lib/documentMeta';
import './SavedPage.css';

function SavedPage() {
  const { isAuthenticated, openSignInModal } = useAuth();
  useDocumentMeta('المحفوظ', 'المقالات اللي حفظتها في حِبر.');
  const { posts, stats, isLoading, hasLoaded, removePost } = usePosts();
  const { bookmarkIds, bookmarksOn } = useSocial();

  const showInitialLoading = isLoading && !hasLoaded;

  if (!isAuthenticated) {
    return (
      <main className="saved-page" id="main-content">
        <div className="saved-page__empty">
          <h1>المحفوظ</h1>
          <p>سجّل دخولك عشان تشوف المقالات اللي حفظتها.</p>
          <Button variant="primary" size="sm" onClick={openSignInModal}>
            سجّل دخولك
          </Button>
        </div>
      </main>
    );
  }

  const saved = posts.filter((post) => bookmarkIds.has(post.id));

  return (
    <main className="saved-page" id="main-content">
      <div className="saved-page__wrapper">
        <div className="saved-page__bar">
          <h1>المحفوظ</h1>
        </div>

        <section className="saved-page__list" aria-label="المقالات المحفوظة">
          <h1 className="sr-only">المقالات المحفوظة</h1>
          {showInitialLoading || !bookmarksOn ? (
            <div
              className="saved-page__status"
              role="status"
              aria-live="polite"
            >
              {showInitialLoading ? 'نحمّل المقالات...' : 'الحفظ مو متاح الحين.'}
            </div>
          ) : saved.length === 0 ? (
            <div className="saved-page__empty-list">
              <p>ما عندك شي محفوظ للحين.</p>
              <p>احفظ المقالات اللي تعجبك وارجع لها هنا.</p>
              <Link to="/" className="saved-page__back">
                <ArrowRight01Icon size={16} strokeWidth={2} />
                <span>تصفّح المقالات</span>
              </Link>
            </div>
          ) : (
            saved.map((post) => (
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

export default SavedPage;
