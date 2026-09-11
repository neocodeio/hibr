import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { Webhook } from 'svix';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

// Initialize Supabase Admin Client (Service Role Key or Anon Key)
const supabaseUrl = process.env.SUPABASE_URL || 'https://wmfftwbgjgrafustxwxd.supabase.co';

/**
 * Pick the first usable Supabase key from the environment, skipping leftover
 * template placeholders (e.g. "your_supabase_service_role_key_here") that
 * would otherwise make every request fail with "Invalid API key".
 */
function resolveSupabaseKey(): string {
  const candidates = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_ANON_KEY,
  ];
  return (
    candidates.find(
      (key) => key && !/your_|example|changeme|placeholder|^xxx/i.test(key.trim())
    ) || ''
  ).trim();
}

const supabaseKey = resolveSupabaseKey();

if (!supabaseKey) {
  console.warn(
    '⚠️ No valid Supabase key found in backend/.env — set SUPABASE_SERVICE_ROLE_KEY ' +
      '(or SUPABASE_ANON_KEY for read-only access).'
  );
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// ── Security headers ────────────────────────────────────────────
// crossOriginResourcePolicy must stay 'cross-origin': the frontend calls
// this API cross-origin, and the default 'same-origin' would make browsers
// refuse those responses.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ── CORS: explicit allowlist, never '*' ─────────────────────────
// Set CORS_ORIGINS in production, e.g.
//   CORS_ORIGINS=https://hibr.space,https://www.hibr.space
// Localhost is only ever allowed outside production (local dev).
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProd && allowedOrigins.length === 0) {
  console.warn(
    '⚠️ CORS_ORIGINS is not set in production — browser clients will be rejected. ' +
      'Set CORS_ORIGINS to your frontend origin(s).'
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Non-browser clients (curl, mobile, server-to-server) send no Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProd && /^http:\/\/localhost:\d+$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed'));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  })
);

// ── Rate limiting ───────────────────────────────────────────────
// NOTE: no `trust proxy` is set — enable it (e.g. app.set('trust proxy', 1))
// only if this API actually runs behind a reverse proxy, otherwise client
// IPs could be spoofed.
function tooManyRequests(_req: express.Request, res: express.Response) {
  res.status(429).json({ error: 'Too many requests, please slow down.' });
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});

// Mutations go through the privileged service-role client — limit harder.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});

// Clerk delivers a handful of webhooks with backoff retries — lenient cap
// so legitimate deliveries are never dropped, abusive ones still are.
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});

app.use(globalLimiter);

// ── Validation helpers ──────────────────────────────────────────
// The service-role client bypasses RLS, so every write path validates
// types, shapes and lengths before touching the database.
const MAX_TITLE_LENGTH = 200;
const MAX_EXCERPT_LENGTH = 500;
const MAX_CONTENT_LENGTH = 300000;
const MAX_NAME_LENGTH = 120;
const MAX_ID_LENGTH = 128;
const MAX_SLUG_LENGTH = 120;

// Letters/numbers (any script, incl. Arabic), underscore, hyphen.
const SLUG_RE = /^[\p{L}\p{N}_-]{1,120}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
  );
}

function isOptionalString(value: unknown, maxLength: number): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && value.length <= maxLength)
  );
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * True when a Supabase error means the named column doesn't exist yet
 * (table predates a migration or the PostgREST schema cache is stale).
 */
function isMissingColumnError(err: unknown, column: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; message?: unknown };
  if (record.code === 'PGRST204') return true;
  return (
    typeof record.message === 'string' &&
    record.message.toLowerCase().includes(column.toLowerCase()) &&
    /column|schema/i.test(record.message)
  );
}

/**
 * 500 responses never leak driver internals. In development the real message
 * is returned for debuggability; in production callers get a generic message
 * while the details stay in the server logs.
 */
function serverError(
  res: express.Response,
  err: unknown,
  publicMessage: string
) {
  console.error('❌ Backend error:', err);
  const detail =
    !isProd && err instanceof Error && err.message ? `: ${err.message}` : '';
  return res.status(500).json({ error: `${publicMessage}${detail}` });
}

/**
 * Wraps async route handlers so rejections are forwarded to Express's error
 * handling instead of leaving the request hanging (Express 4 does not catch
 * rejected promises from async handlers on its own).
 */
