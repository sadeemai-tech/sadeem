// ============================================================
// Surnia — local account service.
// REAL local-first accounts: scrypt-hashed passwords, device
// sessions persisted to disk. Nothing leaves this machine.
// Files live in app.getPath('userData'):
//   accounts.json  — [{ id, email, name, plan, createdAt, salt, hash }]
//   session.json   — { token, accountId, createdAt }
// SECURITY: both files are written with mode 0600 (secrets at rest);
// sessions expire after 30 days; login attempts are throttled per email.
// ============================================================
import { app } from 'electron';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AccountInfo, AuthResult, GuestPassStatus } from '../../shared/types';
import { getLicense } from './storeService';
import { activate as activateLicense, validateKey } from './licenseService';

interface StoredAccount {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'team';
  createdAt: number;
  salt: string;
  hash: string;
  /** v11.3 — account CREATED ON THE WEBSITE (no local password). It signs
   *  in via the website activation flow, never via in-app credentials. */
  via?: 'website';
}

interface StoredSession {
  token: string;
  accountId: string;
  createdAt: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
/** Sessions older than this are treated as logged out. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Consecutive failed logins per email before a forced 3s delay. */
const THROTTLE_THRESHOLD = 5;
const THROTTLE_DELAY_MS = 3_000;
const VALID_PLANS: readonly string[] = ['free', 'pro', 'team'];

// ============================================================
// v11.6 — GUEST PASS (تخطي تسجيل الدخول بفترة محدودة).
// The user may SKIP sign-in and use the full app as a guest for
// GUEST_TTL_DAYS days. The clock is DEVICE-LEVEL and starts at the
// FIRST skip — re-skipping never extends it. After expiry the auth
// gate becomes mandatory: the guest session is rejected and the
// skip button disappears until a real account signs in.
// ============================================================
export const GUEST_TTL_DAYS = 7;
const GUEST_TTL_MS = GUEST_TTL_DAYS * 24 * 60 * 60 * 1000;
const GUEST_ID = 'guest';

function guestFile(): string {
  return path.join(dataDir(), 'guest.json');
}

interface GuestRecord {
  startedAt: number;
}

function readGuest(): GuestRecord | null {
  const g = readJson<GuestRecord>(guestFile());
  return g && typeof g.startedAt === 'number' && Number.isFinite(g.startedAt) ? g : null;
}

function writeGuest(rec: GuestRecord): void {
  writeJson(guestFile(), rec);
}

/** A real account landed (register/login/website) — the pass is consumed. */
function clearGuest(): void {
  try {
    fs.rmSync(guestFile(), { force: true });
  } catch {
    /* best-effort */
  }
}

export function guestRemainingMs(startedAt: number): number {
  // Clock-rollback hardening: a future-dated device clock must never EXTEND
  // the pass beyond its 7-day window. The cap is inclusive at the start.
  return Math.min(GUEST_TTL_MS, startedAt + GUEST_TTL_MS - Date.now());
}

export function guestAccountInfo(startedAt: number): AccountInfo {
  return { id: GUEST_ID, email: '', name: 'Guest', plan: 'free', createdAt: startedAt };
}

/** v11.6 — begin/resume the guest pass. Returns a guest session that
 *  persists across restarts, or guest_expired once the window is over. */
export function guestBegin(): AuthResult {
  try {
    let rec = readGuest();
    if (!rec) {
      rec = { startedAt: Date.now() };
      writeGuest(rec);
    }
    const remaining = guestRemainingMs(rec.startedAt);
    if (remaining <= 0) {
      // Mandatory mode: drop any stale guest session so the gate holds.
      const session = readJson<StoredSession>(sessionFile());
      if (session?.accountId === GUEST_ID) {
        try {
          fs.rmSync(sessionFile(), { force: true });
        } catch {
          /* ignore */
        }
      }
      return { ok: false, error: 'guest_expired' };
    }
    const session: StoredSession = {
      token: randomBytes(32).toString('hex'),
      accountId: GUEST_ID,
      createdAt: Date.now(),
    };
    writeJson(sessionFile(), session);
    return {
      ok: true,
      account: guestAccountInfo(rec.startedAt),
      daysLeft: Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000))),
    };
  } catch {
    return { ok: false, error: 'storage_failed' };
  }
}

