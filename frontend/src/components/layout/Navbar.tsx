import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useClerk } from '@clerk/clerk-react';
import Logo from '../ui/Logo';
import Button from '../ui/Button';
import {
  Moon02Icon,
  Sun01Icon,
  UserIcon,
  Settings01Icon,
  Logout01Icon,
} from 'hugeicons-react';
import { useTheme } from '../../lib/ThemeProvider';
import { useAuth } from '../../lib/AuthContext';
import './Navbar.css';

function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const {
    isAuthenticated,
    user,
    openSignInModal,
    openCreatePostModal,
    signOut,
  } = useAuth();
  const { openUserProfile } = useClerk();
  const navigate = useNavigate();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the account menu on outside click or Escape.
  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleSignOut = async () => {
    setIsMenuOpen(false);
    await signOut();
    navigate('/');
  };

  return (
    <header className="navbar" role="banner">
      <div className="navbar__inner">
        <div className="navbar__logo">
          <Link to="/" aria-label="الرئيسية">
            <Logo />
          </Link>
        </div>

        <nav className="navbar__nav" aria-label="التنقل الرئيسي">
          <Link to="/" className="navbar__link">المقالات</Link>
        </nav>

        <div className="navbar__actions">
          <button
            type="button"
            className="navbar__theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'تفعيل الوضع الليلي' : 'تفعيل الوضع النهاري'}
          >
            {theme === 'light' ? <Moon02Icon size={18} strokeWidth={1.5} /> : <Sun01Icon size={18} strokeWidth={1.5} />}
          </button>

          {isAuthenticated ? (
            <div className="navbar__user-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={openCreatePostModal}
              >
                ابدأ الكتابة
              </Button>
              <div className="navbar__profile" ref={menuRef}>
                <button
                  type="button"
                  className="navbar__avatar-btn"
                  onClick={() => setIsMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={isMenuOpen}
                  aria-label="قائمة الحساب"
                >
                  {user?.avatarUrl ? (
                    <img
                      className="navbar__avatar-img"
                      src={user.avatarUrl}
                      alt=""
                    />
                  ) : (
                    <span className="navbar__avatar-fallback" aria-hidden="true">
                      {(user?.name || 'ح').trim().charAt(0)}
                    </span>
                  )}
                </button>

                {isMenuOpen && user && (
                  <div className="navbar__menu" role="menu" aria-label="قائمة الحساب">
                    <div className="navbar__menu-header">
                      <span className="navbar__menu-name">{user.name}</span>
                      {user.email && (
                        <span className="navbar__menu-email" dir="ltr">
                          {user.email}
                        </span>
                      )}
                    </div>
                    <Link
                      to={user.username ? `/profile/${user.username}` : `/profile/${user.id}`}
                      className="navbar__menu-item"
                      role="menuitem"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <UserIcon size={18} strokeWidth={1.5} />
                      <span>بروفايلي</span>
                    </Link>
                    <button
                      type="button"
                      className="navbar__menu-item"
                      role="menuitem"
                      onClick={() => {
                        setIsMenuOpen(false);
                        // Clerk renders this modal itself — pass the
                        // close-button position through its official
                        // appearance API (mirrored by the
                        // .cl-modalCloseButton override in index.css).
                        openUserProfile({
                          appearance: {
                            elements: {
                              modalCloseButton: {
                                right: 'auto',
                                left: '16px',
                              },
                            },
                          },
                        });
                      }}
                    >
                      <Settings01Icon size={18} strokeWidth={1.5} />
                      <span>إدارة الحساب</span>
                    </button>
                    <button
                      type="button"
                      className="navbar__menu-item"
                      role="menuitem"
                      onClick={handleSignOut}
                    >
                      <Logout01Icon size={18} strokeWidth={1.5} />
                      <span>تسجيل الخروج</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={openSignInModal}>
                سجّل دخولك
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={openCreatePostModal}
              >
                ابدأ الكتابة
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default Navbar;
