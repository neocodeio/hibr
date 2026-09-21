import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { CHAT_SEEN_EVENT, CHAT_SEEN_PREFIX } from './chatCache';
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
 * `hibr:chat-seen:<userId>` read-marks the chat page writes. Live via the
 * same realtime feed, so the navbar/sidebar badge lights up the moment a
 * message arrives, on ANY page. ChatPage itself is untouched apart from
 * broadcasting a window event when it marks threads read.
 */
export function ChatUnreadProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, getSupabaseToken } = useAuth();
  const [chatOn, setChatOn] = useState(false);
  const [convIds, setConvIds] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ChatMessageRow[]>([]);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const userId = user?.id ?? null;

  // Realtime handlers read through a ref so the subscription is created
  // once and never goes stale (no resubscribe loops).
  const liveRef = useRef({ convIds, userId });
  useEffect(() => {
    liveRef.current = { convIds, userId };
  }, [convIds, userId]);

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
      setConvIds(new Set(convs.map((c) => c.id)));
      const recent = await listRecentMessages(
        convs.map((c) => c.id),
        token,
        150
      );
      setRows(recent);
    } catch {
      // Badge stays at its last value; realtime + refocus retry later.
    }
  }, [user, getSupabaseToken]);

  // Initial load (counts only — no spinners anywhere; it's a badge).
  useEffect(() => {
    if (!isAuthenticated || !user || !chatOn) return;
    setSeen(loadSeen(user.id));
    void refreshIdsAndRows();
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
      if (cancelled) return;
      unsubscribe = subscribeMyChat(token, {
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
  }, [isAuthenticated, user, chatOn, getSupabaseToken, mergeRow, refreshIdsAndRows]);

  // ChatPage broadcasts this when it marks threads read; refocus also
  // reloads marks (covers reads from another tab).
  useEffect(() => {
    if (!user) return;
    const reloadSeen = () => setSeen(loadSeen(user.id));
    const onVisible = () => {
      if (!document.hidden) reloadSeen();
    };
    window.addEventListener(CHAT_SEEN_EVENT, reloadSeen);
    window.addEventListener('focus', reloadSeen);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(CHAT_SEEN_EVENT, reloadSeen);
      window.removeEventListener('focus', reloadSeen);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

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
