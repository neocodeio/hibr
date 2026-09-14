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

const explicitApiUrl = (import.meta.env.VITE_API_URL as string | undefined) || '';
const onLocalhost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

/**
 * True when backend API calls can actually succeed: either VITE_API_URL is
 * set, or the app runs on localhost (where the localhost fallback is valid).
 * All backend failsafe fetches must check this first — otherwise production
 * builds spam CORS/ERR_FAILED errors against http://localhost:5000.
 */
export function isBackendApiConfigured(): boolean {
  return Boolean(explicitApiUrl) || onLocalhost;
}

let warnedBackendApi = false;

/**
 * Backend fetch that fails soft (null) when the API isn't configured,
 * instead of throwing CORS/network errors into the console on production.
 */
export async function fetchBackendApi(
  path: string,
  init?: RequestInit
): Promise<Response | null> {
  if (!isBackendApiConfigured()) {
    if (!warnedBackendApi) {
      warnedBackendApi = true;
      console.warn(
        '⚠️ Backend API is not configured — skipping API failsafe. Set VITE_API_URL to your deployed backend URL.'
      );
    }
    return null;
  }
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    return null;
  }
}

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
 *
 * Clients are cached per token: creating a new client per call spawns
 * duplicate GoTrue instances ("Multiple GoTrueClient instances detected")
 * and leaks memory. The cache is capped so rotated tokens can't grow it
 * without bound.
 */
const clientCache = new Map<string, typeof supabase>();

export function getSupabaseClient(clerkToken?: string | null) {
  const key = clerkToken || 'anon';
  const cached = clientCache.get(key);
  if (cached) return cached;
  const client = createClient(supabaseUrl || 'http://placeholder.invalid', supabaseAnonKey || 'placeholder-key', {
    global: {
      headers: clerkToken
        ? { Authorization: `Bearer ${clerkToken}` }
        : {},
    },
  });
  if (clientCache.size >= 5) {
    const oldest = clientCache.keys().next();
    if (!oldest.done) clientCache.delete(oldest.value);
  }
  clientCache.set(key, client);
  return client;
}

/**
 * Standard anonymous Supabase client for public read-only operations.
 */
export const supabase = createClient(
  supabaseUrl || 'http://placeholder.invalid',
  supabaseAnonKey || 'placeholder-key'
);
