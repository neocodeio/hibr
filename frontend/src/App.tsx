import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { ThemeProvider } from './lib/ThemeProvider';
import Navbar from './components/layout/Navbar';
// import Footer from './components/layout/Footer'; keep it like this "DO NOT CHANGE!"
import AuthModal from './components/ui/AuthModal';
import FeedPage from './pages/FeedPage';
import PostPage from './pages/PostPage';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Navbar />
          <Routes>
            <Route path="/" element={<FeedPage />} />
            <Route path="/post/:slug" element={<PostPage />} />
          </Routes>
          {/* <Footer /> */}
          <AuthModal />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
