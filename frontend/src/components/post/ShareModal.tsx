import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Cancel01Icon,
  Copy01Icon,
  Tick02Icon,
  NewTwitterIcon,
  Facebook01Icon,
} from 'hugeicons-react';

import type { Post } from '../../types';
import { getPostUrl } from '../../lib/posts';
import './ShareModal.css';

function SubstackIcon({ size = 22 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" />
    </svg>
  );
}

interface ShareModalProps {
  post: Post | null;
  onClose: () => void;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy fallback below */
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function ShareModal({ post, onClose }: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  const handleClose = useCallback(() => {
    setCopied(false);
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    },
    [handleClose]
  );

  useEffect(() => {
    if (post) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [post, handleKeyDown]);

  if (!post) return null;

  const url = getPostUrl(post);
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(`${post.title} — ${post.excerpt}`);

  const shareTargets = [
    {
      id: 'x',
      label: 'إكس',
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      Icon: NewTwitterIcon,
    },
    {
      id: 'facebook',
      label: 'فيسبوك',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      Icon: Facebook01Icon,
    },
    {
      id: 'substack',
      label: 'سابستاك',
      href: `https://substack.com/notes?text=${encodedText}%20${encodedUrl}`,
      Icon: SubstackIcon,
    },
  ];

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(url);
    setCopied(ok);
    if (ok) {
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  // Rendered in a portal on document.body so ancestor styles
  // (transforms, filters, overflow, stacking contexts — e.g. the
  // post-card hover lift) can never trap the fixed backdrop.
  return createPortal(
    <div className="share-backdrop" onClick={handleClose} role="presentation">
      <div
        className="share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="share-modal__header">
          <h2 id="share-modal-title" className="share-modal__heading">
            مشاركة المقال
          </h2>
          <button
            type="button"
            className="share-modal__close"
            onClick={handleClose}
            aria-label="إغلاق"
            autoFocus
          >
            <Cancel01Icon size={18} strokeWidth={2} />
          </button>
        </div>

        <p className="share-modal__post-title">{post.title}</p>

        <div className="share-modal__copy-row">
          <input
            type="text"
            className="share-modal__link-input"
            value={url}
            readOnly
            onFocus={(e) => e.target.select()}
            aria-label="رابط المقال"
          />
          <button
            type="button"
            className={`share-modal__copy-btn${copied ? ' share-modal__copy-btn--copied' : ''}`}
            onClick={handleCopy}
          >
            {copied ? (
              <Tick02Icon size={16} strokeWidth={2} />
            ) : (
              <Copy01Icon size={16} strokeWidth={1.75} />
            )}
            <span>{copied ? 'تم النسخ' : 'نسخ الرابط'}</span>
          </button>
        </div>

        <div className="share-modal__grid" role="list" aria-label="خيارات المشاركة">
          {shareTargets.map(({ id, label, href, Icon }) => (
            <a
              key={id}
              role="listitem"
              className="share-modal__option"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="share-modal__option-icon">
                <Icon size={22} strokeWidth={1.5} />
              </span>
              <span className="share-modal__option-label">{label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ShareModal;
