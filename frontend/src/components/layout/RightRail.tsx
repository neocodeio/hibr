import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AddTeamIcon, Search01Icon } from 'hugeicons-react';
import { useAuth } from '../../lib/AuthContext';
import { useSocial } from '../../lib/SocialContext';
import { supabase } from '../../lib/supabase';
import { useMediaQuery } from '../../lib/useMediaQuery';
import './RightRail.css';

interface SuggestedWriter {
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

/**
 * Desktop-only right rail (≥1300px): search box + suggested writers.
 * Never mounts on smaller screens — the navbar search and /people
 * page already cover those viewports.
 */
function RightRail() {
  const show = useMediaQuery('(min-width: 1300px)');
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { followingIds, followsOn, toggleFollow } = useSocial();
  const [query, setQuery] = useState('');
  const [writers, setWriters] = useState<SuggestedWriter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [brokenAvatars, setBrokenAvatars] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        // Public reads only — same ranking as /people (most published).
        const [usersRes, postsRes] = await Promise.all([
          supabase.from('users').select('id, name, avatar_url, username').limit(20),
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
        const mapped: SuggestedWriter[] = (
          ((usersRes.data || []) as UserRow[]).filter((u) => u && u.id) || []
        ).map((u) => {
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
        mapped.sort(
          (a, b) => b.postsCount - a.postsCount || a.name.localeCompare(b.name, 'ar')
        );
        setWriters(mapped.slice(0, 5));
      } catch (err) {
        console.warn('Error loading suggested writers:', err);
        if (!cancelled) setWriters([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [show]);

  if (!show) return null;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : '/');
  };

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
    <aside className="rail" aria-label="البحث واقتراحات المتابعة">
      <div className="rail__sticky">
        <form className="rail__search" role="search" onSubmit={handleSearch}>
          <Search01Icon
            size={17}
            strokeWidth={1.75}
            aria-hidden="true"
            className="rail__search-icon"
          />
          <label htmlFor="rail-search" className="sr-only">
            ابحث في حِبر
          </label>
          <input
            id="rail-search"
            type="search"
            className="rail__search-input"
            placeholder="ابحث عن مقال أو كاتب..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </form>

        <section className="rail__block" aria-label="مقترح للمتابعة">
          <div className="rail__block-head">
            <h2 className="rail__block-title">
              <span>مقترح للمتابعة</span>
              <AddTeamIcon size={18} strokeWidth={1.75} aria-hidden="true" />
            </h2>
            <Link to="/people" className="rail__see-all">
              عرض الكل
            </Link>
          </div>
          {isLoading ? (
            <div className="rail__loading" role="status" aria-live="polite">
              <span className="sr-only">نحمّل الاقتراحات...</span>
              {[0, 1, 2].map((i) => (
                <div className="rail__skeleton" aria-hidden="true" key={i}>
                  <div className="rail__skeleton-avatar" />
                  <div className="rail__skeleton-lines">
                    <div className="rail__skeleton-name" />
                    <div className="rail__skeleton-meta" />
                  </div>
                </div>
              ))}
            </div>
          ) : writers.length === 0 ? null : (
            <ul className="rail__writers">
              {writers.map((writer) => {
                const isSelf = currentUser?.id === writer.id;
                const isFollowing = followingIds.has(writer.id);
                const busy = followBusy === writer.id;
                const profilePath = writer.username
                  ? `/profile/${writer.username}`
                  : `/profile/${writer.id}`;
                return (
                  <li key={writer.id} className="rail__writer">
                    <Link
                      to={profilePath}
                      className="rail__who"
                      aria-label={`صفحة ${writer.name}`}
                    >
                      <span className="rail__avatar" aria-hidden="true">
                        {writer.avatarUrl && !brokenAvatars.has(writer.id) ? (
                          <img
                            src={writer.avatarUrl}
                            alt=""
                            loading="lazy"
                            onError={() => markBroken(writer.id)}
                          />
                        ) : (
                          <span className="rail__avatar-fallback">
                            {getInitial(writer.name)}
                          </span>
                        )}
                      </span>
                      <span className="rail__identity">
                        <span className="rail__name">{writer.name}</span>
                        <span className="rail__handle" dir="ltr">
                          @{writer.handle}
                        </span>
                      </span>
                    </Link>
                    {followsOn && !isSelf && (
                      <button
                        type="button"
                        className={
                          isFollowing
                            ? 'rail__follow rail__follow--following'
                            : 'rail__follow'
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
        </section>
      </div>
    </aside>
  );
}

export default RightRail;
