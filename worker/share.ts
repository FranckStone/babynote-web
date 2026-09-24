import type { SharePermission } from "../shared/types";

export interface ShareKeyRow {
  id: string;
  name: string;
  permission: SharePermission;
  created_at: number;
  expires_at: number | null;
  disabled_at: number | null;
  last_used_at: number | null;
}

const encoder = new TextEncoder();
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(secret: string, message: string) {
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(message))));
}

async function verify(secret: string, message: string, signature: string) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, (byte) => Number.parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await signingKey(secret), bytes, encoder.encode(message));
}

export function newShareKeyId() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

// Only the random ID and metadata are stored; owners can recover the same signed link.
export async function createShareToken(secret: string, id: string) {
  return `key.${id}.${await sign(secret, `babynote:key:${id}`)}`;
}

export async function verifyShareToken(secret: string, token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !/^key\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return null;
  const [, id, signature] = token.split(".");
  return await verify(secret, `babynote:key:${id}`, signature) ? id : null;
}

export function isShareKeyActive(key: ShareKeyRow | null, now = Date.now()): key is ShareKeyRow {
  return key !== null && key.disabled_at === null && (key.expires_at === null || key.expires_at > now);
}

export async function createShareSession(secret: string, id: string, now = Date.now()) {
  const expiresAt = now + 400 * 24 * 60 * 60 * 1000;
  return `share.${id}.${expiresAt}.${await sign(secret, `babynote:share-session:${id}:${expiresAt}`)}`;
}

export async function verifyShareSession(secret: string, token: unknown, now = Date.now()): Promise<string | null> {
  if (typeof token !== "string" || !/^share\.[a-f0-9]{32}\.\d{13}\.[a-f0-9]{64}$/.test(token)) return null;
  const [, id, expiresAt, signature] = token.split(".");
  if (Number(expiresAt) <= now) return null;
  return await verify(secret, `babynote:share-session:${id}:${expiresAt}`, signature) ? id : null;
}
