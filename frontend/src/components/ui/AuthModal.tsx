import { useEffect, useCallback } from 'react';
import { SignIn, SignUp } from '@clerk/clerk-react';
import { useAuth } from '../../lib/AuthContext';
import './AuthModal.css';

const clerkAppearance = {
  variables: {
    colorPrimary: '#0a0a0a',
    colorBackground: 'transparent',
    colorText: 'var(--color-ink)',
    colorTextSecondary: 'var(--color-muted)',
    colorInputBackground: 'var(--color-white)',
    colorInputText: 'var(--color-ink)',
    borderRadius: '8px',
    fontFamily: 'var(--font-base)',
  },
  elements: {
    rootBox: 'hibr-clerk-root',
    cardBox: 'hibr-clerk-card-box',
    card: 'hibr-clerk-card',
    headerTitle: 'hibr-clerk-title',
    headerSubtitle: 'hibr-clerk-subtitle',
    socialButtonsBlockButton: 'hibr-clerk-social-btn',
    formButtonPrimary: 'hibr-clerk-primary-btn',
    footerActionLink: 'hibr-clerk-footer-link',
  },
};

function AuthModal() {
  const { isModalOpen, closeModal, authModalMode, setAuthModalMode } = useAuth();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    },
    [closeModal]
  );

  useEffect(() => {
    if (isModalOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isModalOpen, handleKeyDown]);

  if (!isModalOpen) return null;

  return (
    <div
      className="auth-modal-backdrop"
      onClick={closeModal}
      role="presentation"
    >
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="auth-modal__close"
          onClick={closeModal}
          aria-label="إغلاق"
          type="button"
        >
          ✕
        </button>

        {/* Tab switcher */}
        <div className="auth-modal__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={authModalMode === 'signin'}
            className={`auth-modal__tab ${authModalMode === 'signin' ? 'auth-modal__tab--active' : ''}`}
            onClick={() => setAuthModalMode('signin')}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={authModalMode === 'signup'}
            className={`auth-modal__tab ${authModalMode === 'signup' ? 'auth-modal__tab--active' : ''}`}
            onClick={() => setAuthModalMode('signup')}
          >
            إنشاء حساب
          </button>
        </div>

        <div className="auth-modal__clerk-container">
          {authModalMode === 'signin' ? (
            <SignIn routing="virtual" appearance={clerkAppearance} />
          ) : (
            <SignUp routing="virtual" appearance={clerkAppearance} />
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
