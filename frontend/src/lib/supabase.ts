import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '⚠️ Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env — database features will be unavailable and the app will fall back to the backend API / mock data.'
  );
}

/** Base URL of the Express backend API (overridable via VITE_API_URL). */
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

if (
  typeof window !== 'undefined' &&
  !import.meta.env.VITE_API_URL &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1'
) {
  console.warn(
    '⚠️ VITE_API_URL is not set — API calls fall back to http://localhost:5000 and will fail in production. Set VITE_API_URL to your deployed backend URL.'
  );
}

/**
 * Creates a Supabase client configured with Clerk JWT authentication.
 * Pass the Clerk `getToken` function to inject the JWT into Supabase requests,
 * ensuring Supabase Row Level Security (RLS) is strictly enforced per user.
 */
export function getSupabaseClient(clerkToken?: string | null) {
  return createClient(supabaseUrl || 'http://placeholder.invalid', supabaseAnonKey || 'placeholder-key', {
    global: {
      headers: clerkToken
        ? { Authorization: `Bearer ${clerkToken}` }
        : {},
    },
  });
}

/**
 * Standard anonymous Supabase client for public read-only operations.
 */
export const supabase = createClient(
  supabaseUrl || 'http://placeholder.invalid',
  supabaseAnonKey || 'placeholder-key'
);
