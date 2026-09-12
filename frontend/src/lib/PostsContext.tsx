import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Post } from '../types';
import { fetchAllPosts } from './posts';
import { fetchPostsStats, subscribePostsRealtime } from './interactions';
import type { PostsStats } from './interactions';
import { useAuth } from './AuthContext';
import { subscribePostCreated } from './postEvents';

interface PostsContextValue {
  posts: Post[];
  stats: PostsStats | null;
  /** True only during the very first load (cached visits never spin). */
  isLoading: boolean;
  /** True after the first fetch attempt finished (success or empty). */
  hasLoaded: boolean;
  /** Manual refetch (e.g. refresh button). */
  refresh: () => Promise<void>;
  removePost: (postId: string) => void;
  /** Replace a cached post after an edit (no refetch). */
  updatePost: (post: Post) => void;
}

const PostsContext = createContext<PostsContextValue | null>(null);

export function PostsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [stats, setStats] = useState<PostsStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchAllPosts();
      setPosts(data);
    } finally {
      setHasLoaded(true);
      setIsLoading(false);
    }
  }, []);

  // Load once for the whole app lifetime — navigating away unmounts the
  // feed page, but this provider stays mounted, so coming back is instant.
  // NOTE: no started-ref guard here — under StrictMode the effect mounts,
  // unmounts, and remounts, and a guard would cancel the first fetch and
  // skip the second, leaving the feed stuck on loading forever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAllPosts();
        if (!cancelled) setPosts(data);
      } catch {
        // fetchAllPosts already swallows its own errors; this is a failsafe
        // so a throw can never leave the feed stuck on loading.
      } finally {
        if (!cancelled) {
          setHasLoaded(true);
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // New posts created anywhere (global composer) prepend without refetch.
  // Drafts stay out of the feed cache — they live on the author's profile.
  useEffect(() => {
    return subscribePostCreated((newPost) => {
      if (newPost.isPublished === false) return;
      setPosts((prev) =>
        prev.some((post) => post.id === newPost.id) ? prev : [newPost, ...prev]
      );
    });
  }, []);

  const removePost = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((post) => post.id !== postId));
  }, []);

  const updatePost = useCallback((post: Post) => {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
  }, []);

  // Live like/comment counts for visible posts, kept fresh by realtime.
  // Re-runs only when the id list or the viewer changes — never on
  // navigation alone.
  useEffect(() => {
    if (posts.length === 0) return;
    let cancelled = false;
    const ids = posts.map((post) => post.id);
    const uid = isAuthenticated && user ? user.id : null;
    const update = () => {
      fetchPostsStats(ids, uid).then((s) => {
        if (!cancelled) setStats(s);
      });
    };
    update();
    const unsubscribe = subscribePostsRealtime(ids, update);
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids derived from posts; user object identity is unstable
  }, [posts, isAuthenticated, user?.id]);

  return (
    <PostsContext.Provider
      value={{ posts, stats, isLoading, hasLoaded, refresh, removePost, updatePost }}
    >
      {children}
    </PostsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context + hook intentionally co-located
export function usePosts(): PostsContextValue {
  const ctx = useContext(PostsContext);
  if (!ctx) throw new Error('usePosts must be used inside <PostsProvider>');
  return ctx;
}
