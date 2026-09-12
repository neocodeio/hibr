import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useUser, useAuth as useClerkAuth, useClerk } from '@clerk/clerk-react';
import { getSupabaseClient, API_BASE_URL } from './supabase';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  username: string | null; // Clerk username — pretty key for /profile/:username
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoaded: boolean;
  user: UserProfile | null;
  isModalOpen: boolean;
  authModalMode: 'signin' | 'signup';
  isCreatePostOpen: boolean;
  setAuthModalMode: (mode: 'signin' | 'signup') => void;
  requireAuth: (onSuccess?: () => void) => boolean;
  closeModal: () => void;
  openSignInModal: () => void;
  openSignUpModal: () => void;
  openCreatePostModal: () => void;
  closeCreatePostModal: () => void;
  signOut: () => Promise<void>;
  getSupabaseToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// OAuth (e.g. Google) leaves the page and comes back, wiping in-memory
// state. Persisting the modal means the signup "continue" step (username)
// reopens inside OUR modal on return instead of falling back to Clerk's
// hosted pages. sessionStorage survives the same-tab round-trip and dies
// with the tab, so abandoned flows never haunt later visits.
const AUTH_MODAL_STORAGE_KEY = 'hibr:auth-modal';
const CREATE_AFTER_AUTH_STORAGE_KEY = 'hibr:create-after-auth';

type PersistedAuthMode = 'signin' | 'signup';

function readPersistedAuthMode(): PersistedAuthMode | null {
  try {
    const raw = sessionStorage.getItem(AUTH_MODAL_STORAGE_KEY);
    return raw === 'signin' || raw === 'signup' ? raw : null;
  } catch {
    return null;
  }
}

