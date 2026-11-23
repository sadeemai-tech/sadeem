// ============================================================
// Surnia — licensing v2
// Offline signed keys (HMAC-SHA256 over Crockford base32) plus
// an optional remote license endpoint (settings.billing.licenseEndpoint,
// checked first when set). Trial auto-provisioning + plan gating helper.
//
// Key format v2:  KDX-PLAN-EXPIP-SIG1-SIG2
//   PLAN  ∈ {PRO, TEAM, OWNER, FOUNDER}
//   EXPIP = 5 Crockford-base32 chars of the expiry epoch-DAYS (0 = perpetual)
//   SIG   = 7 Crockford-base32 chars = first 35 bits of
//           HMAC-SHA256(secret='KODex-license-v1', message=`${PLAN}|${days}|`)
//           split as SIG1 (4 chars) + SIG2 (3 chars)
// Legacy pattern KDX-PRO-XXXX-XXXX-XXXX stays accepted (unsigned).
//
// v11.33 — LICENSE ENTITLEMENT TRUTH. One-time OWNER / FOUNDER keys are an
// explicit, honest plan mapping: a valid signed OWNER/FOUNDER key resolves to
// the highest local entitlement (`plan: 'pro'`) with the label
// "Owner License (v11 series)". It is PERPETUAL for the whole v11 series
// (v11 + every v11.x) and carries a 50% discount on the next major — it is
// deliberately NOT marketed as "lifetime forever" and gets no arbitrary
// expiry. BYOK (bring-your-own-keys) stays free forever; no monthly charge,
// no credits, no fake "active subscription". See docs/BILLING.md for the
// contract + honest limitations.
// ============================================================
import { createHmac, randomBytes } from 'crypto';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { LicenseState } from '../../shared/types';
import { getLicense, getSettings, saveLicense } from './storeService';
import { FREE_SEASON, refreshPlan } from './billingService';

// ---------- constants ----------
/**
 * LEGACY HMAC secret — kept ONLY to validate old v2 keys minted before v2.2.
 * v2.2 security fix: new keys are signed with a runtime-generated secret
 * persisted owner-only (0600) at <userData>/license.secret, so offline key
 * minting requires local file access on the user's machine, not source code.
 */
export const LICENSE_SECRET = 'KODex-license-v1';

let runtimeSecretCache = '';

/** Runtime HMAC secret — generated once, persisted 0600, cached in memory. */
function getLicenseSecret(): string {
  if (runtimeSecretCache) return runtimeSecretCache;
  try {
    const dir = app.getPath('userData');
    const file = path.join(dir, 'license.secret');
    // eslint-disable-next-line no-sync
    const raw = fsSync.readFileSync(file, 'utf8').trim();
    if (raw.length >= 32) {
      runtimeSecretCache = raw;
      return runtimeSecretCache;
    }
  } catch {
    /* generate below */
  }
  const secret = randomBytes(32).toString('hex');
  try {
    const dir = app.getPath('userData');
    // eslint-disable-next-line no-sync
    fsSync.mkdirSync(dir, { recursive: true });
    // eslint-disable-next-line no-sync
    fsSync.writeFileSync(path.join(dir, 'license.secret'), secret + '\n', { mode: 0o600 });
  } catch {
    /* in-memory secret still works for this session */
  }
  runtimeSecretCache = secret;
  return runtimeSecretCache;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DAY_MS = 86_400_000;
/**
 * v11.31 — FREE_SEASON is imported from billingService (the ONE source of
 * truth). There is intentionally no local mirror: the old literal could drift
 * out of sync with the gate layer and reintroduce a silent paywall. While the
 * season is on, effectivePlan() reports Pro for every non-team license so the
 * UI never shows a trial countdown or an "expired" paywall nag.
 */
const PLANS: LicenseState['plan'][] = ['free', 'pro', 'team'];

/**
 * v11.33 — the OWNER license is a ONE-TIME purchase: perpetual v11 + all
 * v11.x, 50% off the next major, BYOK free forever. The label is deliberately
 * scoped to the v11 series — "lifetime forever" would be a false claim.
 */
export const OWNER_LICENSE_LABEL = 'Owner License (v11 series)';
export const NEXT_MAJOR_DISCOUNT_PERCENT = 50;
/** A LicenseState `source` marker persisted for owner keys (no schema change
 *  needed: storeService round-trips `source` as an opaque string). */
export const OWNER_SOURCE = 'owner';
/** Raw plan codes that denote an Owner License (signed v2 or legacy v1). */
const OWNER_CODES = new Set(['OWNER', 'FOUNDER']);

/** Legacy unsigned keys (v1) — accepted for backward compatibility. */
const LEGACY_RE = /^KDX-(PRO|TEAM|OWNER|FOUNDER)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
/** v2 signed keys: KDX-PLAN-EXPIP(5)-SIG1(4)-SIG2(3). */
const V2_RE = /^KDX-(PRO|TEAM|OWNER|FOUNDER)-([0-9A-Z]{5})-([0-9A-Z]{4})-([0-9A-Z]{3})$/;

/** True when this LicenseState was redeemed from an OWNER/FOUNDER key. */
export function isOwnerLicense(lic: LicenseState | null | undefined): boolean {
  return !!lic && (String(lic.source) === OWNER_SOURCE || lic.licensedTo === OWNER_LICENSE_LABEL);
}

// ---------- Crockford base32 helpers ----------
/** Encode a non-negative integer into `length` Crockford base32 chars. */
function b32Encode(value: number, length: number): string {
  const v = Math.max(0, Math.floor(value));
  let out = '';
  for (let i = length - 1; i >= 0; i--) {
    const digit = Math.floor(v / Math.pow(32, i)) % 32;
    out += CROCKFORD[digit];
  }
  return out;
}

/** Decode Crockford base32 chars back to a number (null on bad chars). */
function b32Decode(chars: string): number | null {
  let v = 0;
  for (const ch of chars) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) return null;
    v = v * 32 + idx;
  }
  return v;
}

