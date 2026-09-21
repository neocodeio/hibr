import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ThemeProvider } from './lib/ThemeProvider';
import Navbar from './components/layout/Navbar';
import Sidebar from './components/layout/Sidebar';
import RightRail from './components/layout/RightRail';
import './components/layout/Shell.css';
// import Footer from './components/layout/Footer'; keep it like this "DO NOT CHANGE!"
import AuthModal from './components/ui/AuthModal';
import CreatePostModal from './components/post/CreatePostModal';
import FeedPage from './pages/FeedPage';
import PostPage from './pages/PostPage';
import ProfilePage from './pages/ProfilePage';
import SavedPage from './pages/SavedPage';
import NotificationsPage from './pages/NotificationsPage';
import ChatPage from './pages/ChatPage';
import TrendingPage from './pages/TrendingPage';
import PeoplePage from './pages/PeoplePage';
import { getPostPath } from './lib/posts';
import { notifyPostCreated } from './lib/postEvents';
import { PostsProvider } from './lib/PostsContext';
import { SocialProvider } from './lib/SocialContext';
import { ChatUnreadProvider } from './lib/ChatUnreadContext';
import type { Post } from './types';

// Mounted once inside the Router + Auth providers so the composer works
// from every page (feed, post, profile) — not just the feed.
function GlobalCreatePostModal() {
  const { isCreatePostOpen, closeCreatePostModal } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handlePostCreated = (newPost: Post) => {
    notifyPostCreated(newPost);
    closeCreatePostModal();
    // Stay on the feed (it prepends via the event); from anywhere else,
    // take the user straight to their new post.
    if (location.pathname !== '/') {
      navigate(getPostPath(newPost));
    }
  };

  return (
    <CreatePostModal
      isOpen={isCreatePostOpen}
      onClose={closeCreatePostModal}
      onPostCreated={handlePostCreated}
    />
  );
}

// Keyed by viewer so SocialProvider remounts with fresh ids on
// sign-in/sign-out instead of leaking one session's state into the next.
function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <PostsProvider>
      <SocialProvider key={user?.id ?? 'guest'}>
        <ChatUnreadProvider>{children}</ChatUnreadProvider>
      </SocialProvider>
    </PostsProvider>
  );
}

// Adds .shell--chat on /chat so the suggestions rail hides and the chat
// card stretches into the freed space. The nav sidebar stays untouched.
function ShellFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isChat = location.pathname === '/chat';
  return <div className={isChat ? 'shell shell--chat' : 'shell'}>{children}</div>;
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppShell>
            <Navbar />
            <ShellFrame>
              <Sidebar />
              <div className="shell__main">
                <Routes>
                  <Route path="/" element={<FeedPage />} />
                  <Route path="/post/:slug" element={<PostPage />} />
                  <Route path="/profile/:username" element={<ProfilePage />} />
                  <Route path="/saved" element={<SavedPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/chat" element={<ChatPage />} />
                  <Route path="/trending" element={<TrendingPage />} />
                  <Route path="/people" element={<PeoplePage />} />
                  {/* Unknown URLs redirect home instead of rendering a blank page */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
              <RightRail />
            </ShellFrame>
            {/* <Footer /> */}
            <AuthModal />
            <GlobalCreatePostModal />
          </AppShell>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
