import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight01Icon } from 'hugeicons-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { formatDbPost } from '../lib/posts';
import type { Post } from '../types';
import PostCard from '../components/post/PostCard';
import Button from '../components/ui/Button';
import './ProfilePage.css';

interface ProfileUser {
  id: string;
  name: string;
  avatarUrl: string;
  username: string | null;
  handle: string;
}

function getInitial(name: string): string {
  return name.trim().charAt(0);
}

function ProfilePage() {
  const { username: profileKey } = useParams<{ username: string }>();
  const { user: currentUser, openCreatePostModal } = useAuth();

  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      if (!profileKey) return;
      setIsLoading(true);
      setNotFound(false);

      try {
        // 1. Pretty username lookup (works once the `username` column exists).
        const byUsername = await supabase
          .from('users')
          .select('id, name, avatar_url, username')
          .eq('username', profileKey)
          .single();

        let userRow = !byUsername.error && byUsername.data ? byUsername.data : null;

        // 2. Legacy fallback: raw user id (works with or without the column,
        //    so old /profile/:id links never break).
        if (!userRow) {
          const byId = await supabase
            .from('users')
            .select('id, name, avatar_url')
            .eq('id', profileKey)
            .single();
          if (!byId.error && byId.data) {
            userRow = { ...byId.data, username: null };
          }
        }

        if (!userRow) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }

        const name = userRow.name || 'كاتب حِبر';
        setProfile({
          id: userRow.id,
          name,
          avatarUrl: userRow.avatar_url || '',
          username: userRow.username || null,
          handle: userRow.username || name.toLowerCase().replace(/\s+/g, '-'),
        });

        try {
          const { data: postRows, error: postsError } = await supabase
            .from('posts')
            .select('*, author:users!posts_author_id_fkey(*)')
            .eq('author_id', userRow.id)
            .eq('is_published', true)
            .order('created_at', { ascending: false });

          if (!postsError && postRows) {
            setPosts(postRows.map(formatDbPost));
          }
        } catch (err) {
          console.warn('Error fetching profile posts from Supabase:', err);
        }
      } catch (err) {
        console.warn('Error fetching profile from Supabase:', err);
        setNotFound(true);
      }

      setIsLoading(false);
    }

    loadProfile();
  }, [profileKey]);

  if (isLoading) {
    return (
      <main className="profile-page" id="main-content">
        <div className="profile-page__container" role="status" aria-live="polite">
          <span className="sr-only">جاري تحميل الملف الشخصي...</span>
          <div className="profile-page__skeleton" aria-hidden="true">
            <div className="profile-page__skeleton-avatar" />
            <div className="profile-page__skeleton-name" />
            <div className="profile-page__skeleton-handle" />
            <div className="profile-page__skeleton-line" />
            <div className="profile-page__skeleton-line" />
            <div className="profile-page__skeleton-line profile-page__skeleton-line--short" />
          </div>
        </div>
      </main>
    );
  }

  if (notFound || !profile) {
    return (
      <main className="profile-page" id="main-content">
        <div className="profile-page__not-found">
          <h1>الحساب غير موجود</h1>
          <p>لم نتمكن من إيجاد الملف الشخصي الذي تبحث عنه.</p>
          <Link to="/" className="profile-page__back profile-page__back--centered">
            <ArrowRight01Icon size={16} strokeWidth={2} />
            <span>العودة إلى المقالات</span>
          </Link>
        </div>
      </main>
    );
  }

  const isOwnProfile = currentUser?.id === profile.id;

  return (
    <main className="profile-page" id="main-content">
      <div className="profile-page__container">
        <Link to="/" className="profile-page__back">
          <ArrowRight01Icon size={16} strokeWidth={2} />
          <span>العودة إلى المقالات</span>
        </Link>

        <header className="profile-page__header">
          <div className="profile-page__avatar" aria-hidden="true">
            {profile.avatarUrl ? (
              <img
                className="profile-page__avatar-image"
                src={profile.avatarUrl}
                alt=""
              />
            ) : (
              <span className="profile-page__avatar-fallback">
                {getInitial(profile.name)}
              </span>
            )}
          </div>

          <div className="profile-page__identity">
            <h1 className="profile-page__name">
              {profile.name}
              {isOwnProfile && (
                <span className="profile-page__badge">ملفك الشخصي</span>
              )}
            </h1>
            <p className="profile-page__handle" dir="ltr">
              @{profile.handle}
            </p>
            <p className="profile-page__stats">
              {posts.length} {posts.length === 1 ? 'مقال' : 'مقالات'}
            </p>
          </div>
        </header>

        <section className="profile-page__posts" aria-label="مقالات الكاتب">
          <h2 className="profile-page__section-title">المقالات</h2>

          {posts.length > 0 ? (
            <div className="profile-page__list">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          ) : (
            <div className="profile-page__empty">
              <p>
                {isOwnProfile
                  ? 'لم تنشر أي مقال بعد. شارك أول أفكارك مع القرّاء.'
                  : 'لم ينشر هذا الكاتب أي مقال بعد.'}
              </p>
              {isOwnProfile && (
                <Button variant="primary" size="sm" onClick={openCreatePostModal}>
                  اكتب أول مقال
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default ProfilePage;
