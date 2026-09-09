import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '⚠️ Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env — database features will be unavailable and the app will fall back to the backend API / mock data.'
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
