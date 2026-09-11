import { getSupabaseClient, supabase } from './supabase';

/**
 * Bookmarks + follows data layer.
 *
 * Both tables are created by the migration block at the end of
 * backend/supabase_schema.sql. Until it runs, every helper here degrades
 * gracefully: probes report "unavailable" (UI hides the controls) and
 * mutations throw a friendly Arabic error instead of crashing.
 */

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204') return true;
  const msg = error.message || '';
  return /42P01|not exist|could not find/i.test(msg);
}

// ── Availability probes (cached per session) ────────────────────

let bookmarksAvailable: boolean | null = null;
let followsAvailable: boolean | null = null;

async function probeTable(
  table: 'bookmarks' | 'follows',
  column: string,
  cached: boolean | null
): Promise<{ available: boolean; changed: boolean }> {
  if (cached !== null) return { available: cached, changed: false };
  try {
    const { error } = await supabase.from(table).select(column).limit(1);
    if (error && isMissingTableError(error)) {
      return { available: false, changed: true };
    }
    // RLS denials / empty results still mean "table exists".
    return { available: true, changed: true };
  } catch {
    return { available: false, changed: true };
  }
}

export async function probeBookmarksTable(): Promise<boolean> {
  const { available, changed } = await probeTable('bookmarks', 'post_id', bookmarksAvailable);
  if (changed) bookmarksAvailable = available;
  return available;
}

export async function probeFollowsTable(): Promise<boolean> {
  const { available, changed } = await probeTable('follows', 'follower_id', followsAvailable);
  if (changed) followsAvailable = available;
  return available;
}

// ── Bookmarks ───────────────────────────────────────────────────

export async function fetchBookmarkIds(userId: string, token: string | null): Promise<Set<string>> {
  if (!token) return new Set();
  const client = getSupabaseClient(token);
  const { data, error } = await client.from('bookmarks').select('post_id').eq('user_id', userId);
  if (error) {
    if (isMissingTableError(error)) return new Set();
    throw new Error(error.message);
  }
  return new Set(((data || []) as { post_id: string }[]).map((row) => row.post_id));
}

export async function addBookmark(postId: string, userId: string, token: string | null): Promise<void> {
  if (!token) throw new Error('لازم تسجّل دخولك عشان تحفظ المقال.');
  const client = getSupabaseClient(token);
  const { error } = await client.from('bookmarks').insert({ post_id: postId, user_id: userId });
  if (error) {
    if (error.code === '23505') return; // already saved
    if (isMissingTableError(error)) throw new Error('الحفظ مو متاح الحين، حاول بعدين.');
    throw new Error(error.message);
  }
}

export async function removeBookmark(postId: string, userId: string, token: string | null): Promise<void> {
  if (!token) throw new Error('لازم تسجّل دخولك عشان تحفظ المقال.');
  const client = getSupabaseClient(token);
  const { error } = await client
    .from('bookmarks')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) {
    if (isMissingTableError(error)) throw new Error('الحفظ مو متاح الحين، حاول بعدين.');
    throw new Error(error.message);
  }
}

// ── Follows ─────────────────────────────────────────────────────

export async function fetchFollowingIds(userId: string, token: string | null): Promise<Set<string>> {
  if (!token) return new Set();
  const client = getSupabaseClient(token);
  const { data, error } = await client
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);
  if (error) {
    if (isMissingTableError(error)) return new Set();
    throw new Error(error.message);
  }
  return new Set(((data || []) as { following_id: string }[]).map((row) => row.following_id));
}

export async function addFollow(followingId: string, followerId: string, token: string | null): Promise<void> {
  if (!token) throw new Error('لازم تسجّل دخولك عشان تتابع.');
  if (followingId === followerId) throw new Error('لا يمكنك متابعة نفسك.');
  const client = getSupabaseClient(token);
  const { error } = await client
    .from('follows')
    .insert({ follower_id: followerId, following_id: followingId });
  if (error) {
    if (error.code === '23505') return; // already following
    if (isMissingTableError(error)) throw new Error('المتابعة مو متاحة الحين، حاول بعدين.');
    throw new Error(error.message);
  }
}

export async function removeFollow(followingId: string, followerId: string, token: string | null): Promise<void> {
  if (!token) throw new Error('لازم تسجّل دخولك عشان تتابع.');
  const client = getSupabaseClient(token);
  const { error } = await client
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
  if (error) {
    if (isMissingTableError(error)) throw new Error('المتابعة مو متاحة الحين، حاول بعدين.');
    throw new Error(error.message);
  }
}

export async function fetchFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const [followersRes, followingRes] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', userId),
    supabase.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return {
    followers:
      !followersRes.error && typeof followersRes.count === 'number' ? followersRes.count : 0,
    following:
      !followingRes.error && typeof followingRes.count === 'number' ? followingRes.count : 0,
  };
}