/** v11.6 — read-only guest pass state for the UI (gate, settings, status bar). */
export function guestStatus(): GuestPassStatus {
  const rec = readGuest();
  const session = readJson<StoredSession>(sessionFile());
  const active = session?.accountId === GUEST_ID;
  if (!rec) {
    return { startedAt: null, daysLeft: GUEST_TTL_DAYS, expired: false, active: false, ttlDays: GUEST_TTL_DAYS };
  }
  const remaining = guestRemainingMs(rec.startedAt);
  const expired = remaining <= 0;
  return {
    startedAt: rec.startedAt,
    daysLeft: expired ? 0 : Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000))),
    expired,
    active: active && !expired,
    ttlDays: GUEST_TTL_DAYS,
  };
}

// In-memory login-failure counters: email → consecutive failure count.
const loginFailures = new Map<string, number>();

function dataDir(): string {
  return app.getPath('userData');
}

function accountsFile(): string {
  return path.join(dataDir(), 'accounts.json');
}

function sessionFile(): string {
  return path.join(dataDir(), 'session.json');
}

function readJson<T>(file: string): T | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Persist JSON with owner-only permissions (secrets at rest, mode 0600). */
function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/** Throws when `plan` is not one of the known plans (renderer-supplied value). */
function assertValidPlan(plan: unknown): void {
  if (typeof plan !== 'string' || !VALID_PLANS.includes(plan)) {
    throw new Error('AUTH_BAD_PLAN');
  }
}

/**
 * v11.31 — HONESTY: a paid plan asserted by the renderer (sign-up picker) or
 * carried by a self-asserted website deep link is NOT a purchase. Monetization
 * is offline during FREE_SEASON, so the ONLY thing that may back a paid
 * *account* plan is a currently-valid paid license on this device. Everything
 * else resolves to 'free' — no fake "Pro trial started" / "Team plan" claims
 * after registration or pairing.
 */
function honestPlan(requested: 'free' | 'pro' | 'team'): 'free' | 'pro' | 'team' {
  if (requested === 'free') return 'free';
  const lic = getLicense();
  const paid = lic.plan === 'pro' || lic.plan === 'team' ? lic.plan : null;
  if (!paid) return 'free';
  const exp = lic.expiresAt;
  if (typeof exp === 'number' && exp > 0 && exp <= Date.now()) return 'free';
  return paid;
}

function loadAccounts(): StoredAccount[] {
  const parsed = readJson<{ accounts: StoredAccount[] }>(accountsFile());
  return parsed?.accounts ?? [];
}

function saveAccounts(accounts: StoredAccount[]): void {
  writeJson(accountsFile(), { accounts });
}

