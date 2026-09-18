/**
 * E2EE primitives for HIBR chat (1:1 DMs).
 *
 * Scheme:
 * - Each user owns an ECDH P-256 identity keypair. The private key NEVER
 *   leaves this browser (localStorage, per user id). The public JWK is
 *   published to `users.public_key` so peers can derive a shared secret.
 * - Per peer we derive an AES-GCM-256 key via ECDH(ownPriv, peerPub).
 *   Both sides derive the identical key without ever transmitting it —
 *   the server only ever sees (iv, ciphertext) base64 blobs.
 * - Every message uses a fresh random 96-bit IV.
 */

export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

const PRIVATE_KEY_PREFIX = 'hibr:chat-priv:';

function privateKeyStorageKey(userId: string): string {
  return `${PRIVATE_KEY_PREFIX}${userId}`;
}

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isValidPublicJwk(value: unknown): value is PublicJwk {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.kty === 'EC' &&
    v.crv === 'P-256' &&
    typeof v.x === 'string' &&
    v.x.length > 0 &&
    typeof v.y === 'string' &&
    v.y.length > 0
  );
}

async function generateIdentityKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function exportPublicJwk(pair: CryptoKeyPair): Promise<PublicJwk> {
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as unknown as Record<string, unknown>;
  return { kty: 'EC', crv: 'P-256', x: String(jwk.x ?? ''), y: String(jwk.y ?? '') };
}

async function importPrivateJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function importPeerPublic(jwk: PublicJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

function readStoredPrivateJwk(userId: string): JsonWebKey | null {
  try {
    const raw = localStorage.getItem(privateKeyStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const jwk = parsed as Record<string, unknown>;
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string') {
      return null;
    }
    return jwk as JsonWebKey;
  } catch {
    return null;
  }
}

/**
 * Returns this device's identity (creating + persisting it on first run).
 * The public JWK should be published to `users.public_key` by the caller.
 */
export async function ensureIdentity(userId: string): Promise<{ publicJwk: PublicJwk; privateKey: CryptoKey }> {
  const stored = readStoredPrivateJwk(userId);
  if (stored) {
    try {
      const privateKey = await importPrivateJwk(stored);
      const tmpPair = { privateKey, publicKey: await crypto.subtle.importKey(
        'jwk',
        { kty: 'EC', crv: 'P-256', x: String(stored.x), y: String(stored.y), ext: true },
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      ) } as CryptoKeyPair;
      void tmpPair;
      const publicJwk: PublicJwk = { kty: 'EC', crv: 'P-256', x: String(stored.x), y: String(stored.y) };
      return { publicJwk, privateKey };
    } catch {
      // Corrupt stored key — fall through and generate a fresh one.
    }
  }
  const pair = await generateIdentityKeypair();
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  try {
    localStorage.setItem(privateKeyStorageKey(userId), JSON.stringify(privateJwk));
  } catch {
    // Private browsing — identity works for this session only.
  }
  const publicJwk = await exportPublicJwk(pair);
  return { publicJwk, privateKey: pair.privateKey };
}

async function deriveAesKey(privateKey: CryptoKey, peerPublicJwk: PublicJwk): Promise<CryptoKey> {
  const peerPublic = await importPeerPublic(peerPublicJwk);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublic },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
}

export async function encryptForPeer(
  plaintext: string,
  ownPrivateKey: CryptoKey,
  peerPublicJwk: PublicJwk
): Promise<EncryptedPayload> {
  const aesKey = await deriveAesKey(ownPrivateKey, peerPublicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = textEncoder.encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, aesKey, data as unknown as BufferSource);
  return { ciphertext: bufToBase64(cipher), iv: bufToBase64(iv) };
}

export async function decryptFromPeer(
  payload: EncryptedPayload,
  ownPrivateKey: CryptoKey,
  peerPublicJwk: PublicJwk
): Promise<string> {
  const aesKey = await deriveAesKey(ownPrivateKey, peerPublicJwk);
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    aesKey,
    data as unknown as BufferSource
  );
  return textDecoder.decode(plain);
}

export function cryptoAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.isSecureContext !== 'undefined' &&
    !!crypto?.subtle
  );
}
