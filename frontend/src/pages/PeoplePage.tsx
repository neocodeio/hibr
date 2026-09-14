import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useSocial } from '../lib/SocialContext';
import { supabase } from '../lib/supabase';
import { useDocumentMeta } from '../lib/documentMeta';
import './PeoplePage.css';

interface Writer {
  id: string;
  name: string;
  avatarUrl: string;
  username: string | null;
  handle: string;
  postsCount: number;
}

function getInitial(name: string): string {
  return name.trim().charAt(0) || 'ح';
}

function formatCount(count: number): string {
  if (count === 0) return 'لم ينشر بعد';
  if (count === 1) return 'مقال واحد';
  if (count === 2) return 'مقالان';
  if (count <= 10) return `${count} مقالات`;
  return `${count} مقالاً`;
}

function PeoplePage() {
  const { user: currentUser } = useAuth();
  const { followingIds, followsOn, toggleFollow } = useSocial();
  const [writers, setWriters] = useState<Writer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [brokenAvatars, setBrokenAvatars] = useState<Set<string>>(new Set());
  useDocumentMeta('الكتّاب', 'اكتشف كتّاب حِبر الأكثر نشاطاً وتابع من يعجبك.');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        // Public reads: users viewable by everyone, published posts
        // viewable by everyone — no JWT needed, no RLS surprises.
        const [usersRes, postsRes] = await Promise.all([
          supabase
            .from('users')
            .select('id, name, avatar_url, username')
            .limit(50),
          supabase
            .from('posts')
            .select('author_id')
            .eq('is_published', true)
            .limit(1000),
        ]);
        if (cancelled) return;
        const counts = new Map<string, number>();
        const rows = (postsRes.data || []) as { author_id: string }[];
        for (const row of rows) {
          if (!row.author_id) continue;
          counts.set(row.author_id, (counts.get(row.author_id) || 0) + 1);
        }
        type UserRow = {
          id: string;
          name?: string | null;
          avatar_url?: string | null;
          username?: string | null;
        };
        const userRows = ((usersRes.data || []) as UserRow[]).filter((u) => u && u.id);
        const mapped: Writer[] = userRows.map((u) => {
          const name = (u.name || '').trim() || 'كاتب حِبر';
          return {
            id: u.id,
            name,
            avatarUrl: u.avatar_url || '',
            username: u.username || null,
            handle: u.username || name.toLowerCase().replace(/\s+/g, '-'),
            postsCount: counts.get(u.id) || 0,
          };
        });
        // Active writers first (most published posts), then alphabetical.
        // Writers with zero posts still show so the page is never empty.
        mapped.sort(
          (a, b) => b.postsCount - a.postsCount || a.name.localeCompare(b.name, 'ar')
        );
        setWriters(mapped.slice(0, 30));
      } catch (err) {
        console.warn('Error loading writers:', err);
        if (!cancelled) setWriters([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFollow = async (writerId: string) => {
    if (followBusy) return;
    setFollowBusy(writerId);
    try {
      await toggleFollow(writerId);
    } finally {
      setFollowBusy(null);
    }
  };

  const markBroken = (id: string) => {
    setBrokenAvatars((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <main className="people-page" id="main-content">
      <div className="people-page__container">
        <header className="people-page__header">
          <span className="people-page__eyebrow">اكتشف حِبر</span>
          <h1 className="people-page__title">من تكتب؟</h1>
          <p className="people-page__subtitle">
            الكتّاب الأكثر نشاطاً هذا الأسبوع — تابع من يعجبك.
          </p>
        </header>

        {isLoading ? (
          <div className="people-page__list" role="status" aria-live="polite">
            <span className="sr-only">نحمّل الكتّاب...</span>
            {[0, 1, 2, 3].map((i) => (
              <div className="people-page__skeleton" aria-hidden="true" key={i}>
                <div className="people-page__skeleton-avatar" />
                <div className="people-page__skeleton-lines">
                  <div className="people-page__skeleton-name" />
                  <div className="people-page__skeleton-meta" />
                </div>
                <div className="people-page__skeleton-btn" />
              </div>
            ))}
          </div>
        ) : writers.length === 0 ? (
          <div className="people-page__empty">
            <p>ما فيه كتّاب للحين — كن أول من ينشر في حِبر.</p>
          </div>
        ) : (
          <ul className="people-page__list" aria-label="قائمة الكتّاب">
            {writers.map((writer) => {
              const isSelf = currentUser?.id === writer.id;
              const isFollowing = followingIds.has(writer.id);
              const busy = followBusy === writer.id;
              const profilePath = writer.username
                ? `/profile/${writer.username}`
                : `/profile/${writer.id}`;
              return (
                <li key={writer.id} className="people-page__item">
                  <Link
                    to={profilePath}
                    className="people-page__who"
                    aria-label={`صفحة ${writer.name}`}
                  >
                    <span className="people-page__avatar" aria-hidden="true">
                      {writer.avatarUrl && !brokenAvatars.has(writer.id) ? (
                        <img
                          src={writer.avatarUrl}
                          alt=""
                          loading="lazy"
                          onError={() => markBroken(writer.id)}
                        />
                      ) : (
                        <span className="people-page__avatar-fallback">
                          {getInitial(writer.name)}
                        </span>
                      )}
                    </span>
                    <span className="people-page__identity">
                      <span className="people-page__name">{writer.name}</span>
                      <span className="people-page__meta">
                        <span dir="ltr">@{writer.handle}</span>
                        <span className="people-page__dot" aria-hidden="true">
                          ·
                        </span>
                        <span>{formatCount(writer.postsCount)}</span>
                      </span>
                    </span>
                  </Link>
                  {followsOn && !isSelf && (
                    <button
                      type="button"
                      className={
                        isFollowing
                          ? 'people-page__follow people-page__follow--following'
                          : 'people-page__follow'
                      }
                      onClick={() => handleFollow(writer.id)}
                      disabled={busy}
                      aria-pressed={isFollowing}
                    >
                      {busy ? 'لحظة...' : isFollowing ? 'أتابعه' : 'تابع'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

export default PeoplePage;
