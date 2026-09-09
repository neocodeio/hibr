export interface Author {
  id: string;
  name: string;
  handle: string; // used in URL: /author/:handle
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
