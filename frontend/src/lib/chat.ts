import { getSupabaseClient, supabase } from './supabase';
import { ensureIdentity, isValidPublicJwk } from './chatCrypto';
import type { PublicJwk } from './chatCrypto';

export interface ChatPeer {
  id: string;
  name: string;
  avatarUrl: string;
  username: string | null;
  publicKey: PublicJwk | null;
}

export interface ChatConversation {
  id: string;
  peer: ChatPeer;
  lastMessageAt: string;
  createdAt: string;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  ciphertext: string;
  iv: string;
  created_at: string;
}

/** Escape user text for a PostgREST `like/ilike` pattern (%, _, ,, (, ) break `or=`). */
function sanitizeLike(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/,/g, '')
    .replace(/[()]/g, '')
    .replace(/"/g, '')
    .replace(/;/g, '')
    .trim();
}

function toPeer(row: {
  id: string;
  name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  public_key?: unknown;
}): ChatPeer {
  return {
    id: row.id,
    name: (row.name || 'كاتب حِبر').trim() || 'كاتب حِبر',
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : '',
    username: typeof row.username === 'string' ? row.username : null,
    publicKey: isValidPublicJwk(row.public_key) ? row.public_key : null,
  };
}

/** False when the chat migration hasn't run yet — UI stays hidden. */
export async function probeChatTables(): Promise<boolean> {
  try {
    const { error } = await supabase.from('conversations').select('id').limit(1);
    if (!error) return true;
    // PostgREST "table not found" errors mean the migration hasn't run.
    if (error.code === 'PGRST205' || /could not find the table|schema cache/i.test(error.message || '')) {
      return false;
    }
    // Any other error (e.g. RLS with anon key) still means the table exists.
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures this device has an identity keypair and that our public key is
 * published to users.public_key so peers can encrypt to us.
 */
export async function ensureChatIdentity(
  myId: string,
  token: string | null
): Promise<{ publicJwk: PublicJwk; privateKey: CryptoKey }> {
  const identity = await ensureIdentity(myId);
  try {
    const client = getSupabaseClient(token);
    const { data } = await client.from('users').select('public_key').eq('id', myId).single();
    const stored = (data as { public_key?: unknown } | null)?.public_key;
    if (!isValidPublicJwk(stored) || stored.x !== identity.publicJwk.x || stored.y !== identity.publicJwk.y) {
      await client.from('users').update({ public_key: identity.publicJwk }).eq('id', myId);
    }
  } catch {
    // Publishing failure is non-fatal — encryption still works locally;
    // the peer just can't start new threads until our key is published.
  }
  return identity;
}

export async function getPeerPublicKey(peerId: string, token: string | null): Promise<PublicJwk | null> {
  try {
    const client = getSupabaseClient(token);
    const { data, error } = await client.from('users').select('public_key').eq('id', peerId).single();
    if (error || !data) return null;
    const key = (data as { public_key?: unknown }).public_key;
    return isValidPublicJwk(key) ? key : null;
  } catch {
    return null;
  }
}

export async function searchChatUsers(
  query: string,
  myId: string,
  token: string | null
): Promise<ChatPeer[]> {
  const q = sanitizeLike(query);
  if (q.length < 1) return [];
  try {
    const client = getSupabaseClient(token);
    const { data, error } = await client
      .from('users')
      .select('id,name,avatar_url,username,public_key')
      .or(`name.ilike.%${q}%,username.ilike.%${q}%`)
      .neq('id', myId)
      .limit(8);
    if (error || !data) return [];
    return (data as Array<{ id: string; name?: string | null; avatar_url?: string | null; username?: string | null; public_key?: unknown }>).map(toPeer);
  } catch {
    return [];
  }
}

async function myConversationIds(myId: string, token: string | null): Promise<string[]> {
  const client = getSupabaseClient(token);
  const { data, error } = await client
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', myId)
    .limit(200);
  if (error || !data) return [];
  return (data as Array<{ conversation_id: string }>).map((r) => r.conversation_id);
}

export async function getOrCreateConversation(
  myId: string,
  peerId: string,
  token: string | null
): Promise<string> {
  if (peerId === myId) throw new Error('لا يمكنك مراسلة نفسك');
  const client = getSupabaseClient(token);
  // Look for an existing DM with exactly these two participants.
  const mine = await myConversationIds(myId, token);
  if (mine.length > 0) {
    const { data } = await client
      .from('conversation_participants')
      .select('conversation_id,user_id')
      .in('conversation_id', mine);
    if (data) {
      const byConv = new Map<string, string[]>();
      for (const row of data as Array<{ conversation_id: string; user_id: string }>) {
        const list = byConv.get(row.conversation_id) ?? [];
        list.push(row.user_id);
        byConv.set(row.conversation_id, list);
      }
      for (const [convId, members] of byConv) {
        if (members.length === 2 && members.includes(myId) && members.includes(peerId)) {
          return convId;
        }
      }
    }
  }
  // Create a new DM.
  const { data: conv, error: convError } = await client
    .from('conversations')
    .insert({ created_by: myId })
    .select('id')
    .single();
  if (convError || !conv) throw new Error(convError?.message || 'تعذر إنشاء المحادثة');
  const convId = (conv as { id: string }).id;
  const { error: partError } = await client.from('conversation_participants').insert([
    { conversation_id: convId, user_id: myId },
    { conversation_id: convId, user_id: peerId },
  ]);
  if (partError) throw new Error(partError.message || 'تعذر إضافة المشاركين');
  return convId;
}

export async function listConversations(myId: string, token: string | null): Promise<ChatConversation[]> {
  try {
    const client = getSupabaseClient(token);
    const mine = await myConversationIds(myId, token);
    if (mine.length === 0) return [];
    const { data: convs, error } = await client
      .from('conversations')
      .select('id,created_at,last_message_at')
      .in('id', mine)
      .order('last_message_at', { ascending: false })
      .limit(50);
    if (error || !convs) return [];
    const { data: parts } = await client
      .from('conversation_participants')
      .select('conversation_id,user_id,users!conversation_participants_user_id_fkey(id,name,avatar_url,username,public_key)')
      .in('conversation_id', mine);
    const peerByConv = new Map<string, ChatPeer>();
    const partRows = ((parts ?? []) as unknown as Array<{
      conversation_id: string;
      user_id: string;
      users?: { id: string; name?: string | null; avatar_url?: string | null; username?: string | null; public_key?: unknown } | Array<{ id: string; name?: string | null; avatar_url?: string | null; username?: string | null; public_key?: unknown }> | null;
    }>);
    for (const row of partRows) {
      if (row.user_id === myId) continue;
      const joined = Array.isArray(row.users) ? row.users[0] : row.users;
      if (joined && !peerByConv.has(row.conversation_id)) {
        peerByConv.set(row.conversation_id, toPeer(joined));
      }
    }
    // Fallback: if the FK join name differs, fetch peers directly.
    const missing = (convs as Array<{ id: string }>).map((c) => c.id).filter((id) => !peerByConv.has(id));
    if (missing.length > 0) {
      const { data: direct } = await client
        .from('conversation_participants')
        .select('conversation_id,user_id')
        .in('conversation_id', missing);
      const peerIds = [...new Set(((direct ?? []) as Array<{ user_id: string }>).map((r) => r.user_id).filter((id) => id !== myId))];
      if (peerIds.length > 0) {
        const { data: users } = await client
          .from('users')
          .select('id,name,avatar_url,username,public_key')
          .in('id', peerIds);
        const byId = new Map(
          (((users ?? []) as Array<{ id: string; name?: string | null; avatar_url?: string | null; username?: string | null; public_key?: unknown }>)).map((u) => [u.id, toPeer(u)])
        );
        for (const row of ((direct ?? []) as Array<{ conversation_id: string; user_id: string }>)) {
          if (row.user_id === myId) continue;
          const peer = byId.get(row.user_id);
          if (peer && !peerByConv.has(row.conversation_id)) peerByConv.set(row.conversation_id, peer);
        }
      }
    }
    return (convs as Array<{ id: string; created_at: string; last_message_at: string }>)
      .map((c) => {
        const peer = peerByConv.get(c.id);
        if (!peer) return null;
        return { id: c.id, peer, lastMessageAt: c.last_message_at, createdAt: c.created_at };
      })
      .filter((c): c is ChatConversation => c !== null);
  } catch {
    return [];
  }
}

export async function listMessages(conversationId: string, token: string | null): Promise<ChatMessageRow[]> {
  const client = getSupabaseClient(token);
  const { data, error } = await client
    .from('messages')
    .select('id,conversation_id,sender_id,ciphertext,iv,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error || !data) return [];
  return data as ChatMessageRow[];
}

/** Latest messages across my conversations in ONE query (previews + unread). */
export async function listRecentMessages(
  conversationIds: string[],
  token: string | null,
  limit = 120
): Promise<ChatMessageRow[]> {
  if (conversationIds.length === 0) return [];
  try {
    const client = getSupabaseClient(token);
    const { data, error } = await client
      .from('messages')
      .select('id,conversation_id,sender_id,ciphertext,iv,created_at')
      .in('conversation_id', conversationIds.slice(0, 200))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as ChatMessageRow[]).slice().reverse();
  } catch {
    return [];
  }
}

/** Messages in one thread created after `afterIso` (realtime gap-fill / polling). */
export async function listMessagesAfter(
  conversationId: string,
  afterIso: string,
  token: string | null
): Promise<ChatMessageRow[]> {
  try {
    const client = getSupabaseClient(token);
    const { data, error } = await client
      .from('messages')
      .select('id,conversation_id,sender_id,ciphertext,iv,created_at')
      .eq('conversation_id', conversationId)
      .gt('created_at', afterIso)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error || !data) return [];
    return data as ChatMessageRow[];
  } catch {
    return [];
  }
}
/** Send one E2EE message (ciphertext only ever touches the server). */
export async function sendEncryptedMessage(
  conversationId: string,
  senderId: string,
  ciphertext: string,
  iv: string,
  token: string | null
): Promise<ChatMessageRow> {
  if (!ciphertext || ciphertext.length > 20000) throw new Error('الرسالة طويلة جداً');
  const client = getSupabaseClient(token);
  const { data, error } = await client
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, ciphertext, iv })
    .select('id,conversation_id,sender_id,ciphertext,iv,created_at')
    .single();
  if (error || !data) throw new Error(error?.message || 'تعذر إرسال الرسالة');
  return data as ChatMessageRow;
}

