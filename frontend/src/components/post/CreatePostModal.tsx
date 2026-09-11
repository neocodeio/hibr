import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Cancel01Icon } from 'hugeicons-react';
import { useAuth } from '../../lib/AuthContext';
import { createPostInSupabase, parseTagsInput } from '../../lib/posts';
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
  const [tagsInput, setTagsInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Guard: the author identity is required to save anything to the database.
  const canPublish = Boolean(user?.id && user.id !== 'anonymous');

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
      setErrorMsg('حط عنوان للمقال أول');
      return;
    }
    if (!content.trim()) {
      setErrorMsg('اكتب محتوى المقال أول');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      if (!canPublish) {
        throw new Error('لازم تسجّل دخولك عشان تنشر المقال.');
      }

      const token = await getSupabaseToken();
      const newPost = await createPostInSupabase(
        { title, excerpt, content, tags: parseTagsInput(tagsInput) },
        token,
        {
          id: user!.id,
          name: user!.name,
          email: user!.email,
          avatarUrl: user!.avatarUrl,
        }
      );

      if (onPostCreated) {
        onPostCreated(newPost);
      }

      // Reset form
      setTitle('');
      setExcerpt('');
      setContent('');
      setTagsInput('');
      setIsSubmitting(false);
      onClose();
    } catch (err: unknown) {
      console.error('Error publishing post:', err);
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : 'صار خطأ ونحن ننشر المقال، حاول مرة ثانية.'
      );
      setIsSubmitting(false);
    }
  };

  // Rendered in a portal on document.body so ancestor styles
  // (transforms, filters, overflow, stacking contexts) can never
  // trap the fixed backdrop or clip the dialog.
  return createPortal(
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
            اكتب مقال جديد
          </h2>
          <button
            type="button"
            className="create-post-modal__close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            <Cancel01Icon size={18} strokeWidth={2} />
          </button>
        </div>

        {errorMsg && (
          <div className="create-post-modal__error" role="alert">
            {errorMsg}
          </div>
        )}

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
              autoFocus
            />
          </div>

          <div className="create-post-modal__field">
            <label htmlFor="post-excerpt" className="create-post-modal__label">
              نبذة سريعة <span className="create-post-modal__optional">(اختياري)</span>
            </label>
            <textarea
              id="post-excerpt"
              rows={2}
              className="create-post-modal__textarea create-post-modal__excerpt-textarea"
              placeholder="اكتب نبذة تشوّق القارئ للمقال..."
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
            />
          </div>

          <div className="create-post-modal__field">
            <label htmlFor="post-tags" className="create-post-modal__label">
              الوسوم <span className="create-post-modal__optional">(اختياري — افصل بينها بفاصلة)</span>
            </label>
            <input
              id="post-tags"
              type="text"
              className="create-post-modal__input"
              placeholder="مثال: تقنية، كتب، خواطر..."
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              maxLength={180}
              autoComplete="off"
            />
          </div>

          <div className="create-post-modal__field">
            <label htmlFor="post-content" className="create-post-modal__label">
              محتوى المقال
            </label>
            <textarea
              id="post-content"
              rows={8}
              className="create-post-modal__textarea create-post-modal__content-textarea"
              placeholder="اكتب المقال كامل هنا..."
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
              {isSubmitting ? 'ننشر المقال...' : 'نشر المقال'}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreatePostModal;
