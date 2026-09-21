import type { ChatConversation, ChatMessageRow } from './chat';
import type { PublicJwk } from './chatCrypto';

export interface ChatIdentity {
  publicJwk: PublicJwk;
  privateKey: CryptoKey;
}

export interface ChatSnapshot {
  userId: string;
  identity: ChatIdentity;
  conversations: ChatConversation[];
  messagesByConv: Record<string, ChatMessageRow[]>;
  plaintext: Record<string, string>;
  undecryptable: string[];
  activeId: string | null;
  seen: Record<string, string>;
  loadedThreads: string[];
}

/** localStorage key prefix for per-user chat read-marks (shared with ChatPage). */
export const CHAT_SEEN_PREFIX = 'hibr:chat-seen:';

/** Window event ChatPage dispatches after marking threads read (shared with ChatUnreadContext). */
export const CHAT_SEEN_EVENT = 'hibr:chat-seen-changed';

/** Window event ChatPage dispatches after every successful load/sync (shared with ChatUnreadContext). */
export const CHAT_SYNC_EVENT = 'hibr:chat-sync';

/**
 * In-memory snapshot of the chat page, keyed by user id.
 *
 * SPA navigation (React Router) never reloads the page, so this module
 * state survives leaving /chat and coming back. ChatPage restores from
 * it to render instantly without spinners, then does a silent background
 * sync + resubscribes realtime to catch anything missed while away.
 *
 * Private CryptoKeys can't leave memory (not serializable), which is
 * exactly why this is in-memory and NOT localStorage.
 */
let snapshot: ChatSnapshot | null = null;

export function getChatSnapshot(userId: string): ChatSnapshot | null {
  if (!snapshot || snapshot.userId !== userId) return null;
  return snapshot;
}

export function setChatSnapshot(next: ChatSnapshot): void {
  snapshot = next;
}
