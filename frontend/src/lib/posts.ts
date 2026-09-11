import { getSupabaseClient, supabase, API_BASE_URL } from './supabase';
import type { Post } from '../types';

/** Shape of a post row as returned by Supabase / the Express backend. */
export interface DbPostRow {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  content?: string | null;
  published_at?: string | null;
  read_time?: number | null;
  likes_count?: number | null;
  comments_count?: number | null;
  author_id?: string | null;
  author?: {
    id?: string | null;
    name?: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
}

/** Minimal author profile needed to persist posts (and the author row). */
export interface AuthorProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export interface CreatePostPayload {
  title: string;
  excerpt: string;
  content: string;
  tags?: string[];
}

/**
 * Generate a clean, URL-safe ASCII slug.
 * Latin characters are slugified; non-Latin titles (e.g. Arabic) fall back
 * to `post-<unique>` so shared links stay short, readable and copy-safe.
 * Existing slugs already stored in the DB keep working — lookup always
 * matches the exact stored value (see PostPage).
 */
export function generateSlug(title: string): string {
  const uniqueId = Date.now().toString(36).slice(-4);
  const latin = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!latin) return `post-${uniqueId}`;
  return `${latin}-${uniqueId}`;
}

/**
 * Decode a `:slug` route param safely. React Router already decodes params,
 * but shared/copied links may arrive percent-encoded (especially slugs with
 * Arabic characters), so we normalize defensively without ever throwing.
 */
export function normalizeSlugParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** App-relative path for a post, safely encoded for the URL bar. */
export function getPostPath(post: { slug: string }): string {
  return `/post/${encodeURIComponent(post.slug)}`;
}

/** Absolute shareable URL for a post (uses the current origin in browser). */
export function getPostUrl(post: { slug: string }): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  return `${origin}${getPostPath(post)}`;
}

export function calculateReadTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function formatDbPost(item: DbPostRow): Post {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt || '',
    publishedAt: item.published_at || new Date().toISOString(),
    readTime: item.read_time || 5,
    likesCount: item.likes_count || 0,
    commentsCount: item.comments_count || 0,
    author: {
      id: item.author?.id || item.author_id || '',
      name: item.author?.name || 'كاتب حِبر',
      handle: (item.author?.name || 'author').toLowerCase().replace(/\s+/g, '-'),
      avatarUrl: item.author?.avatar_url || '',
      username: item.author?.username || null,
    },
  };
}

/**
 * Ensure a row for this author exists in public.users before inserting a post.
 * posts.author_id has a foreign key to users(id), so the insert fails with a
 * FK violation when the author row is missing (sync on login may have failed).
 * Order: client upsert with the Clerk JWT → backend admin upsert (bypasses RLS).
 */
