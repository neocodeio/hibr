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

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { isSignedIn, isLoaded, user: clerkUser } = useUser();
  const { getToken } = useClerkAuth();
  const { signOut: clerkSignOut } = useClerk();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signin');
  const pendingActionRef = useRef<(() => void) | null>(null);

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

  // Execute pending action after authentication
  useEffect(() => {
    if (isAuthenticated && pendingActionRef.current) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      action();
      setIsModalOpen(false);
    }
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

        // 2. Failsafe: Backend API sync (runs with admin privileges)
        try {
          await fetch(`${API_BASE_URL}/api/users/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    [isAuthenticated]
  );

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    pendingActionRef.current = null;
  }, []);

  const openSignInModal = useCallback(() => {
    setAuthModalMode('signin');
    setIsModalOpen(true);
  }, []);

  const openSignUpModal = useCallback(() => {
    setAuthModalMode('signup');
    setIsModalOpen(true);
  }, []);

  const openCreatePostModal = useCallback(() => {
    if (!isAuthenticated) {
      requireAuth(() => setIsCreatePostOpen(true));
    } else {
      setIsCreatePostOpen(true);
    }
  }, [isAuthenticated, requireAuth]);

  const closeCreatePostModal = useCallback(() => {
    setIsCreatePostOpen(false);
  }, []);

  const signOut = useCallback(async () => {
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