const asyncHandler =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      console.error('❌ Unhandled route error:', err);
      if (!res.headersSent) {
        serverError(res, err, 'Internal server error');
      }
    });
  };

// Webhook endpoint requires raw body for Svix signature verification
app.post('/api/webhooks/clerk', webhookLimiter, express.raw({ type: 'application/json', limit: '1mb' }), asyncHandler(async (req, res) => {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️ CLERK_WEBHOOK_SECRET is not set in backend/.env');
    return res.status(500).json({ error: 'Webhook secret missing' });
  }

  // Svix headers
  const svixId = req.headers['svix-id'] as string;
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  const svixSignature = req.headers['svix-signature'] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).json({ error: 'Missing Svix headers' });
  }

  const payload = req.body.toString();
  const wh = new Webhook(webhookSecret);
  let evt: { type?: string; data?: Record<string, any> };

  try {
    evt = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as { type?: string; data?: Record<string, any> };
  } catch (err: unknown) {
    console.error('❌ Error verifying Clerk webhook signature:', err instanceof Error ? err.message : err);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const { type, data } = evt;
  if (typeof type !== 'string' || typeof data !== 'object' || data === null) {
    return res.status(400).json({ error: 'Malformed webhook payload' });
  }
  console.log(`Received Clerk Webhook: ${type}`);

  if (type === 'user.created' || type === 'user.updated') {
    const userId = data.id;
    if (typeof userId !== 'string' || userId.length === 0 || userId.length > MAX_ID_LENGTH) {
      return res.status(400).json({ error: 'Malformed webhook payload' });
    }
    const emailAddresses = Array.isArray(data.email_addresses) ? data.email_addresses : [];
    const email = typeof emailAddresses[0]?.email_address === 'string' ? emailAddresses[0].email_address : '';
    const firstName = typeof data.first_name === 'string' ? data.first_name : '';
    const lastName = typeof data.last_name === 'string' ? data.last_name : '';
    const username = typeof data.username === 'string' ? data.username : '';
    const name = `${firstName} ${lastName}`.trim() || username || email.split('@')[0] || 'كاتب حِبر';
    const avatarUrl = typeof data.image_url === 'string' ? data.image_url : '';

    const { error } = await supabaseAdmin.from('users').upsert(
      {
        id: userId,
        email: email.slice(0, 320),
        name: name.slice(0, MAX_NAME_LENGTH),
        avatar_url: isHttpUrl(avatarUrl) ? avatarUrl : '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (error) {
      return serverError(res, error, 'Database sync failed');
    }

    console.log(`✅ User ${userId} successfully synced to Supabase!`);
  } else if (type === 'user.deleted') {
    const userId = data.id;
    if (typeof userId !== 'string' || userId.length === 0 || userId.length > MAX_ID_LENGTH) {
      return res.status(400).json({ error: 'Malformed webhook payload' });
    }
    const { error } = await supabaseAdmin.from('users').delete().eq('id', userId);
    if (error) {
      console.error('❌ Error deleting user from Supabase:', error);
    }
  }

  return res.status(200).json({ success: true });
}));

// JSON body parser for normal API endpoints (after the raw-body webhook route)
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Hibr Backend API', version: '1.0.0' });
});

// Manual profile sync endpoint
app.post('/api/users/sync', writeLimiter, asyncHandler(async (req, res) => {
  const { id, email, name, avatarUrl } = req.body ?? {};

  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
    return res.status(400).json({ error: 'Missing required user fields (id, email)' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 320) {
    return res.status(400).json({ error: 'Missing required user fields (id, email)' });
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > MAX_NAME_LENGTH)) {
    return res.status(400).json({ error: 'Invalid user fields' });
  }
  if (avatarUrl !== undefined && avatarUrl !== '' && !isHttpUrl(avatarUrl)) {
    return res.status(400).json({ error: 'Invalid user fields' });
  }

  const { data, error } = await supabaseAdmin.from('users').upsert(
    {
      id,
      email,
      name: (typeof name === 'string' && name.trim()) || 'كاتب حِبر',
      avatar_url: typeof avatarUrl === 'string' && isHttpUrl(avatarUrl) ? avatarUrl : '',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  ).select().single();

  if (error) {
    return serverError(res, error, 'Could not sync user profile');
  }

  res.json({ success: true, user: data });
}));

// Fetch all published posts
app.get('/api/posts', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('posts')
    .select('*, author:users!posts_author_id_fkey(*)')
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (error) {
    return serverError(res, error, 'Could not fetch posts');
  }

  res.json({ posts: data });
}));

