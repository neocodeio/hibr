import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight01Icon, UserAdd01Icon, UserCheck01Icon, PencilEdit01Icon } from 'hugeicons-react';
import { useAuth } from '../lib/AuthContext';
import { useSocial } from '../lib/SocialContext';
import { supabase } from '../lib/supabase';
import { sanitizeSocialLinks, type SocialLink } from '../lib/socialLinks';
import SocialLinks from '../components/profile/SocialLinks';
import SocialLinksEditor from '../components/profile/SocialLinksEditor';
import { formatDbPost } from '../lib/posts';
import { fetchPostsStats, subscribePostsRealtime } from '../lib/interactions';
import type { PostsStats } from '../lib/interactions';
import { fetchFollowCounts, subscribeFollowsRealtime } from '../lib/social';
import type { Post } from '../types';
import PostCard from '../components/post/PostCard';
import Button from '../components/ui/Button';
import AvatarPreview from '../components/ui/AvatarPreview';
import { useDocumentMeta } from '../lib/documentMeta';
import './ProfilePage.css';

interface ProfileUser {
  id: string;
  name: string;
  avatarUrl: string;
  username: string | null;
  handle: string;
  socialLinks: SocialLink[];
}

/** True when a Supabase error means `social_links` (or `username`) doesn't exist yet. */
function isMissingColumnError(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes(column.toLowerCase()) && /column|schema|not find|not exist/i.test(msg);
}

interface UserRow {
  id: string;
  name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  social_links?: unknown;
}

/** Fetch one user row, degrading gracefully when `username`/`social_links` columns are missing. */
async function fetchUserRow(
  field: 'username' | 'id',
  value: string
): Promise<{ row: UserRow | null; hasSocial: boolean }> {
  const attempts = [
    'id, name, avatar_url, username, social_links',
    'id, name, avatar_url, username',
    'id, name, avatar_url, social_links',
    'id, name, avatar_url',
  ];
  for (const cols of attempts) {
    // Skip username lookups when the attempted column set has no username.
    if (field === 'username' && !cols.includes('username')) continue;
    const res = await supabase.from('users').select(cols).eq(field, value).single();
    if (!res.error && res.data) {
      return { row: res.data as unknown as UserRow, hasSocial: cols.includes('social_links') };
    }
    const err = res.error as { code?: string; message?: string } | null;
    // Table-level "no rows" (PGRST116): try the next strategy, don't retry columns.
    if (err && err.code === 'PGRST116') return { row: null, hasSocial: false };
    const missingSocial = isMissingColumnError(err, 'social_links');
    const missingUsername = isMissingColumnError(err, 'username');
    // Column error → try the next (reduced) column set; other errors → stop.
    if (missingSocial || missingUsername) continue;
    return { row: null, hasSocial: cols.includes('social_links') };
  }
  return { row: null, hasSocial: false };
}

function getInitial(name: string): string {
  return name.trim().charAt(0);
}

function pluralFollowers(count: number): string {
  if (count === 1) return 'متابِع';
  if (count === 2) return 'متابِعين';
  if (count <= 10) return 'متابِعين';
  return 'متابِع';
}