/** Crockford confusable mapping: I/L → 1, O → 0 (U is simply invalid). */
function b32Normalize(chars: string): string {
  return chars.replace(/[IL]/g, '1').replace(/O/g, '0');
}

// ---------- v2 signing ----------
/** First 35 bits of HMAC-SHA256(`${PLAN}|${days}|`), as 7 base32 chars. */
function signV2WithSecret(planUpper: string, expiryDays: number, secret: string): string {
  const digest = createHmac('sha256', secret)
    .update(`${planUpper}|${expiryDays}|`, 'utf8')
    .digest();
  // 35 bits = digest[0..3] (8 bits each) + top 3 bits of digest[4].
  const bits =
    (digest[0] & 0xff) * 0x8000000 + // 2^27
    (digest[1] & 0xff) * 0x100000 + // 2^19
    (digest[2] & 0xff) * 0x2000 + // 2^11
    (digest[3] & 0xff) * 0x8 + // 2^3
    ((digest[4] & 0xff) >>> 5);
  return b32Encode(bits, 7);
}

function signV2(planUpper: string, expiryDays: number): string {
  return signV2WithSecret(planUpper, expiryDays, getLicenseSecret());
}

/** Plan codes accepted when minting a v2 key (OWNER/FOUNDER = owner license). */
export type KeyPlanCode = 'pro' | 'team' | 'owner' | 'founder';

/** Build a valid v2 key (parity with scripts/license-gen.cjs). */
export function buildKeyV2(plan: KeyPlanCode, expiryDays: number): string {
  const upper = plan.toUpperCase();
  const expy = b32Encode(Math.max(0, Math.floor(expiryDays)), 5);
  const sig = signV2(upper, Math.max(0, Math.floor(expiryDays)));
  return `KDX-${upper}-${expy}-${sig.slice(0, 4)}-${sig.slice(4)}`;
}

export interface DecodedKey {
  /** LicenseState plan: owner/founder keys map to the top local tier, 'pro'. */
  plan: 'pro' | 'team';
  /** Owner licenses are perpetual — always reported as 0 here. */
  expiryDays: number;
  /** True for OWNER / FOUNDER plan codes. */
  owner: boolean;
}

/** Verify + decode a v2 key. Null when the signature does not verify. */
export function decodeKeyV2(key: string): DecodedKey | null {
  // Normalize here too so direct tool callers get the same verdict as the
  // validateKey()/activate() paths (which already strip spaces).
  const normalized = String(key ?? '').toUpperCase().replace(/\s+/g, '');
  const m = normalized.match(V2_RE);
  if (!m) return null;
  const planUpper = m[1];
  const owner = OWNER_CODES.has(planUpper);
  const plan = (owner ? 'pro' : planUpper.toLowerCase()) as 'pro' | 'team';
  const expiryDays = b32Decode(b32Normalize(m[2]));
  if (expiryDays === null) return null;
  const sig = b32Normalize(m[3] + m[4]);
  // v2.2: runtime secret first, legacy constant second (old keys keep working).
  if (sig === signV2WithSecret(planUpper, expiryDays, getLicenseSecret())) {
    return { plan, expiryDays: owner ? 0 : expiryDays, owner };
  }
  if (sig === signV2WithSecret(planUpper, expiryDays, LICENSE_SECRET)) {
    return { plan, expiryDays: owner ? 0 : expiryDays, owner };
  }
  return null;
}

