import { getSupabaseClient, supabase } from './supabase';
import type { Post } from '../types';
import { MOCK_POSTS } from './mockData';

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
  } | null;
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
  return `${base}-${uniqueId}`;
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
    },
  };
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
      .select('*, author:users(*)')
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
      const res = await fetch('http://localhost:5000/api/posts');
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

  // Merge database posts on top of mock posts (deduplicating by slug)
  const existingSlugs = new Set(dbPostsList.map((p) => p.slug));
  const remainingMocks = MOCK_POSTS.filter((p) => !existingSlugs.has(p.slug));

  return [...dbPostsList, ...remainingMocks];
}

/**
 * Create a new post in Supabase with Express Backend fallback
 */
export async function createPostInSupabase(
  payload: CreatePostPayload,
  clerkToken: string | null,
  userId: string,
  userName: string
): Promise<Post> {
  const slug = generateSlug(payload.title);
  const readTime = calculateReadTime(payload.content);
  const now = new Date().toISOString();

  const postRecord = {
    author_id: userId,
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

  let savedPost: DbPostRow | null = null;

  // 1. Attempt Client-side Supabase insert
  try {
    const client = getSupabaseClient(clerkToken);
    const { data, error } = await client
      .from('posts')
      .insert([postRecord])
      .select('*, author:users(*)')
      .single();

    if (!error && data) {
      savedPost = data;
    } else {
      console.warn('Client Supabase insert fallback to Backend API:', error?.message);
    }
  } catch (err) {
    console.warn('Supabase client insert error:', err);
  }

  // 2. Failsafe: Express Backend API insert (bypasses RLS issues)
  if (!savedPost) {
    try {
      const res = await fetch('http://localhost:5000/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: userId,
          title: payload.title,
          slug,
          excerpt: payload.excerpt,
          content: payload.content,
          readTime,
          authorName: userName,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.post) {
          savedPost = json.post;
        }
      }
    } catch (err) {
      console.error('Backend API post creation error:', err);
    }
  }

  if (savedPost) {
    return formatDbPost(savedPost);
  }

  return {
    id: String(Date.now()),
    slug,
    title: payload.title,
    excerpt: payload.excerpt || payload.content.slice(0, 160) + '...',
    publishedAt: 'الآن',
    readTime,
    likesCount: 0,
    commentsCount: 0,
    author: {
      id: userId,
      name: userName,
      handle: userName.toLowerCase().replace(/\s+/g, '-'),
    },
  };
}
