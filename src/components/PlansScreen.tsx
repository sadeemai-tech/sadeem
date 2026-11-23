// SADEEM plans screen — FINAL LAUNCH POLICY (founder): NO monthly plan.
// The old tier grid (Free / Pro / Team with "$20/mo", struck prices,
// "Checkout", "coming soon", coupon box, trial CTAs, paid-plan pause notes
// and subscription summary) has been REMOVED in full — no dead buttons,
// no dead cards, no placeholders. What remains is one honest statement:
// SADEEM is free during the public season with BYOK; monetization is being
// designed. Local license/account logic (key activation, deactivation and
// the offline license readout) is intentionally kept intact.
// Store contract: plansOpen, license, setPlans, refreshLicense, notify.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, KeyRound, Share2, X } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { Btn, IconBtn, Spinner, TextInput } from './ui';
import { Logo } from './Logo';
import './billing.css';
import './settings/s4-art.css';
import { FreeSeasonBadge, FreeSeasonStatement } from './billingShared';
import type { LicenseState } from '../../shared/types';

// The app site URL — also used as the OpenRouter HTTP-Referer (providers.ts).
const APP_SITE_URL = 'https://surnia.app';

const fmtDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The one precise artistic element of this surface: a season ring —
 *  an open dial with four graduations and a single seed point. */
const SeasonRingGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <path
      className="s4-ink"
      d="M36 9a19 19 0 1 1-13 33"
      transform="rotate(-28 36 28)"
    />
    <path className="s4-ink s4-thin" d="M36 5v5M36 46v5M13 28h5M54 28h5" />
    <path className="s4-ink" d="M36 28 48 19" />
    <circle className="s4-dot" cx="36" cy="28" r="2" />
    <circle className="s4-dot" cx="49" cy="18" r="1.4" />
  </svg>
);

