import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useDocumentMeta } from '../lib/documentMeta';
import { useMediaQuery } from '../lib/useMediaQuery';
import { formatRelativeTime } from '../lib/date';
import Button from '../components/ui/Button';
import {
  probeChatTables,
  ensureChatIdentity,
  getPeerPublicKey,
  searchChatUsers,
  getOrCreateConversation,
  listConversations,
  listMessages,
  listMessagesAfter,
  listRecentMessages,
  sendEncryptedMessage,
  deleteMessage,
  subscribeMyChat,
} from '../lib/chat';
import { encryptForPeer, decryptFromPeer, cryptoAvailable } from '../lib/chatCrypto';
import { getChatSnapshot, setChatSnapshot } from '../lib/chatCache';
import type { PublicJwk } from '../lib/chatCrypto';
import type { ChatConversation, ChatMessageRow, ChatPeer } from '../lib/chat';
import './ChatPage.css';

const MAX_MESSAGE_LENGTH = 2000;
const POLL_MS = 15000;
const NEAR_BOTTOM_PX = 140;
const SEEN_PREFIX = 'hibr:chat-seen:';

/* ── helpers ─────────────────────────────────────────────── */

function peerInitial(name: string): string {
  const t = name.trim();
  return t ? t.charAt(0) : 'ح';
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return 'اليوم';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'أمس';
  }
  return d.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
}

