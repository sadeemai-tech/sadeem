// SADEEM — v11.11 (A6) canonical PROVIDER-SLICE derivation (pure, store-agnostic).
//
// The Settings UI persists the fetched live model list as
// ProviderEntry.lastModels (shared/types.ts). These pure helpers read that
// exact shape so every consumer (ModelPicker, persistence checks) agrees on
// which providers and models are configured.
//
// Eligibility contract (honest, explicit intent respected):
//   · enabled === false  → NEVER eligible (the user switched it off);
//   · enabled === true   → eligible;
//   · enabled undefined  → eligible ONLY when the entry carries credentials
//     (apiKey / baseUrl for custom / keyless preset) — pre-v11.10 profiles
//     that configured a key before the toggle existed keep working instead of
//     hitting "no models configured" after an upgrade.
import type { ProviderEntry } from '../../shared/types';

interface ProviderEntryLike extends Partial<ProviderEntry> {
  /** Defensive: a legacy/foreign writer may have used `models`. */
  models?: string[];
}

/** Does this entry carry usable credentials (or is it keyless by design)? */
export function providerHasCredentials(entry: ProviderEntryLike | undefined, preset?: { keyless?: boolean }): boolean {
  if (!entry) return preset?.keyless === true;
  if (preset?.keyless) return true;
  if (typeof entry.apiKey === 'string' && entry.apiKey.trim() !== '') return true;
  if (typeof entry.baseUrl === 'string' && entry.baseUrl.trim() !== '') return true;
  return false;
}

/** Is this provider entry eligible for racers / picker groups? */
export function providerEligible(entry: ProviderEntryLike | undefined, preset?: { keyless?: boolean }): boolean {
  if (!entry) return false;
  if (entry.enabled === false) return false;
  if (entry.enabled === true) return true;
  // enabled undefined (pre-v11.10 profile): configured credentials count as on
  return providerHasCredentials(entry, preset);
}

/**
 * Canonical model ids for a provider entry — the exact list order:
 *   1. ProviderEntry.lastModels  (the live fetch the Settings UI persists)
 *   2. a legacy `models` field   (defensive against foreign writers)
 *   3. the curated preset list   (what the Settings card shows before a
 *      successful live fetch — enableProvider's honest fallback)
 */
export function providerModelIds(entry: ProviderEntryLike | undefined, presetModels: string[] = []): string[] {
  const clean = (xs: unknown): string[] =>
    Array.isArray(xs) ? (xs as unknown[]).filter((m): m is string => typeof m === 'string' && m.trim() !== '') : [];
  const live = clean(entry?.lastModels);
  if (live.length) return live;
  const legacy = clean(entry?.models);
  if (legacy.length) return legacy;
  return clean(presetModels);
}