// ---------- plan resolution (pure) ----------
/**
 * The plan actually in force right now:
 *  - paid plan counts only if NOT expired (expiresAt absent/0 = perpetual);
 *  - expired paid plan → 'free';
 *  - free + trialUntil in the future → 'pro' (trial), else 'free'.
 * Renderer mirror lives in src/lib/plan.ts (main cannot import from src/).
 */
export function effectivePlan(lic: LicenseState | null | undefined): 'free' | 'pro' | 'team' {
  // v3.1 — FREE SEASON kills the premature-paywall perception: the payment
  // gateway is offline, every feature gate is already open (billingService),
  // so a trial/expired-trial/free license now reads as Pro everywhere (no
  // countdown, no "expired" demotion). Mirror kept in src/lib/plan.ts.
  if (FREE_SEASON) {
    // Every gate is open; only a genuine team key is still honored as team.
    // A free/expired/trial license reads as Pro — never a countdown or nag.
    return lic?.plan === 'team' ? 'team' : 'pro';
  }
  if (!lic) return 'free';
  if (lic.plan === 'pro' || lic.plan === 'team') {
    if (typeof lic.expiresAt !== 'number' || lic.expiresAt <= 0) return lic.plan; // perpetual
    return lic.expiresAt > Date.now() ? lic.plan : 'free';
  }
  if (typeof lic.trialUntil === 'number' && lic.trialUntil > Date.now()) return 'pro';
  return 'free';
}

// ---------- service ----------
/**
 * Cache the subscription state in settings via billingService.refreshPlan()
 * after every license mutation, so plan gating (checkGate) sees the new plan
 * immediately. Best-effort: a billing-cache failure never breaks licensing.
 */
async function syncPlanState(): Promise<void> {
  try {
    refreshPlan();
  } catch {
    /* billing cache is best-effort */
  }
}

export async function get(): Promise<LicenseState> {
  const lic = getLicense();
  // v3.1 — trial auto-provision REMOVED. The old code started a 14-day clock
  // on first app open ("the trial expired without me ever using it" = the
  // premature-paywall complaint). FREE_SEASON keeps everything unlocked
  // anyway; a real trial now only starts via explicit activation.
  return lic;
}

// ---------- key validation (returned, never thrown) ----------

/** Result of validateKey(): ok=false always carries a human-readable error. */
export interface KeyVerdict {
  ok: boolean;
  plan?: 'pro' | 'team';
  /** v2 only: expiry epoch-DAYS encoded in the key (0 = perpetual). */
  expiryDays?: number;
  /** Which validator accepted the key. */
  source?: 'v2' | 'legacy';
  /** v11.33 — true for a signed/legacy OWNER or FOUNDER key. */
  owner?: boolean;
  error?: string;
  hint?: string;
}

/**
 * Validate a license key WITHOUT throwing — the verdict (including the
 * validation error message) is returned. Used by activate() (which maps the
 * error to a thrown, descriptive Error for IPC compatibility) and available
 * standalone for tooling / future endpoints.
 */
export function validateKey(key: string): KeyVerdict {
  const normalized = String(key ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!normalized) {
    return {
      ok: false,
      error: 'License key is empty — paste a key like KDX-PRO-XXXXX-XXXX-XXX.',
      hint: 'KDX-PLAN-EXPIP-SIG1-SIG2',
    };
  }

  // 1) v2 signed key — HMAC must verify exactly.
  const v2 = decodeKeyV2(normalized);
  if (v2) {
    return {
      ok: true,
      plan: v2.plan,
      expiryDays: v2.expiryDays,
      source: 'v2',
      ...(v2.owner ? { owner: true } : {}),
    };
  }

  // 2) right shape but bad signature → say so explicitly.
  if (V2_RE.test(normalized)) {
    return {
      ok: false,
      error:
        'License key signature check failed — the key was mistyped or corrupted.',
      hint: 'KDX-PRO-XXXXX-XXXX-XXX (35-bit HMAC segment must match).',
    };
  }

  // 3) legacy unsigned pattern (v1) — accepted for backward compatibility.
  //    v11.33: OWNER/FOUNDER legacy codes also map to the owner entitlement.
  const legacy = normalized.match(LEGACY_RE);
  if (legacy) {
    const owner = OWNER_CODES.has(legacy[1]);
    return {
      ok: true,
      plan: owner ? 'pro' : (legacy[1].toLowerCase() as 'pro' | 'team'),
      source: 'legacy',
      ...(owner ? { owner: true } : {}),
    };
  }

  return {
    ok: false,
    error:
      'Invalid license key — expected KDX-PRO-XXXXX-XXXX-XXX (signed v2) or KDX-PRO-XXXX-XXXX-XXXX (legacy). Owner keys begin KDX-OWNER-.',
    hint: 'Keys look like KDX-PRO-12345-ABCD-EFG.',
  };
}

