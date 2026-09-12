import { getSupabaseClient, supabase } from './supabase';
import type { AppNotification, Author, NotificationType } from '../types';

/**
 * Notifications data layer.
 *
 * The table comes from migration block 6 in backend/supabase_schema.sql.
 * Until it runs, every helper degrades gracefully: probes report
 * "unavailable" (UI hides the bell) and writers fail silently so likes,
 * comments and follows never break.
 */

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204') return true;
  const msg = error.message || '';
  return /42P01|not exist|could not find/i.test(msg);
}

function formatActor(raw: {
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

interface NotificationRow {
  id: string;
  type: string;
  post_id: string | null;
  post_slug: string | null;
  comment_id: string | null;
  is_read: boolean | null;
  created_at: string | null;
  actor: {
    id?: string | null;
    name?: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
  post: { id?: string | null; slug?: string | null; title?: string | null } | null;
}

const VALID_TYPES: NotificationType[] = ['like', 'comment', 'reply', 'follow'];

function formatRow(row: NotificationRow): AppNotification {
  const type: NotificationType = (VALID_TYPES as string[]).includes(row.type)
    ? (row.type as NotificationType)
    : 'comment';
  return {
    id: row.id,
    type,
    actor: formatActor(row.actor),
    postId: row.post_id,
    postSlug: row.post_slug ?? row.post?.slug ?? null,
    postTitle: row.post?.title ?? null,
    commentId: row.comment_id,
    isRead: row.is_read === true,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

// ── Availability probe (cached per session) ─────────────────────

let notificationsAvailable: boolean | null = null;

export async function probeNotificationsTable(): Promise<boolean> {
  if (notificationsAvailable !== null) return notificationsAvailable;
  try {
    const { error } = await supabase.from('notifications').select('id').limit(1);
    notificationsAvailable = !(error && isMissingTableError(error));
  } catch {
    notificationsAvailable = false;
  }
  return notificationsAvailable;
}

// ── Reads ───────────────────────────────────────────────────────

export async function fetchNotifications(userId: string, token: string | null): Promise<AppNotification[]> {
  if (!token) return [];
  const client = getSupabaseClient(token);
  const { data, error } = await client
    .from('notifications')
    .select(
      '*, actor:users!notifications_actor_id_fkey(id,name,avatar_url,username), post:posts!notifications_post_id_fkey(id,slug,title)'
    )
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (!isMissingTableError(error)) console.warn('Error fetching notifications:', error.message);
    return [];
  }
  return ((data || []) as NotificationRow[]).map(formatRow);
}

export async function markNotificationRead(id: string, userId: string, token: string | null): Promise<void> {
  if (!token) return;
  const client = getSupabaseClient(token);
  const { error } = await client
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('recipient_id', userId);
  if (error && !isMissingTableError(error)) {
    console.warn('Error marking notification read:', error.message);
  }
}

export async function markAllNotificationsRead(userId: string, token: string | null): Promise<void> {
  if (!token) return;
  const client = getSupabaseClient(token);
  const { error } = await client
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', userId)
    .eq('is_read', false);
  if (error && !isMissingTableError(error)) {
    console.warn('Error marking all notifications read:', error.message);
  }
}

// ── Writers (best-effort, never throw) ──────────────────────────

interface NotifyInput {
  recipientId: string;
  actorId: string;
  token: string | null;
  type: NotificationType;
  postId?: string | null;
  postSlug?: string | null;
  commentId?: string | null;
}

async function insertNotification(input: NotifyInput): Promise<void> {
  const { recipientId, actorId, token, type, postId, postSlug, commentId } = input;
  if (!token || recipientId === actorId) return;
  try {
    const client = getSupabaseClient(token);
    const { error } = await client.from('notifications').insert({
      recipient_id: recipientId,
      actor_id: actorId,
      type,
      post_id: postId ?? null,
      post_slug: postSlug ?? null,
      comment_id: commentId ?? null,
    });
    if (error && !isMissingTableError(error) && error.code !== '23505') {
      console.warn('Error creating notification:', error.message);
    }
  } catch (err) {
    console.warn('Error creating notification:', err);
  }
}

async function deleteNotification(input: Omit<NotifyInput, 'commentId'>): Promise<void> {
  const { recipientId, actorId, token, type, postId } = input;
  if (!token || recipientId === actorId) return;
  try {
    const client = getSupabaseClient(token);
    let query = client
      .from('notifications')
      .delete()
      .eq('recipient_id', recipientId)
      .eq('actor_id', actorId)
      .eq('type', type);
    query = postId ? query.eq('post_id', postId) : query.is('post_id', null);
    const { error } = await query;
    if (error && !isMissingTableError(error)) {
      console.warn('Error deleting notification:', error.message);
    }
  } catch (err) {
    console.warn('Error deleting notification:', err);
  }
}

/** Call after a like toggle settles (liked = new state). */
export function notifyLikeChange(
  postId: string,
  postSlug: string,
  authorId: string,
  likerId: string,
  token: string | null,
  liked: boolean
): void {
  if (liked) {
    void insertNotification({ recipientId: authorId, actorId: likerId, token, type: 'like', postId, postSlug });
  } else {
    void deleteNotification({ recipientId: authorId, actorId: likerId, token, type: 'like', postId });
  }
}

/** Call after a comment/reply is created. */
export function notifyNewComment(input: {
  postId: string;
  postSlug: string;
  commentId: string;
  postAuthorId: string;
  parentAuthorId?: string | null;
  actorId: string;
  token: string | null;
  isReply: boolean;
}): void {
  const { postId, postSlug, commentId, postAuthorId, parentAuthorId, actorId, token, isReply } = input;
  void insertNotification({
    recipientId: postAuthorId,
    actorId,
    token,
    type: isReply ? 'reply' : 'comment',
    postId,
    postSlug,
    commentId,
  });
  if (isReply && parentAuthorId && parentAuthorId !== postAuthorId) {
    void insertNotification({
      recipientId: parentAuthorId,
      actorId,
      token,
      type: 'reply',
      postId,
      postSlug,
      commentId,
    });
  }
}

/** Call after a follow toggle settles (following = new state). */
export function notifyFollowChange(
  followedId: string,
  followerId: string,
  token: string | null,
  following: boolean
): void {
  if (following) {
    void insertNotification({ recipientId: followedId, actorId: followerId, token, type: 'follow' });
  } else {
    void deleteNotification({ recipientId: followedId, actorId: followerId, token, type: 'follow' });
  }
}

// ── Realtime ────────────────────────────────────────────────────

export function subscribeNotificationsRealtime(userId: string, onChange: () => void): () => void {
  if (!userId) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 350);
  };

  const topic = `notifications-realtime-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        debounced
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') {
          console.warn('Realtime notifications subscription status:', status);
        }
      });

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  } catch (err) {
    console.warn('Realtime notifications subscription failed:', err);
    if (timer) clearTimeout(timer);
    return () => {};
  }
}
