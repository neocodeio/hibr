-- ============================================================
-- HIBR — Supabase Database & Security (RLS) Schema
-- ============================================================

-- 1. Create Users Table (Synced from Clerk via Webhook or Auth)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY, -- Clerk User ID (e.g. user_2...)
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users RLS Policies (drop-first keeps this script re-runnable)
DROP POLICY IF EXISTS "Users are viewable by everyone" ON public.users;
CREATE POLICY "Users are viewable by everyone" 
  ON public.users FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
CREATE POLICY "Users can update their own profile" 
  ON public.users FOR UPDATE 
  USING (id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
CREATE POLICY "Users can insert their own profile" 
  ON public.users FOR INSERT 
  WITH CHECK (id = (auth.jwt() ->> 'sub'));

-- 2. Create Posts Table
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  read_time INTEGER DEFAULT 5,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT true,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tags for search/filter (run this in the SQL editor on existing databases;
-- safe to re-run: IF NOT EXISTS + a backfill only for NULL rows).
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
UPDATE public.posts SET tags = '{}' WHERE tags IS NULL;

-- Enable RLS on posts
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Posts RLS Policies (drop-first keeps this script re-runnable)
DROP POLICY IF EXISTS "Published posts are viewable by everyone" ON public.posts;
CREATE POLICY "Published posts are viewable by everyone" 
  ON public.posts FOR SELECT 
  USING (is_published = true OR author_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Authenticated users can create posts" ON public.posts;
CREATE POLICY "Authenticated users can create posts" 
  ON public.posts FOR INSERT 
  WITH CHECK (author_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Authors can update their own posts" ON public.posts;
CREATE POLICY "Authors can update their own posts" 
  ON public.posts FOR UPDATE 
  USING (author_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Authors can delete their own posts" ON public.posts;
CREATE POLICY "Authors can delete their own posts" 
  ON public.posts FOR DELETE 
  USING (author_id = (auth.jwt() ->> 'sub'));

-- 3. Create Likes Table
CREATE TABLE IF NOT EXISTS public.likes (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

-- Enable RLS on likes
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Likes are viewable by everyone" ON public.likes;
CREATE POLICY "Likes are viewable by everyone" 
  ON public.likes FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Users can insert their own likes" ON public.likes;
CREATE POLICY "Users can insert their own likes" 
  ON public.likes FOR INSERT 
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can delete their own likes" ON public.likes;
CREATE POLICY "Users can delete their own likes" 
  ON public.likes FOR DELETE 
  USING (user_id = (auth.jwt() ->> 'sub'));

-- 4. Create Comments Table
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on comments
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
CREATE POLICY "Comments are viewable by everyone" 
  ON public.comments FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Users can post comments" ON public.comments;
CREATE POLICY "Users can post comments" 
  ON public.comments FOR INSERT 
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can delete their own comments" ON public.comments;
CREATE POLICY "Users can delete their own comments" 
  ON public.comments FOR DELETE 
  USING (user_id = (auth.jwt() ->> 'sub'));

-- 5. Bookmarks + follows (run this block in the SQL editor on existing
-- databases; safe to re-run. The app hides these features until the
-- tables exist, then lights them up automatically.)
CREATE TABLE IF NOT EXISTS public.bookmarks (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own bookmarks" ON public.bookmarks;
CREATE POLICY "Users can view their own bookmarks"
  ON public.bookmarks FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can insert their own bookmarks" ON public.bookmarks;
CREATE POLICY "Users can insert their own bookmarks"
  ON public.bookmarks FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can delete their own bookmarks" ON public.bookmarks;
CREATE POLICY "Users can delete their own bookmarks"
  ON public.bookmarks FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE INDEX IF NOT EXISTS bookmarks_user_id_idx ON public.bookmarks (user_id);

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Follows are viewable by everyone" ON public.follows;
CREATE POLICY "Follows are viewable by everyone"
  ON public.follows FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert their own follows" ON public.follows;
CREATE POLICY "Users can insert their own follows"
  ON public.follows FOR INSERT
  WITH CHECK (follower_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can delete their own follows" ON public.follows;
CREATE POLICY "Users can delete their own follows"
  ON public.follows FOR DELETE
  USING (follower_id = (auth.jwt() ->> 'sub'));

CREATE INDEX IF NOT EXISTS follows_follower_id_idx ON public.follows (follower_id);
CREATE INDEX IF NOT EXISTS follows_following_id_idx ON public.follows (following_id);

-- 6. Comment replies + editing, post covers, notifications (run in the SQL
-- editor on existing databases; safe to re-run).
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

DROP POLICY IF EXISTS "Authors can update their own comments" ON public.comments;
CREATE POLICY "Authors can update their own comments"
  ON public.comments FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'reply', 'follow')),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  post_slug TEXT,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (recipient_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can insert their own notifications" ON public.notifications;
CREATE POLICY "Users can insert their own notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (actor_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (recipient_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (recipient_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE
  USING (recipient_id = (auth.jwt() ->> 'sub'));

CREATE INDEX IF NOT EXISTS notifications_recipient_id_idx ON public.notifications (recipient_id, created_at DESC);

-- 7. Cover image storage (run once in the SQL editor).
-- Public bucket `post-covers`; each user uploads under their own folder
-- `<clerk_user_id>/...`. RLS uses the Clerk JWT sub, same as the tables above.
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-covers', 'post-covers', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Covers are publicly readable" ON storage.objects;
CREATE POLICY "Covers are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'post-covers');

DROP POLICY IF EXISTS "Users can upload their own covers" ON storage.objects;
CREATE POLICY "Users can upload their own covers"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'post-covers'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
  );

DROP POLICY IF EXISTS "Users can delete their own covers" ON storage.objects;
CREATE POLICY "Users can delete their own covers"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'post-covers'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
  );
