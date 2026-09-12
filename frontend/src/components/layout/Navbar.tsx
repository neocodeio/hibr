import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useClerk } from '@clerk/clerk-react';
import Logo from '../ui/Logo';
import Button from '../ui/Button';
import {
  Moon02Icon,
  Sun01Icon,
  UserIcon,
  Bookmark02Icon,
  Settings01Icon,
  Logout01Icon,
  Search01Icon,
  Cancel01Icon,
  Notification01Icon,
} from 'hugeicons-react';
import { useTheme } from '../../lib/ThemeProvider';
import { useAuth } from '../../lib/AuthContext';
import { useSocial } from '../../lib/SocialContext';
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
  const { unreadCount, notificationsOn } = useSocial();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Expanding navbar search. The query lives in the URL (?q=) so the feed
  // filters from anywhere: live while on the feed, on submit otherwise.
  const [searchOpen, setSearchOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onFeed = location.pathname === '/';
  const urlQuery = searchParams.get('q') ?? '';
  const searchValue = onFeed ? urlQuery : draft;

  const writeQueryParam = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value.trim());
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const openSearch = () => {
    if (!onFeed) setDraft(urlQuery);
    setSearchOpen(true);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    if (!onFeed) setDraft('');
  };

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const handleSearchChange = (value: string) => {
    if (onFeed) writeQueryParam(value);
    else setDraft(value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onFeed) {
      searchInputRef.current?.blur();
      return;
    }
    if (!draft.trim()) return;
    navigate(`/?q=${encodeURIComponent(draft.trim())}`);
  };

  const clearSearch = () => {
    if (onFeed) writeQueryParam('');
    else setDraft('');
    searchInputRef.current?.focus();
  };

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
        <div className="navbar__start">
          <div className="navbar__logo">
            <Link to="/" aria-label="الرئيسية">
              <Logo />
            </Link>
          </div>

          <nav className="navbar__nav" aria-label="التنقل الرئيسي">
            <Link to="/" className="navbar__link">المقالات</Link>
            <Link to="/trending" className="navbar__link">الرائج</Link>
            {/* {isAuthenticated && (
              <Link to="/saved" className="navbar__link">المحفوظ</Link> KEEP IT LIKE THIS!
            )} */}
          </nav>
        </div>

        <div className="navbar__actions">
          <div className={`navbar__search${searchOpen ? ' navbar__search--open' : ''}`} role="search">
            <button
              type="button"
              className="navbar__search-toggle"
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
              aria-expanded={searchOpen}
              aria-label="بحث"
            >
              <Search01Icon size={18} strokeWidth={1.75} />
            </button>
            <form className="navbar__search-field" onSubmit={handleSearchSubmit}>
              <label htmlFor="navbar-search" className="sr-only">
                دوّر بالمقالات
              </label>
              <input
                ref={searchInputRef}
                id="navbar-search"
                type="search"
                className="navbar__search-input"
                placeholder="دوّر على مقال..."
                value={searchValue}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeSearch();
                }}
                tabIndex={searchOpen ? 0 : -1}
                aria-hidden={!searchOpen}
                autoComplete="off"
              />
              {searchOpen && searchValue && (
                <button
                  type="button"
                  className="navbar__search-clear"
                  onClick={clearSearch}
                  aria-label="امسح البحث"
                  tabIndex={searchOpen ? 0 : -1}
                >
                  <Cancel01Icon size={14} strokeWidth={2} />
                </button>
              )}
            </form>
          </div>

          {isAuthenticated && notificationsOn && (
            <Link
              to="/notifications"
              className="navbar__bell"
              aria-label={unreadCount > 0 ? `الإشعارات — ${unreadCount} غير مقروء` : 'الإشعارات'}
            >
              <Notification01Icon size={18} strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="navbar__bell-badge" aria-hidden="true">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          )}

          <button
            type="button"
            className="navbar__theme-toggle"
            onClick={toggleTheme}
              aria-label={theme === 'light' ? 'شغّل الوضع الليلي' : 'شغّل الوضع النهاري'}
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
                      <span>صفحتي</span>
                    </Link>
                    <Link
                      to="/saved"
                      className="navbar__menu-item"
                      role="menuitem"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <Bookmark02Icon size={18} strokeWidth={1.5} />
                      <span>المحفوظ</span>
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
                      <span>إعدادات الحساب</span>
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
