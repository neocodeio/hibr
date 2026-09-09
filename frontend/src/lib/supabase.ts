import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Creates a Supabase client configured with Clerk JWT authentication.
 * Pass the Clerk `getToken` function to inject the JWT into Supabase requests,
 * ensuring Supabase Row Level Security (RLS) is strictly enforced per user.
 */
export function getSupabaseClient(clerkToken?: string | null) {
  return createClient(supabaseUrl, supabaseAnonKey, {
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
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
