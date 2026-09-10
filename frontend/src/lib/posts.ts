import { getSupabaseClient, supabase, API_BASE_URL } from './supabase';
import type { Post } from '../types';

/** Shape of a post row as returned by Supabase / the Express backend. */
interface DbPostRow {
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

export function generateSlug(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\w\u0621-\u064A\s-]/g, '')
    .replace(/\s+/g, '-');
  const uniqueId = Date.now().toString(36).slice(-4);
  return `${base}-${uniqueId}` || `post-${uniqueId}`;
}

export function calculateReadTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

function formatDbPost(item: DbPostRow): Post {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt || '',
    publishedAt: item.published_at
      ? new Date(item.published_at).toLocaleDateString('ar-SA', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'اليوم',
    readTime: item.read_time || 5,
    likesCount: item.likes_count || 0,
    commentsCount: item.comments_count || 0,
    author: {
      id: item.author?.id || item.author_id || '',
      name: item.author?.name || 'كاتب حِبر',
      handle: (item.author?.name || 'author').toLowerCase().replace(/\s+/g, '-'),
      avatarUrl: item.author?.avatar_url || '',
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
  throw new Error(
    `فشل حفظ المقال في قاعدة البيانات. ${errors.join(' | ')}` ||
      'فشل حفظ المقال في قاعدة البيانات.'
  );
}
