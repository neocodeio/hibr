import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { CHAT_SEEN_EVENT, CHAT_SEEN_PREFIX, CHAT_SYNC_EVENT } from './chatCache';
import {
  probeChatTables,
  listConversations,
  listRecentMessages,
  subscribeMyChat,
} from './chat';
import type { ChatMessageRow } from './chat';

function loadSeen(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`${CHAT_SEEN_PREFIX}${userId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    // ignore
  }
  return {};
}

function countUnread(
  rows: ChatMessageRow[],
  convIds: Set<string>,
  seen: Record<string, string>,
  myId: string
): number {
  let total = 0;
  for (const row of rows) {
    if (row.sender_id === myId) continue;
    if (!convIds.has(row.conversation_id)) continue;
    const seenAt = seen[row.conversation_id];
    if (!seenAt || row.created_at > seenAt) total += 1;
  }
  return total;
}

const ChatUnreadContext = createContext<number>(0);

/** Total unread chat messages for the viewer (0 when signed out). */
export function useChatUnread(): number {
  return useContext(ChatUnreadContext);
}

/**
 * App-wide unread-chat counter. Mounted once per user session (the parent
 * is keyed by user id, so state never leaks across accounts).
 *
 * It counts message rows — no decryption involved — using the same
 * read-marks the chat page writes. Live via the same realtime feed, so the
 * navbar/sidebar badge lights up the moment a message arrives, on ANY page.
 *
 * Resilience (this is why a badge must never need /chat open first):
 * - initial load retries with backoff (the Supabase JWT may not be ready
 *   on the very first tick → RLS would return empty once and never again);
 * - a transient empty result never wipes previously good ids;
 * - refocus / visibility / chat-page syncs all trigger catch-up;
 * - a dropped realtime channel resubscribes (bounded).
 */
export function ChatUnreadProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, getSupabaseToken } = useAuth();
  const [chatOn, setChatOn] = useState(false);
  const [convIds, setConvIds] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ChatMessageRow[]>([]);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [channelKey, setChannelKey] = useState(0);
  const userId = user?.id ?? null;

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Realtime handlers read through a ref so the subscription is created
  // once per channelKey and never goes stale (no resubscribe loops).
  const liveRef = useRef({ convIds, userId });
  useEffect(() => {
    liveRef.current = { convIds, userId };
  }, [convIds, userId]);

  // Set once a full load completes — gates the boot retries below.
  const readyRef = useRef(false);
  // Last catch-up timestamp — throttles focus/visibility refetch storms.
  const lastCatchUpRef = useRef(0);
  // Bounded realtime recovery attempts (reset on every clean connect).
  const resubAttemptsRef = useRef(0);

  // Skip everything until the chat migration is confirmed present.
  useEffect(() => {
    let cancelled = false;
    probeChatTables().then((on) => {
      if (!cancelled) setChatOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshIdsAndRows = useCallback(async () => {
    if (!user) return;
    try {
      const token = await getSupabaseToken();
      const convs = await listConversations(user.id, token);
      if (!aliveRef.current) return;
      // Never let a transient (RLS/token) empty wipe good known ids.
      setConvIds((prev) =>
        convs.length === 0 && prev.size > 0 ? prev : new Set(convs.map((c) => c.id))
      );
      const recent = await listRecentMessages(
        convs.map((c) => c.id),
        token,
        150
      );
      if (!aliveRef.current) return;
      setRows(recent);
      readyRef.current = true;
    } catch {
      // Badge keeps its last value; retries + refocus cover it later.
    }
  }, [user, getSupabaseToken]);

  const catchUp = useCallback(
    (throttled = true) => {
      if (!user) return;
      const now = Date.now();
      if (throttled && now - lastCatchUpRef.current < 10000) return;
      lastCatchUpRef.current = now;
      setSeen(loadSeen(user.id));
      void refreshIdsAndRows();
    },
    [user, refreshIdsAndRows]
  );

  // Initial load (+ bounded boot retries while nothing ever completed).
  useEffect(() => {
    if (!isAuthenticated || !user || !chatOn) return;
    let cancelled = false;
    setSeen(loadSeen(user.id));
    void refreshIdsAndRows();
    const timers: number[] = [];
    for (const ms of [2500, 8000]) {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled && aliveRef.current && !readyRef.current) {
            void refreshIdsAndRows();
          }
        }, ms)
      );
    }
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [isAuthenticated, user, chatOn, refreshIdsAndRows]);

  const mergeRow = useCallback((row: ChatMessageRow) => {
    setRows((prev) => {
      if (prev.some((m) => m.id === row.id)) return prev;
      return [...prev, row].slice(-300);
    });
  }, []);

  // Live feed: new messages bump the badge instantly on any page.
  useEffect(() => {
    if (!isAuthenticated || !user || !chatOn) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const token = await getSupabaseToken();
      if (cancelled || !aliveRef.current) return;
      unsubscribe = subscribeMyChat(token, {
        onStatus: (s) => {
          if (cancelled || !aliveRef.current) return;
          if (s === 'live') {
            resubAttemptsRef.current = 0;
          } else if (s === 'offline' && resubAttemptsRef.current < 5) {
            resubAttemptsRef.current += 1;
            window.setTimeout(() => {
              if (!cancelled && aliveRef.current) setChannelKey((k) => k + 1);
            }, 4000);
          }
        },
        onInsert: (row) => {
          // Brand-new DM started by the peer — pull ids + previews.
          if (!liveRef.current.convIds.has(row.conversation_id)) {
            void refreshIdsAndRows();
          }
          mergeRow(row);
        },
        onDelete: ({ id }) => {
          setRows((prev) => prev.filter((m) => m.id !== id));
        },
        onConversationsChanged: () => {
          void refreshIdsAndRows();
        },
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isAuthenticated, user, chatOn, channelKey, getSupabaseToken, mergeRow, refreshIdsAndRows]);

  // ChatPage broadcasts CHAT_SEEN_EVENT when it marks threads read and
  // CHAT_SYNC_EVENT after every successful load — either one heals this
  // badge even if the boot tick ran before the token was ready.
  // Refocus/visibility also catch up (covers other tabs + sleep).
  useEffect(() => {
    if (!user) return;
    const onSeen = () => setSeen(loadSeen(user.id));
    const onSync = () => catchUp(false);
    const onFocus = () => catchUp(true);
    const onVisible = () => {
      if (!document.hidden) catchUp(true);
    };
    window.addEventListener(CHAT_SEEN_EVENT, onSeen);
    window.addEventListener(CHAT_SYNC_EVENT, onSync);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(CHAT_SEEN_EVENT, onSeen);
      window.removeEventListener(CHAT_SYNC_EVENT, onSync);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, catchUp]);

  const chatUnread = useMemo(
    () => (userId ? countUnread(rows, convIds, seen, userId) : 0),
    [rows, convIds, seen, userId]
  );

  return (
    <ChatUnreadContext.Provider value={chatUnread}>
      {children}
    </ChatUnreadContext.Provider>
  );
}