function loadSeen(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`${SEEN_PREFIX}${userId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    // ignore
  }
  return {};
}

function Avatar({ peer, size = 40 }: { peer: ChatPeer; size?: number }) {
  if (peer.avatarUrl) {
    return (
      <span className="chat__avatar" style={{ width: size, height: size }} aria-hidden="true">
        <img src={peer.avatarUrl} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span className="chat__avatar chat__avatar--fallback" style={{ width: size, height: size }} aria-hidden="true">
      {peerInitial(peer.name)}
    </span>
  );
}

type LiveStatus = 'live' | 'connecting' | 'offline';

/* ── page ────────────────────────────────────────────────── */

function ChatPage() {
  const { isAuthenticated, user, openSignInModal, getSupabaseToken } = useAuth();
  useDocumentMeta('الرسائل', 'محادثاتك الخاصة المشفرة في حِبر.');

  // Restored once per mount: if this user already loaded chat earlier in
  // this session, start from the in-memory snapshot (instant, no spinners)
  // and only sync in the background. Keyed by user id — never leaks
  // across accounts.
  const [cached] = useState(() => (user?.id ? getChatSnapshot(user.id) : null));

  const [chatOn, setChatOn] = useState<boolean | null>(() => (cached ? true : null));
  const [identity, setIdentity] = useState<{ publicJwk: PublicJwk; privateKey: CryptoKey } | null>(
    () => cached?.identity ?? null
  );
  const [conversations, setConversations] = useState<ChatConversation[]>(
    () => cached?.conversations ?? []
  );
  const [activeId, setActiveId] = useState<string | null>(() => cached?.activeId ?? null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessageRow[]>>(
    () => cached?.messagesByConv ?? {}
  );
  const [plaintext, setPlaintext] = useState<Record<string, string>>(
    () => cached?.plaintext ?? {}
  );
  const [undecryptable, setUndecryptable] = useState<Set<string>>(
    () => new Set(cached?.undecryptable ?? [])
  );
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatPeer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [startingPeer, setStartingPeer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; timer: number } | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>(() => cached?.seen ?? {});
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [threadOpen, setThreadOpen] = useState(false); // mobile master-detail
  const [nearBottom, setNearBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const searchTimer = useRef<number | null>(null);
  const loadedThreadsRef = useRef<Set<string>>(new Set(cached?.loadedThreads ?? []));
  const nearBottomRef = useRef(true);
  const secureContext = cryptoAvailable();
  const isMobile = useMediaQuery('(max-width: 860px)');

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );
  // Memoized so effects depending on it don't re-fire every render.
  const messages = useMemo(
    () => (active ? (messagesByConv[active.id] ?? []) : []),
    [active, messagesByConv]
  );

  const conversationsRef = useRef<ChatConversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    nearBottomRef.current = nearBottom;
  }, [nearBottom]);

  const showThread = !isMobile || threadOpen;

  /* ── scroll ── */

  const scrollToBottom = useCallback((smooth = true) => {
    const el = threadRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
    setNewBelow(0);
    setNearBottom(true);
  }, []);

  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNear = distance < NEAR_BOTTOM_PX;
    nearBottomRef.current = isNear;
    setNearBottom(isNear);
    if (isNear) setNewBelow(0);
  }, []);

  /* ── crypto ── */

  const decryptRows = useCallback(
    async (rows: ChatMessageRow[], peerKey: PublicJwk | null, priv: CryptoKey) => {
      const ok: Record<string, string> = {};
      const bad = new Set<string>();
      await Promise.all(
        rows.map(async (row) => {
          if (!peerKey) {
            bad.add(row.id);
            return;
          }
          try {
            ok[row.id] = await decryptFromPeer(
              { ciphertext: row.ciphertext, iv: row.iv },
              priv,
              peerKey
            );
          } catch {
            bad.add(row.id);
          }
        })
      );
      if (Object.keys(ok).length > 0) setPlaintext((prev) => ({ ...prev, ...ok }));
      if (bad.size > 0) {
        setUndecryptable((prev) => {
          const next = new Set(prev);
          for (const id of bad) next.add(id);
          return next;
        });
      }
      setUndecryptable((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const row of rows) {
          if (ok[row.id] && next.has(row.id)) {
            next.delete(row.id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    []
  );

  const resolvePeerKey = useCallback(
    async (convId: string): Promise<PublicJwk | null> => {
      const conv = conversationsRef.current.find((c) => c.id === convId);
      if (!conv) return null;
      if (conv.peer.publicKey) return conv.peer.publicKey;
      const token = await getSupabaseToken();
      const fresh = await getPeerPublicKey(conv.peer.id, token);
      if (fresh) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId ? { ...c, peer: { ...c.peer, publicKey: fresh } } : c
          )
        );
      }
      return fresh;
    },
    [getSupabaseToken]
  );

  const decryptIncoming = useCallback(
    async (row: ChatMessageRow, priv: CryptoKey) => {
      const key = await resolvePeerKey(row.conversation_id).catch(() => null);
      if (!key) {
        setUndecryptable((prev) => new Set(prev).add(row.id));
        return;
      }
      try {
        const text = await decryptFromPeer(
          { ciphertext: row.ciphertext, iv: row.iv },
          priv,
          key
        );
        setPlaintext((prev) => ({ ...prev, [row.id]: text }));
        setUndecryptable((prev) => {
          if (!prev.has(row.id)) return prev;
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      } catch {
        setUndecryptable((prev) => new Set(prev).add(row.id));
      }
    },
    [resolvePeerKey]
  );

  const mergeRows = useCallback((convId: string, rows: ChatMessageRow[]) => {
    if (rows.length === 0) return;
    setMessagesByConv((prev) => {
      const current = prev[convId] ?? [];
      const ids = new Set(current.map((m) => m.id));
      const fresh = rows.filter((r) => !ids.has(r.id));
      if (fresh.length === 0) return prev;
      return { ...prev, [convId]: [...current, ...fresh].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)) };
    });
  }, []);

  /* ── 1. probe ── */
  useEffect(() => {
    let cancelled = false;
    probeChatTables().then((on) => {
      if (!cancelled) setChatOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── seen store ── */
  useEffect(() => {
    const id = user?.id;
    // Deferred so the effect body never triggers a cascading render.
    queueMicrotask(() => {
      setSeen(id ? loadSeen(id) : {});
    });
  }, [user]);

  const markSeen = useCallback(
    (convId: string, iso?: string) => {
      if (!user) return;
      const stamp = iso ?? new Date().toISOString();
      setSeen((prev) => {
        if (prev[convId] && prev[convId] >= stamp) return prev;
        const next = { ...prev, [convId]: stamp };
        try {
          localStorage.setItem(`${SEEN_PREFIX}${user.id}`, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [user]
  );

  /* ── snapshot: persist chat state to the in-memory cache so leaving
     /chat and coming back restores instantly (no reload). Realtime +
     background sync on remount keep it fresh. Keyed by user id. ── */
  useEffect(() => {
    if (!user || !identity) return;
    setChatSnapshot({
      userId: user.id,
      identity,
      conversations,
      messagesByConv,
      plaintext,
      undecryptable: [...undecryptable],
      activeId,
      seen,
      loadedThreads: [...loadedThreadsRef.current],
    });
  }, [user, identity, conversations, messagesByConv, plaintext, undecryptable, activeId, seen]);

  /* ── 2. identity + conversations + previews ──
     silent=true = background sync for a restored snapshot: merges fresh
     data without ever showing spinners or touching the error banner. */
  const refreshConversations = useCallback(async (silent = false) => {
    if (!isAuthenticated || !user) return;
    if (!silent) {
      setLoadingConvs(true);
      setError(null);
    }
    try {
      const token = await getSupabaseToken();
      const id = await ensureChatIdentity(user.id, token);
      setIdentity(id);
      const convs = await listConversations(user.id, token);
      setConversations(convs);
      // Substack-style: never auto-select — the thread shows
      // "no chat selected" until the user picks one explicitly.
      setActiveId((prev) => (prev && convs.some((c) => c.id === prev) ? prev : null));
      // One query for previews/unread across all threads.
      if (convs.length > 0) {
        const recent = await listRecentMessages(
          convs.map((c) => c.id),
          token,
          150
        );
        const byConv = new Map<string, ChatMessageRow[]>();
        for (const row of recent) {
          const list = byConv.get(row.conversation_id) ?? [];
          list.push(row);
          byConv.set(row.conversation_id, list);
        }
        setMessagesByConv((prev) => {
          const next = { ...prev };
          for (const [convId, rows] of byConv) {
            const current = next[convId] ?? [];
            const ids = new Set(current.map((m) => m.id));
            const fresh = rows.filter((r) => !ids.has(r.id));
            if (fresh.length > 0 || !next[convId]) {
              next[convId] = [...current, ...fresh].sort(
                (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
              );
            }
          }
          return next;
        });
        // Decrypt previews in the background (per-conversation peer key).
        void (async () => {
          for (const conv of convs) {
            const rows = byConv.get(conv.id);
            if (!rows || rows.length === 0) continue;
            const key = conv.peer.publicKey ?? (await getPeerPublicKey(conv.peer.id, token));
            await decryptRows(rows, key, id.privateKey);
          }
        })();
      }
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'تعذر تحميل المحادثات');
    } finally {
      if (!silent) setLoadingConvs(false);
    }
  }, [isAuthenticated, user, getSupabaseToken, decryptRows]);

  // Boot once per user per mount: first-ever visit does the full load
  // (identity + conversations + previews); a return visit restores from
  // the snapshot instantly and only syncs silently in the background.
  // Realtime (separate effect below) resubscribes on every mount, so
  // nothing missed while away is lost — the silent sync picks it up.
  const bootKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !user || chatOn !== true || !secureContext) return;
    if (bootKeyRef.current === user.id) return;
    bootKeyRef.current = user.id;
    const restored = identity !== null;
    void Promise.resolve().then(() => {
      void refreshConversations(restored);
    });
    // refreshConversations is stable per user session; identity is read
    // intentionally only at boot time to decide full vs silent load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, chatOn, secureContext]);

  /* ── 3. active thread load ── */
  useEffect(() => {
    if (!activeId || !identity || !user) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!loadedThreadsRef.current.has(activeId)) setLoadingMsgs(true);
      setError(null);
    });
    (async () => {
      try {
        const peerKey = await resolvePeerKey(activeId);
        if (cancelled) return;
        const token = await getSupabaseToken();
        const rows = await listMessages(activeId, token);
        if (cancelled) return;
        loadedThreadsRef.current.add(activeId);
        setMessagesByConv((prev) => ({ ...prev, [activeId]: rows }));
        await decryptRows(rows, peerKey, identity.privateKey);
        if (!cancelled && rows.length > 0) {
          markSeen(activeId, rows[rows.length - 1].created_at);
        }
        scrollToBottom(false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'تعذر تحميل الرسائل');
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, identity, user, getSupabaseToken, resolvePeerKey, decryptRows, scrollToBottom, markSeen]);

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const messagesByConvRef = useRef<Record<string, ChatMessageRow[]>>({});
  useEffect(() => {
    messagesByConvRef.current = messagesByConv;
  }, [messagesByConv]);

  /* ── 4. GLOBAL realtime (authenticated — the actual fix) ── */
  useEffect(() => {
    if (!identity || !user || chatOn !== true) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    // Deferred so the effect body never triggers a cascading render.
    queueMicrotask(() => {
      if (!cancelled) setLiveStatus('connecting');
    });
    void (async () => {
      const token = await getSupabaseToken();
      if (cancelled) return;
      unsubscribe = subscribeMyChat(token, {
        onStatus: (s) => {
          if (!cancelled) setLiveStatus(s);
        },
        onConversationsChanged: () => {
          void refreshConversations();
        },
        onDelete: ({ id, conversation_id }) => {
          setMessagesByConv((prev) => {
            const next: Record<string, ChatMessageRow[]> = {};
            let changed = false;
            for (const [convId, rows] of Object.entries(prev)) {
              if (!conversation_id || convId === conversation_id) {
                const filtered = rows.filter((m) => m.id !== id);
                if (filtered.length !== rows.length) changed = true;
                next[convId] = filtered;
              } else {
                next[convId] = rows;
              }
            }
            return changed ? next : prev;
          });
          setPlaintext((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        },
        onInsert: (row) => {
          const known = conversationsRef.current.some((c) => c.id === row.conversation_id);
          if (!known) {
            // Brand-new DM started by the peer — pull the conversation list.
            void refreshConversations();
          }
          mergeRows(row.conversation_id, [row]);
          void decryptIncoming(row, identity.privateKey);
          // Bump thread ordering.
          setConversations((prev) =>
            prev
              .map((c) =>
                c.id === row.conversation_id ? { ...c, lastMessageAt: row.created_at } : c
              )
              .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))
          );
          if (row.conversation_id === activeIdRef.current) {
            if (nearBottomRef.current) scrollToBottom(true);
            else setNewBelow((n) => n + 1);
            markSeen(row.conversation_id, row.created_at);
          }
        },
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, user, chatOn, getSupabaseToken]);

  /* ── 5. polling + refetch safety net (missed realtime, sleep, offline) ── */
  useEffect(() => {
    if (!identity || !user || chatOn !== true) return;
    let timer: number | null = null;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const token = await getSupabaseToken();
        const convId = activeIdRef.current;
        if (convId) {
          const current = messagesByConvRef.current[convId] ?? [];
          const last = current[current.length - 1]?.created_at;
          const fresh = last
            ? await listMessagesAfter(convId, last, token)
            : await listMessages(convId, token);
          if (fresh.length > 0) {
            mergeRows(convId, fresh);
            for (const row of fresh) void decryptIncoming(row, identity.privateKey);
            if (nearBottomRef.current) scrollToBottom(false);
            markSeen(convId, fresh[fresh.length - 1].created_at);
          }
        }
      } catch {
        // polling is best-effort; realtime + manual retry cover failures
      }
    };
    timer = window.setInterval(() => {
      void poll();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    const onFocus = () => {
      void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [identity, user, chatOn, getSupabaseToken, mergeRows, decryptIncoming, scrollToBottom, markSeen]);

  /* ── mark thread seen as new rows arrive while open ── */
  useEffect(() => {
    if (!activeId || messages.length === 0 || !nearBottom) return;
    const convId = activeId;
    const stamp = messages[messages.length - 1].created_at;
    // Only auto-mark when the user is looking at the bottom of the thread.
    // Deferred so the effect body never triggers a cascading render;
    // markSeen itself ignores older stamps, so races are harmless.
    queueMicrotask(() => {
      markSeen(convId, stamp);
    });
  }, [activeId, messages, nearBottom, markSeen]);

  /* ── 6. user search (debounced) ── */
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q || !isAuthenticated || !user) {
      // Deferred so the effect body never triggers a cascading render;
      // `visibleResults` below already hides stale rows for empty queries.
      queueMicrotask(() => {
        setResults([]);
        setSearching(false);
      });
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      setSearching(true);
      setSearchOpen(true);
      void (async () => {
        try {
          const token = await getSupabaseToken();
          const found = await searchChatUsers(q, user.id, token);
          setResults(found);
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query, isAuthenticated, user, getSupabaseToken]);

  // Close search dropdown on outside click / Escape.
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: PointerEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        (document.getElementById('chat-search') as HTMLInputElement | null)?.blur();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [searchOpen]);

  /* ── composer autosize ── */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, activeId]);

  const selectConversation = useCallback(
    (convId: string) => {
      setActiveId(convId);
      setThreadOpen(true);
      setNewBelow(0);
      // Don't steal focus (pop the keyboard) on mobile.
      if (!isMobile) requestAnimationFrame(() => composerRef.current?.focus?.());
    },
    [isMobile]
  );

  const goBackToList = useCallback(() => {
    setThreadOpen(false);
  }, []);

  const visibleResults = query.trim().length > 0 && searchOpen ? results : [];

  const handleStartChat = async (peer: ChatPeer) => {
    if (!user) return;
    setStartingPeer(peer.id);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const convId = await getOrCreateConversation(user.id, peer.id, token);
      const convs = await listConversations(user.id, token);
      setConversations(convs);
      setActiveId(convId);
      setThreadOpen(true);
      setQuery('');
      setResults([]);
      setSearchOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر بدء المحادثة');
    } finally {
      setStartingPeer(null);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!active || !identity || !user || sending) return;
    const text = draft.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setError(`الرسالة طويلة جداً (الحد ${MAX_MESSAGE_LENGTH} حرف)`);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const peerKey = await resolvePeerKey(active.id);
      if (!peerKey) {
        setError('الطرف الآخر لم يفعّل التشفير بعد — لا يمكن الإرسال له حتى يفتح صفحة الرسائل مرة واحدة.');
        setSending(false);
        return;
      }
      const { ciphertext, iv } = await encryptForPeer(text, identity.privateKey, peerKey);
      const token = await getSupabaseToken();
      const row = await sendEncryptedMessage(active.id, user.id, ciphertext, iv, token);
      mergeRows(row.conversation_id, [row]);
      setPlaintext((prev) => ({ ...prev, [row.id]: text }));
      setConversations((prev) =>
        prev
          .map((c) => (c.id === row.conversation_id ? { ...c, lastMessageAt: row.created_at } : c))
          .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))
      );
      markSeen(row.conversation_id, row.created_at);
      setDraft('');
      scrollToBottom(true);
      requestAnimationFrame(() => composerRef.current?.focus?.());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const handleComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Two-tap inline confirm (no ref needed — the expiry timer id lives in state).
  const handleDelete = useCallback(
    async (messageId: string) => {
      if (confirmDelete?.id !== messageId) {
        if (confirmDelete) window.clearTimeout(confirmDelete.timer);
        const timer = window.setTimeout(() => {
          setConfirmDelete((prev) => (prev?.id === messageId ? null : prev));
        }, 3500);
        setConfirmDelete({ id: messageId, timer });
        return;
      }
      window.clearTimeout(confirmDelete.timer);
      setConfirmDelete(null);
      setDeletingId(messageId);
      try {
        const token = await getSupabaseToken();
        await deleteMessage(messageId, token);
        setMessagesByConv((prev) => {
          const next: Record<string, ChatMessageRow[]> = {};
          for (const [convId, rows] of Object.entries(prev)) {
            next[convId] = rows.filter((m) => m.id !== messageId);
          }
          return next;
        });
        setPlaintext((prev) => {
          if (!(messageId in prev)) return prev;
          const next = { ...prev };
          delete next[messageId];
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر حذف الرسالة');
      } finally {
        setDeletingId(null);
      }
    },
    [confirmDelete, getSupabaseToken]
  );

  /* ── derived: unread + previews ── */
  const unreadByConv = useMemo(() => {
    const map: Record<string, number> = {};
    if (!user) return map;
    for (const conv of conversations) {
      const rows = messagesByConv[conv.id] ?? [];
      const seenAt = seen[conv.id];
      let count = 0;
      for (const row of rows) {
        if (row.sender_id === user.id) continue;
        if (!seenAt || row.created_at > seenAt) count += 1;
      }
      if (count > 0) map[conv.id] = count;
    }
    return map;
  }, [conversations, messagesByConv, seen, user]);

  const totalUnread = useMemo(
    () => Object.values(unreadByConv).reduce((a, b) => a + b, 0),
    [unreadByConv]
  );

  const visibleConvs = useMemo(
    () =>
      filter === 'unread'
        ? conversations.filter((c) => (unreadByConv[c.id] ?? 0) > 0)
        : conversations,
    [filter, conversations, unreadByConv]
  );

  // "New message" = search a writer (Substack-style compose button).
  const focusSearch = useCallback(() => {
    setThreadOpen(false);
    setSearchOpen(true);
    requestAnimationFrame(() => {
      (document.getElementById('chat-search') as HTMLInputElement | null)?.focus();
    });
  }, []);

  const previewByConv = useMemo(() => {
    const map: Record<string, string> = {};
    for (const conv of conversations) {
      const rows = messagesByConv[conv.id] ?? [];
      const last = rows[rows.length - 1];
      if (!last) continue;
      const text = plaintext[last.id];
      if (text) map[conv.id] = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    }
    return map;
  }, [conversations, messagesByConv, plaintext]);

  /* ── grouped thread with day dividers ── */
  const threadBlocks = useMemo(() => {
    type Block = { day: string; items: { msg: ChatMessageRow; mine: boolean; grouped: boolean }[] };
    const blocks: Block[] = [];
    let lastDay = '';
    let prevSender = '';
    let prevTime = 0;
    for (const msg of messages) {
      const day = dayKey(msg.created_at);
      if (day !== lastDay) {
        blocks.push({ day: msg.created_at, items: [] });
        lastDay = day;
        prevSender = '';
      }
      const mine = Boolean(user && msg.sender_id === user.id);
      const t = +new Date(msg.created_at);
      const grouped = prevSender === msg.sender_id && t - prevTime < 5 * 60 * 1000;
      prevSender = msg.sender_id;
      prevTime = t;
      blocks[blocks.length - 1].items.push({ msg, mine, grouped });
    }
    return blocks;
  }, [messages, user]);

  /* ── gates ── */

  if (!isAuthenticated) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__gate">
          <span className="chat__gate-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
          </span>
          <h1>الرسائل</h1>
          <p>سجّل دخولك لمراسلة الكتّاب برسائل خاصة مشفرة.</p>
          <Button variant="primary" size="sm" onClick={openSignInModal}>
            تسجيل الدخول
          </Button>
        </div>
      </main>
    );
  }

  if (chatOn === null) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__loading" role="status" aria-label="جارٍ التحميل">
          <div className="chat__spinner" aria-hidden="true" />
          <p>جارٍ التحميل...</p>
        </div>
      </main>
    );
  }

  if (chatOn === false) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__gate">
          <span className="chat__gate-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </span>
          <h1>الرسائل غير متاحة حالياً</h1>
          <p>حدث خطأ في الإعداد. حاول مجدداً لاحقاً.</p>
        </div>
      </main>
    );
  }

  if (!secureContext) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__gate">
          <span className="chat__gate-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </span>
          <h1>الرسائل</h1>
          <p>متصفحك لا يدعم التشفير. استخدم متصفحاً حديثاً عبر اتصال آمن.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`chat${showThread && active ? ' chat--thread-open' : ''}`} id="main-content">
      <div className="chat__layout">
        {/* ── Conversation list ── */}
        <aside className="chat__sidebar" aria-label="المحادثات" aria-hidden={isMobile && showThread && active ? true : undefined}>
          <div className="chat__search" ref={searchBoxRef}>
            <label htmlFor="chat-search" className="sr-only">ابحث عن شخص لمراسلته</label>
            <div className="chat__search-field">
              <span className="chat__search-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
              </span>
              <input
                id="chat-search"
                type="search"
                className="chat__search-input"
                placeholder="بحث عن شخص..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => {
                  if (query.trim()) setSearchOpen(true);
                }}
                autoComplete="off"
              />
              {searching ? (
                <span className="chat__search-spinner" aria-hidden="true" />
              ) : query ? (
                <button
                  type="button"
                  className="chat__search-clear"
                  aria-label="مسح البحث"
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                    setSearchOpen(false);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              ) : null}
            </div>
            {visibleResults.length > 0 && (
              <ul className="chat__results" role="listbox" aria-label="نتائج البحث">
                {visibleResults.map((peer) => (
                  <li key={peer.id}>
                    <button
                      type="button"
                      className="chat__result"
                      onClick={() => void handleStartChat(peer)}
                      disabled={startingPeer === peer.id}
                    >
                      <Avatar peer={peer} size={36} />
                      <span className="chat__result-main">
                        <span className="chat__result-name">{peer.name}</span>
                        {peer.username && <span className="chat__result-handle" dir="ltr">@{peer.username}</span>}
                      </span>
                      <span className="chat__result-state">
                        {startingPeer === peer.id ? '...' : !peer.publicKey ? 'غير مفعّل' : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchOpen && query.trim() && !searching && visibleResults.length === 0 && (
              <div className="chat__results-empty">لا توجد نتائج مطابقة.</div>
            )}
          </div>

          <div className="chat__tabs" role="tablist" aria-label="تصفية المحادثات">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={`chat__tab${filter === 'all' ? ' chat__tab--active' : ''}`}
              onClick={() => setFilter('all')}
            >
              الكل
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'unread'}
              className={`chat__tab${filter === 'unread' ? ' chat__tab--active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              غير المقروءة
              {totalUnread > 0 && (
                <span className="chat__tab-count" aria-label={`${totalUnread} غير مقروءة`}>
                  {totalUnread > 99 ? '+99' : totalUnread}
                </span>
              )}
            </button>
          </div>

          {liveStatus === 'offline' && (
            <div className="chat__offline-bar" role="status">
              <span className="chat__offline-dot" aria-hidden="true" />
              انقطع الاتصال المباشر — سيتم التحديث تلقائياً.
            </div>
          )}

          <ul className="chat__convs" aria-label="قائمة المحادثات">
            {loadingConvs && conversations.length === 0 ? (
              <div className="chat__skeletons" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <li className="chat__skeleton-row" key={i}>
                    <div className="chat__skeleton-avatar" />
                    <div className="chat__skeleton-lines">
                      <div className="chat__skeleton-line chat__skeleton-line--w60" />
                      <div className="chat__skeleton-line chat__skeleton-line--w40" />
                    </div>
                  </li>
                ))}
              </div>
            ) : visibleConvs.length === 0 ? (
              <li className="chat__empty-convs">
                {filter === 'unread' ? (
                  <>
                    <p className="chat__empty-title">لا توجد رسائل غير مقروءة</p>
                    <p>كل رسائلك مقروءة.</p>
                  </>
                ) : (
                  <>
                    <p className="chat__empty-title">لا توجد محادثات بعد</p>
                    <p>ابحث بالأعلى لبدء محادثة جديدة.</p>
                    <Button variant="primary" size="sm" onClick={focusSearch}>
                      رسالة جديدة
                    </Button>
                  </>
                )}
              </li>
            ) : (
              visibleConvs.map((conv) => {
                const unread = unreadByConv[conv.id] ?? 0;
                const preview = previewByConv[conv.id];
                const isActive = conv.id === activeId;
                return (
                  <li key={conv.id}>
                    <button
                      type="button"
                      className={`chat__conv${isActive ? ' chat__conv--active' : ''}${unread > 0 ? ' chat__conv--unread' : ''}`}
                      onClick={() => selectConversation(conv.id)}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <Avatar peer={conv.peer} size={48} />
                      <span className="chat__conv-meta">
                        <span className="chat__conv-top">
                          <span className="chat__conv-name">{conv.peer.name}</span>
                          <time className="chat__conv-time" dateTime={conv.lastMessageAt}>
                            {formatRelativeTime(conv.lastMessageAt)}
                          </time>
                        </span>
                        <span className="chat__conv-bottom">
                          <span className="chat__conv-preview">
                            {preview ?? 'رسالة مشفرة'}
                          </span>
                          {unread > 0 && (
                            <span className="chat__unread-badge" aria-label={`${unread} رسائل غير مقروءة`}>
                              {unread > 99 ? '+99' : unread}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        {/* ── Thread ── */}
        <section className="chat__thread-wrap" aria-label="الرسائل">
          {!active ? (
            <div className="chat__no-active">
              <span className="chat__no-active-icon" aria-hidden="true">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
              </span>
              <p className="chat__empty-title">اختر محادثة</p>
              <p className="chat__e2ee-note">اختر محادثة من القائمة لعرض الرسائل هنا.</p>
            </div>
          ) : (
            <>
              <header className="chat__thread-head">
                {isMobile && (
                  <button type="button" className="chat__back" onClick={goBackToList} aria-label="رجوع للمحادثات">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                )}
                <Avatar peer={active.peer} size={40} />
                <div className="chat__thread-peer">
                  <strong>{active.peer.name}</strong>
                  <span className="chat__thread-status">
                    <span className={`chat__status-dot chat__status-dot--${liveStatus}`} aria-hidden="true" />
                    {liveStatus === 'live' ? 'متصل' : liveStatus === 'connecting' ? 'جارٍ الاتصال...' : 'غير متصل'}
                  </span>
                </div>
              </header>

              {error && (
                <div className="chat__error" role="alert">
                  <span className="chat__error-text">{error}</span>
                  <button type="button" className="chat__error-retry" onClick={() => void refreshConversations()}>إعادة المحاولة</button>
                  <button type="button" className="chat__error-close" onClick={() => setError(null)} aria-label="إغلاق التنبيه">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              )}

              <div className="chat__thread" ref={threadRef} onScroll={handleThreadScroll} aria-live="off">
                {loadingMsgs && messages.length === 0 ? (
                  <div className="chat__skeletons chat__skeletons--thread" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div className={`chat__skeleton-bubble${i % 2 ? ' chat__skeleton-bubble--mine' : ''}`} key={i} />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="chat__empty-thread">
                    <Avatar peer={active.peer} size={56} />
                    <p className="chat__empty-title">ابدأ المحادثة مع {active.peer.name}</p>
                    <p className="chat__e2ee-note">الرسائل مشفرة طرف-لطرف.</p>
                  </div>
                ) : (
                  threadBlocks.map((block) => (
                    <div key={block.day}>
                      <div className="chat__day" role="separator" aria-label={dayLabel(block.day)}>
                        <span>{dayLabel(block.day)}</span>
                      </div>
                      {block.items.map(({ msg, mine, grouped }) => {
                        const text = plaintext[msg.id];
                        const broken = undecryptable.has(msg.id);
                        const confirming = confirmDelete?.id === msg.id;
                        return (
                          <div key={msg.id} className={`chat__msg${mine ? ' chat__msg--mine' : ''}${grouped ? ' chat__msg--grouped' : ''}`}>
                            <div className="chat__bubble">
                              {broken || text === undefined ? (
                                <span className="chat__undecryptable">تعذر فك تشفير هذه الرسالة على هذا الجهاز.</span>
                              ) : (
                                <span className="chat__text">{text}</span>
                              )}
                              <span className="chat__msg-foot">
                                <time dateTime={msg.created_at}>{clockTime(msg.created_at)}</time>
                                {mine && (
                                  <button
                                    type="button"
                                    className={`chat__delete${confirming ? ' chat__delete--confirm' : ''}`}
                                    onClick={() => void handleDelete(msg.id)}
                                    disabled={deletingId === msg.id}
                                    aria-label={confirming ? 'اضغط مجدداً للتأكيد' : 'احذف رسالتي'}
                                    title={confirming ? 'اضغط مجدداً للتأكيد' : 'احذف رسالتي'}
                                  >
                                    {deletingId === msg.id ? '...' : confirming ? 'تأكيد؟' : (
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                                    )}
                                  </button>
                                )}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                {!nearBottom && (
                  <button type="button" className="chat__jump" onClick={() => scrollToBottom(true)} aria-label="النزول لآخر الرسائل">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                    {newBelow > 0 ? ` ${newBelow} جديدة` : null}
                  </button>
                )}
              </div>

              <form className="chat__composer" onSubmit={(e) => void handleSend(e)}>
                <label htmlFor="chat-draft" className="sr-only">اكتب رسالة (Enter للإرسال)</label>
                <textarea
                  id="chat-draft"
                  ref={composerRef}
                  className="chat__input"
                  placeholder="اكتب رسالة..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleComposerKey}
                  maxLength={MAX_MESSAGE_LENGTH}
                  autoComplete="off"
                  disabled={sending}
                  rows={1}
                />
                <button
                  type="submit"
                  className="chat__send"
                  disabled={sending || !draft.trim()}
                  aria-label="إرسال الرسالة"
                >
                  {sending ? (
                    <span className="chat__send-spinner" aria-hidden="true" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  )}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default ChatPage;
