import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Webhook } from 'svix';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase Admin Client (Service Role Key or Anon Key)
const supabaseUrl = process.env.SUPABASE_URL || 'https://wmfftwbgjgrafustxwxd.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_bZ5L5IoCYAiyXdctUR1zHQ_SWSYeEb-';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

app.use(cors({ origin: '*' }));

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
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  };

// Webhook endpoint requires raw body for Svix signature verification
app.post('/api/webhooks/clerk', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
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
  let evt: any;

  try {
    evt = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  } catch (err: any) {
    console.error('❌ Error verifying Clerk webhook signature:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const { type, data } = evt;
  console.log(`Received Clerk Webhook: ${type}`);

  if (type === 'user.created' || type === 'user.updated') {
    const userId = data.id;
    const email = data.email_addresses?.[0]?.email_address || '';
    const name = `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.username || email.split('@')[0];
    const avatarUrl = data.image_url || '';

    const { error } = await supabaseAdmin.from('users').upsert(
      {
        id: userId,
        email,
        name,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (error) {
      console.error('❌ Error syncing user to Supabase:', error);
      return res.status(500).json({ error: 'Database sync failed' });
    }

    console.log(`✅ User ${userId} successfully synced to Supabase!`);
  } else if (type === 'user.deleted') {
    const userId = data.id;
    const { error } = await supabaseAdmin.from('users').delete().eq('id', userId);
    if (error) {
      console.error('❌ Error deleting user from Supabase:', error);
    }
  }

  return res.status(200).json({ success: true });
}));

// JSON body parser for normal API endpoints (after the raw-body webhook route)
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Hibr Backend API', version: '1.0.0' });
});

// Manual profile sync endpoint
app.post('/api/users/sync', asyncHandler(async (req, res) => {
  const { id, email, name, avatarUrl } = req.body;

  if (!id || !email) {
    return res.status(400).json({ error: 'Missing required user fields (id, email)' });
  }

  const { data, error } = await supabaseAdmin.from('users').upsert(
    {
      id,
      email,
      name,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  ).select().single();

  if (error) {
    console.error('Error syncing user:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, user: data });
}));

// Fetch all published posts
app.get('/api/posts', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('posts')
    .select('*, author:users(*)')
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching posts:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ posts: data });
}));

// Create a new post endpoint
app.post('/api/posts', asyncHandler(async (req, res) => {
  const { authorId, title, slug, excerpt, content, readTime, authorName } = req.body;

  if (!authorId || !title || !content) {
    return res.status(400).json({ error: 'Missing required post fields' });
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
        name: authorName || 'كاتب حِبر',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('posts')
    .insert([
      {
        author_id: authorId,
        title: title.trim(),
        slug: slug || `${Date.now()}`,
        excerpt: excerpt || content.slice(0, 160) + '...',
        content: content.trim(),
        read_time: readTime || 5,
        likes_count: 0,
        comments_count: 0,
        is_published: true,
        published_at: now,
        created_at: now,
      },
    ])
    .select('*, author:users(*)')
    .single();

  if (error) {
    console.error('Error creating post in Supabase:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`✅ Post "${title}" created successfully in Supabase!`);
  res.json({ success: true, post: data });
}));

app.listen(PORT, () => {
  console.log(`🚀 Hibr Backend Server running on http://localhost:${PORT}`);
});
