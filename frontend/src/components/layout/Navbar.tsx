import { Link } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import Logo from '../ui/Logo';
import Button from '../ui/Button';
import { Moon02Icon, Sun01Icon } from 'hugeicons-react';
import { useTheme } from '../../lib/ThemeProvider';
import { useAuth } from '../../lib/AuthContext';
import './Navbar.css';

function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, openSignInModal, openCreatePostModal } = useAuth();

  return (
    <header className="navbar" role="banner">
      <div className="navbar__inner">
        <div className="navbar__logo">
          <Link to="/" aria-label="الرئيسية">
            <Logo />
          </Link>
        </div>

        <nav className="navbar__nav" aria-label="التنقل الرئيسي">
          <Link to="/" className="navbar__link">استكشف</Link>
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
              <UserButton />
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