function persistAuthMode(mode: PersistedAuthMode) {
  try {
    sessionStorage.setItem(AUTH_MODAL_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable — the modal simply won't survive a reload.
  }
}

function clearPersistedAuthMode() {
  try {
    sessionStorage.removeItem(AUTH_MODAL_STORAGE_KEY);
  } catch {
    // noop
  }
}

function readCreateAfterAuth(): boolean {
  try {
    return sessionStorage.getItem(CREATE_AFTER_AUTH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistCreateAfterAuth() {
  try {
    sessionStorage.setItem(CREATE_AFTER_AUTH_STORAGE_KEY, '1');
  } catch {
    // noop
  }
}

function clearCreateAfterAuth() {
  try {
    sessionStorage.removeItem(CREATE_AFTER_AUTH_STORAGE_KEY);
  } catch {
    // noop
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { isSignedIn, isLoaded, user: clerkUser } = useUser();
  const { getToken } = useClerkAuth();
  const { signOut: clerkSignOut } = useClerk();

  // Reopen the modal on boot when an OAuth round-trip is in flight —
  // the <SignUp>/<SignIn> with routing="virtual" then picks up the pending
  // flow (e.g. the required-username step) right inside our modal.
  const [isModalOpen, setIsModalOpen] = useState(() => readPersistedAuthMode() !== null);
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [authModalMode, setAuthModalModeState] = useState<PersistedAuthMode>(
    () => readPersistedAuthMode() ?? 'signin'
  );
  const pendingActionRef = useRef<(() => void) | null>(null);

  const setAuthModalMode = useCallback((mode: 'signin' | 'signup') => {
    setAuthModalModeState(mode);
    persistAuthMode(mode);
  }, []);

  const isAuthenticated = Boolean(isSignedIn);

  // Format user profile (memoized so its identity is stable across renders)
  const user: UserProfile | null = useMemo(
    () =>
      clerkUser
        ? {
            id: clerkUser.id,
            name: clerkUser.fullName || clerkUser.username || clerkUser.primaryEmailAddress?.emailAddress?.split('@')[0] || 'كاتب حِبر',
            email: clerkUser.primaryEmailAddress?.emailAddress || '',
            avatarUrl: clerkUser.imageUrl || '',
            username: clerkUser.username ?? null,
          }
        : null,
    [clerkUser]
  );

  // After authentication: run any pending action (same-session), reopen
  // the composer when it was requested before an OAuth reload, then always
  // close the modal and clear the round-trip flags. Storage writes stay
  // synchronous (external-system sync); the UI transitions are deferred to
  // a microtask so this effect never triggers cascading renders.
  useEffect(() => {
    if (!isAuthenticated) return;
    clearPersistedAuthMode();
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    const wantsComposer = readCreateAfterAuth();
    clearCreateAfterAuth();
    queueMicrotask(() => {
      if (pending) pending();
      else if (wantsComposer) setIsCreatePostOpen(true);
      setIsModalOpen(false);
    });
  }, [isAuthenticated]);

  // Sync user profile to Supabase public.users table on login/signup
  useEffect(() => {
    if (isAuthenticated && user) {
      const syncUserToSupabase = async () => {
        // 1. Client-side sync via Supabase JWT
        try {
          const token = await getToken({ template: 'supabase' });
          const client = getSupabaseClient(token);
          const baseRecord = {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar_url: user.avatarUrl,
            updated_at: new Date().toISOString(),
          };
          const { error } = await client
            .from('users')
            .upsert({ ...baseRecord, username: user.username }, { onConflict: 'id' });
          if (error && (error.code === '42703' || /username/i.test(error.message || ''))) {
            // The `username` column hasn't been added in Supabase yet —
            // sync without it so login never breaks (pre-SQL fallback).
            await client.from('users').upsert(baseRecord, { onConflict: 'id' });
          }
        } catch {
          // Client-side sync failed — the backend sync below acts as failsafe
        }

        // 2. Failsafe: Backend API sync (RLS-enforced with the caller's JWT)
        try {
          const syncToken = await getToken({ template: 'supabase' }).catch(() => null);
          await fetch(`${API_BASE_URL}/api/users/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(syncToken ? { Authorization: `Bearer ${syncToken}` } : {}),
            },
            body: JSON.stringify({
              id: user.id,
              email: user.email,
              name: user.name,
              avatarUrl: user.avatarUrl,
            }),
          });
        } catch {
          // Backend offline fallback - client sync handled it
        }
      };
      syncUserToSupabase();
    }
  }, [isAuthenticated, user, getToken]);

  const requireAuth = useCallback(
    (onSuccess?: () => void): boolean => {
      if (!isAuthenticated) {
        if (onSuccess) pendingActionRef.current = onSuccess;
        setAuthModalMode('signup');
        setIsModalOpen(true);
        return false;
      }
      if (onSuccess) onSuccess();
      return true;
    },
    [isAuthenticated, setAuthModalMode]
  );

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    pendingActionRef.current = null;
    clearPersistedAuthMode();
    clearCreateAfterAuth();
  }, []);

  const openSignInModal = useCallback(() => {
    setAuthModalMode('signin');
    setIsModalOpen(true);
  }, [setAuthModalMode]);

  const openSignUpModal = useCallback(() => {
    setAuthModalMode('signup');
    setIsModalOpen(true);
  }, [setAuthModalMode]);

  const openCreatePostModal = useCallback(() => {
    if (!isAuthenticated) {
      // Remember across a possible OAuth reload so the composer still
      // opens after sign-in (the in-memory pending action would be lost).
      persistCreateAfterAuth();
      requireAuth(() => setIsCreatePostOpen(true));
    } else {
      setIsCreatePostOpen(true);
    }
  }, [isAuthenticated, requireAuth]);

  const closeCreatePostModal = useCallback(() => {
    setIsCreatePostOpen(false);
  }, []);

  const signOut = useCallback(async () => {
    clearPersistedAuthMode();
    clearCreateAfterAuth();
    await clerkSignOut();
  }, [clerkSignOut]);

  const getSupabaseToken = useCallback(async (): Promise<string | null> => {
    try {
      return await getToken({ template: 'supabase' });
    } catch (error) {
      console.error('Failed to get Supabase JWT from Clerk:', error);
      return null;
    }
  }, [getToken]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoaded,
        user,
        isModalOpen,
        authModalMode,
        isCreatePostOpen,
        setAuthModalMode,
        requireAuth,
        closeModal,
        openSignInModal,
        openSignUpModal,
        openCreatePostModal,
        closeCreatePostModal,
        signOut,
        getSupabaseToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context + hook intentionally co-located
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