function toPublic(a: StoredAccount): AccountInfo {
  return { id: a.id, email: a.email, name: a.name, plan: a.plan, createdAt: a.createdAt };
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- public API ----------

function isSessionExpired(session: StoredSession | null): boolean {
  if (!session || typeof session.createdAt !== 'number' || !Number.isFinite(session.createdAt)) {
    return true; // malformed/legacy session without a timestamp → logged out
  }
  return Date.now() - session.createdAt > SESSION_TTL_MS;
}

export function currentAccount(): AccountInfo | null {
  const session = readJson<StoredSession>(sessionFile());
  if (!session?.accountId || !session.token) return null;
  // SECURITY: sessions expire after 30 days — a stale device session is
  // treated as logged out and removed.
  if (isSessionExpired(session)) {
    try {
      fs.rmSync(sessionFile(), { force: true });
    } catch {
      /* best-effort */
    }
    return null;
  }
  // v11.6 — guest sessions resolve against the guest pass clock, not
  // accounts.json: an expired pass is treated as signed out (mandatory auth).
  if (session.accountId === GUEST_ID) {
    const rec = readGuest();
    if (!rec || guestRemainingMs(rec.startedAt) <= 0) {
      try {
        fs.rmSync(sessionFile(), { force: true });
      } catch {
        /* best-effort */
      }
      return null;
    }
    return guestAccountInfo(rec.startedAt);
  }
  const account = loadAccounts().find((a) => a.id === session.accountId);
  return account ? toPublic(account) : null;
}

export function hasAccounts(): boolean {
  return loadAccounts().length > 0;
}

export function register(
  name: string,
  email: string,
  password: string,
  plan: 'free' | 'pro' | 'team' = 'free',
): AuthResult {
  const trimmedName = (name ?? '').trim();
  const trimmedEmail = (email ?? '').trim().toLowerCase();

  if (!trimmedName) return { ok: false, error: 'name_required' };
  if (!EMAIL_RE.test(trimmedEmail)) return { ok: false, error: 'email_invalid' };
  if (!password || password.length < MIN_PASSWORD) return { ok: false, error: 'password_short' };

  // SECURITY: plan arrives from the renderer (cast through ipc) — validate
  // against the allow-list before anything is persisted (throws AUTH_BAD_PLAN).
  assertValidPlan(plan);

  try {
    const accounts = loadAccounts();
    if (accounts.some((a) => a.email === trimmedEmail)) return { ok: false, error: 'email_taken' };

    const salt = randomBytes(16).toString('hex');
    const account: StoredAccount = {
      id: randomBytes(12).toString('hex'),
      email: trimmedEmail,
      name: trimmedName,
      plan: honestPlan(plan),
      createdAt: Date.now(),
      salt,
      hash: hashPassword(password, salt),
    };
    accounts.push(account);
    saveAccounts(accounts);

    // auto sign-in after registration — the guest pass is consumed
    clearGuest();
    const session: StoredSession = {
      token: randomBytes(32).toString('hex'),
      accountId: account.id,
      createdAt: Date.now(),
    };
    writeJson(sessionFile(), session);
    return { ok: true, account: toPublic(account) };
  } catch {
    return { ok: false, error: 'storage_failed' };
  }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const trimmedEmail = (email ?? '').trim().toLowerCase();

  try {
    // SECURITY throttle: after 5 consecutive failures for this email, force a
    // 3s delay BEFORE the (deliberately expensive) scrypt verification, so
    // automated guessing stays slow. In-memory only, reset on success.
    const failures = loginFailures.get(trimmedEmail) ?? 0;
    if (failures >= THROTTLE_THRESHOLD) {
      await new Promise((r) => setTimeout(r, THROTTLE_DELAY_MS));
    }

    const accounts = loadAccounts();
    const account = accounts.find((a) => a.email === trimmedEmail);
    if (!account) return { ok: false, error: 'no_account' };
    if (!verifyPassword(password ?? '', account.salt, account.hash)) {
      loginFailures.set(trimmedEmail, failures + 1);
      return { ok: false, error: 'wrong_password' };
    }
    loginFailures.delete(trimmedEmail);

    clearGuest();
    const session: StoredSession = {
      token: randomBytes(32).toString('hex'),
      accountId: account.id,
      createdAt: Date.now(),
    };
    writeJson(sessionFile(), session);
    return { ok: true, account: toPublic(account) };
  } catch {
    return { ok: false, error: 'storage_failed' };
  }
}

export function logout(): void {
  try {
    fs.rmSync(sessionFile(), { force: true });
  } catch {
    /* ignore */
  }
}

/** Upgrade the signed-in account's plan (used by Plans screen activation). */
export function setPlan(accountId: string, plan: 'free' | 'pro' | 'team'): AccountInfo | null {
  // SECURITY: plan arrives from the renderer — validate before persisting
  // (throws AUTH_BAD_PLAN on anything outside the allow-list).
  assertValidPlan(plan);
  try {
    const accounts = loadAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return null;
    account.plan = honestPlan(plan);
    saveAccounts(accounts);
    return toPublic(account);
  } catch {
    return null;
  }
}

/** Very small password-strength heuristic shared with the UI (0-4). */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= MIN_PASSWORD) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(4, score);
}

