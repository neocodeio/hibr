import { getSupabaseClient, supabase } from './supabase';
import type { Author, PostComment } from '../types';

/**
 * Live interaction stats for a list of posts, fetched in exactly 2 queries
 * (no N+1 per card). Counts are computed from the source tables so they
 * never drift — the denormalized posts.*_count columns are only fallbacks.
 */
export interface PostsStats {
  likedIds: Set<string>;
  likesCounts: Map<string, number>;
  commentsCounts: Map<string, number>;
}

export function emptyPostsStats(): PostsStats {
  return { likedIds: new Set(), likesCounts: new Map(), commentsCounts: new Map() };
}

function formatCommentAuthor(raw: {
  id?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
} | null): Author {
  const name = raw?.name || 'كاتب حِبر';
  return {
    id: raw?.id || '',
    name,
    handle: (raw?.name || 'author').toLowerCase().replace(/\s+/g, '-'),
    avatarUrl: raw?.avatar_url || '',
    username: raw?.username ?? null,
  };
}

function formatCommentRow(row: {
  id: string;
  post_id: string;
  content?: string | null;
  created_at?: string | null;
  author: {
    id?: string | null;
    name?: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
}): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content || '',
    createdAt: row.created_at || new Date().toISOString(),
    author: formatCommentAuthor(row.author),
  };
}

export async function fetchPostsStats(
  postIds: string[],
  userId: string | null
): Promise<PostsStats> {
  const stats = emptyPostsStats();
  if (postIds.length === 0) return stats;

  try {
    const [likesRes, commentsRes] = await Promise.all([
      supabase.from('likes').select('post_id, user_id').in('post_id', postIds),
      supabase.from('comments').select('post_id').in('post_id', postIds),
    ]);

    if (!likesRes.error && likesRes.data) {
      for (const row of likesRes.data as { post_id: string; user_id: string }[]) {
        stats.likesCounts.set(row.post_id, (stats.likesCounts.get(row.post_id) || 0) + 1);
        if (userId && row.user_id === userId) stats.likedIds.add(row.post_id);
      }
    }

    if (!commentsRes.error && commentsRes.data) {
      for (const row of commentsRes.data as { post_id: string }[]) {
        stats.commentsCounts.set(
          row.post_id,
          (stats.commentsCounts.get(row.post_id) || 0) + 1
        );
      }
    }
  } catch (err) {
    console.warn('Error fetching posts stats from Supabase:', err);
  }

  return stats;
}

/**
 * Toggle the current user's like. Returns the new liked state.
 * A duplicate insert (unique violation) is treated as "liked", not an error.
 */
export async function toggleLike(
  postId: string,
  userId: string,
  clerkToken: string | null,
  currentlyLiked: boolean
): Promise<boolean> {
  if (!clerkToken) {
    throw new Error('لازم تسجّل دخولك عشان تحط إعجاب.');
  }

  const client = getSupabaseClient(clerkToken);

  if (currentlyLiked) {
    const { error } = await client
      .from('likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return false;
  }

  const { error } = await client.from('likes').insert({ post_id: postId, user_id: userId });
  if (error) {
    if (error.code === '23505') return true;
    throw new Error(error.message);
  }
  return true;
}

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*, author:users!comments_user_id_fkey(*)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return ((data || []) as Parameters<typeof formatCommentRow>[0][]).map(formatCommentRow);
}

export async function addComment(
  postId: string,
  userId: string,
  content: string,
  clerkToken: string | null
): Promise<PostComment> {
  const text = content.trim();
  if (!text) throw new Error('اكتب تعليقك أول.');
  if (!clerkToken) throw new Error('لازم تسجّل دخولك عشان تعلّق.');

  const client = getSupabaseClient(clerkToken);
  const { data, error } = await client
    .from('comments')
    .insert({ post_id: postId, user_id: userId, content: text })
    .select('*, author:users!comments_user_id_fkey(*)')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'ما قدرنا ننشر التعليق، حاول مرة ثانية.');
  }
  return formatCommentRow(data);
}

/**
 * Realtime subscription for likes/comments on the given posts.
 * Calls onChange (debounced) on any insert/delete so callers can refetch —
 * refetching absolute state (instead of incrementing) makes counts immune
 * to double-applied echoes of our own optimistic updates.
 *
 * REQUIRES (one-time SQL, otherwise events silently never arrive):
 *   alter publication supabase_realtime add table public.likes;
 *   alter publication supabase_realtime add table public.comments;
 */
export function subscribePostsRealtime(
  postIds: string[],
  onChange: () => void
): () => void {
  if (postIds.length === 0) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 350);
  };

  const filter =
    postIds.length === 1
      ? `post_id=eq.${postIds[0]}`
      : `post_id=in.(${postIds.join(',')})`;

  // Unique topic per subscription. supabase-js reuses channel objects by
  // topic, and calling .on() on an already-subscribed channel throws
  // ("cannot add postgres_changes callbacks ... after subscribe()").
  // The feed cache (PostsProvider) and the post page subscribe
  // concurrently, so a shared topic crashed the whole app (blank white
  // page) as soon as a real post loaded. Unique topics make that
  // impossible. Realtime is enhancement-only, so any failure here must
  // degrade to a no-op — never throw into a React effect.
  const topic = `posts-realtime-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'likes', filter },
        debounced
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'likes', filter },
        debounced
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter },
        debounced
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'comments', filter },
        debounced
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') {
          console.warn('Realtime posts subscription status:', status);
        }
      });

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  } catch (err) {
    console.warn('Realtime posts subscription failed:', err);
    if (timer) clearTimeout(timer);
    return () => {};
  }
}