// ---------- v11.33 — real entitlement, honest labels, 0600 key storage ----------
/**
 * The entitlement returned by redeemLicense(). Every field is backed by a
 * verified key or by the documented BYOK model — there is no "active
 * subscription" fiction and no monthly charge.
 */
export interface Entitlement {
  /** Highest local plan granted (an Owner License maps to 'pro'). */
  plan: 'pro' | 'team';
  /** Honest human label — deliberately NOT "lifetime forever". */
  label: string;
  /** Owner License is perpetual for v11 + all v11.x (no arbitrary expiry). */
  perpetual: boolean;
  /** Daily run cap once FREE_SEASON ends; null = uncapped. */
  dailyRunCap: number | null;
  /** Bring-your-own-keys usage stays free forever. */
  byok: true;
  /** Owner License discount on the next major (never "all future free"). */
  nextMajorDiscountPercent?: number;
  /** The persisted license state — kept for the existing IPC contract. */
  license: LicenseState;
}

function verifiedKeyPath(): string {
  return path.join(app.getPath('userData'), 'license.key');
}

/** Persist the raw verified key owner-only (0600). Best-effort by design: a
 *  filesystem failure never blocks a key that already verified in memory. */
function persistVerifiedKey(key: string): void {
  try {
    const dir = app.getPath('userData');
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(verifiedKeyPath(), key + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    /* best-effort; the verified state is still persisted 0600 below */
  }
}

function removeVerifiedKey(): void {
  try {
    fsSync.rmSync(verifiedKeyPath(), { force: true });
  } catch {
    /* best-effort cleanup */
  }
}

/** Build the persisted LicenseState from a verified verdict. Owner keys carry
 *  NO expiresAt — they cover the whole v11 series without an arbitrary date. */
function licenseStateFromVerdict(v: KeyVerdict): LicenseState {
  const base: LicenseState = {
    plan: v.plan ?? 'pro',
    activatedAt: Date.now(),
    mode: 'local',
  };
  if (v.owner) {
    return {
      ...base,
      licensedTo: OWNER_LICENSE_LABEL,
      source: OWNER_SOURCE as unknown as LicenseState['source'],
    };
  }
  if (v.source === 'v2') {
    return {
      ...base,
      licensedTo: 'local',
      source: 'local',
      ...(v.expiryDays && v.expiryDays > 0 ? { expiresAt: v.expiryDays * DAY_MS } : {}),
    };
  }
  return { ...base, licensedTo: 'local', source: 'legacy' };
}

function entitlementFromState(state: LicenseState): Entitlement {
  const owner = isOwnerLicense(state);
  const perpetual = !(typeof state.expiresAt === 'number' && state.expiresAt > 0);
  return {
    plan: state.plan === 'team' ? 'team' : 'pro',
    label: owner
      ? OWNER_LICENSE_LABEL
      : state.plan === 'team'
        ? 'Team'
        : 'Pro',
    perpetual,
    // Paid/owner entitlements lift the BYOK free-tier daily cap.
    dailyRunCap: null,
    byok: true,
    ...(owner ? { nextMajorDiscountPercent: NEXT_MAJOR_DISCOUNT_PERCENT } : {}),
    license: state,
  };
}

/**
 * v11.33 — redeem a license key from the UI/store. Verification is OFFLINE
 * (HMAC over the key); the verified state AND the raw key are stored with mode
 * 0600, and a REAL entitlement is returned. A bad key throws exactly one clear
 * English sentence (no JSON, no stack, no provider noise).
 */
export async function redeemLicense(key: string): Promise<Entitlement> {
  const normalized = String(key ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!normalized) {
    throw new Error('License key is empty — paste a key like KDX-PRO-XXXXX-XXXX-XXX.');
  }
  const verdict = validateKey(normalized);
  if (!verdict.ok || !verdict.plan) {
    throw new Error(verdict.error ?? 'Invalid license key.');
  }
  const state = licenseStateFromVerdict(verdict);
  persistVerifiedKey(normalized); // 0600 — raw key, owner-only
  await saveLicense(state); // 0600 — verified state, owner-only
  await syncPlanState();
  return entitlementFromState(state);
}

/** IPC-compatible activation. A configured HTTPS remote endpoint is tried
 *  first (best-effort); otherwise the offline verifier + real entitlement
 *  path in redeemLicense() is used. */
export async function activate(key: string): Promise<LicenseState> {
  const normalized = String(key ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!normalized) {
    throw new Error(
      'License key is empty — paste a key like KDX-PRO-XXXXX-XXXX-XXX.',
    );
  }

  // 1) remote endpoint (if configured) takes precedence — best-effort.
  //    Any failure here falls through to offline validation; raw fetch
  //    errors are never surfaced.
  try {
    const settings = getSettings();
    const endpoint = sanitizeLicenseEndpoint(settings.billing?.licenseEndpoint);
    if (endpoint) {
      const remote = await tryRemote(endpoint, normalized);
      if (remote) {
        persistVerifiedKey(normalized);
        await saveLicense(remote);
        await syncPlanState();
        return remote;
      }
    }
  } catch {
    /* fall through to offline keys */
  }

  // 2) offline — the real redeem path (0600 storage + honest entitlement).
  return (await redeemLicense(normalized)).license;
}

/**
 * Extend the active paid license by `days` (renewals / top-ups). Stacks on
 * the current expiry, or runs from now when the license already expired.
 * Only meaningful for pro/team licenses; throws a descriptive error
 * otherwise (API-level validation, consistent with activate()).
 */
export async function renew(days: number): Promise<LicenseState> {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n <= 0 || n > 3650) {
    throw new Error('renew(days): days must be a whole number between 1 and 3650.');
  }
  const lic = getLicense();
  if (lic.plan !== 'pro' && lic.plan !== 'team') {
    throw new Error(
      'renew(days): the current license is not a paid plan — activate a Pro/Team key first.',
    );
  }
  const base =
    typeof lic.expiresAt === 'number' && lic.expiresAt > Date.now()
      ? lic.expiresAt
      : Date.now();
  const next: LicenseState = { ...lic, expiresAt: base + n * DAY_MS };
  await saveLicense(next);
  await syncPlanState();
  return next;
}

