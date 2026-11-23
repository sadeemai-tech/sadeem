// SADEEM — full-screen authentication (local device accounts).
// SURVEYOR v4: the brand panel reads as an indexed instrument sheet (mono
// indexes, hairline rows); the form header is .caps-md over a .ruler; tabs
// are a .stamp-seg segment.
//
// v11.31 — FINAL LAUNCH POLICY: there is NO monthly plan and NO paid tier on
// sign-up. The old 3-card picker (Free / Pro trial / Team) with "$n/mo" prices
// and the fake "Pro trial started" welcome panel are gone: the backend's
// honestPlan() forces every self-asserted plan to `free`, so those controls
// were dead and the trial copy was a lie. Sign-up now creates a plain free-
// season account and says so, using the same bilingual copy as the Plans
// screen. Real scrypt-hashed accounts; nothing is uploaded anywhere. The
// auth gate contract (App.tsx) is unchanged: the screen only disappears once
// setAccount() is called.
import { useEffect, useMemo, useState } from 'react';
import { Check, Globe, KeyRound, Lock } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { FreeSeasonBadge, PlanBadge } from './billingShared';
import './billing.css';
import type { AccountInfo, AuthError } from '../../shared/types';
import { Logo } from './Logo';
import { Btn, TextInput } from './ui';

type Tab = 'in' | 'up';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const LEFT_POINTS: { key: string; fb: string }[] = [
  {
    key: 'auth.point.plan',
    fb: 'Plan mode: the agent researches read-only, then proposes a plan you approve',
  },
  {
    key: 'auth.point.device',
    fb: 'Real access to your machine: files, terminal, git — your tools, your machine',
  },
  {
    key: 'auth.point.models',
    fb: 'Claude, GPT, Gemini, GLM, DeepSeek, Ollama — bring your own key',
  },
  {
    key: 'auth.point.privacy',
    fb: 'Local-first: keys are encrypted, code never leaves this device',
  },
];

/** The one precise artistic element of this surface: an open season dial —
 *  four graduations, one hand and a seed point. Same motif as the Plans ring. */
