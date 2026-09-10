import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { MOCK_POSTS } from '../lib/mockData';
import type { Post } from '../types';
import './PostPage.css';

function PostPage() {
  const { slug } = useParams<{ slug: string }>();
  const { requireAuth } = useAuth();

  const [post, setPost] = useState<Post | null>(null);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPost() {
      if (!slug) return;
      setIsLoading(true);

      try {
        const { data, error } = await supabase
          .from('posts')
          .select('*, author:users!posts_author_id_fkey(*)')
          .eq('slug', slug)
          .single();

        if (data && !error) {
          const formattedPost: Post = {
            id: data.id,
            slug: data.slug,
            title: data.title,
            excerpt: data.excerpt || '',
            publishedAt: data.published_at
              ? new Date(data.published_at).toLocaleDateString('ar-SA', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })
              : 'اليوم',
            readTime: data.read_time || 5,
            likesCount: data.likes_count || 0,
            commentsCount: data.comments_count || 0,
            author: {
              id: data.author?.id || data.author_id,
              name: data.author?.name || 'كاتب حِبر',
              handle: (data.author?.name || 'author').toLowerCase().replace(/\s+/g, '-'),
            },
          };
          setPost(formattedPost);
          setContent(data.content || data.excerpt || '');
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Error fetching post from Supabase:', err);
      }

      // Fallback mock post
      const mock = MOCK_POSTS.find((p) => p.slug === slug);
      if (mock) {
        setPost(mock);
        setContent(mock.excerpt);
      }
      setIsLoading(false);
    }

    loadPost();
  }, [slug]);

  if (isLoading) {
    return (
      <main className="post-page" id="main-content">
        <div className="post-page__container" style={{ padding: '4rem 0', textAlign: 'center' }}>
          <p>جاري تحميل المقال...</p>
        </div>
      </main>
    );
  }

  if (!post) {
    return (
      <main className="post-page" id="main-content">
        <div className="post-page__not-found">
          <h1>المقال غير موجود</h1>
          <p>لم نتمكن من إيجاد المقال الذي تبحث عنه.</p>
          <Link to="/" className="post-page__back">
            <span className="post-page__back-arrow" aria-hidden="true">→</span>
            العودة إلى المقالات
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="post-page" id="main-content">
      <div className="post-page__container">
        <Link to="/" className="post-page__back">
          <span className="post-page__back-arrow" aria-hidden="true">→</span>
          العودة إلى المقالات
        </Link>

        <header className="post-page__header">
          <h1 className="post-page__title">{post.title}</h1>

          <div className="post-page__meta">
            <span className="post-page__author">{post.author.name}</span>
            <span className="post-page__separator" aria-hidden="true">·</span>
            <span className="post-page__date">{post.publishedAt}</span>
            <span className="post-page__separator" aria-hidden="true">·</span>
            <span className="post-page__read-time">{post.readTime} دقائق قراءة</span>
          </div>
        </header>

        <div className="post-page__body">
          {content.split('\n').map((paragraph, index) => (
            <p key={index} style={{ marginBottom: '1.25rem', lineHeight: '1.8' }}>
              {paragraph}
            </p>
          ))}
        </div>

        <footer className="post-page__footer">
          <button
            type="button"
            className="post-page__action"
            onClick={() => requireAuth()}
            aria-label={`أعجبني — ${post.likesCount}`}
          >
            <span className="post-page__action-icon" aria-hidden="true">♡</span>
            <span className="post-page__action-label">{post.likesCount}</span>
          </button>

          <button
            type="button"
            className="post-page__action"
            onClick={() => requireAuth()}
            aria-label={`تعليقات — ${post.commentsCount}`}
          >
            <span className="post-page__action-icon" aria-hidden="true">◻</span>
            <span className="post-page__action-label">{post.commentsCount} تعليق</span>
          </button>
        </footer>
      </div>
    </main>
  );
}

export default PostPage;