// ============================================================
// v11.3 — WEBSITE-LINKED ACCOUNTS (OpenCode-style activation)
// Creating an account happens ON THE WEBSITE, never inside the app:
//   1. the app generates a short PAIR CODE and opens
//      <site>/auth#pair=<code>&mode=signup  (Next.js route: /auth, NOT /auth.html)
//   2. the user registers/signs in on the website
//   3. the website sends the OS back to sadeem://auth/callback?...
//   4. main.ts hands the payload to completeWebAuth() — the pair must
//      match a PENDING code (15-minute TTL) — and the session opens.
// No server participates in this build: the handshake is the deep link
// itself, and the pair code binds the browser tab to this device.
// ============================================================

/** 15 minutes to finish the website handshake before the pair expires. */
const PAIR_TTL_MS = 15 * 60 * 1000;

interface PendingPair {
  createdAt: number;
}
/** pair code → created-at. Cleared on use or expiry. */
const pendingPairs = new Map<string, PendingPair>();

/** The deployment base of the SADEEM website. SADEEM_SITE_URL overrides it
 *  (dev/staging); production builds use the OFFICIAL domain `sadeem-ai.com`.
 *  Older preview URLs (`sadeem-website-theta.vercel.app`, `sadeem.app`) are
 *  retired — deep links must land on the canonical domain. */
