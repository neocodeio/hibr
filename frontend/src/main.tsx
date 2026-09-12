import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { arSA } from '@clerk/localizations';
import './index.css';
import App from './App.tsx';

const PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  console.error(
    'Missing Clerk Publishable Key. Please ensure VITE_CLERK_PUBLISHABLE_KEY is set in frontend/.env'
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {PUBLISHABLE_KEY ? (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} localization={arSA}>
        <App />
      </ClerkProvider>
    ) : (
      <div dir="rtl" style={{ padding: '4rem 1.5rem', textAlign: 'center', fontFamily: 'inherit' }}>
        <h1>الإعداد ناقص</h1>
        <p>مفتاح الدخول (Clerk) مو مضبوط. اضبط VITE_CLERK_PUBLISHABLE_KEY ثم أعد التحميل.</p>
      </div>
    )}
  </StrictMode>
);
