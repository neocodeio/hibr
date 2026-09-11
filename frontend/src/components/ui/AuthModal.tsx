import { useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SignIn, SignUp } from '@clerk/clerk-react';
import { Cancel01Icon } from 'hugeicons-react';
import { useAuth } from '../../lib/AuthContext';
import { useTheme } from '../../lib/ThemeProvider';
import './AuthModal.css';

function AuthModal() {
  const { isModalOpen, closeModal, authModalMode, setAuthModalMode } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const clerkAppearance = useMemo(
    () => ({
      variables: {
        colorPrimary: isDark ? '#ededed' : '#0a0a0a',
        colorTextOnPrimaryButton: isDark ? '#0a0a0a' : '#fafafa',
        colorBackground: 'transparent',
        colorText: isDark ? '#e5e5e5' : 'var(--color-ink)',
        colorTextSecondary: isDark ? '#a3a3a3' : 'var(--color-muted)',
        colorInputBackground: isDark ? '#171717' : 'var(--color-white)',
        colorInputText: isDark ? '#e5e5e5' : 'var(--color-ink)',
        colorDanger: isDark ? '#f87171' : '#dc2626',
        borderRadius: '10px',
        fontFamily: 'var(--font-base)',
      },
      elements: {
        rootBox: 'hibr-clerk-root',
        cardBox: 'hibr-clerk-card-box',
        card: 'hibr-clerk-card',
        headerTitle: 'hibr-clerk-title',
        headerSubtitle: 'hibr-clerk-subtitle',
        socialButtonsBlockButton: 'hibr-clerk-social-btn',
        dividerLine: 'hibr-clerk-divider-line',
        dividerText: 'hibr-clerk-divider-text',
        formFieldLabel: 'hibr-clerk-field-label',
        formFieldInput: 'hibr-clerk-field-input',
        formButtonPrimary: 'hibr-clerk-primary-btn',
        form: 'hibr-clerk-form',
        footer: 'hibr-clerk-footer',
        footerActionLink: 'hibr-clerk-footer-link',
        alert: 'hibr-clerk-alert',
      },
    }),
    [isDark]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    },
    [closeModal]
  );

  // Clerk renders its own "switch mode" footer link inside SignIn/SignUp.
  // Left alone it performs a full-page navigation to Clerk's hosted pages.
  // Intercept it at capture phase (before Clerk's own handler runs) and
  // switch OUR tab instead — the Clerk component remounts fresh.
  // The footer wrapper carries a `cl-footerAction__signIn|signUp` marker
  // naming the CURRENT screen, so __signIn means "go to signup" and
  // vice versa. Anything unrecognized is left untouched.
  const handleClerkFooterNavigate = useCallback(
    (e: React.MouseEvent) => {
      const link = (e.target as Element).closest?.('.hibr-clerk-footer-link');
      if (!link) return;
      const action = link.closest('[class*="cl-footerAction__"]');
      const actionClasses = action?.getAttribute('class') || '';
      if (actionClasses.includes('cl-footerAction__signIn')) {
        e.preventDefault();
        e.stopPropagation();
        setAuthModalMode('signup');
      } else if (actionClasses.includes('cl-footerAction__signUp')) {
        e.preventDefault();
        e.stopPropagation();
        setAuthModalMode('signin');
      }
    },
    [setAuthModalMode]
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

  // Remember what opened the dialog so focus can be restored on close.
  useEffect(() => {
    if (isModalOpen) {
      lastFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (lastFocusedRef.current && document.contains(lastFocusedRef.current)) {
      lastFocusedRef.current.focus({ preventScroll: true });
      lastFocusedRef.current = null;
    }
  }, [isModalOpen]);

  // Lightweight focus trap: keep Tab cycling inside the dialog.
  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const candidates = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const focusables = Array.from(candidates).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen, authModalMode]);

  if (!isModalOpen) return null;

  // Portal: ancestor transforms / filters / stacking contexts can never
  // trap the fixed backdrop or clip the dialog.
  return createPortal(
    <div
      className="auth-modal-backdrop"
      onClick={closeModal}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label={authModalMode === 'signin' ? 'دخول' : 'حساب جديد'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-modal__topbar">
          <button
            className="auth-modal__close"
            onClick={closeModal}
            aria-label="إغلاق"
            type="button"
          >
            <Cancel01Icon size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="auth-modal__tabs" role="tablist" aria-label="اختر دخول أو حساب جديد">
          <button
            type="button"
            role="tab"
            aria-selected={authModalMode === 'signin'}
            className={`auth-modal__tab ${authModalMode === 'signin' ? 'auth-modal__tab--active' : ''}`}
            onClick={() => setAuthModalMode('signin')}
          >
            دخول
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={authModalMode === 'signup'}
            className={`auth-modal__tab ${authModalMode === 'signup' ? 'auth-modal__tab--active' : ''}`}
            onClick={() => setAuthModalMode('signup')}
          >
            حساب جديد
          </button>
        </div>

        <div className="auth-modal__clerk-container" onClickCapture={handleClerkFooterNavigate}>
          {authModalMode === 'signin' ? (
            <SignIn routing="virtual" appearance={clerkAppearance} />
          ) : (
            <SignUp routing="virtual" appearance={clerkAppearance} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default AuthModal;
