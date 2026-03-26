// ============================================================================
// PIN CRYPTO — Encrypt/decrypt WIF with a 4-digit PIN
// Uses Web Crypto API (SubtleCrypto) — runs entirely in browser
// ============================================================================

import { STORAGE_KEYS } from '../constants';

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100_000;

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptAndStoreWif(wif: string, pin: string, address: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(pin, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(wif),
  );

  // Store as: salt (16) + iv (12) + ciphertext, base64 encoded
  const combined = new Uint8Array(salt.length + iv.length + new Uint8Array(encrypted).length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  localStorage.setItem(STORAGE_KEYS.WALLET_ENC, btoa(String.fromCharCode(...combined)));
  localStorage.setItem(STORAGE_KEYS.WALLET_ADDR, address);
}

export async function decryptStoredWif(pin: string): Promise<string> {
  const stored = localStorage.getItem(STORAGE_KEYS.WALLET_ENC);
  if (!stored) throw new Error('No stored wallet');

  const combined = new Uint8Array(atob(stored).split('').map(c => c.charCodeAt(0)));
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(pin, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error('Wrong PIN');
  }
}

export function hasStoredWallet(): boolean {
  return !!localStorage.getItem(STORAGE_KEYS.WALLET_ENC);
}

export function getAddressHint(): string | null {
  return localStorage.getItem(STORAGE_KEYS.WALLET_ADDR);
}

export function deleteStoredWallet(): void {
  localStorage.removeItem(STORAGE_KEYS.WALLET_ENC);
  localStorage.removeItem(STORAGE_KEYS.WALLET_ADDR);
}