async function ensureAuthorExists(
  profile: AuthorProfile,
  clerkToken: string | null
): Promise<void> {
  // 1. Does the author already exist? (SELECT is open to everyone via RLS)
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('id', profile.id)
      .maybeSingle();
    if (data) return; // author exists — nothing to do
  } catch {
    // Fall through and attempt the upsert anyway.
  }

  const userRecord = {
    id: profile.id,
    email: profile.email || `${profile.id}@user.hibr`,
    name: profile.name || 'كاتب حِبر',
    avatar_url: profile.avatarUrl || '',
    updated_at: new Date().toISOString(),
  };

  // 2. Client-side upsert (requires a valid Clerk JWT for the RLS policy)
  if (clerkToken) {
    try {
      const client = getSupabaseClient(clerkToken);
      const { error } = await client
        .from('users')
        .upsert(userRecord, { onConflict: 'id' });
      if (!error) return;
      console.warn('Author client-side upsert failed:', error.message);
    } catch (err) {
      console.warn('Author client-side upsert error:', err);
    }
  }

  // 3. Backend admin upsert (service role key — bypasses RLS)
  const res = await fetch(`${API_BASE_URL}/api/users/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    const detail = res ? `status ${res.status}` : 'backend unreachable';
    throw new Error(
      `Could not create the author profile in the database (${detail}). ` +
        `Is the backend running on ${API_BASE_URL}?`
    );
  }
}

/**
 * Public profile URL for an author — pretty `/profile/:username` when the
 * username is known, raw-id fallback otherwise (both resolve on ProfilePage).
 */
export function getProfilePath(author: {
  id: string;
  username?: string | null;
}): string {
  return author.username ? `/profile/${author.username}` : `/profile/${author.id}`;
}

/**
 * Delete a post: client-side Supabase delete first, Express backend as
 * failsafe. The author_id filter guarantees users can only delete their
 * own posts. Throws with the real error when both paths fail.
 */
export async function deletePostFromSupabase(
  postId: string,
  authorId: string,
  clerkToken: string | null
): Promise<void> {
  const errors: string[] = [];

  // 1. Attempt client-side Supabase delete (RLS enforced with the Clerk JWT)
  if (clerkToken) {
    try {
      const client = getSupabaseClient(clerkToken);
      const { data, error } = await client
        .from('posts')
        .delete()
        .eq('id', postId)
        .eq('author_id', authorId)
        .select('id');

      if (!error && data && data.length > 0) return;
      if (error) {
        console.error('Client Supabase delete failed:', error.message);
        errors.push(`Supabase: ${error.message}`);
      } else {
        errors.push('Supabase: ما انحذف أي مقال (تأكد من صلاحيات الحذف RLS).');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Supabase client delete error:', err);
      errors.push(`Supabase: ${message}`);
    }
  } else {
    errors.push(
      'Supabase: no Clerk JWT — configure the "supabase" JWT template in Clerk'
    );
  }

  // 2. Failsafe: Express backend API delete (service role key bypasses RLS)
  try {
    const res = await fetch(`${API_BASE_URL}/api/posts/${postId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorId }),
    });

    if (res.ok) return;
    const message =
      (await res.json().catch(() => null))?.error || `HTTP ${res.status}`;
    console.error('Backend API post delete failed:', message);
    errors.push(`Backend: ${message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Backend API post delete error:', err);
    errors.push(`Backend: ${message}`);
  }

  throw new Error(`ما قدرنا نحذف المقال. ${errors.join(' | ')}`);
}

/**
 * Fetch all posts from Supabase database (or Express backend API)
 */
export async function fetchAllPosts(): Promise<Post[]> {
  let dbPostsList: Post[] = [];

  // 1. Try Supabase client
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('*, author:users!posts_author_id_fkey(*)')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (data && !error && data.length > 0) {
      dbPostsList = data.map(formatDbPost);
    }
  } catch (err) {
    console.warn('Supabase client query failed:', err);
  }

  // 2. Try Express backend API if client list is empty
  if (dbPostsList.length === 0) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/posts`);
      if (res.ok) {
        const json = await res.json();
        if (json.posts && Array.isArray(json.posts) && json.posts.length > 0) {
          dbPostsList = json.posts.map(formatDbPost);
        }
      }
    } catch {
      // API fallback
    }
  }

  return dbPostsList;
}

/**
 * Create a new post: client-side Supabase insert first, Express backend as
 * failsafe. Throws with the real error when both paths fail — never returns
 * a fake, unsaved post.
 */
export async function createPostInSupabase(
  payload: CreatePostPayload,
  clerkToken: string | null,
  profile: AuthorProfile
): Promise<Post> {
  const slug = generateSlug(payload.title);
  const readTime = calculateReadTime(payload.content);
  const now = new Date().toISOString();

  const postRecord = {
    author_id: profile.id,
    title: payload.title.trim(),
    slug,
    excerpt: payload.excerpt.trim() || payload.content.trim().slice(0, 160) + '...',
    content: payload.content.trim(),
    read_time: readTime,
    likes_count: 0,
    comments_count: 0,
    is_published: true,
    published_at: now,
    created_at: now,
  };

  const errors: string[] = [];
  let savedPost: DbPostRow | null = null;

  // 0. The author row must exist or the posts insert fails (FK constraint)
  await ensureAuthorExists(profile, clerkToken);

  // 1. Attempt client-side Supabase insert (RLS enforced with the Clerk JWT)
  if (clerkToken) {
    try {
      const client = getSupabaseClient(clerkToken);
      const { data, error } = await client
        .from('posts')
        .insert([postRecord])
        .select('*, author:users!posts_author_id_fkey(*)')
        .single();

      if (!error && data) {
        savedPost = data;
      } else if (error) {
        console.error('Client Supabase insert failed:', error.message);
        errors.push(`Supabase: ${error.message}`);
      }
    } catch (err) {
      console.error('Supabase client insert error:', err);
      errors.push(`Supabase: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    errors.push(
      'Supabase: no Clerk JWT — configure the "supabase" JWT template in Clerk'
    );
  }

  // 2. Failsafe: Express backend API insert (service role key bypasses RLS)
  if (!savedPost) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: profile.id,
          title: payload.title,
          slug,
          excerpt: payload.excerpt,
          content: payload.content,
          readTime,
          authorName: profile.name,
        }),
      });

      const json = await res.json().catch(() => null);

      if (res.ok && json?.success && json?.post) {
        savedPost = json.post;
      } else {
        const message = json?.error || `HTTP ${res.status}`;
        console.error('Backend API post creation failed:', message);
        errors.push(`Backend: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Backend API post creation error:', err);
      errors.push(`Backend: ${message}`);
    }
  }

  if (savedPost) {
    return formatDbPost(savedPost);
  }

  // Both save paths failed — surface the real error instead of faking success.
  throw new Error(`ما قدرنا نحفظ المقال في قاعدة البيانات. ${errors.join(' | ')}`);
}