function ProfilePage() {
  const { username: profileKey } = useParams<{ username: string }>();
  const {
    user: currentUser,
    openCreatePostModal,
    isAuthenticated,
  } = useAuth();

  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats] = useState<PostsStats | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [isAvatarOpen, setIsAvatarOpen] = useState(false);
  const [isSocialEditorOpen, setIsSocialEditorOpen] = useState(false);
  const [socialAvailable, setSocialAvailable] = useState(false);
  const { followingIds, followsOn, toggleFollow } = useSocial();
  useDocumentMeta(profile?.name, profile ? `مقالات ${profile.name} في حِبر.` : undefined);

  const handlePostDeleted = (postId: string) => {
    setPosts((prev) => prev.filter((post) => post.id !== postId));
    setDrafts((prev) => prev.filter((post) => post.id !== postId));
  };

  const handlePostUpdated = (updated: Post) => {
    if (updated.isPublished) {
      setDrafts((prev) => prev.filter((post) => post.id !== updated.id));
      setPosts((prev) => [updated, ...prev.filter((post) => post.id !== updated.id)]);
    } else {
      setPosts((prev) => prev.filter((post) => post.id !== updated.id));
      setDrafts((prev) => prev.map((post) => (post.id === updated.id ? updated : post)));
    }
  };

  // Live like states + counts for the author's posts (single batch query),
  // kept fresh by a realtime subscription (no refresh needed).
  // NOTE: no stats reset when the list empties — nothing renders then, and
  // the next non-empty list always triggers a fresh fetch below.
  useEffect(() => {
    if (posts.length === 0) return;
    let cancelled = false;
    const ids = posts.map((post) => post.id);
    const uid = isAuthenticated && currentUser ? currentUser.id : null;
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
  }, [posts, isAuthenticated, currentUser]);

  useEffect(() => {
    async function loadProfile() {
      if (!profileKey) return;
      setIsLoading(true);
      setNotFound(false);

      try {
        // 1. Pretty username lookup (works once the `username` column exists).
        const byUsername = await fetchUserRow('username', profileKey);

        let userRow = byUsername.row;
        let hasSocial = byUsername.hasSocial;

        // 2. Legacy fallback: raw user id (works with or without the column,
        //    so old /profile/:id links never break).
        if (!userRow) {
          const byId = await fetchUserRow('id', profileKey);
          if (byId.row) {
            userRow = byId.row;
            hasSocial = byId.hasSocial;
          }
        }

        if (!userRow) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
        setSocialAvailable(hasSocial);

        const name = userRow.name || 'كاتب حِبر';
        setProfile({
          id: userRow.id,
          name,
          avatarUrl: userRow.avatar_url || '',
          username: userRow.username || null,
          handle: userRow.username || name.toLowerCase().replace(/\s+/g, '-'),
          socialLinks: sanitizeSocialLinks(userRow.social_links),
        });

        try {
          // Author columns are explicit so other users' emails are never
          // pulled into the client; retry bare pre-`username`-migration.
          const full = await supabase
            .from('posts')
            .select('*, author:users!posts_author_id_fkey(id,name,avatar_url,username)')
            .eq('author_id', userRow.id)
            .eq('is_published', true)
            .order('created_at', { ascending: false });

          if (!full.error && full.data) {
            setPosts(full.data.map(formatDbPost));
          } else if (full.error) {
            const bare = await supabase
              .from('posts')
              .select('*, author:users!posts_author_id_fkey(id,name,avatar_url)')
              .eq('author_id', userRow.id)
              .eq('is_published', true)
              .order('created_at', { ascending: false });
            if (!bare.error && bare.data) {
              setPosts(bare.data.map(formatDbPost));
            }
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

  // Own drafts (unpublished) — visible only on your own profile. RLS
  // enforces this server-side too; the check here just avoids the query.
  useEffect(() => {
    if (!profile || !currentUser || profile.id !== currentUser.id) return;
    let cancelled = false;
    supabase
      .from('posts')
      .select('*, author:users!posts_author_id_fkey(*)')
      .eq('author_id', profile.id)
      .eq('is_published', false)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!cancelled && !error && data) {
          setDrafts(data.map(formatDbPost));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile, currentUser]);

  // Follower counts for the shown profile (public, cheap count queries),
  // kept fresh by a realtime subscription. NOTE: deliberately NOT keyed on
  // `followingIds` — that changes optimistically before the write commits,
  // so refetching on it reads stale counts (the refresh-page bug). Own
  // toggles adjust the count locally below; the subscription converges to
  // server truth for everyone else's actions.
  useEffect(() => {
    if (!profile || !followsOn) return;
    let cancelled = false;
    const refresh = () => {
      fetchFollowCounts(profile.id).then((counts) => {
        if (!cancelled) {
          setFollowerCount(counts.followers);
          setFollowingCount(counts.following);
        }
      });
    };
    refresh();
    const unsubscribe = subscribeFollowsRealtime(profile.id, refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profile, followsOn]);

  if (isLoading) {
    return (
      <main className="profile-page" id="main-content">
        <div className="profile-page__container" role="status" aria-live="polite">
          <span className="sr-only">نحمّل الملف الشخصي...</span>
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
          <h1>الحساب مو موجود</h1>
          <p>ما لقينا الحساب اللي تدور عليه.</p>
          <Link to="/" className="profile-page__back profile-page__back--centered">
            <ArrowRight01Icon size={16} strokeWidth={2} />
            <span>ارجع للمقالات</span>
          </Link>
        </div>
      </main>
    );
  }

  const isOwnProfile = currentUser?.id === profile.id;
  const isFollowing = profile ? followingIds.has(profile.id) : false;
  const showFollowButton = followsOn && !isOwnProfile;

  const handleFollow = async () => {
    if (!profile || followBusy) return;
    // Capture pre-toggle state: a successful toggle flips it, so the
    // followers count moves instantly with no server round-trip.
    const wasFollowing = followingIds.has(profile.id);
    setFollowBusy(true);
    try {
      const ok = await toggleFollow(profile.id);
      if (ok) setFollowerCount((c) => Math.max(0, c + (wasFollowing ? -1 : 1)));
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <main className="profile-page" id="main-content">
      <div className="profile-page__container">
        <Link to="/" className="profile-page__back">
          <ArrowRight01Icon size={16} strokeWidth={2} />
          <span>ارجع للمقالات</span>
        </Link>

        <header className="profile-page__header">
          {profile.avatarUrl ? (
            <button
              type="button"
              className="profile-page__avatar profile-page__avatar--clickable"
              onClick={() => setIsAvatarOpen(true)}
              aria-label={`عرض صورة ${profile.name}`}
              aria-haspopup="dialog"
            >
              <img
                className="profile-page__avatar-image"
                src={profile.avatarUrl}
                alt=""
                loading="lazy"
              />
            </button>
          ) : (
            <div className="profile-page__avatar" aria-hidden="true">
              <span className="profile-page__avatar-fallback">
                {getInitial(profile.name)}
              </span>
            </div>
          )}

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
            <SocialLinks links={profile.socialLinks} />
            {isOwnProfile && socialAvailable && (
              <button
                type="button"
                className="profile-page__social-edit"
                onClick={() => setIsSocialEditorOpen(true)}
              >
                <PencilEdit01Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  {profile.socialLinks.length > 0 ? 'عدّل روابط التواصل' : 'أضف روابط التواصل'}
                </span>
              </button>
            )}
            <div className="profile-page__stats" role="list" aria-label="إحصائيات الحساب">
              <span className="profile-page__stat" role="listitem">
                <span className="profile-page__stat-value">{posts.length}</span>
                <span className="profile-page__stat-label">
                  {posts.length === 1 ? 'مقال' : 'مقالات'}
                </span>
              </span>
              {followsOn && (
                <>
                  <span className="profile-page__stat" role="listitem">
                    <span className="profile-page__stat-value">{followerCount}</span>
                    <span className="profile-page__stat-label">
                      {pluralFollowers(followerCount)}
                    </span>
                  </span>
                  <span className="profile-page__stat" role="listitem">
                    <span className="profile-page__stat-value">{followingCount}</span>
                    <span className="profile-page__stat-label">يتابع</span>
                  </span>
                </>
              )}
            </div>
            {showFollowButton && (
              <div className="profile-page__follow">
                <Button
                  variant={isFollowing ? 'ghost' : 'primary'}
                  size="sm"
                  onClick={handleFollow}
                  disabled={followBusy}
                >
                  <span className="profile-page__follow-inner">
                    {isFollowing ? (
                      <UserCheck01Icon size={16} strokeWidth={2} />
                    ) : (
                      <UserAdd01Icon size={16} strokeWidth={2} />
                    )}
                    {followBusy ? 'لحظة...' : isFollowing ? 'أتابعه' : 'تابع'}
                  </span>
                </Button>
              </div>
            )}
          </div>
        </header>

        <section className="profile-page__posts" aria-label="مقالات الكاتب">
          <h2 className="profile-page__section-title">المقالات</h2>

          {posts.length > 0 ? (
            <div className="profile-page__list">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onDeleted={handlePostDeleted}
                  onPostUpdated={handlePostUpdated}
                  stats={stats}
                />
              ))}
            </div>
          ) : (
            <div className="profile-page__empty">
              <p>
                {isOwnProfile
                  ? 'توه ما نشرت شي. شاركنا أول أفكارك.'
                  : 'هذا الكاتب توه ما نشر شي.'}
              </p>
              {isOwnProfile && (
                <Button variant="primary" size="sm" onClick={openCreatePostModal}>
                  اكتب أول مقال
                </Button>
              )}
            </div>
          )}
        </section>

        {isOwnProfile && drafts.length > 0 && (
          <section className="profile-page__posts" aria-label="مسوداتك">
            <h2 className="profile-page__section-title">
              مسوداتك
              <span className="profile-page__count">({drafts.length})</span>
            </h2>
            <div className="profile-page__list">
              {drafts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onDeleted={handlePostDeleted}
                  onPostUpdated={handlePostUpdated}
                  stats={stats}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <AvatarPreview
        src={isAvatarOpen && profile.avatarUrl ? profile.avatarUrl : null}
        name={profile.name}
        onClose={() => setIsAvatarOpen(false)}
      />

      {isSocialEditorOpen && isOwnProfile && (
        <SocialLinksEditor
          userId={profile.id}
          initialLinks={profile.socialLinks}
          onClose={() => setIsSocialEditorOpen(false)}
          onSaved={(links) => setProfile((prev) => (prev ? { ...prev, socialLinks: links } : prev))}
        />
      )}
    </main>
  );
}

export default ProfilePage;
