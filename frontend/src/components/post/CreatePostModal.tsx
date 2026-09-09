import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { createPostInSupabase, calculateReadTime } from '../../lib/posts';
import type { Post } from '../../types';
import Button from '../ui/Button';
import './CreatePostModal.css';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated?: (newPost: Post) => void;
}

function CreatePostModal({ isOpen, onClose, onPostCreated }: CreatePostModalProps) {
  const { user, getSupabaseToken } = useAuth();

  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const estimatedReadTime = calculateReadTime(content);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('يرجى إدخال عنوان المقال');
      return;
    }
    if (!content.trim()) {
      setErrorMsg('يرجى إدخال محتوى المقال');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const token = await getSupabaseToken();
      const newPost = await createPostInSupabase(
        { title, excerpt, content },
        token,
        user?.id || 'anonymous',
        user?.name || 'كاتب حِبر'
      );

      if (onPostCreated) {
        onPostCreated(newPost);
      }

      // Reset form
      setTitle('');
      setExcerpt('');
      setContent('');
      setIsSubmitting(false);
      onClose();
    } catch (err: unknown) {
      console.error('Error publishing post:', err);
      setErrorMsg('حدث خطأ أثناء نشر المقال، يرجى المحاولة مرة أخرى.');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="create-post-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="create-post-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-post-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="create-post-modal__header">
          <h2 id="create-post-title" className="create-post-modal__heading">
            نشر مقال جديد
          </h2>
          <button
            type="button"
            className="create-post-modal__close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        {errorMsg && <div className="create-post-modal__error">{errorMsg}</div>}

        <form onSubmit={handleSubmit} className="create-post-modal__form">
          <div className="create-post-modal__field">
            <label htmlFor="post-title" className="create-post-modal__label">
              عنوان المقال
            </label>
            <input
              id="post-title"
              type="text"
              className="create-post-modal__input create-post-modal__title-input"
              placeholder="اكتب عنوان مقالك هنا..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="create-post-modal__field">
            <label htmlFor="post-excerpt" className="create-post-modal__label">
              مقدمة موجزة (اختياري)
            </label>
            <textarea
              id="post-excerpt"
              rows={2}
              className="create-post-modal__textarea create-post-modal__excerpt-textarea"
              placeholder="اكتب ملخصاً أو مقدمة جذابة للمقال..."
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
            />
          </div>

          <div className="create-post-modal__field">
            <div className="create-post-modal__label-row">
              <label htmlFor="post-content" className="create-post-modal__label">
                محتوى المقال
              </label>
              <span className="create-post-modal__read-meta">
                وقت القراءة المقدر: {estimatedReadTime} دقيقة
              </span>
            </div>
            <textarea
              id="post-content"
              rows={8}
              className="create-post-modal__textarea create-post-modal__content-textarea"
              placeholder="اكتب نص المقال كاملاً هنا..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
          </div>

          <div className="create-post-modal__actions">
            <Button
              variant="ghost"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'جاري النشر...' : 'نشر المقال'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreatePostModal;
