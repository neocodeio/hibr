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
import {
  probeNotificationsTable,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeNotificationsRealtime,
  notifyFollowChange,
} from './notifications';
import type { AppNotification } from '../types';

interface SocialContextValue {
  /** Saved post ids for the signed-in user. */
  bookmarkIds: Set<string>;
  /** User ids the signed-in user follows. */
  followingIds: Set<string>;
  /** Inbox for the signed-in user (newest first). */
  notifications: AppNotification[];
  /** Unread inbox count. */
  unreadCount: number;
  /** False until the bookmarks table is confirmed to exist. */
  bookmarksOn: boolean;
  /** False until the follows table is confirmed to exist. */
  followsOn: boolean;
  /** False until the notifications table is confirmed to exist. */
  notificationsOn: boolean;
  toggleBookmark: (postId: string) => Promise<boolean>;
  toggleFollow: (userId: string) => Promise<boolean>;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, requireAuth, getSupabaseToken } = useAuth();
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [bookmarksOn, setBookmarksOn] = useState(false);
  const [followsOn, setFollowsOn] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(false);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const refreshNotifications = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    try {
      const token = await getSupabaseToken();
      const rows = await fetchNotifications(user.id, token);
      setNotifications(rows);
    } catch (err) {
      console.warn('Error refreshing notifications:', err);
    }
  }, [isAuthenticated, user, getSupabaseToken]);

  // Probe tables once — controls stay hidden until the migration has run.
  useEffect(() => {
    let cancelled = false;
    probeBookmarksTable().then((on) => {
      if (!cancelled) setBookmarksOn(on);
    });
    probeFollowsTable().then((on) => {
      if (!cancelled) setFollowsOn(on);
    });
    probeNotificationsTable().then((on) => {
      if (!cancelled) setNotificationsOn(on);
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
        const [bookmarks, following, inbox] = await Promise.all([
          fetchBookmarkIds(user.id, token),
          fetchFollowingIds(user.id, token),
          fetchNotifications(user.id, token),
        ]);
        if (!cancelled) {
          setBookmarkIds(bookmarks);
          setFollowingIds(following);
          setNotifications(inbox);
        }
      } catch (err) {
        console.warn('Error loading social state:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, getSupabaseToken]);

  // Live inbox: any insert/update/delete on our rows refetches.
  useEffect(() => {
    if (!isAuthenticated || !user || !notificationsOn) return;
    return subscribeNotificationsRealtime(user.id, () => {
      void refreshNotifications();
    });
  }, [isAuthenticated, user, notificationsOn, refreshNotifications]);

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
        notifyFollowChange(targetUserId, user.id, token, !following);
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

  const markOneNotificationRead = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      if (!isAuthenticated || !user) return;
      try {
        const token = await getSupabaseToken();
        await markNotificationRead(id, user.id, token);
      } catch (err) {
        console.warn('Error marking notification read:', err);
      }
    },
    [isAuthenticated, user, getSupabaseToken]
  );

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    if (!isAuthenticated || !user) return;
    try {
      const token = await getSupabaseToken();
      await markAllNotificationsRead(user.id, token);
    } catch (err) {
      console.warn('Error marking all notifications read:', err);
    }
  }, [isAuthenticated, user, getSupabaseToken]);

  return (
    <SocialContext.Provider
      value={{
        bookmarkIds,
        followingIds,
        notifications,
        unreadCount,
        bookmarksOn,
        followsOn,
        notificationsOn,
        toggleBookmark,
        toggleFollow,
        markNotificationRead: markOneNotificationRead,
        markAllNotificationsRead: markAllRead,
      }}
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
