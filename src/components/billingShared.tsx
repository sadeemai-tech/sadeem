// SADEEM — shared billing presentation.
// FINAL LAUNCH POLICY (founder): there is NO monthly subscription plan.
// Everything subscription-shaped has been removed from this module:
// checkout hooks, status chips, subscription summaries, tier/coupon rows,
// usage paywall charts, skeleton and error states, and every "/mo" price.
// Kept: the two local number/date formatters, the free-season badge used by
// the account chip and the usage panel, and ONE honest statement shared by
// the Plans screen and Settings → Account & Data. Local license/account
// logic in the owning screens is untouched — only presentation changed.
import { useStore } from '../store';
import { useT } from '../i18n';
import type { LicenseState } from '../../shared/types';
import './settings/s4-art.css';

// ---------- local formatters (used by Account & Data usage/license rows) ----------

/** Locale-aware short date (e.g. "Mar 1, 2026") — safe in RTL text. */
export function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Compact integer: 950 → "950", 2000000 → "2M", 12300 → "12.3k". */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

// ---------- free-season identity (kept — it is the opposite of a paywall) ----------

/** The single source of the free-season visual identity. Reused by the
 *  account chip (AuthScreen), the usage panel and the two billing surfaces. */
export function FreeSeasonBadge({
  className = '',
  title,
}: {
  className?: string;
  title?: string;
}) {
  const t = useT();
  return (
    <span className={`bx-hero-badge ${className}`} role="status" title={title}>
      <span className="led" aria-hidden />
      {t('billing.free.badge', 'FREE SEASON')}
    </span>
  );
}

/** Account-chip badge. Every plan reads as the free season — no tier display. */
export function PlanBadge({ plan }: { plan: 'free' | 'pro' | 'team' }) {
  void plan;
  return <FreeSeasonBadge />;
}

// ---------- the one honest statement ----------

/** The ONLY pricing copy left in the app. Shared verbatim by the Plans
 *  screen and Settings → Account & Data so the two surfaces cannot drift. */
export function FreeSeasonStatement() {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  return (
    <section className="s4-statement">
      <span className="s4-mono">
        {t(
          'billing.freeSeason.eyebrow',
          ar ? 'لا خطة شهرية' : 'NO MONTHLY PLAN',
        )}
      </span>
      <p className="s4-statement-text" dir="auto">
        {t(
          'billing.freeSeason.statement',
          ar
            ? 'سديم مجانية خلال الموسم العام — بمفاتيحك الخاصة. لا توجد خطة شهرية؛ نموذج الدخل قيد التصميم.'
            : 'SADEEM is free during the public season — bring your own keys. There is no monthly plan; monetization is being designed.',
        )}
      </p>
    </section>
  );
}

// ---------- v11.33 — Owner License truth ----------

/** Honest, bilingual label. Scoped to the v11 series on purpose — the
 *  entitlement is perpetual for v11 + all v11.x with 50% off the next major,
 *  NOT "all future versions free forever". */
export const OWNER_LABEL_EN = 'Owner License (v11 series)';
export const OWNER_LABEL_AR = 'ترخيص المالك (سلسلة v11)';

/** A key redeemed from an OWNER / FOUNDER code is persisted with this source
 *  marker (the main process uses the same constant). */
export function isOwnerLicense(lic: LicenseState | null | undefined): boolean {
  // `source: 'owner'` is a runtime marker (shared/types.ts is not owned here),
  // so compare as a string to keep the type checker honest about the union.
  return !!lic && (String(lic.source) === 'owner' || lic.licensedTo === OWNER_LABEL_EN);
}

/** Status chip shown beside the plan name when an Owner License is active. */
export function OwnerLicenseBadge() {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  return (
    <span className="bx-hero-badge" role="status" title={OWNER_LABEL_EN}>
      <span className="led" aria-hidden />
      {t('billing.owner.badge', ar ? 'ترخيص المالك' : 'OWNER LICENSE')}
    </span>
  );
}

/** The full entitlement statement — one-time, scoped, no recurring charge.
 *  Shared by the account screen so it cannot drift into a paywall claim. */
export function LicenseModelStatement() {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  return (
    <section className="s4-statement">
      <span className="s4-mono">
        {t('billing.owner.eyebrow', ar ? 'ترخيص مالك — دفعة واحدة' : 'OWNER LICENSE — ONE-TIME')}
      </span>
      <p className="s4-statement-text" dir="auto">
        {t(
          'billing.owner.statement',
          ar
            ? 'ترخيص المالك يغطي سلسلة v11 بالكامل (v11 وكل إصدارات v11.x) ويمنح خصم ٥٠٪ على الإصدار الرئيسي القادم. مفاتيحك الخاصة (BYOK) مجانية للأبد، ولا توجد خطة شهرية ولا رصيد مدفوع مسبقاً.'
            : 'The Owner License covers the whole v11 series (v11 and every v11.x) and includes a 50% discount on the next major. Bring your own keys (BYOK) stays free forever — there is no monthly plan and no paid credit balance.',
        )}
      </p>
    </section>
  );
}