export async function deleteMessage(messageId: string, token: string | null): Promise<void> {
  const client = getSupabaseClient(token);
  const { error } = await client.from('messages').delete().eq('id', messageId);
  if (error) throw new Error(error.message || 'تعذر حذف الرسالة');
}

export interface ChatLiveHandlers {
  onInsert: (row: ChatMessageRow) => void;
  onDelete?: (row: { id: string; conversation_id: string }) => void;
  onConversationsChanged?: () => void;
  onStatus?: (status: 'live' | 'connecting' | 'offline') => void;
}

/**
 * Global live feed for ALL of my conversations.
 *
 * MUST use the authenticated client (Clerk JWT): the old code subscribed
 * with the anon key, and RLS silently dropped every private-message event —
 * that is why "messages are not realtime". No per-conversation filter is
 * used on purpose: RLS already scopes events to conversations I belong to,
 * and one channel covers new DMs created by the peer too.
 */
export function subscribeMyChat(token: string | null, handlers: ChatLiveHandlers): () => void {
  const client = getSupabaseClient(token);
  const channel = client
    .channel('chat:my-feed')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        handlers.onInsert(payload.new as ChatMessageRow);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        const old = payload.old as { id?: string; conversation_id?: string };
        if (old?.id) handlers.onDelete?.({ id: old.id, conversation_id: old.conversation_id ?? '' });
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'conversations' },
      () => {
        handlers.onConversationsChanged?.();
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'conversation_participants' },
      () => {
        handlers.onConversationsChanged?.();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') handlers.onStatus?.('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        handlers.onStatus?.('offline');
      } else {
        handlers.onStatus?.('connecting');
      }
    });
  return () => {
    void client.removeChannel(channel);
  };
}

/**
 * Live inserts for one conversation (authenticated — RLS applies).
 * Kept for compatibility; prefer {@link subscribeMyChat} for the full feed.
 */
export function subscribeConversationMessages(
  conversationId: string,
  onInsert: (row: ChatMessageRow) => void,
  token?: string | null
): () => void {
  const client = token ? getSupabaseClient(token) : supabase;
  const channel = client
    .channel(`chat:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        onInsert(payload.new as ChatMessageRow);
      }
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
