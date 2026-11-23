'use client';

// ============================================================
// Website-side local-first account + license helpers.
//
// HONESTY CONTRACT — read this before changing anything:
//   1. There is NO backend. Accounts live in this browser's
//      localStorage only. The password is hashed with Web Crypto
//      SHA-256 + a random salt IN THE BROWSER and never leaves it.
//   2. This is NOT the desktop account. The pairing deep link sends
//      pair / email / name / plan and, when a license was redeemed on
//      this device, the stored `lic` key. The password and its hash
//      are never sent to the app. The desktop app creates its own
//      local account+session from the short-lived pair code, and only
//      promotes the plan when it verifies that key's HMAC signature.
//   3. A license key can only be FORMAT-checked here. The HMAC
//      signature is verified by the desktop app on activation —
//      the signing secret is generated on that device, so no
//      website can honestly claim to validate authenticity.
// ============================================================

import { SITE } from './site';

export const ACCOUNTS_KEY = 'sadeem-web-accounts';
export const ENTITLEMENT_KEY = 'sadeem-web-entitlement';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountPlan = 'free' | 'pro' | 'team';

/** A browser-local account. `salt`/`hash` are empty on records created by
 *  the older passwordless pairing flow; those records are adopted on the
 *  next sign-up/sign-in so no existing user is locked out. */
export interface WebAccount {
  email: string;
  name: string;
  createdAt: number;
  plan: AccountPlan;
  salt: string; // hex, 32 chars
  hash: string; // hex SHA-256 of `${salt}:${password}`
}

/** A redeemed Owner License as recorded on THIS device, for pairing only.
 *  Not a receipt and not a verified signature — see the contract above. */
export interface Entitlement {
  key: string; // normalized, upper-case
  plan: 'pro' | 'team';
  expiryDays: number; // 0 = perpetual
  redeemedAt: number;
}

export const normEmail = (value: string): string => value.trim().toLowerCase();

export function displayName(name: string, email: string): string {
  return name.trim() || normEmail(email).split('@')[0] || 'SADEEM user';
}

// ---------- Web Crypto ----------

/** crypto.subtle needs a secure context (HTTPS or localhost). Fail loudly
 *  and honestly instead of pretending to hash. */
export function webCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export async function verifyPassword(password: string, account: WebAccount): Promise<boolean> {
  if (!account.hash) return false;
  const actual = await hashPassword(password, account.salt);
  // Both sides are fixed-length hex; a plain compare is fine for a
  // browser-only lock (there is no remote oracle to time against).
  return actual === account.hash;
}

// ---------- accounts in localStorage ----------

function isAccount(value: unknown): value is WebAccount {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.email === 'string' &&
    typeof o.name === 'string' &&
    typeof o.createdAt === 'number'
  );
}

export function loadAccounts(): WebAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAccount) : [];
  } catch {
    return [];
  }
}

function persistAccounts(list: WebAccount[]): WebAccount[] {
  try {
    if (list.length) localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
    else localStorage.removeItem(ACCOUNTS_KEY);
  } catch { /* storage disabled — keep the in-memory result */ }
  return list;
}

export function forgetAccount(email: string): WebAccount[] {
  return persistAccounts(loadAccounts().filter((a) => a.email !== normEmail(email)));
}

export type AccountWriteResult =
  | { ok: true; accounts: WebAccount[]; adopted: boolean }
  | { ok: false; code: 'exists' | 'wrong-password' | 'not-found' | 'storage' | 'crypto' };

/**
 * Create or update a browser-local, password-backed account.
 * `exists` in sign-up mode means the email is already on this device with a
 * different password — the UI tells the user to use Sign in instead.
 * Records from the old passwordless flow are adopted (a hash is attached)
 * rather than discarded.
 */
export async function writeAccount(params: {
  email: string;
  name: string;
  password: string;
  mode: 'signup' | 'signin';
  plan: AccountPlan;
}): Promise<AccountWriteResult> {
  if (!webCryptoAvailable()) return { ok: false, code: 'crypto' };
  const key = normEmail(params.email);
  const name = displayName(params.name, key);
  const list = loadAccounts();
  const existing = list.find((a) => a.email === key);

  if (params.mode === 'signin') {
    if (!existing) return { ok: false, code: 'not-found' };
    const adopted = !existing.hash;
    if (existing.hash) {
      if (!(await verifyPassword(params.password, existing))) {
        return { ok: false, code: 'wrong-password' };
      }
    } else {
      existing.salt = newSalt();
      existing.hash = await hashPassword(params.password, existing.salt);
    }
    existing.name = name;
    existing.plan = params.plan;
    try {
      return { ok: true, accounts: persistAccounts(list), adopted };
    } catch {
      return { ok: false, code: 'storage' };
    }
  }

  if (existing) {
    const adopted = !existing.hash;
    if (existing.hash) {
      if (!(await verifyPassword(params.password, existing))) {
        return { ok: false, code: 'exists' };
      }
    } else {
      existing.salt = newSalt();
      existing.hash = await hashPassword(params.password, existing.salt);
    }
    existing.name = name;
    existing.plan = params.plan;
    try {
      return { ok: true, accounts: persistAccounts(list), adopted };
    } catch {
      return { ok: false, code: 'storage' };
    }
  }

  try {
    const salt = newSalt();
    list.push({
      email: key,
      name,
      createdAt: Date.now(),
      plan: params.plan,
      salt,
      hash: await hashPassword(params.password, salt),
    });
    return { ok: true, accounts: persistAccounts(list), adopted: false };
  } catch {
    return { ok: false, code: 'storage' };
  }
}

