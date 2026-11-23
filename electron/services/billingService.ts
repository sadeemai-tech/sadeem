// ============================================================
// Surnia — billing & subscription service (v1.3)
// Full local subscription lifecycle: plans, trial, quotas,
// coupons, checkout hand-off. Everything is computed from the
// local license + usage log — no network required to reason
// about the user's plan.
// Owned by: orchestrator (wave 1.3) — billing agent enhances.
// ============================================================
import { shell } from 'electron';
import type {
  BillingOverview,
  CouponResult,
  LicenseState,
  PlanDefinition,
  PlanId,
  SubscriptionState,
  UsagePoint,
} from '../../shared/types';
import * as store from './storeService';

// ---------- plan catalog ----------
/**
 * v11.10 (A8) — EXACTLY TWO TIERS: Free and Pro. The founder directive:
 * the Plans screen must show two cards only — every other tier is gone
 * from the catalog (legacy 'team' licenses still resolve at the license
 * layer; they simply have no marketing card).
 */
/**
 * v2.3 FREE SEASON — the payment gateway is offline, so the app is
 * temporarily 100% free (publicity period). While true:
 *  - checkGate() allows EVERY action for everyone (no caps, no upgrade nags);
 *  - Pro stays visible in the UI but marked unavailable (checkout paused).
 * Flip to false to restore the paid plan.
 */
export const FREE_SEASON = true;

/**
 * v11.33 — the ONLY paid-style number that survives the free season is the
 * BYOK free-tier guardrail. When FREE_SEASON ends, bring-your-own-keys stays
 * usable at 50 runs/day; an Owner License (mapped to 'pro') lifts the cap.
 * There is NO monthly charge and NO credit meter anywhere in this model.
 */
export const FREE_DAILY_RUN_CAP = 50;

/** ✏️ EDITABLE PRICE PLACEHOLDER — the ONE constant the founder edits to
 *  re-price Pro. Single source of truth: the Pro card, checkout strings
 *  and any future billing flow must read THIS value, never a literal.
 *  NOTE: this is NOT a monthly charge; the Pro card is paused while the
 *  gateway is offline. The real product is the one-time Owner License. */
export const PRO_PRICE_USD = 20;

export const PLANS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    blurb: 'Bring your own keys — local agent power, honest limits, forever.',
    features: [
      ' Unlimited agent runs on YOUR OWN API keys (BYO keys)',
      ' All 12 providers — keys stay on this device',
      ' Local features: files, git, terminal, checkpoints, search',
      ' 2 MCP servers',
      ' Community support',
    ],
    limits: {
      dailyRuns: FREE_DAILY_RUN_CAP,
      monthlyTokens: 2_000_000,
      maxMcpServers: 2,
      deviceTools: false,
      parallelToolCalls: false,
      subagents: false,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    priceUsd: PRO_PRICE_USD,
    blurb: 'Every capability unlocked. For daily drivers.',
    features: [
      ' Everything in Free',
      ' Unlimited MCP servers',
      ' Device-control tools',
      ' Parallel tool calls',
      ' All 16 specialist agents',
      ' Priority support',
    ],
    limits: {
      deviceTools: true,
      parallelToolCalls: true,
      subagents: true,
    },
    highlight: true,
    // Computed at module level: false during the free season, true when it ends.
    available: !FREE_SEASON,
  },
];

const TRIAL_DAYS = 14;
/** Promo codes: code → percent off the first period. */
const COUPONS: Record<string, { percentOff: number; label: string }> = {
  KODEX20: { percentOff: 20, label: 'Launch offer — 20% off' },
  WELCOME50: { percentOff: 50, label: 'Welcome — 50% off the first month' },
  DEV10: { percentOff: 10, label: 'Developer discount — 10% off' },
};