export function websiteBaseUrl(): string {
  const env = process.env.SADEEM_SITE_URL;
  if (env && /^https?:\/\//i.test(env.trim())) return env.trim().replace(/\/+$/, '');
  return 'https://sadeem-ai.com';
}

/** Generate a 6-char pair code (unambiguous alphabet), register it pending. */
function newPairCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

export interface WebAuthBegin {
  pair: string;
  url: string;
}

/** Step 1 — the app asks for a pair code + the website URL to open. */
export function beginWebAuth(mode: 'signup' | 'signin' = 'signup'): WebAuthBegin {
  // sweep expired pairs first (cheap; map stays tiny)
  const now = Date.now();
  for (const [k, v] of pendingPairs) if (now - v.createdAt > PAIR_TTL_MS) pendingPairs.delete(k);
  // One-use codes must never collide: a re-mint would silently overwrite a
  // still-live pairing and pair the wrong browser tab to this device.
  let pair = newPairCode();
  for (let i = 0; i < 8 && pendingPairs.has(pair); i++) pair = newPairCode();
  pendingPairs.set(pair, { createdAt: now });
  // The website is a Next.js app: its auth page is the `/auth` route. The old
  // dot-html auth path 404s on the live deployment, so it is never emitted.
  const url = `${websiteBaseUrl()}/auth#pair=${pair}&mode=${mode}`;
  return { pair, url };
}

export interface WebAuthPayload {
  pair?: string;
  email?: string;
  name?: string;
  plan?: string;
  /** v11.33 — a signed `KDX-…` key carried by the deep link. The browser's
   *  `plan` string is self-asserted and NEVER a receipt: only this key, once
   *  signature-verified by licenseService, can back a paid account plan. */
  lic?: string;
}

/** A deep-link result may carry an honest, human-readable license diagnostic
 *  in addition to the shared AuthResult fields (no shared/types edit needed). */
export interface WebAuthResult extends AuthResult {
  licenseError?: string;
}

/** Step 4 — the deep link landed. Validate the pair, create/update the
 *  website-origin account, open the session. Never throws to the OS. */
export function completeWebAuth(payload: WebAuthPayload): WebAuthResult {
  try {
    const pair = (payload.pair ?? '').trim().toUpperCase();
    const pending = pendingPairs.get(pair);
    if (!pair || !pending || Date.now() - pending.createdAt > PAIR_TTL_MS) {
      return { ok: false, error: 'no_account' };
    }
    pendingPairs.delete(pair);

    const email = (payload.email ?? '').trim().toLowerCase();
    const name = (payload.name ?? '').trim() || email.split('@')[0] || 'SADEEM user';
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'email_invalid' };
    const rawPlan = (payload.plan ?? 'free').toLowerCase();
    const requestedPlan: 'free' | 'pro' | 'team' = (VALID_PLANS as readonly string[]).includes(rawPlan)
      ? (rawPlan as 'free' | 'pro' | 'team')
      : 'free';
    // A paid `plan` in the callback is a self-asserted string, not a receipt.
    // The ONLY thing that may promote this account to pro/team is a signed
    // `lic` key whose HMAC licenseService verifies right here. An invalid key
    // leaves the account on the free season and carries an honest error.
    const lic = (payload.lic ?? '').trim();
    let licenseError: string | undefined;
    let entitledPlan: 'pro' | 'team' | null = null;
    if (lic) {
      const verdict = validateKey(lic);
      // validateKey() is the single source of truth for key validity — a
      // positive verdict (signature verified by licenseService) is the receipt.
      entitledPlan = verdict.ok && verdict.plan ? verdict.plan : null;
      if (entitledPlan) {
        // Persist the redemption through licenseService's own store path
        // (owner-only license.json). Validation already passed; failures are
        // never allowed to crash the OS deep-link handler.
        try {
          void Promise.resolve(activateLicense(lic)).catch(() => undefined);
        } catch {
          /* best-effort — the verified verdict still backs this session */
        }
      } else {
        licenseError = verdict.error
          ? `${verdict.error} The account stays on the free season.`
          : 'Invalid license key — the account stays on the free season.';
      }
    }
    const plan = entitledPlan ?? honestPlan(requestedPlan);

    const accounts = loadAccounts();
    let account = accounts.find((a) => a.email === email);
    if (account) {
      // P1 (launch audit) — a website-origin deep link is SELF-ASSERTED identity.
      // It must never rewrite a LOCAL (password-backed) account: the lookup is
      // by exact (lowercased) email, so the only remaining question is origin.
      // A local account keeps its name, password AND plan until its owner signs
      // in with that password; the pair is still consumed (one-use) so a replay
      // cannot be used to probe or hijack it.
      if (account.via !== 'website') {
        return { ok: false, error: 'email_taken' };
      }
      // existing WEBSITE account, same email: refresh profile fields, keep id
      account.name = name;
      account.plan = plan;
      account.via = 'website';
    } else {
      account = {
        id: randomBytes(12).toString('hex'),
        email,
        name,
        plan,
        createdAt: Date.now(),
        salt: '',
        hash: '',
        via: 'website',
      };
      accounts.push(account);
    }
    saveAccounts(accounts);

    // the guest pass is consumed the moment a real account is activated
    clearGuest();
    const session: StoredSession = {
      token: randomBytes(32).toString('hex'),
      accountId: account.id,
      createdAt: Date.now(),
    };
    writeJson(sessionFile(), session);
    return {
      ok: true,
      account: toPublic(account),
      ...(licenseError ? { licenseError } : {}),
    };
  } catch {
    return { ok: false, error: 'storage_failed' };
  }
}

/** TRUE when this email belongs to a website-origin account (no local
 *  password exists) — the local login form must redirect to the website. */
export function isWebAccount(email: string): boolean {
  const e = (email ?? '').trim().toLowerCase();
  return loadAccounts().some((a) => a.email === e && a.via === 'website');
}
