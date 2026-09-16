import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useClerk } from '@clerk/clerk-react';
import {
  DiscoverCircleIcon,
  Fire02Icon,
  UserGroupIcon,
  AllBookmarkIcon,
  Notification01Icon,
  Search01Icon,
  Moon02Icon,
  Sun01Icon,
  Settings01Icon,
  Logout01Icon,
  Menu01Icon,
} from 'hugeicons-react';
import { useAuth } from '../../lib/AuthContext';
import { useSocial } from '../../lib/SocialContext';
import { useTheme } from '../../lib/ThemeProvider';
import { useMediaQuery } from '../../lib/useMediaQuery';
import Button from '../ui/Button';
import './Sidebar.css';

/**
 * Desktop-only left rail (≥1024px): search (only while the right rail
 * is hidden, 1024–1300), write CTA, primary nav, theme, account.
 * It fully replaces the old top navbar on desktop, so everything the
 * navbar owned (theme toggle, settings, sign-out) lives here too.
 * Mobile/tablet render nothing — top navbar + bottom tabs cover them.
 */
function Sidebar() {
  const show = useMediaQuery('(min-width: 1024px)');
  const navigate = useNavigate();
  const { openUserProfile } = useClerk();
  const { theme, toggleTheme } = useTheme();
  const {
    isAuthenticated,
    user,
    openSignInModal,
    openCreatePostModal,
    signOut,
  } = useAuth();
  const { unreadCount, notificationsOn } = useSocial();
  const [query, setQuery] = useState('');
  const [brokenAvatarUrl, setBrokenAvatarUrl] = useState<string | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMoreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMoreOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isMoreOpen]);

  if (!show) return null;

  const profilePath = user
    ? user.username
      ? `/profile/${user.username}`
      : `/profile/${user.id}`
    : '/';

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar__link${isActive ? ' sidebar__link--active' : ''}`;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : '/');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <aside className="sidebar" aria-label="التنقل الجانبي">
      <div className="sidebar__sticky">
        <form className="sidebar__search" role="search" onSubmit={handleSearch}>
          <Search01Icon
            size={17}
            strokeWidth={1.75}
            aria-hidden="true"
            className="sidebar__search-icon"
          />
          <label htmlFor="sidebar-search" className="sr-only">
            ابحث في حِبر
          </label>
          <input
            id="sidebar-search"
            type="search"
            className="sidebar__search-input"
            placeholder="ابحث عن مقال أو كاتب..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </form>

        <div className="sidebar__create">
          <Button variant="primary" size="md" onClick={openCreatePostModal}>
            ابدأ الكتابة
          </Button>
        </div>

        <nav className="sidebar__nav" aria-label="أقسام الموقع">
          <NavLink to="/" end className={linkClass}>
            <DiscoverCircleIcon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>الرئيسية</span>
          </NavLink>
          <NavLink to="/trending" className={linkClass}>
            <Fire02Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>الرائج</span>
          </NavLink>
          <NavLink to="/people" className={linkClass}>
            <UserGroupIcon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>الكتّاب</span>
          </NavLink>
          <NavLink to="/saved" className={linkClass}>
            <AllBookmarkIcon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>المحفوظ</span>
          </NavLink>
          {isAuthenticated && notificationsOn && (
            <NavLink to="/notifications" className={linkClass}>
              <Notification01Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>الإشعارات</span>
              {unreadCount > 0 && (
                <span className="sidebar__badge" aria-hidden="true">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </NavLink>
          )}
        </nav>

        <div className="sidebar__bottom">
          {isAuthenticated && user ? (
            <div className="sidebar__account">
              <Link to={profilePath} className="sidebar__who" aria-label="صفحتي">
                <span className="sidebar__avatar" aria-hidden="true">
                  {user.avatarUrl && user.avatarUrl !== brokenAvatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      onError={() => setBrokenAvatarUrl(user.avatarUrl)}
                    />
                  ) : (
                    <span className="sidebar__avatar-fallback">
                      {(user.name || 'ح').trim().charAt(0)}
                    </span>
                  )}
                </span>
                <span className="sidebar__account-meta">
                  <span className="sidebar__account-name">{user.name}</span>
                  {user.email && (
                    <span className="sidebar__account-email" dir="ltr">
                      {user.email}
                    </span>
                  )}
                </span>
              </Link>
              <button
                type="button"
                className="sidebar__logout"
                onClick={handleSignOut}
                aria-label="تسجيل الخروج"
                title="تسجيل الخروج"
              >
                <Logout01Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="sidebar__signin">
              <Button variant="ghost" size="md" onClick={openSignInModal}>
                سجّل دخولك
              </Button>
            </div>
          )}

          <div className="sidebar__more-wrap" ref={moreRef}>
            {isMoreOpen && (
              <div className="sidebar__more-menu" role="menu" aria-label="المزيد">
                <button
                  type="button"
                  role="menuitem"
                  className="sidebar__more-item"
                  onClick={() => {
                    toggleTheme();
                    setIsMoreOpen(false);
                  }}
                >
                  {theme === 'light' ? (
                    <Moon02Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <Sun01Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                  )}
                  <span>{theme === 'light' ? 'الوضع الليلي' : 'الوضع النهاري'}</span>
                </button>
                {isAuthenticated && (
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar__more-item"
                    onClick={() => {
                      setIsMoreOpen(false);
                      openUserProfile({
                        appearance: {
                          elements: {
                            modalCloseButton: { right: 'auto', left: '16px' },
                          },
                        },
                      });
                    }}
                  >
                    <Settings01Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                    <span>إعدادات الحساب</span>
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              className={`sidebar__link sidebar__more-btn${isMoreOpen ? ' sidebar__link--active' : ''}`}
              onClick={() => setIsMoreOpen((open) => !open)}
              aria-expanded={isMoreOpen}
              aria-haspopup="menu"
            >
              <Menu01Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>المزيد</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
