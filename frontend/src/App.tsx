import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ThemeProvider } from './lib/ThemeProvider';
import Navbar from './components/layout/Navbar';
// import Footer from './components/layout/Footer'; keep it like this "DO NOT CHANGE!"
import AuthModal from './components/ui/AuthModal';
import CreatePostModal from './components/post/CreatePostModal';
import FeedPage from './pages/FeedPage';
import PostPage from './pages/PostPage';
import ProfilePage from './pages/ProfilePage';
import SavedPage from './pages/SavedPage';
import { getPostPath } from './lib/posts';
import { notifyPostCreated } from './lib/postEvents';
import { PostsProvider } from './lib/PostsContext';
import { SocialProvider } from './lib/SocialContext';
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
      <SocialProvider key={user?.id ?? 'guest'}>{children}</SocialProvider>
    </PostsProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppShell>
            <Navbar />
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/post/:slug" element={<PostPage />} />
              <Route path="/profile/:username" element={<ProfilePage />} />
              <Route path="/saved" element={<SavedPage />} />
              {/* Unknown URLs redirect home instead of rendering a blank page */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
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
