import type {
  CodexPulseSnapshot,
  EncryptedEnvelope,
  PairingPayload,
  ProtectedKeyBundle,
} from './types';

const WRAP_AAD = new TextEncoder().encode('codexpulse:key-wrap:v1');
const SNAPSHOT_AAD = new TextEncoder().encode('codexpulse:snapshot:v1');
const VAULT_AAD = new TextEncoder().encode('codexpulse:local-vault:v1');
export const PIN_ITERATIONS = 600_000;

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', asArrayBuffer(bytes)));
}

export async function keyIdFor(rawKey: Uint8Array) {
  return bytesToBase64Url((await sha256(rawKey)).slice(0, 9));
}

async function pinKey(pin: string, salt: Uint8Array, iterations: number) {
  const source = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asArrayBuffer(salt), iterations },
    source,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function importMasterKey(rawKey: Uint8Array) {
  return crypto.subtle.importKey('raw', asArrayBuffer(rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function protectMasterKey(pin: string, rawKey: Uint8Array, dataUrl: string): Promise<ProtectedKeyBundle> {
  if (!/^\d{6}$/u.test(pin)) throw new Error('PIN_FORMAT');
  if (rawKey.byteLength !== 32) throw new Error('KEY_LENGTH');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await pinKey(pin, salt, PIN_ITERATIONS);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: asArrayBuffer(WRAP_AAD) }, wrappingKey, asArrayBuffer(rawKey));
  return {
    version: 1,
    algorithm: 'PBKDF2-SHA256+A256GCM',
    iterations: PIN_ITERATIONS,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    wrappedKey: bytesToBase64Url(new Uint8Array(wrapped)),
    keyId: await keyIdFor(rawKey),
    dataUrl,
  };
}

export async function unlockMasterKey(pin: string, bundle: ProtectedKeyBundle) {
  const wrappingKey = await pinKey(pin, base64UrlToBytes(bundle.salt), bundle.iterations);
  const raw = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(base64UrlToBytes(bundle.iv)), additionalData: asArrayBuffer(WRAP_AAD) },
    wrappingKey,
    asArrayBuffer(base64UrlToBytes(bundle.wrappedKey)),
  ));
  if ((await keyIdFor(raw)) !== bundle.keyId) throw new Error('KEY_ID');
  const key = await importMasterKey(raw);
  return { key, raw };
}

export async function decryptSnapshot(envelope: EncryptedEnvelope, key: CryptoKey): Promise<CodexPulseSnapshot> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(base64UrlToBytes(envelope.iv)), additionalData: asArrayBuffer(SNAPSHOT_AAD) },
    key,
    asArrayBuffer(base64UrlToBytes(envelope.data)),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as CodexPulseSnapshot;
  if (parsed.schemaVersion !== 1 || parsed.source !== 'codexpulse-local') throw new Error('SNAPSHOT_SCHEMA');
  return parsed;
}

export async function encryptLocalValue(value: unknown, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: asArrayBuffer(VAULT_AAD) }, key, asArrayBuffer(data));
  return JSON.stringify({ version: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)) });
}

export async function decryptLocalValue<T>(value: string, key: CryptoKey): Promise<T> {
  const envelope = JSON.parse(value) as { version: 1; iv: string; data: string };
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(base64UrlToBytes(envelope.iv)), additionalData: asArrayBuffer(VAULT_AAD) },
    key,
    asArrayBuffer(base64UrlToBytes(envelope.data)),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export function parsePairingHash(hash: string): PairingPayload | null {
  const match = hash.match(/(?:^#|&)pair=([^&]+)/u);
  if (!match) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(decodeURIComponent(match[1])))) as PairingPayload;
    if (payload.version !== 1 || !payload.dataUrl || base64UrlToBytes(payload.key).byteLength !== 32) return null;
    return payload;
  } catch {
    return null;
  }
}

const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export async function recoveryCodeFor(rawKey: Uint8Array) {
  const checksum = (await sha256(rawKey)).slice(0, 4);
  const input = new Uint8Array([...rawKey, ...checksum]);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return `CP1-${output.match(/.{1,5}/gu)?.join('-') || output}`;
}

export async function rawKeyFromRecoveryCode(code: string) {
  const normalized = code.trim().toLocaleUpperCase('en-US').replace(/^CP1-/u, '').replaceAll('-', '').replaceAll(' ', '');
  if (normalized.length !== 58 || Array.from(normalized).some((character) => !BASE32.includes(character))) {
    throw new Error('RECOVERY_FORMAT');
  }

  let bits = 0;
  let value = 0;
  const decoded: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      decoded.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (decoded.length !== 36 || (bits > 0 && (value & ((1 << bits) - 1)) !== 0)) {
    throw new Error('RECOVERY_FORMAT');
  }

  const rawKey = Uint8Array.from(decoded.slice(0, 32));
  const checksum = Uint8Array.from(decoded.slice(32));
  const expected = (await sha256(rawKey)).slice(0, 4);
  let mismatch = 0;
  for (let index = 0; index < checksum.length; index += 1) mismatch |= checksum[index] ^ expected[index];
  if (mismatch !== 0) {
    rawKey.fill(0);
    throw new Error('RECOVERY_CHECKSUM');
  }
  return rawKey;
}
