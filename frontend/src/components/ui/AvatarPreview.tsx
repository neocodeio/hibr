import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Cancel01Icon } from 'hugeicons-react';
import './AvatarPreview.css';

interface AvatarPreviewProps {
  /** Image URL — render nothing while null (same pattern as ShareModal). */
  src: string | null;
  name: string;
  onClose: () => void;
}

function AvatarPreview({ src, name, onClose }: AvatarPreviewProps) {
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    },
    [handleClose]
  );

  useEffect(() => {
    if (!src) return;
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [src, handleKeyDown]);

  if (!src) return null;

  return createPortal(
    <div className="avatar-preview-backdrop" onClick={handleClose} role="presentation">
      <button
        type="button"
        className="avatar-preview__close"
        onClick={handleClose}
        aria-label="إغلاق"
        autoFocus
      >
        <Cancel01Icon size={20} strokeWidth={2} />
      </button>
      <figure
        className="avatar-preview__figure"
        role="dialog"
        aria-modal="true"
        aria-label={`صورة ${name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <img className="avatar-preview__image" src={src} alt={`صورة ${name}`} />
        <figcaption className="avatar-preview__caption">{name}</figcaption>
      </figure>
    </div>,
    document.body
  );
}

export default AvatarPreview;
