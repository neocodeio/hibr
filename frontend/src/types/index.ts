export interface Author {
  id: string;
  name: string;
  handle: string; // used in URL: /author/:handle
  avatarUrl?: string; // author profile image (from users.avatar_url)
  username?: string | null; // pretty profile URL key (from users.username)
}

export interface Post {
  id: string;
  slug: string; // used in URL: /post/:slug
  title: string;
  excerpt: string;
  author: Author;
  publishedAt: string;
  readTime: number; // minutes
  likesCount: number;
  commentsCount: number;
  tags?: string[];
}

export interface PostComment {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  author: Author;
}