export async function deactivate(): Promise<LicenseState> {
  const prev = getLicense();
  // Preserve trialUntil so deactivating can't be used to mint a fresh trial.
  const next: LicenseState = {
    plan: 'free',
    mode: 'local',
    ...(typeof prev.trialUntil === 'number' ? { trialUntil: prev.trialUntil } : {}),
  };
  removeVerifiedKey();
  await saveLicense(next);
  await syncPlanState();
  return next;
}

// ---------- remote license endpoint ----------
/**
 * v11.31 — TOKEN REDACTION / TRANSPORT: the license key is a secret and must
 * never be POSTed over cleartext. Only HTTPS is accepted, with an explicit
 * loopback-HTTP exception for local development (same posture as the updater
 * feed). Anything else returns '' and activation falls through to the offline
 * validator — no silent leak, no scary network error.
 */
export function sanitizeLicenseEndpoint(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return u.toString().replace(/\/+$/, '');
    if (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname)) {
      return u.toString().replace(/\/+$/, '');
    }
  } catch {
    /* malformed URL → reject */
  }
  return '';
}

interface RemoteLicenseResponse {
  plan?: string;
  licensedTo?: string;
  email?: string;
  expiresAt?: number;
  seats?: number;
}

async function tryRemote(endpoint: string, key: string): Promise<LicenseState | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RemoteLicenseResponse | null;
    if (!data || typeof data !== 'object') return null;
    if (!data.plan || !PLANS.includes(data.plan as LicenseState['plan'])) return null;
    const expiresAt =
      typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) && data.expiresAt > 0
        ? data.expiresAt
        : undefined;
    const seats =
      typeof data.seats === 'number' && Number.isFinite(data.seats) && data.seats > 0
        ? Math.floor(data.seats)
        : undefined;
    return {
      plan: data.plan as LicenseState['plan'],
      licensedTo: data.licensedTo ?? data.email ?? 'local',
      activatedAt: Date.now(),
      mode: 'local',
      ...(expiresAt ? { expiresAt } : {}),
      ...(seats ? { seats } : {}),
      ...(data.email ? { email: data.email } : {}),
      source: 'remote',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
