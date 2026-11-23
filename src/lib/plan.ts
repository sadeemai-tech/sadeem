// Surnia — renderer-side plan resolution (pure, no Electron imports).
// Mirror of electron/services/licenseService.ts effectivePlan(): the main
// process cannot share code with src/, so keep both implementations in sync.
import type { LicenseState } from '../../shared/types';

/**
 * v3.1 — FREE SEASON mirror (electron/services/licenseService.ts). While the
 * payment gateway is offline, every license reads as Pro — no countdown, no
 * expired-trial demotion, no premature paywall.
 */
const FREE_SEASON = true;

/**
 * The plan actually in force right now:
 *  - FREE SEASON → everything reads as Pro (except a real team license);
 *  - paid plan counts only if NOT expired (expiresAt absent/0 = perpetual);
 *  - free + trialUntil in the future → 'pro' (trial), else 'free'.
 */
export function effectivePlan(lic: LicenseState | null | undefined): 'free' | 'pro' | 'team' {
  if (FREE_SEASON) {
    if (lic && lic.plan === 'team') return 'team';
    return 'pro';
  }
  if (!lic) return 'free';
  if (lic.plan === 'pro' || lic.plan === 'team') {
    if (typeof lic.expiresAt !== 'number' || lic.expiresAt <= 0) return lic.plan; // perpetual
    return lic.expiresAt > Date.now() ? lic.plan : 'free';
  }
  if (typeof lic.trialUntil === 'number' && lic.trialUntil > Date.now()) return 'pro';
  return 'free';
}

/** True when the user is on the free plan inside the 14-day Pro trial. */
export function isTrialActive(lic: LicenseState | null | undefined): boolean {
  return !!lic && lic.plan === 'free' && effectivePlan(lic) === 'pro';
}

/** Whole days left in the trial (0 when absent/expired). */
export function trialDaysLeft(lic: LicenseState | null | undefined): number {
  if (!lic || typeof lic.trialUntil !== 'number') return 0;
  return Math.max(0, Math.ceil((lic.trialUntil - Date.now()) / 86_400_000));
}

/** True when a paid license is past its expiresAt date. */
export function isLicenseExpired(lic: LicenseState | null | undefined): boolean {
  if (!lic) return false;
  if (lic.plan !== 'pro' && lic.plan !== 'team') return false;
  return typeof lic.expiresAt === 'number' && lic.expiresAt > 0 && lic.expiresAt <= Date.now();
}
