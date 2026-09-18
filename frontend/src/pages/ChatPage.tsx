import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useDocumentMeta } from '../lib/documentMeta';
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
  sendEncryptedMessage,
  deleteMessage,
  subscribeConversationMessages,
} from '../lib/chat';
import { encryptForPeer, decryptFromPeer, cryptoAvailable } from '../lib/chatCrypto';
import type { PublicJwk } from '../lib/chatCrypto';
import type { ChatConversation, ChatMessageRow, ChatPeer } from '../lib/chat';
import './ChatPage.css';

const MAX_MESSAGE_LENGTH = 2000;

function peerInitial(name: string): string {
  const t = name.trim();
  return t ? t.charAt(0) : 'ح';
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

function ChatPage() {
  const { isAuthenticated, user, openSignInModal, getSupabaseToken } = useAuth();
  useDocumentMeta('الرسائل', 'محادثاتك الخاصة المشفرة في حِبر.');

  const [chatOn, setChatOn] = useState<boolean | null>(null);
  const [identity, setIdentity] = useState<{ publicJwk: PublicJwk; privateKey: CryptoKey } | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessageRow[]>>({});
  const [plaintext, setPlaintext] = useState<Record<string, string>>({});
  const [undecryptable, setUndecryptable] = useState<Set<string>>(new Set());
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatPeer[]>([]);
  const [searching, setSearching] = useState(false);
  const [startingPeer, setStartingPeer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const searchTimer = useRef<number | null>(null);
  // Threads already fetched this session — revisits refetch in the
  // background while cached rows render instantly.
  const loadedThreadsRef = useRef<Set<string>>(new Set());

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  // Per-conversation cache: switching threads never needs a synchronous
  // reset inside an effect — each thread renders its own cached rows.
  const messages = active ? (messagesByConv[active.id] ?? []) : [];

  // Ref mirror so async loaders always see the latest peer (e.g. after a
  // freshly published public key) without retriggering effects.
  const conversationsRef = useRef<ChatConversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // WebCrypto requires a secure context (HTTPS / localhost). Computed
  // during render so no effect needs to setState for it.
  const secureContext = cryptoAvailable();

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  // 1. Does the chat migration exist?
  useEffect(() => {
    let cancelled = false;
    probeChatTables().then((on) => {
      if (!cancelled) setChatOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Identity + conversation list.
  const refreshConversations = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    setLoadingConvs(true);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const id = await ensureChatIdentity(user.id, token);
      setIdentity(id);
      const convs = await listConversations(user.id, token);
      setConversations(convs);
      setActiveId((prev) => {
        if (prev && convs.some((c) => c.id === prev)) return prev;
        return convs[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المحادثات');
    } finally {
      setLoadingConvs(false);
    }
  }, [isAuthenticated, user, getSupabaseToken]);

  useEffect(() => {
    if (!isAuthenticated || !user || chatOn !== true || !secureContext) return;
    // Deferred (promise callback) so the effect body itself never
    // triggers a cascading render — same shape as the probe effects.
    void Promise.resolve().then(() => {
      void refreshConversations();
    });
  }, [isAuthenticated, user, chatOn, secureContext, refreshConversations]);

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
      setPlaintext((prev) => ({ ...prev, ...ok }));
      setUndecryptable((prev) => {
        const next = new Set(prev);
        for (const row of rows) {
          if (bad.has(row.id)) next.add(row.id);
          else next.delete(row.id);
        }
        return next;
      });
    },
    []
  );

  // Fresh peer key (cached public key first, network fallback for
  // peers who published their key after the conversation list loaded).
  const resolvePeerKey = useCallback(
    async (convId: string): Promise<PublicJwk | null> => {
      const conv = conversationsRef.current.find((c) => c.id === convId);
      if (!conv) return null;
      if (conv.peer.publicKey) return conv.peer.publicKey;
      const token = await getSupabaseToken();
      return getPeerPublicKey(conv.peer.id, token);
    },
    [getSupabaseToken]
  );

  // 3. Load + decrypt the active thread. Rows are cached per
  // conversation, so switching threads renders cache instantly and only
  // fetches when the thread has no cached rows yet.
  useEffect(() => {
    if (!activeId || !identity || !user) return;
    let cancelled = false;
    // Deferred to a microtask so this effect never triggers cascading
    // renders (same pattern as AuthContext).
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
        scrollToBottom();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'تعذر تحميل الرسائل');
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, identity, user, getSupabaseToken, resolvePeerKey, decryptRows, scrollToBottom]);

  // 4. Realtime inserts on the active thread.
  useEffect(() => {
    if (!activeId || !identity) return;
    const unsubscribe = subscribeConversationMessages(activeId, (row) => {
      setMessagesByConv((prev) => {
        const current = prev[row.conversation_id] ?? [];
        if (current.some((m) => m.id === row.id)) return prev;
        return { ...prev, [row.conversation_id]: [...current, row] };
      });
      void (async () => {
        let key: PublicJwk | null;
        try {
          key = await resolvePeerKey(row.conversation_id);
        } catch {
          key = null;
        }
        if (!key) {
          setUndecryptable((prev) => new Set(prev).add(row.id));
          return;
        }
        try {
          const text = await decryptFromPeer(
            { ciphertext: row.ciphertext, iv: row.iv },
            identity.privateKey,
            key
          );
          setPlaintext((prev) => ({ ...prev, [row.id]: text }));
        } catch {
          setUndecryptable((prev) => new Set(prev).add(row.id));
        }
      })();
      scrollToBottom();
    });
    return unsubscribe;
  }, [activeId, identity, resolvePeerKey, scrollToBottom]);

  // 5. User search (debounced). Empty queries render no results via
  // `visibleResults` below, so this effect never resets state synchronously.
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q || !isAuthenticated || !user) return;
    searchTimer.current = window.setTimeout(() => {
      setSearching(true);
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

  const visibleResults = query.trim().length > 0 ? results : [];

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
      setQuery('');
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر بدء المحادثة');
    } finally {
      setStartingPeer(null);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setMessagesByConv((prev) => {
        const current = prev[row.conversation_id] ?? [];
        if (current.some((m) => m.id === row.id)) return prev;
        return { ...prev, [row.conversation_id]: [...current, row] };
      });
      setPlaintext((prev) => ({ ...prev, [row.id]: text }));
      setDraft('');
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (messageId: string) => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف الرسالة');
    } finally {
      setDeletingId(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__gate">
          <h1>الرسائل</h1>
          <p>سجّل دخولك عشان تراسل الكتّاب برسائل خاصة مشفرة.</p>
          <Button variant="primary" size="sm" onClick={openSignInModal}>
            سجّل دخولك
          </Button>
        </div>
      </main>
    );
  }

  if (chatOn === null) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__status" role="status">جارٍ التحميل...</div>
      </main>
    );
  }

  if (chatOn === false) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__gate">
          <h1>الرسائل غير مفعّلة بعد</h1>
          <p>نفّذ سكربت <code dir="ltr">backend/supabase_chat.sql</code> في محرر SQL داخل Supabase ثم أعد تحميل الصفحة.</p>
        </div>
      </main>
    );
  }

  if (!secureContext) {
    return (
      <main className="chat" id="main-content">
        <div className="chat__gate">
          <h1>الرسائل</h1>
          <p>متصفحك لا يدعم التشفير (WebCrypto). استخدم متصفحاً حديثاً عبر HTTPS.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="chat" id="main-content">
      <div className="chat__layout">
        {/* ── Conversation list ── */}
        <aside className="chat__sidebar" aria-label="المحادثات">
          <div className="chat__search">
            <label htmlFor="chat-search" className="sr-only">ابحث عن كاتب لمراسلته</label>
            <input
              id="chat-search"
              type="search"
              className="chat__search-input"
              placeholder="ابحث عن كاتب..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {searching && <span className="chat__search-hint">جارٍ البحث...</span>}
            {visibleResults.length > 0 && (
              <ul className="chat__results">
                {visibleResults.map((peer) => (
                  <li key={peer.id}>
                    <button
                      type="button"
                      className="chat__result"
                      onClick={() => void handleStartChat(peer)}
                      disabled={startingPeer === peer.id}
                    >
                      <Avatar peer={peer} size={32} />
                      <span className="chat__result-name">{peer.name}</span>
                      {peer.username && <span className="chat__result-handle" dir="ltr">@{peer.username}</span>}
                      {!peer.publicKey && <span className="chat__result-nokey">بدون مفتاح بعد</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="chat__convs">
            {loadingConvs ? (
              <div className="chat__status" role="status">جارٍ تحميل المحادثات...</div>
            ) : conversations.length === 0 ? (
              <div className="chat__empty-convs">
                <p>لا توجد محادثات بعد.</p>
                <p>ابحث عن كاتب بالأعلى وابدأ محادثة مشفرة.</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  className={`chat__conv${conv.id === activeId ? ' chat__conv--active' : ''}`}
                  onClick={() => setActiveId(conv.id)}
                  aria-current={conv.id === activeId}
                >
                  <Avatar peer={conv.peer} size={40} />
                  <span className="chat__conv-meta">
                    <span className="chat__conv-name">{conv.peer.name}</span>
                    <time className="chat__conv-time" dateTime={conv.lastMessageAt}>
                      {formatRelativeTime(conv.lastMessageAt)}
                    </time>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── Thread ── */}
        <section className="chat__thread-wrap" aria-label="الرسائل">
          {!active ? (
            <div className="chat__no-active">
              <p>اختر محادثة من القائمة أو ابدأ واحدة جديدة.</p>
              <p className="chat__e2ee-note" role="note">🔒 مشفرة طرف-لطرف: لا يستطيع حتى الخادم قراءة رسائلك.</p>
            </div>
          ) : (
            <>
              <header className="chat__thread-head">
                <Avatar peer={active.peer} size={36} />
                <div className="chat__thread-peer">
                  <strong>{active.peer.name}</strong>
                  {active.peer.username && (
                    <span className="chat__thread-handle" dir="ltr">@{active.peer.username}</span>
                  )}
                </div>
                <span className="chat__lock" title="تشفير طرف-لطرف مفعّل">🔒 E2EE</span>
              </header>

              {error && (
                <div className="chat__error" role="alert">
                  {error}
                  <button type="button" onClick={() => setError(null)} aria-label="إغلاق التنبيه">×</button>
                </div>
              )}

              <div className="chat__thread" ref={threadRef} aria-live="polite">
                {loadingMsgs ? (
                  <div className="chat__status" role="status">جارٍ فك تشفير الرسائل...</div>
                ) : messages.length === 0 ? (
                  <div className="chat__empty-thread">
                    <p>لا رسائل بعد — قل مرحباً 👋</p>
                    <p className="chat__e2ee-note">🔒 الرسائل مشفرة طرف-لطرف ولا تُخزن إلا كشيفرة.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const mine = user && msg.sender_id === user.id;
                    const text = plaintext[msg.id];
                    const broken = undecryptable.has(msg.id);
                    return (
                      <div key={msg.id} className={`chat__msg${mine ? ' chat__msg--mine' : ''}`}>
                        <div className="chat__bubble">
                          {broken || text === undefined ? (
                            <span className="chat__undecryptable">تعذر فك تشفير هذه الرسالة على هذا الجهاز.</span>
                          ) : (
                            <span className="chat__text">{text}</span>
                          )}
                          <span className="chat__msg-foot">
                            <time dateTime={msg.created_at}>{formatRelativeTime(msg.created_at)}</time>
                            {mine && (
                              <button
                                type="button"
                                className="chat__delete"
                                onClick={() => void handleDelete(msg.id)}
                                disabled={deletingId === msg.id}
                                aria-label="احذف رسالتي"
                                title="احذف رسالتي"
                              >
                                حذف
                              </button>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form className="chat__composer" onSubmit={(e) => void handleSend(e)}>
                <label htmlFor="chat-draft" className="sr-only">اكتب رسالة مشفرة</label>
                <input
                  id="chat-draft"
                  type="text"
                  className="chat__input"
                  placeholder="اكتب رسالة مشفرة..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={MAX_MESSAGE_LENGTH}
                  autoComplete="off"
                  disabled={sending}
                />
                <Button variant="primary" size="sm" type="submit" disabled={sending || !draft.trim()}>
                  {sending ? 'جارٍ الإرسال...' : 'إرسال'}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default ChatPage;
