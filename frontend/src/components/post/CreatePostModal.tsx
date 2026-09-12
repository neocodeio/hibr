import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Cancel01Icon } from 'hugeicons-react';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  createPostInSupabase,
  updatePostInSupabase,
  parseTagsInput,
  normalizeCoverUrl,
} from '../../lib/posts';
import type { Post } from '../../types';
import Button from '../ui/Button';
import './CreatePostModal.css';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated?: (newPost: Post) => void;
  /** When set, the modal edits this post instead of creating a new one. */
  editing?: Post | null;
  onPostUpdated?: (post: Post) => void;
}

interface PostFormProps {
  editing?: Post | null;
  onClose: () => void;
  onPostCreated?: (newPost: Post) => void;
  onPostUpdated?: (post: Post) => void;
}

function PostForm({ editing, onClose, onPostCreated, onPostUpdated }: PostFormProps) {
  const { user, getSupabaseToken } = useAuth();

  const [title, setTitle] = useState(editing?.title ?? '');
  const [excerpt, setExcerpt] = useState(editing?.excerpt ?? '');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState(editing?.tags?.join('، ') ?? '');
  const [coverInput, setCoverInput] = useState(editing?.coverImageUrl ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingBody, setLoadingBody] = useState(Boolean(editing));
  const [errorMsg, setErrorMsg] = useState('');
  // Which submit button was pressed (publish vs. save-as-draft).
  const submitModeRef = useRef<'publish' | 'draft'>('publish');

  const isEditing = Boolean(editing);

  // Guard: the author identity is required to save anything to the database.
  const canPublish = Boolean(user?.id && user.id !== 'anonymous');

  // Edit mode: cards carry excerpts only, so fetch the full content once.
  // setState happens in the async callback only (lint-safe).
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    supabase
      .from('posts')
      .select('content')
      .eq('id', editing.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setContent(typeof data?.content === 'string' ? data.content : '');
          setLoadingBody(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once per edited post
  }, [editing?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loadingBody) return;
    if (!title.trim()) {
      setErrorMsg('حط عنوان للمقال أول');
      return;
    }
    if (!content.trim()) {
      setErrorMsg('اكتب محتوى المقال أول');
      return;
    }
    if (coverInput.trim() && !normalizeCoverUrl(coverInput)) {
      setErrorMsg('حط رابط صورة صحيح يبدأ بـ http');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      if (!canPublish) {
        throw new Error('لازم تسجّل دخولك عشان تنشر المقال.');
      }

      const token = await getSupabaseToken();
      const profile = {
        id: user!.id,
        name: user!.name,
        email: user!.email,
        avatarUrl: user!.avatarUrl,
      };

      if (editing) {
        const updated = await updatePostInSupabase(editing.id, editing.author.id, token, {
          title,
          excerpt,
          content,
          tags: parseTagsInput(tagsInput),
          coverImageUrl: coverInput.trim() || undefined,
          isPublished: editing.isPublished,
        });
        if (onPostUpdated) onPostUpdated(updated);
        setIsSubmitting(false);
        onClose();
        return;
      }

      const publish = submitModeRef.current === 'publish';
      const newPost = await createPostInSupabase(
        {
          title,
          excerpt,
          content,
          tags: parseTagsInput(tagsInput),
          coverImageUrl: coverInput.trim() || undefined,
          isPublished: publish,
        },
        token,
        profile
      );

      if (onPostCreated) {
        onPostCreated(newPost);
      }

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

  return (
    <>
      <div className="create-post-modal__header">
        <h2 id="create-post-title" className="create-post-modal__heading">
          {isEditing ? 'تعديل المقال' : 'اكتب مقال جديد'}
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
          <label htmlFor="post-cover" className="create-post-modal__label">
            صورة الغلاف <span className="create-post-modal__optional">(اختياري — رابط)</span>
          </label>
          <input
            id="post-cover"
            type="url"
            dir="ltr"
            className="create-post-modal__input"
            placeholder="https://..."
            value={coverInput}
            onChange={(e) => setCoverInput(e.target.value)}
            maxLength={2048}
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
            placeholder={isEditing && loadingBody ? 'نحمّل المحتوى...' : 'اكتب المقال كامل هنا... (يدعم تنسيق ماركداون)'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            disabled={loadingBody}
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
          {isEditing ? (
            <Button
              variant="primary"
              type="submit"
              disabled={isSubmitting || loadingBody}
            >
              {isSubmitting ? 'نحفظ التعديلات...' : 'حفظ التعديلات'}
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                type="submit"
                disabled={isSubmitting}
                onClick={() => {
                  submitModeRef.current = 'draft';
                }}
              >
                {isSubmitting ? 'نحفظ...' : 'حفظ كمسودة'}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={isSubmitting}
                onClick={() => {
                  submitModeRef.current = 'publish';
                }}
              >
                {isSubmitting ? 'ننشر المقال...' : 'نشر المقال'}
              </Button>
            </>
          )}
        </div>
      </form>
    </>
  );
}

function CreatePostModal({ isOpen, onClose, onPostCreated, editing, onPostUpdated }: CreatePostModalProps) {
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

  // Keyed so the form remounts fresh on every open (no stale state, no
  // open-sync effect needed).
  const formKey = editing ? `edit-${editing.id}` : 'create';

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
        <PostForm
          key={formKey}
          editing={editing}
          onClose={onClose}
          onPostCreated={onPostCreated}
          onPostUpdated={onPostUpdated}
        />
      </div>
    </div>,
    document.body
  );
}

export default CreatePostModal;