export function PlansScreen() {
  const t = useT();
  const ar = useStore((s) => s.settings?.language ?? 'en') === 'ar';
  const open = useStore((s) => s.plansOpen);
  const license = useStore((s) => s.license);
  const setPlans = useStore((s) => s.setPlans);
  const refreshLicense = useStore((s) => s.refreshLicense);
  const notify = useStore((s) => s.notify);

  const [key, setKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  // share button feedback (copied state, auto-clears)
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  // Esc closes the overlay while it is open (window X / title bar stays
  // usable). Stacked modals (the approval DiffModal renders above this
  // screen) also listen on window: when any is up, Escape belongs to it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-modal-open="true"]')) return;
      setPlans(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setPlans]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  if (!open) return null;

  // License readout only — this is a local capability, not a plan card.
  const licensed = license.plan !== 'free';

  const share = () => {
    const done = () => {
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2200);
    };
    try {
      navigator.clipboard
        .writeText(APP_SITE_URL)
        .then(done)
        .catch(() => notify(APP_SITE_URL)); // clipboard blocked → surface the URL
    } catch {
      notify(APP_SITE_URL);
    }
  };

  const activate = async () => {
    const k = key.trim();
    if (!k || activating) return;
    setActivating(true);
    try {
      const res: LicenseState = await api.licenseActivate(k);
      await refreshLicense();
      const ok = !!res && res.plan !== 'free';
      notify(ok ? t('plans.activated', 'License activated') : t('plans.invalidKey', 'Invalid license key'));
      if (ok) setKey('');
    } catch {
      notify(t('plans.invalidKey', 'Invalid license key'));
    } finally {
      setActivating(false);
    }
  };

  const deactivate = async () => {
    if (deactivating) return;
    setDeactivating(true);
    try {
      await api.licenseDeactivate();
      await refreshLicense();
      notify(t('plans.license.deactivated', 'License deactivated — back to the Free plan'));
    } catch {
      notify(t('plans.license.deactivateFailed', 'Could not deactivate the license'));
    } finally {
      setDeactivating(false);
    }
  };

  return (
    // Starts BELOW the 44px custom title bar (top-11) so the window
    // min/max/close buttons stay visible and clickable while open.
    // z-[80]: above DiffModal (z-75) — this screen always wins, X never covered.
    <div
      className="fixed inset-x-0 top-11 bottom-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label={t('plans.title.new', ar ? 'سديم — موسم مجاني' : 'SADEEM — free season')}
    >
      <div
        className="absolute inset-0 scrim-glass"
        style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}
        aria-hidden
      />
      <div className="relative h-full overflow-y-auto" onClick={() => setPlans(false)}>
        <div className="relative max-w-[960px] mx-auto py-12 px-6" onClick={(e) => e.stopPropagation()}>
          <div className="s4-page s4-plans">
            {/* ---------- editorial masthead ---------- */}
            <header className="s4-mast">
              <div className="flex items-center gap-3 mb-1.5">
                <Logo size={34} />
                <span className="s4-eyebrow">
                  {t('s4.plans.eyebrow', ar ? 'سديم / موسم مجاني' : 'SADEEM / FREE SEASON')}
                </span>
              </div>
              <div className="s4-mast-top">
                <div className="min-w-0">
                  <h1 className="s4-title" dir="auto">
                    {t('plans.freeSeason.title', ar ? 'سديم مجانية بالكامل الآن' : 'SADEEM is completely free right now')}
                  </h1>
                  <p className="s4-desc" dir="auto">
                    {t(
                      'billing.free.banner',
                      ar
                        ? 'كل شيء مفتوح — بلا حدود ولا جدار دفع. بمفاتيحك الخاصة، على جهازك.'
                        : 'Everything is unlocked — no limits, no paywall. Bring your own keys; everything stays on your device.',
                    )}
                  </p>
                </div>
                <SeasonRingGlyph />
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <FreeSeasonBadge />
                <button type="button" className={`bx-share press ${copied ? 'is-copied' : ''}`} onClick={share}>
                  {copied ? (
                    <Check size={13} strokeWidth={2} aria-hidden />
                  ) : (
                    <Share2 size={13} strokeWidth={1.8} aria-hidden />
                  )}
                  <span dir="auto">{t('billing.share.copy', 'Copy download link')}</span>
                </button>
                {copied && (
                  <span className="stamp stamp-acc anim-in" role="status">
                    {t('billing.share.copied', 'Link copied')}
                  </span>
                )}
                <span className="text-[10.5px] text-[var(--faint)] tnum" dir="ltr">
                  {APP_SITE_URL}
                </span>
              </div>
              <div className="s4-rule" aria-hidden />
            </header>

            <div className="s4-body">
              {/* ---------- the single honest statement ---------- */}
              <FreeSeasonStatement />

              {/* ---------- license panel (local capability, not a payment) ---------- */}
              <div id="kdx-license-panel" className="card p-5 mt-5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <KeyRound size={14} className="text-dim" />
                    {t('plans.license.title', 'Your license')}
                  </div>
                  {licensed && (
                    <Btn variant="ghost" onClick={() => void deactivate()} disabled={deactivating}>
                      {deactivating && <Spinner size={12} />}
                      {t('plans.license.deactivate', 'Deactivate')}
                    </Btn>
                  )}
                </div>

                {licensed && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 py-3 border-b border-[var(--line)] mb-4">
                    <Detail label={t('plans.license.plan', 'Plan')}>
                      <span className="stamp stamp-acc">{license.plan.toUpperCase()}</span>
                    </Detail>
                    <Detail label={t('plans.license.licensedTo', 'Licensed to')}>
                      <span className="tnum text-[11.5px]" dir="ltr">
                        {license.email || license.licensedTo || '—'}
                      </span>
                    </Detail>
                    <Detail label={t('plans.license.activated', 'Activated')}>
                      <span className="tnum text-[11.5px]" dir="ltr">
                        {license.activatedAt ? fmtDay(license.activatedAt) : '—'}
                      </span>
                    </Detail>
                    <Detail label={t('plans.license.expiry', 'Expiry')}>
                      {license.expiresAt ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="tnum text-[11.5px]" dir="ltr">
                            {fmtDay(license.expiresAt)}
                          </span>
                          {license.expiresAt <= Date.now() && (
                            <span className="stamp stamp-bad">{t('plans.license.expired', 'Expired')}</span>
                          )}
                        </span>
                      ) : (
                        <span className="stamp stamp-acc">{t('plans.license.perpetual', 'Perpetual')}</span>
                      )}
                    </Detail>
                    <Detail label={t('plans.license.seats', 'Seats')}>
                      <span className="tnum text-[11.5px]" dir="ltr">
                        {typeof license.seats === 'number' ? license.seats : '—'}
                      </span>
                    </Detail>
                    <Detail label={t('plans.license.source', 'Source')}>
                      <span className="tnum text-[11.5px]" dir="ltr">
                        {license.source ?? 'local'}
                      </span>
                    </Detail>
                  </div>
                )}

                <div className="text-[12px] text-dim mb-2">
                  {t('plans.activate', 'Have a license key? Activate it below.')}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <TextInput
                    value={key}
                    placeholder={t('settings.billing.keyPh', 'KDX-…')}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void activate()}
                    className="font-code flex-1 min-w-[240px]"
                    dir="ltr"
                  />
                  <Btn variant="primary" onClick={() => void activate()} disabled={!key.trim() || activating}>
                    {activating && <Spinner size={12} />}
                    {t('settings.billing.activate', 'Activate')}
                  </Btn>
                </div>
                <div className="text-[10.5px] text-[var(--faint)] mt-2 font-code" dir="ltr">
                  {t(
                    'plans.key.hint',
                    'Format: KDX-PRO-XXXXX-XXXX-XXX — legacy keys KDX-PRO-XXXX-XXXX-XXXX also work.',
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* close — pinned inside the fixed root so it never scrolls away */}
      <IconBtn
        className="bx-close press absolute top-3 end-4 z-20"
        onClick={() => setPlans(false)}
        aria-label={t('plans.close', 'Close')}
        title={t('plans.close', 'Close')}
      >
        <X size={16} />
      </IconBtn>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1">{label}</div>
      <div className="text-[12px] flex items-center flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default PlansScreen;