// ---------- license keys (FORMAT ONLY) ----------

// Mirrors electron/services/licenseService.ts:
//   v2:   KDX-PLAN-EXPIP(5)-SIG1(4)-SIG2(3)
//   v1:   KDX-PLAN-XXXX-XXXX-XXXX (legacy, unsigned)
// PLAN ∈ {PRO, TEAM}; EXPIP is Crockford base32 expiry epoch-DAYS (0 = perpetual).
const V2_RE = /^KDX-(PRO|TEAM)-([0-9A-Z]{5})-([0-9A-Z]{4})-([0-9A-Z]{3})$/;
const LEGACY_RE = /^KDX-(PRO|TEAM)-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const normalizeKey = (raw: string): string =>
  String(raw ?? '').toUpperCase().replace(/\s+/g, '');

/** Crockford confusables: I/L → 1, O → 0 (U is invalid). */
function b32Normalize(chars: string): string {
  return chars.replace(/[IL]/g, '1').replace(/O/g, '0');
}

function b32Decode(chars: string): number | null {
  let value = 0;
  for (const ch of b32Normalize(chars)) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) return null;
    value = value * 32 + idx;
  }
  return value;
}

export type LicenseFormatVerdict =
  | { ok: true; plan: 'pro' | 'team'; expiryDays: number; source: 'v2' | 'legacy' }
  | { ok: false; reason: 'empty' | 'format' };

/**
 * Check the SHAPE of a signed key and decode its plan/expiry. This is NOT
 * signature verification: the HMAC secret lives on the user's device and is
 * checked by the desktop app when the key is activated there.
 */
export function validateLicenseFormat(raw: string): LicenseFormatVerdict {
  const key = normalizeKey(raw);
  if (!key) return { ok: false, reason: 'empty' };

  const v2 = key.match(V2_RE);
  if (v2) {
    const expiryDays = b32Decode(v2[2]);
    if (expiryDays === null) return { ok: false, reason: 'format' };
    return {
      ok: true,
      plan: v2[1].toLowerCase() as 'pro' | 'team',
      expiryDays,
      source: 'v2',
    };
  }

  const legacy = key.match(LEGACY_RE);
  if (legacy) {
    return {
      ok: true,
      plan: legacy[1].toLowerCase() as 'pro' | 'team',
      expiryDays: 0,
      source: 'legacy',
    };
  }

  return { ok: false, reason: 'format' };
}

export function loadEntitlement(): Entitlement | null {
  try {
    const raw = localStorage.getItem(ENTITLEMENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const e = parsed as Record<string, unknown>;
    const plan = e.plan === 'pro' || e.plan === 'team' ? e.plan : null;
    if (!plan || typeof e.key !== 'string' || typeof e.expiryDays !== 'number') return null;
    return {
      key: e.key,
      plan,
      expiryDays: e.expiryDays,
      redeemedAt: typeof e.redeemedAt === 'number' ? e.redeemedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveEntitlement(value: Entitlement): void {
  try {
    localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(value));
  } catch { /* storage disabled */ }
}

export function clearEntitlement(): void {
  try { localStorage.removeItem(ENTITLEMENT_KEY); } catch { /* ignore */ }
}

// ---------- the existing deep link, now carrying the plan + optional key ----------

/** Exact payload shape completeWebAuth() parses: pair, email, name, plan, lic?.
 *  `plan` is self-asserted here; the app only honors a paid plan when a real
 *  signed license is active on that device (honestPlan in authService.ts).
 *  `lic` is the locally stored entitlement key (FORMAT-checked only here) —
 *  appending it is what lets the app verify the HMAC and honor the plan.
 *  With no key we send `plan=free` and omit `lic` entirely: never a
 *  self-asserted pro. URLSearchParams encodes the key in the query string. */
export function callbackUrl(
  pair: string,
  email: string,
  name: string,
  plan: AccountPlan,
  lic?: string,
): string {
  const q = new URLSearchParams({
    pair: pair.toUpperCase(),
    email: normEmail(email),
    name: displayName(name, email),
    plan,
  });
  if (lic) q.append('lic', lic);
  return `${SITE.deepLinkCallback}?${q.toString()}`;
}
