import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import {
  probeBookmarksTable,
  probeFollowsTable,
  fetchBookmarkIds,
  fetchFollowingIds,
  addBookmark,
  removeBookmark,
  addFollow,
  removeFollow,
} from './social';

interface SocialContextValue {
  /** Saved post ids for the signed-in user. */
  bookmarkIds: Set<string>;
  /** User ids the signed-in user follows. */
  followingIds: Set<string>;
  /** False until the bookmarks table is confirmed to exist. */
  bookmarksOn: boolean;
  /** False until the follows table is confirmed to exist. */
  followsOn: boolean;
  toggleBookmark: (postId: string) => Promise<boolean>;
  toggleFollow: (userId: string) => Promise<boolean>;
}

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, requireAuth, getSupabaseToken } = useAuth();
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [bookmarksOn, setBookmarksOn] = useState(false);
  const [followsOn, setFollowsOn] = useState(false);

  // Probe tables once — controls stay hidden until the migration has run.
  useEffect(() => {
    let cancelled = false;
    probeBookmarksTable().then((on) => {
      if (!cancelled) setBookmarksOn(on);
    });
    probeFollowsTable().then((on) => {
      if (!cancelled) setFollowsOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the viewer's ids once per mount. App remounts this provider
  // (keyed by user id) on sign-in/sign-out, so state never leaks across
  // sessions and no sign-out reset effect is needed.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getSupabaseToken();
        const [bookmarks, following] = await Promise.all([
          fetchBookmarkIds(user.id, token),
          fetchFollowingIds(user.id, token),
        ]);
        if (!cancelled) {
          setBookmarkIds(bookmarks);
          setFollowingIds(following);
        }
      } catch (err) {
        console.warn('Error loading social state:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, getSupabaseToken]);

  const toggleBookmark = useCallback(
    async (postId: string): Promise<boolean> => {
      if (!isAuthenticated || !user) {
        requireAuth();
        return false;
      }
      const saved = bookmarkIds.has(postId);
      setBookmarkIds((prev) => {
        const next = new Set(prev);
        if (saved) next.delete(postId);
        else next.add(postId);
        return next;
      });
      try {
        const token = await getSupabaseToken();
        if (saved) await removeBookmark(postId, user.id, token);
        else await addBookmark(postId, user.id, token);
        return true;
      } catch (err) {
        console.warn('Error toggling bookmark:', err);
        setBookmarkIds((prev) => {
          const next = new Set(prev);
          if (saved) next.add(postId);
          else next.delete(postId);
          return next;
        });
        return false;
      }
    },
    [isAuthenticated, user, bookmarkIds, requireAuth, getSupabaseToken]
  );

  const toggleFollow = useCallback(
    async (targetUserId: string): Promise<boolean> => {
      if (!isAuthenticated || !user) {
        requireAuth();
        return false;
      }
      if (targetUserId === user.id) return false;
      const following = followingIds.has(targetUserId);
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (following) next.delete(targetUserId);
        else next.add(targetUserId);
        return next;
      });
      try {
        const token = await getSupabaseToken();
        if (following) await removeFollow(targetUserId, user.id, token);
        else await addFollow(targetUserId, user.id, token);
        return true;
      } catch (err) {
        console.warn('Error toggling follow:', err);
        setFollowingIds((prev) => {
          const next = new Set(prev);
          if (following) next.add(targetUserId);
          else next.delete(targetUserId);
          return next;
        });
        return false;
      }
    },
    [isAuthenticated, user, followingIds, requireAuth, getSupabaseToken]
  );

  return (
    <SocialContext.Provider
      value={{ bookmarkIds, followingIds, bookmarksOn, followsOn, toggleBookmark, toggleFollow }}
    >
      {children}
    </SocialContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context + hook intentionally co-located
export function useSocial(): SocialContextValue {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('useSocial must be used inside <SocialProvider>');
  return ctx;
}