// Create a new post endpoint
app.post('/api/posts', writeLimiter, asyncHandler(async (req, res) => {
  const { authorId, title, slug, excerpt, content, readTime, authorName, tags } = req.body ?? {};

  if (!isNonEmptyString(authorId, MAX_ID_LENGTH) || !isNonEmptyString(title, MAX_TITLE_LENGTH) || !isNonEmptyString(content, MAX_CONTENT_LENGTH)) {
    return res.status(400).json({ error: 'Missing required post fields' });
  }
  if (!isOptionalString(excerpt, MAX_EXCERPT_LENGTH) || !isOptionalString(authorName, MAX_NAME_LENGTH)) {
    return res.status(400).json({ error: 'Invalid post fields' });
  }
  if (slug !== undefined && (typeof slug !== 'string' || !SLUG_RE.test(slug))) {
    return res.status(400).json({ error: 'Invalid post fields' });
  }
  // Tags are optional; each must be a short non-empty string, max 5.
  let cleanTags: string[] = [];
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'Invalid post fields' });
    }
    const seen = new Set<string>();
    for (const item of tags) {
      if (typeof item !== 'string') {
        return res.status(400).json({ error: 'Invalid post fields' });
      }
      const tag = item.trim().slice(0, 30);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleanTags.push(tag);
      if (cleanTags.length >= 5) break;
    }
  }
  const readTimeMinutes =
    readTime === undefined
      ? 5
      : typeof readTime === 'number' && Number.isInteger(readTime) && readTime >= 1 && readTime <= 180
        ? readTime
        : NaN;
  if (Number.isNaN(readTimeMinutes)) {
    return res.status(400).json({ error: 'Invalid post fields' });
  }

  // Guarantee author exists in public.users table
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', authorId)
    .single();

  if (!existingUser) {
    await supabaseAdmin.from('users').upsert(
      {
        id: authorId,
        email: `${authorId}@user.hibr`,
        name: (typeof authorName === 'string' && authorName.trim()) || 'كاتب حِبر',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  }

  const now = new Date().toISOString();
  const baseRow = {
    author_id: authorId,
    title: title.trim(),
    slug: slug || `${Date.now()}`,
    excerpt: excerpt || content.slice(0, 160) + '...',
    content: content.trim(),
    read_time: readTimeMinutes,
    likes_count: 0,
    comments_count: 0,
    is_published: true,
    published_at: now,
    created_at: now,
  };
  const insertRow = (withTags: boolean) =>
    supabaseAdmin
      .from('posts')
      .insert([withTags && cleanTags.length > 0 ? { ...baseRow, tags: cleanTags } : baseRow])
      .select('*, author:users!posts_author_id_fkey(*)')
      .single();

  let { data, error } = await insertRow(true);

  // Pre-migration tables have no tags column — retry bare so the post
  // still saves (tags apply once the migration runs).
  if (error && cleanTags.length > 0 && isMissingColumnError(error, 'tags')) {
    console.warn('Tags column missing, retrying post insert without tags.');
    ({ data, error } = await insertRow(false));
  }

  if (error) {
    return serverError(res, error, 'Could not create post');
  }

  console.log(`✅ Post "${title}" created successfully in Supabase!`);
  res.json({ success: true, post: data });
}));

// Delete a post endpoint (ownership always verified against the stored author)
app.delete('/api/posts/:id', writeLimiter, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { authorId } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'Missing post id' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('posts')
    .select('id, author_id')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Post not found' });
  }

  // authorId is mandatory — without it nobody (not even the author) deletes.
  if (typeof authorId !== 'string' || authorId.length === 0 || existing.author_id !== authorId) {
    return res.status(403).json({ error: 'Not the post author' });
  }

  const { error } = await supabaseAdmin.from('posts').delete().eq('id', id);

  if (error) {
    return serverError(res, error, 'Could not delete post');
  }

  console.log(`🗑️ Post "${id}" deleted successfully from Supabase!`);
  res.json({ success: true });
}));

// CORS rejections (and any other routed error) always answer JSON, never HTML.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof Error && err.message === 'CORS origin not allowed') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  return next(err);
});

app.listen(PORT, () => {
  console.log(`🚀 Hibr Backend Server running on http://localhost:${PORT}`);
});
