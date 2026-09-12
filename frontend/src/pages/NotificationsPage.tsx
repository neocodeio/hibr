import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useSocial } from '../lib/SocialContext';
import { getPostPath, getProfilePath } from '../lib/posts';
import { formatRelativeTime } from '../lib/date';
import type { AppNotification } from '../types';
import Button from '../components/ui/Button';
import { useDocumentMeta } from '../lib/documentMeta';
import './NotificationsPage.css';

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0) : 'ح';
}

function notificationText(n: AppNotification): string {
  switch (n.type) {
    case 'like':
      return 'عجب بمقالك';
    case 'comment':
      return 'علّق على مقالك';
    case 'reply':
      return 'رد على تعليقك';
    case 'follow':
      return 'بدأ يتابعك';
  }
}

function notificationTarget(n: AppNotification): string {
  if (n.type === 'follow') return getProfilePath(n.actor);
  if (n.postSlug) {
    const base = getPostPath({ slug: n.postSlug });
    return n.type === 'comment' || n.type === 'reply' ? `${base}#comments` : base;
  }
  return '/';
}

function NotificationsPage() {
  const { isAuthenticated, openSignInModal } = useAuth();
  const {
    notifications,
    unreadCount,
    notificationsOn,
    markNotificationRead,
    markAllNotificationsRead,
  } = useSocial();
  useDocumentMeta('الإشعارات', 'إشعارات حسابك في حِبر.');

  if (!isAuthenticated) {
    return (
      <main className="notifications-page" id="main-content">
        <div className="notifications-page__empty">
          <h1>الإشعارات</h1>
          <p>سجّل دخولك عشان تشوف إشعاراتك.</p>
          <Button variant="primary" size="sm" onClick={openSignInModal}>
            سجّل دخولك
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="notifications-page" id="main-content">
      <div className="notifications-page__wrapper">
        <div className="notifications-page__bar">
          <h1>الإشعارات</h1>
          {unreadCount > 0 && (
            <button
              type="button"
              className="notifications-page__mark-all"
              onClick={() => void markAllNotificationsRead()}
            >
              علّم الكل كمقروء
            </button>
          )}
        </div>

        <section className="notifications-page__list" aria-label="قائمة الإشعارات">
          <h1 className="sr-only">الإشعارات</h1>
          {!notificationsOn ? (
            <div className="notifications-page__status" role="status">
              الإشعارات مو متاحة الحين.
            </div>
          ) : notifications.length === 0 ? (
            <div className="notifications-page__empty-list">
              <p>ما عندك إشعارات للحين.</p>
              <p>إذا عجب أحد بمقالك أو علّق عليه أو تابعك، بتشوفه هنا.</p>
            </div>
          ) : (
            notifications.map((n) => (
              <Link
                key={n.id}
                to={notificationTarget(n)}
                className={`notifications-page__item${n.isRead ? '' : ' notifications-page__item--unread'}`}
                onClick={() => void markNotificationRead(n.id)}
              >
                <span className="notifications-page__avatar" aria-hidden="true">
                  {n.actor.avatarUrl ? (
                    <img src={n.actor.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{getInitial(n.actor.name)}</span>
                  )}
                </span>
                <span className="notifications-page__content">
                  <span className="notifications-page__text">
                    <strong>{n.actor.name}</strong> {notificationText(n)}
                    {n.postTitle && n.type !== 'follow' && (
                      <span className="notifications-page__post">: {n.postTitle}</span>
                    )}
                  </span>
                  <time className="notifications-page__date" dateTime={n.createdAt}>
                    {formatRelativeTime(n.createdAt)}
                  </time>
                </span>
                {!n.isRead && <span className="notifications-page__dot" aria-hidden="true" />}
              </Link>
            ))
          )}
        </section>
      </div>
    </main>
  );
}

export default NotificationsPage;