function SeasonSeal() {
  return (
    <svg width={34} height={34} viewBox="0 0 40 40" fill="none" stroke="currentColor"
      style={{ color: 'var(--acc)' }} className="shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r="15" strokeWidth="1" opacity="0.35" />
      <path d="M20 3v4M20 33v4M3 20h4M33 20h4" strokeWidth="1" opacity="0.6" />
      <path d="M20 20 30 12" strokeWidth="1.2" />
      <circle cx="20" cy="20" r="2" fill="currentColor" stroke="none" />
      <circle cx="30" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

const FREE_SEASON_COPY =
  'SADEEM is free during the public season — bring your own keys. There is no monthly plan; monetization is being designed.';

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function AuthScreen() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const setAccount = useStore((s) => s.setAccount);
  const account = useStore((s) => s.account);
  const license = useStore((s) => s.license);
  const refreshLicense = useStore((s) => s.refreshLicense);
  const notify = useStore((s) => s.notify);

  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).get('screen') === 'auth-signup' ? 'up' : 'in',
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strength, setStrength] = useState(0);

  // Pending account created by a successful register — shown on the welcome
  // panel until the user continues (only then does the auth gate release).
  const [pending, setPending] = useState<AccountInfo | null>(null);

  // v11.33 — website sign-in is the PRIMARY path; offline keys are the fallback.
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [licBusy, setLicBusy] = useState(false);
  const ownerLicense =
    (license?.plan === 'pro' || license?.plan === 'team') &&
    !(typeof license?.expiresAt === 'number' && license.expiresAt > 0 && license.expiresAt <= Date.now());
  const statusLabel = ownerLicense ? 'Owner License' : t('billing.free.badge', 'Free season');

  /** Mint a one-use pair code via authService, then hand the URL to the OS
   *  browser. The app window itself is NEVER navigated. */
  const startWebAuth = async (webMode: 'signup' | 'signin') => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.authWebBegin(webMode);
      await api.openExternal(res.url);
      notify(
        t(
          'auth.web.opened',
          lang === 'ar'
            ? 'فتحنا موقع سديم في متصفحك — أكمل هناك وسيعود بك الموقع إلى التطبيق تلقائياً.'
            : 'We opened the SADEEM website in your browser — finish there and the site returns you here automatically.',
        ),
      );
    } catch {
      setError(t('auth.err.storage_failed', 'Could not open the website right now.'));
    } finally {
      setBusy(false);
    }
  };

  /** Offline fallback: licenseService verifies + stores the signed key. */
  const activateOfflineLicense = async () => {
    const k = licenseKey.trim();
    if (!k || licBusy) return;
    setLicBusy(true);
    try {
      const res = await api.licenseActivate(k);
      await refreshLicense();
      if (res?.plan && res.plan !== 'free') {
        setLicenseKey('');
        setOfflineOpen(false);
        notify(t('plans.activated', 'License activated'));
      } else {
        setError(t('plans.invalidKey', 'Invalid license key'));
      }
    } catch {
      setError(t('plans.invalidKey', 'Invalid license key'));
    } finally {
      setLicBusy(false);
    }
  };

  // If a session is already valid this screen never shows (App gates it).
  useEffect(() => {
    if (password.length > 0 && tab === 'up') {
      void api.authStrength(password).then(setStrength);
    }
  }, [password, tab]);

  const strengthLabel = useMemo(() => {
    if (strength <= 1) return { label: t('auth.strength.weak', 'Weak'), tone: 'var(--bad)' };
    if (strength === 2) return { label: t('auth.strength.fair', 'Fair'), tone: 'var(--warn)' };
    if (strength === 3) return { label: t('auth.strength.good', 'Good'), tone: 'var(--acc)' };
    return { label: t('auth.strength.strong', 'Strong'), tone: 'var(--ok)' };
  }, [strength, t]);

  const localErr = (code: AuthError | null): string | null => {
    if (code) return t(`auth.err.${code}`, code);
    if (tab === 'up') {
      if (!name.trim()) return t('auth.err.name_required', 'Please enter your name');
      if (!EMAIL_RE.test(email.trim())) return t('auth.err.email_invalid', 'invalid email');
      if (password.length < 8) return t('auth.err.password_short', 'too short');
      if (password !== confirm) return t('auth.err.password_mismatch', 'mismatch');
    } else {
      if (!EMAIL_RE.test(email.trim())) return t('auth.err.email_invalid', 'invalid email');
    }
    return null;
  };

  const submit = async () => {
    const pre = localErr(null);
    if (pre) {
      setError(pre);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // No plan is offered on sign-up: every account is a free-season account.
      // Passing 'free' is explicit and matches the backend's honestPlan().
      const res =
        tab === 'up'
          ? await api.authRegister(name.trim(), email.trim(), password, 'free')
          : await api.authLogin(email.trim(), password);
      if (res.ok && res.account) {
        if (tab === 'up') setPending(res.account);
        else setAccount(res.account);
      } else {
        setError(t(`auth.err.${res.error}`, res.error ?? 'error'));
      }
    } catch {
      setError(t('auth.err.storage_failed', 'storage failed'));
    } finally {
      setBusy(false);
    }
  };

  const continueLocal = () => {
    // No account — proceed straight to the product (Windsurf-style escape hatch).
    // Persist the choice so the auth gate doesn't reappear on next launch.
    useStore.getState().updateSettings({ localOnly: true });
    setAccount(account ?? { id: 'local', email: '', name: lang === 'ar' ? 'مستخدم محلي' : 'Local user', plan: 'free', createdAt: Date.now() });
  };

  // ---------- welcome panel (after a successful free-season register) ------
  if (pending) {
    const acc = pending;
    return (
      <div className="fixed inset-0 z-[90] bg-[var(--bg)] flex overflow-hidden">
        <BrandPanel />

        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="w-full max-w-[400px] anim-in">
            <div className="aurora-panel aurora-raised p-5 flex flex-col gap-3">
              {/* account chip with the one honest plan badge */}
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-[var(--r-sm2)] flex items-center justify-center text-[13px] font-bold shrink-0"
                  style={{ background: 'var(--acc)', color: 'var(--acc-ink)' }}
                  aria-hidden="true"
                >
                  {(acc.name || '?').trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold truncate" dir="auto">{acc.name}</div>
                  <div className="text-[10.5px] text-dim truncate tnum" dir="ltr">
                    {acc.email}
                  </div>
                  <div className="text-[10px] text-faint tnum" role="status" dir="auto">
                    {t('auth.signedInAs', lang === 'ar' ? `مسجّل الدخول كـ ${acc.email} · ${statusLabel}` : `Signed in as ${acc.email} · ${statusLabel}`)}
                  </div>
                </div>
                <PlanBadge plan={acc.plan} />
              </div>

              <div className="h-px" style={{ background: 'var(--line)' }} />

              <div className="flex items-start gap-3">
                <SeasonSeal />
                <div className="min-w-0">
                  <div className="caps caps-md" dir="auto">
                    {t('auth.welcome.free', 'Welcome to SADEEM')}
                  </div>
                  <p className="text-[11.5px] text-dim mt-1.5 leading-relaxed" dir="auto">
                    {t('billing.freeSeason.statement', FREE_SEASON_COPY)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <FreeSeasonBadge />
                <span className="text-[10.5px] text-faint" dir="auto">
                  {t('auth.localOnlyDesc', 'Everything stays on this device.')}
                </span>
              </div>

              <Btn variant="primary" className="w-full h-9" onClick={() => setAccount(acc)}>
                {t('onboard.done', 'Start building')}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- auth form ----------
  return (
    <div className="fixed inset-0 z-[90] bg-[var(--bg)] flex overflow-hidden">
      {/* ---------- left brand panel ---------- */}
      <BrandPanel />

      {/* ---------- right form ---------- */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-[400px] anim-in">
          <div className="md:hidden flex items-center gap-2 mb-6">
            <Logo size={22} />
            <span className="caps text-[14px]">{t('app.name', 'SADEEM')}</span>
          </div>

          <h1 className="caps caps-md text-[var(--ink)]" dir="auto">
            {tab === 'in' ? t('auth.welcomeBack', 'Welcome back') : t('auth.signUp', 'Create account')}
          </h1>
          <p className="text-[12px] text-dim mt-1.5 leading-relaxed" dir="auto">
            {t('auth.signInSub', 'Sign in to your local SADEEM account.')}
          </p>
          <div className="ruler mt-3.5 mb-5" />

          {/* one honest statement — free season, BYOK, no monthly plan */}
          <div className="mb-5 px-3 py-2.5 rounded-[var(--radius-sm)] flex gap-2.5 items-start"
            style={{ border: '1px solid var(--line)', background: 'var(--bg1)' }}>
            <SeasonSeal />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FreeSeasonBadge />
              </div>
              <p className="text-[11px] text-dim leading-relaxed mt-1.5" dir="auto">
                {t('billing.freeSeason.statement', FREE_SEASON_COPY)}
              </p>
            </div>
          </div>

          {/* v11.33 — PRIMARY: sign in / create account on the website. */}
          <div className="mb-5">
            <div className="micro-label mb-2" dir="auto">
              {t('auth.web.eyebrow', lang === 'ar' ? 'الحساب مرتبط بالموقع الإلكتروني' : 'ACCOUNT · LINKED TO THE WEBSITE')}
            </div>
            <div className="flex flex-col gap-2">
              <Btn variant="primary" className="w-full h-9" disabled={busy} onClick={() => void startWebAuth('signin')}>
                <Globe size={13} strokeWidth={1.8} aria-hidden />
                <span dir="auto">{t('auth.web.signin', lang === 'ar' ? 'تسجيل الدخول عبر الموقع' : 'Sign in on the website')}</span>
              </Btn>
              <Btn variant="primary" className="w-full h-9" disabled={busy} onClick={() => void startWebAuth('signup')}>
                <Globe size={13} strokeWidth={1.8} aria-hidden />
                <span dir="auto">{t('auth.web.signup', lang === 'ar' ? 'إنشاء حساب جديد' : 'Create account')}</span>
              </Btn>
            </div>
            <p className="text-[10.5px] text-faint leading-relaxed mt-2" dir="auto">
              {t(
                'auth.web.note',
                lang === 'ar'
                  ? 'نفتح المتصفح برمز اقتران لمرة واحدة (صالح 15 دقيقة)؛ لا يغادر التطبيق نافذته.'
                  : 'We open your browser with a one-use pair code (15 minutes); the app window stays right here.',
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 my-4">
            <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
            <span className="micro-label" dir="auto">{t('auth.or.local', lang === 'ar' ? 'أو حساب جهاز محلي' : 'or a local device account')}</span>
            <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
          </div>

          {/* tabs — stamp segment */}
          <div className="stamp-seg is-plain w-full mb-5" role="tablist" aria-label={t('auth.signIn', 'Sign in')}>
            {(['in', 'up'] as Tab[]).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={tab === v}
                onClick={() => {
                  setTab(v);
                  setError(null);
                }}
                className={`flex-1 cursor-pointer ${tab === v ? 'is-active' : ''}`}
                style={{ height: 28, fontSize: 11 }}
              >
                <span dir="auto">{v === 'in' ? t('auth.signIn', 'Sign in') : t('auth.signUp', 'Create account')}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {tab === 'up' && (
              <label className="block">
                <div className="micro-label mb-1.5">{t('auth.name', 'Full name')}</div>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={lang === 'ar' ? 'سارة العلي' : 'Sara Ali'} />
              </label>
            )}
            <label className="block">
              <div className="micro-label mb-1.5">{t('auth.email', 'Email')}</div>
              <TextInput
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label className="block">
              <div className="micro-label mb-1.5">{t('auth.password', 'Password')}</div>
              <TextInput
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === 'up' ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
              {tab === 'up' && password.length > 0 && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="h-1 flex-1 rounded-[1px] transition-colors"
                        style={{ background: i < strength ? strengthLabel.tone : 'var(--hover-2)' }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px]" style={{ color: strengthLabel.tone }}>
                    {strengthLabel.label}
                  </span>
                </div>
              )}
            </label>
            {tab === 'up' && (
              <label className="block">
                <div className="micro-label mb-1.5">{t('auth.confirm', 'Confirm password')}</div>
                <TextInput
                  type="password"
                  dir="ltr"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                />
              </label>
            )}
          </div>

          {error && (
            <div
              className="mt-3 text-[11.5px] px-3 py-2 rounded-[var(--radius-sm)] anim-in"
              style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)', color: 'var(--bad)', border: '1px solid color-mix(in srgb, var(--bad) 35%, transparent)' }}
              role="alert"
            >
              <span dir="auto">{error}</span>
            </div>
          )}

          <Btn variant="primary" className="w-full h-9 mt-5" disabled={busy} onClick={() => void submit()}>
            {busy ? '…' : tab === 'in' ? t('auth.signIn', 'Sign in') : t('auth.signUp', 'Create account')}
          </Btn>

          <button
            className="w-full text-center text-[11.5px] text-dim hover:text-acc transition-colors mt-3.5 cursor-pointer"
            onClick={() => {
              setTab(tab === 'in' ? 'up' : 'in');
              setError(null);
            }}
          >
            <span dir="auto">
              {tab === 'in' ? t('auth.switchToUp', 'New here? Create an account') : t('auth.switchToIn', 'Already have an account? Sign in')}
            </span>
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
            <span className="micro-label" dir="auto">{t('auth.or', 'or')}</span>
            <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
          </div>

          <Btn className="w-full h-9" onClick={continueLocal}>
            <Lock size={13} strokeWidth={1.8} aria-hidden />
            <span dir="auto">{t('auth.localOnly', 'Continue without an account')}</span>
          </Btn>

          {/* v11.33 — OFFLINE FALLBACK: a signed KDX key needs no website. */}
          <div className="mt-3">
            <button
              type="button"
              className="w-full text-center text-[11px] text-dim hover:text-acc transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              aria-expanded={offlineOpen}
              onClick={() => setOfflineOpen((v) => !v)}
            >
              <KeyRound size={12} aria-hidden />
              <span dir="auto">{t('auth.licenseOffline', lang === 'ar' ? 'استخدام مفتاح رخصة دون اتصال' : 'Use a license key offline')}</span>
            </button>
            {offlineOpen && (
              <div className="mt-2 flex flex-col gap-2">
                <TextInput
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void activateOfflineLicense()}
                  dir="ltr"
                  autoComplete="off"
                  placeholder="KDX-PRO-XXXXX-XXXX-XXX"
                  aria-label={t('auth.licenseKey', 'License key')}
                />
                <Btn className="w-full h-8" disabled={licBusy || !licenseKey.trim()} onClick={() => void activateOfflineLicense()}>
                  {licBusy ? '…' : t('plans.activate', 'Activate key')}
                </Btn>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-4 text-[10px] text-faint">
            <Check size={11} strokeWidth={2} className="text-acc" aria-hidden />
            <span dir="auto">{t('auth.deviceNote', 'Accounts are stored on this device only (scrypt-hashed).')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- left brand panel (shared by form + welcome) ----------

function BrandPanel() {
  const t = useT();
  return (
    <div
      className="hidden md:flex flex-col justify-between shrink-0 w-[46%] max-w-[560px] p-10"
      style={{ background: 'var(--bg1)', borderInlineEnd: '1px solid var(--line)' }}
    >
      <div className="flex items-center gap-3">
        <Logo size={28} />
        <div>
          <div className="caps text-[15px] leading-none text-[var(--ink)]" dir="auto">{t('app.name', 'SADEEM')}</div>
          <div className="micro-label mt-1.5" dir="auto">{t('app.tagline', 'AI Coding Workstation')}</div>
        </div>
      </div>

      <div className="flex flex-col">
        {LEFT_POINTS.map(({ key, fb }, i) => (
          <div
            key={key}
            className="flex items-baseline gap-3.5 py-3.5 border-t"
            style={{ borderColor: 'var(--line-soft)' }}
          >
            <span className="tnum text-[11px] shrink-0 w-[22px]" style={{ color: 'var(--acc2)' }} dir="ltr">
              {pad2(i + 1)}
            </span>
            <span className="text-[12.5px] leading-relaxed text-dim" dir="auto">{t(key, fb)}</span>
          </div>
        ))}
      </div>

      <div className="text-[10.5px] text-faint leading-relaxed" dir="auto">
        {t('auth.deviceNote', 'Accounts are stored on this device only (scrypt-hashed).')}
      </div>
    </div>
  );
}

export default AuthScreen;