function licenseToSubscription(license: LicenseState): SubscriptionState {
  const now = Date.now();
  const paid = license.plan === 'pro' || license.plan === 'team' ? license.plan : null;
  // v11.31 — HONESTY: an EXPIRED paid key is not an active subscription. The
  // license layer already demotes it to free; the billing view must agree
  // instead of showing "Pro / active" forever (a fake paid claim).
  const expired =
    paid !== null &&
    typeof license.expiresAt === 'number' &&
    license.expiresAt > 0 &&
    license.expiresAt <= now;
  const plan: PlanId = paid && !expired ? paid : 'free';
  const trialing = !!license.trialUntil && license.trialUntil > now && plan === 'free';
  const trialDaysLeft = license.trialUntil
    ? Math.max(0, Math.ceil((license.trialUntil - now) / 86_400_000))
    : 0;
  const status: SubscriptionState['status'] = trialing
    ? 'trialing'
    : expired
      ? 'canceled'
      : 'active';
  return {
    plan,
    status,
    trialDaysLeft: trialing ? trialDaysLeft : undefined,
    startedAt: license.activatedAt,
    renewsAt: expired ? undefined : license.expiresAt,
    seats: plan === 'team' ? Math.max(1, license.seats ?? 5) : undefined,
  };
}

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Coerce a persisted usage value to a finite, non-negative number. */
function usageNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Usage points for the last 12 months (newest last) from the local usage log. */
function usageSeries(): UsagePoint[] {
  const s = store.getSettings();
  const log = Array.isArray(s.usageLog) ? s.usageLog : [];
  const byMonth = new Map<string, UsagePoint>();
  for (const e of log) {
    // Defensive: settings.json is user-editable / importable — a malformed
    // row must never crash the billing view or poison a total with NaN.
    if (!e || typeof e.date !== 'string' || !/^\d{4}-\d{2}/.test(e.date)) continue;
    const key = e.date.slice(0, 7);
    const p = byMonth.get(key) ?? { label: key, runs: 0, tokens: 0, costUsd: 0 };
    p.runs += usageNumber(e.runs);
    p.tokens += usageNumber(e.tokens);
    p.costUsd += usageNumber(e.costUsd);
    byMonth.set(key, p);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  // Round ONCE per month (per-row rounding accumulated a persistent drift).
  return months.map(([, v]) => ({ ...v, costUsd: Math.round(v.costUsd * 100) / 100 }));
}

/** Quota gate used by the agent layer: is `action` allowed on this plan? */
export function checkGate(
  action: 'run' | 'mcp' | 'device' | 'parallel' | 'subagent',
): { allowed: boolean; reason?: string } {
  // FREE SEASON — every capability is open to everyone: no caps, no nags.
  if (FREE_SEASON) return { allowed: true };
  // v11.33 — HONEST LIMITS once the free season ends. The chat error path
  // passes these strings verbatim (no ar detection), so they stay English.
  // A BYOK license is free forever but capped; an Owner License (mapped to
  // 'pro') lifts every cap. Nothing here is a monthly charge or a credit.
  const OWNER_HINT = 'An Owner License lifts this limit — one-time, no monthly charge.';
  const FEATURE_REASON = `This capability is not in the BYOK free tier. ${OWNER_HINT}`;
  const MCP_REASON = `MCP server limit reached (2 on the BYOK free tier). ${OWNER_HINT}`;
  const CAP_REASON = `Daily run cap reached (${FREE_DAILY_RUN_CAP}/day on the BYOK free tier). ${OWNER_HINT}`;
  const s = store.getSettings();
  const sub = s.planState ?? licenseToSubscription(store.getLicense());
  const lim = (PLANS.find((p) => p.id === sub.plan) ?? PLANS.find((p) => p.id === 'pro') ?? PLANS[0]).limits;

  if (action === 'device') {
    return lim.deviceTools ? { allowed: true } : { allowed: false, reason: FEATURE_REASON };
  }
  if (action === 'parallel') {
    return lim.parallelToolCalls ? { allowed: true } : { allowed: false, reason: FEATURE_REASON };
  }
  if (action === 'subagent') {
    return lim.subagents ? { allowed: true } : { allowed: false, reason: FEATURE_REASON };
  }
  if (action === 'mcp') {
    const max = lim.maxMcpServers;
    // No limit declared (Pro/Owner) means UNLIMITED — the old `?? 0` silently
    // locked every Pro user out of their own MCP servers once the season ended.
    if (max == null || !Number.isFinite(max)) return { allowed: true };
    const count = (Array.isArray(s.mcpServers) ? s.mcpServers : []).filter((m) => m?.enabled).length;
    // Off-by-one: with max=2 and 2 already connected, a 3rd must be refused.
    return count < max ? { allowed: true } : { allowed: false, reason: MCP_REASON };
  }
  // 'run' — daily run cap on the BYOK free tier only; Owner/Pro uncapped.
  const cap = lim.dailyRuns;
  if (cap == null || !Number.isFinite(cap)) return { allowed: true };
  const today = new Date().toISOString().slice(0, 10);
  const log = Array.isArray(s.usageLog) ? s.usageLog : [];
  const todayRuns = usageNumber(log.find((e) => e?.date === today)?.runs);
  if (todayRuns >= cap) {
    return { allowed: false, reason: CAP_REASON };
  }
  return { allowed: true };
}

// ---------- IPC surface ----------
export function overview(): BillingOverview {
  const s = store.getSettings();
  const license = store.getLicense();
  return {
    subscription: licenseToSubscription(license),
    // Free stays purchasable; Pro is paused while the gateway is offline.
    plans: PLANS.map((p) => ({ ...p, available: p.id === 'free' ? true : !FREE_SEASON })),
    paymentLink: s.billing?.stripePaymentLink,
    usage: usageSeries(),
    license,
    promo: {
      freeSeason: FREE_SEASON,
      message: 'Every Pro capability is unlocked for everyone while payments are paused.',
    },
  };
}

export function setPaymentLink(url: string): { ok: boolean } {
  const s = store.getSettings();
  const clean = String(url ?? '').trim();
  if (clean && !/^https?:\/\//i.test(clean)) return { ok: false };
  store.saveSettings({ ...s, billing: { ...s.billing, stripePaymentLink: clean || undefined } });
  return { ok: true };
}

export function openCheckout(plan: string): { ok: boolean; url?: string; error?: string } {
  const s = store.getSettings();
  const link = s.billing?.stripePaymentLink;
  if (!link) {
    return {
      ok: false,
      error: 'No payment link configured yet. Set one in Settings → Billing (a Stripe payment link URL).',
    };
  }
  void shell.openExternal(link);
  return { ok: true, url: link };
}

export function applyCoupon(code: string): CouponResult {
  const c = COUPONS[String(code ?? '').trim().toUpperCase()];
  if (!c) return { ok: false, message: 'Invalid or expired coupon code.' };
  return { ok: true, message: c.label, percentOff: c.percentOff };
}

/** Recompute the subscription from the license and cache it in settings. */
export function refreshPlan(): SubscriptionState {
  const sub = licenseToSubscription(store.getLicense());
  const s = store.getSettings();
  store.saveSettings({ ...s, planState: sub });
  return sub;
}
