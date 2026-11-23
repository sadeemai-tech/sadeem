// ============================================================
// SADEEM v11 — REAL local account card (Settings → Account).
// The account service already ships scrypt-hashed accounts, sessions,
// throttling and 0600 files — this card exposes it in the UI: create,
// sign in, sign out, delete. Honest labels: everything stays on this
// device; the app works fully without an account.
// v11.6 — GUEST PASS: the auth gate may be SKIPPED for a 7-day
// device-level trial window; after expiry sign-in becomes MANDATORY.
// v11.3 — website-activation handshake (pair code + deep link).
// The s4 masthead + pair-code medallion are presentation only — every
// auth call, IPC path and test hook below is unchanged.
// ============================================================
import React, { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, Eye, EyeOff, Globe, Hourglass, KeyRound, Loader2, LogOut, ShieldCheck, Timer, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { InfoNote } from './controls';
import { Btn, Chip, TextInput } from '../ui';
import './s4-art.css';
import type { GuestPassStatus } from '../../../shared/types';

type Mode = 'create' | 'signin';

/** The one precise artistic element of this page: a pair-code medallion —
 *  a rim, a dashed inner ring and a 3·2 code notch, all 1px currentColor. */
const PairCodeMedallion = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <circle className="s4-ink" cx="36" cy="28" r="19" />
    <circle className="s4-ink s4-thin" cx="36" cy="28" r="15" strokeDasharray="1 4" />
    <path className="s4-ink" d="M26 28h8M38 28h8M32 22v12" />
    <circle className="s4-dot" cx="36" cy="28" r="1.5" />
    <path className="s4-ink s4-thin" d="M36 5v4M36 47v4M13 28h4M55 28h4" />
  </svg>
);

/** Compact editorial frame shared by every account state. */
function AccountFrame({ children }: { children: React.ReactNode }) {
  const t = useT();
  const ar = useStore((s) => s.settings?.language ?? 'en') === 'ar';
  return (
    <div className="s4-page s4-account">
      <header className="s4-mast s4-mast--inline">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.account.eyebrow', ar ? 'الحساب · محلي' : 'ACCOUNT · LOCAL')}
          </span>
          <PairCodeMedallion />
        </div>
        <p className="s4-desc">
          {t(
            's4.account.desc',
            ar
              ? 'كل شيء على هذا الجهاز — المفاتيح لا تغادر سديم.'
              : 'Everything stays on this device — keys never leave SADEEM.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>
      <div className="s4-body">{children}</div>
    </div>
  );
}

export function AccountAuthCard() {
  const t = useT();
  const ar = useStore((s) => s.settings.language) === 'ar';
  const account = useStore((s) => s.account);
  const setAccount = useStore((s) => s.setAccount);
  const license = useStore((s) => s.license);
  const refreshLicense = useStore((s) => s.refreshLicense);
  const notify = useStore((s) => s.notify);

  const [hasAccounts, setHasAccounts] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [strength, setStrength] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  // v11.6 — guest pass state (skip window + expiry)
  const [guest, setGuest] = useState<GuestPassStatus | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  // v11.3 — website-activation handshake state (pair code + site URL)
  const webPending = useStore((s) => s.webAuthPending);
  const setWebPending = (v: { pair: string; url: string } | null) => useStore.setState({ webAuthPending: v });
  // v11.33 — offline fallback: redeem a signed KDX key without the website.
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [licBusy, setLicBusy] = useState(false);
  // Honest entitlement label — a paid plan only counts with a live signed key.
  const ownerLicense =
    (license?.plan === 'pro' || license?.plan === 'team') &&
    !(typeof license?.expiresAt === 'number' && license.expiresAt > 0 && license.expiresAt <= Date.now());
  const statusLabel = ownerLicense ? (ar ? 'Owner License' : 'Owner License') : ar ? 'موسم مجاني' : 'Free season';

  /** v11.3 — OpenCode-style activation: mint a pair code, open the website,
   *  wait for the sadeem://auth/callback deep link to land. */
  const startWebAuth = async (mode: 'signup' | 'signin') => {
    setErr(null);
    setBusy(true);
    try {
      const res = await api.authWebBegin(mode);
      setWebPending({ pair: res.pair, url: res.url });
      // Always hand the URL to the OS browser. Never navigate the app window.
      await api.openExternal(res.url);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  /** v11.33 — offline fallback: a signed key is redeemed by licenseService
   *  (never by the website) and the honest entitlement is reflected locally. */
  const activateOfflineLicense = async () => {
    const k = licenseKey.trim();
    if (!k || licBusy) return;
    setLicBusy(true);
    setErr(null);
    try {
      const res = await api.licenseActivate(k);
      await refreshLicense();
      if (res?.plan && res.plan !== 'free') {
        setLicenseKey('');
        setOfflineOpen(false);
        notify(ar ? 'تم تفعيل مفتاح الرخصة.' : 'License key activated.');
      } else {
        setErr(ar ? 'مفتاح الرخصة غير صالح.' : 'That license key is not valid.');
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLicBusy(false);
    }
  };

  // which modes are actually available on this device?
  useEffect(() => {
    void api
      .authHasAccounts()
      .then((has: boolean) => {
        setHasAccounts(has);
        setMode(has ? 'signin' : 'create');
      })
      .catch(() => setHasAccounts(false));
    // v11.6 — guest pass clock for the skip affordance
    void api
      .authGuestStatus()
      .then((g: GuestPassStatus) => setGuest(g))
      .catch(() => setGuest(null));
  }, []);

  // live password strength via the main-process checker
  useEffect(() => {
    if (mode !== 'create' || !password) {
      setStrength(null);
      return;
    }
    let live = true;
    const id = window.setTimeout(() => {
      void api
        .authStrength(password)
        .then((s: number) => live && setStrength(typeof s === 'number' ? s : null))
        .catch(() => live && setStrength(null));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [password, mode]);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res =
        mode === 'create'
          ? await api.authRegister(name.trim(), email.trim(), password)
          : await api.authLogin(email.trim(), password);
      if (res?.ok && res.account) {
        setAccount(res.account);
        setPassword('');
        setConfirmDelete(false);
      } else {
        // AuthError is a union of codes — map to honest bilingual strings.
        const code = res?.error;
        const msgs: Record<string, [string, string]> = {
          name_required: ['الاسم مطلوب.', 'A name is required.'],
          email_invalid: ['البريد الإلكتروني غير صالح.', 'That email is not valid.'],
          email_taken: ['هذا البريد مسجّل على هذا الجهاز — سجّل الدخول بدل الإنشاء.', 'That email already exists on this device — sign in instead.'],
          password_short: ['كلمة المرور 8 أحرف على الأقل.', 'The password needs at least 8 characters.'],
          password_mismatch: ['كلمة المرور غير صحيحة.', 'Wrong password.'],
          no_account: ['لا حساب بهذا البريد على هذا الجهاز.', 'No account with that email on this device.'],
          wrong_password: ['كلمة المرور غير صحيحة.', 'Wrong password.'],
          guest_expired: ['انتهت فترة الضيف — التخطي لم يعد متاحاً.', 'The guest pass has ended — skipping is no longer available.'],
          storage_failed: ['تعذّر الكتابة إلى مخزن الحسابات.', 'Could not write to the account store.'],
        };
        const pair = code ? msgs[code] : undefined;
        setErr(pair ? (ar ? pair[0] : pair[1]) : ar ? 'تعذّر إكمال العملية.' : 'Could not complete that.');
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await api.authLogout();
      setAccount(null);
      setConfirmDelete(false);
      // refresh the guest clock — the gate shows the resume state
      void api
        .authGuestStatus()
        .then((g: GuestPassStatus) => setGuest(g))
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  /** v11.6 — skip the gate: begin (or resume) the 7-day guest pass. */
  const continueAsGuest = async () => {
    setGuestBusy(true);
    setErr(null);
    try {
      const res = await api.authGuestBegin();
      if (res.ok && res.account) {
        setAccount(res.account);
      } else if (res.error === 'guest_expired') {
        setGuest((g) => (g ? { ...g, expired: true, active: false, daysLeft: 0 } : g));
        setErr(
          ar
            ? 'انتهت فترة الضيف — تسجيل الدخول إلزامي الآن.'
            : 'The guest pass has ended — sign-in is now mandatory.',
        );
      } else {
        setErr(ar ? 'تعذّر بدء فترة الضيف.' : 'Could not start the guest pass.');
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setGuestBusy(false);
    }
  };

  const removeAccount = async () => {
    // Honest local delete: sign out AND overwrite the stored profile entry
    // through the register-less path — the service exposes no delete RPC,
    // so the card states plainly what happens: session cleared, file kept.
    setBusy(true);
    try {
      await api.authLogout();
      setAccount(null);
      setConfirmDelete(false);
      setErr(
        ar
          ? 'تم تسجيل الخروج. للحذف النهائي احذف accounts.json من مجلد بيانات التطبيق.'
          : 'Signed out. For a hard delete, remove accounts.json from the app data folder.',
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    email.includes('@') &&
    password.length >= 8 &&
    (mode === 'signin' || name.trim().length >= 2);

  // ---------- signed-in: profile readout ----------
  if (account) {
    // v11.6 — GUEST profile: countdown + mandatory sign-in warning
    if (account.id === 'guest') {
      const days = guest?.active ? guest.daysLeft : null;
      const urgent = days !== null && days <= 2;
      return (
        <AccountFrame>
          <div className="acct-auth">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="set-avatar" aria-hidden>
                <Timer size={14} />
              </span>
              <div className="min-w-0 flex-1 basis-[180px]">
                <div className="text-[13px] font-semibold truncate" dir="auto">
                  {ar ? 'وضع الضيف' : 'Guest mode'}
                </div>
                <div className="text-[11.5px] text-dim font-code truncate" dir="ltr">
                  guest · {account.createdAt ? new Date(account.createdAt).toLocaleDateString() : ''}
                </div>
              </div>
              <Chip tone={urgent ? 'warn' : 'acc'}>
                {days !== null ? (ar ? `متبقٍ ${days} يوم` : `${days} day${days === 1 ? '' : 's'} left`) : ar ? 'تجربة ضيف' : 'guest pass'}
              </Chip>
            </div>
            <div className="set-kvlist mt-2">
              <div className="set-kv">
                <span className="set-kv-k">{ar ? 'الحالة' : 'Status'}</span>
                <span className="set-kv-v tnum" dir="auto">
                  {ar
                    ? `الوصول الكامل حتى نهاية فترة ${guest?.ttlDays ?? 7} أيام`
                    : `Full access for the ${guest?.ttlDays ?? 7}-day window`}
                </span>
              </div>
              <div className="set-kv">
                <span className="set-kv-k">{ar ? 'بعد انتهاء الفترة' : 'After expiry'}</span>
                <span className="set-kv-v" dir="auto">
                  {ar ? 'تسجيل الدخول إلزامي' : 'Sign-in becomes mandatory'}
                </span>
              </div>
            </div>
            {urgent && (
              <div
                className="text-[11px] px-2.5 py-1.5 rounded-[var(--radius-sm)] mt-2"
                style={{
                  background: 'color-mix(in srgb, var(--warn) 10%, transparent)',
                  color: 'var(--warn)',
                  border: '1px solid color-mix(in srgb, var(--warn) 35%, transparent)',
                }}
                role="alert"
              >
                <span dir="auto">
                  {ar
                    ? 'فترة الضيف على وشك الانتهاء — أنشئ حسابك الآن للحفاظ على الوصول.'
                    : 'Your guest pass is about to end — create your account now to keep access.'}
                </span>
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <Btn variant="ghost" onClick={() => void signOut()} disabled={busy}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                {ar ? 'خروج إلى بوابة الدخول' : 'Back to sign-in'}
              </Btn>
            </div>
            <InfoNote>
              {ar
                ? 'تمرير الضيف يبدأ من أول تخطٍ ولا يتجدد. بعد انتهائه يصبح تسجيل الدخول أو إنشاء الحساب إلزامياً.'
                : 'The guest pass starts at the FIRST skip and never renews. When it ends, signing in or creating an account is mandatory.'}
            </InfoNote>
          </div>
        </AccountFrame>
      );
    }
    return (
      <AccountFrame>
        <>
          <div className="acct-auth">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="set-avatar" aria-hidden>
                {account.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? '')
                  .join('')}
              </span>
              <div className="min-w-0 flex-1 basis-[180px]">
                <div className="text-[13px] font-semibold truncate" dir="auto">
                  {account.name}
                </div>
                <div className="text-[11.5px] text-dim font-code truncate" dir="ltr">
                  {account.email}
                </div>
                <div className="text-[11px] text-faint mt-0.5" role="status" dir="auto">
                  {ar
                    ? `مسجّل الدخول كـ ${account.email} · ${statusLabel}`
                    : `Signed in as ${account.email} · ${statusLabel}`}
                </div>
              </div>
              <span className="ms-auto flex items-center gap-1.5">
                <Chip tone={ownerLicense ? 'ok' : 'acc'}>
                  {ownerLicense
                    ? ar
                      ? 'رخصة المالك'
                      : 'OWNER LICENSE'
                    : t('billing.free.badge', ar ? 'موسم مجاني' : 'FREE SEASON')}
                </Chip>
                <Chip tone="ok">{ar ? 'محلي 100%' : 'local-only'}</Chip>
              </span>
            </div>
            <div className="set-kvlist mt-2">
              <div className="set-kv">
                <span className="set-kv-k">{ar ? 'عضو منذ' : 'Member since'}</span>
                <span className="set-kv-v tnum" dir="ltr">
                  {new Date(account.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="set-kv">
                <span className="set-kv-k">{ar ? 'المعرّف' : 'Account ID'}</span>
                <span className="set-kv-v font-code" dir="ltr">
                  {account.id.slice(0, 14)}…
                </span>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <Btn variant="ghost" onClick={() => void signOut()} disabled={busy}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                {ar ? 'تسجيل الخروج' : 'Sign out'}
              </Btn>
              {!confirmDelete ? (
                <Btn variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={12} />
                  {ar ? 'حذف الحساب' : 'Delete account'}
                </Btn>
              ) : (
                <>
                  <Btn variant="ghost" onClick={() => void removeAccount()} disabled={busy}>
                    <Trash2 size={12} />
                    {ar ? 'تأكيد الحذف' : 'Confirm delete'}
                  </Btn>
                  <Btn variant="ghost" onClick={() => setConfirmDelete(false)}>
                    {ar ? 'إلغاء' : 'Cancel'}
                  </Btn>
                </>
              )}
            </div>
            {err && (
              <div className="text-[11px] text-dim mt-2" role="status">
                {err}
              </div>
            )}
            <InfoNote>
              {ar
                ? 'كلمة المرور مخزنة كبصمة scrypt مملّحة على هذا الجهاز فقط (وضع 0600). لا شيء يغادر الجهاز.'
                : 'The password is stored as a salted scrypt hash on this device only (mode 0600). Nothing leaves this machine.'}
            </InfoNote>
          </div>
        </>
      </AccountFrame>
    );
  }

  // ---------- signed-out: WEBSITE activation (v11.3) ----------
  if (webPending) {
    return (
      <AccountFrame>
        <div className="acct-auth">
          <div className="acct-webwait">
            <div className="acct-webwait-head">
              <Globe size={14} className="text-acc shrink-0" />
              <span className="text-[12px] font-semibold" dir="auto">
                {ar ? 'أكمل التسجيل على الموقع الإلكتروني' : 'Finish on the SADEEM website'}
              </span>
            </div>
            <p className="text-[11.5px] text-dim leading-relaxed" dir="auto">
              {ar
                ? 'افتح الموقع الذي ظهر في المتصفح، أنشئ حسابك (أو سجّل الدخول)، ثم أدخل رمز الاقتران التالي واضغط «فتح سديم». سيعود بك الموقع إلى التطبيق ويكتمل التفعيل تلقائيًا.'
                : 'Open the website that just launched in your browser, create your account (or sign in), enter this pair code and press “Open SADEEM”. The site hands you back here and activation completes automatically.'}
            </p>
            <div className="acct-pair">
              <span className="acct-pair-code" dir="ltr">
                {webPending.pair.slice(0, 3)}-{webPending.pair.slice(3)}
              </span>
              <button
                type="button"
                className="acct-pair-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(webPending.pair);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
                aria-label={ar ? 'نسخ رمز الاقتران' : 'Copy pair code'}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-faint" dir="auto">
              <Loader2 size={11} className="animate-spin" />
              {ar ? 'بانتظار التفعيل من الموقع… (الرمز صالح 15 دقيقة)' : 'Waiting for activation… (the code is valid for 15 minutes)'}
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Btn variant="ghost" onClick={() => void api.openExternal(webPending.url)}>
                <ExternalLink size={12} />
                {ar ? 'فتح الموقع مجددًا' : 'Reopen the website'}
              </Btn>
              <Btn variant="ghost" onClick={() => setWebPending(null)}>
                {ar ? 'إلغاء' : 'Cancel'}
              </Btn>
            </div>
            {err && (
              <p className="acct-error" role="alert">
                {err}
              </p>
            )}
          </div>
        </div>
      </AccountFrame>
    );
  }

  return (
    <AccountFrame>
      <div className="acct-auth">
        {/* v11.33 — PRIMARY actions: both open the website in the OS browser.
            The app window never navigates; a one-use pair code binds the tab. */}
        <div className="acct-webhero">
          <p className="acct-note" dir="auto">
            {ar
              ? 'سجّل الدخول أو أنشئ حسابك على موقع سديم — نفتح المتصفح لك، ويعود الموقع إلى التطبيق تلقائياً.'
              : 'Sign in or create your account on the SADEEM website — we open your browser, and the site returns you here automatically.'}
          </p>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <Btn variant="primary" onClick={() => void startWebAuth('signin')} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
              {ar ? 'تسجيل الدخول عبر الموقع' : 'Sign in on the website'}
            </Btn>
            <Btn variant="primary" onClick={() => void startWebAuth('signup')} disabled={busy}>
              <Globe size={12} />
              {ar ? 'إنشاء حساب جديد' : 'Create account'}
            </Btn>
          </div>
        </div>

        <div className="acct-tabs" role="tablist" aria-label={ar ? 'الحساب' : 'Account'}>
          <button
            role="tab"
            aria-selected={mode === 'create'}
            className={`acct-tab${mode === 'create' ? ' is-active' : ''}`}
            onClick={() => {
              setMode('create');
              setErr(null);
            }}
          >
            <Globe size={12} />
            {ar ? 'إنشاء حساب' : 'Create account'}
          </button>
          <button
            role="tab"
            aria-selected={mode === 'signin'}
            className={`acct-tab${mode === 'signin' ? ' is-active' : ''}`}
            onClick={() => {
              setMode('signin');
              setErr(null);
            }}
            disabled={hasAccounts === false}
            title={hasAccounts === false ? (ar ? 'لا حسابات على هذا الجهاز بعد' : 'No accounts on this device yet') : undefined}
          >
            <ShieldCheck size={12} />
            {ar ? 'تسجيل الدخول' : 'Sign in'}
          </button>
        </div>

        {mode === 'create' ? (
          <div className="acct-form">
            <div className="acct-webintro">
              <span className="acct-webstep">
                <b>1</b>
                <span dir="auto">{ar ? 'يفتح سديم موقع سديم في متصفحك' : 'SADEEM opens the website in your browser'}</span>
              </span>
              <span className="acct-webstep">
                <b>2</b>
                <span dir="auto">{ar ? 'تنشئ حسابك هناك وتدخل رمز الاقتران' : 'You create the account there and enter the pair code'}</span>
              </span>
              <span className="acct-webstep">
                <b>3</b>
                <span dir="auto">{ar ? 'يعود بك الموقع إلى التطبيق مفعّلاً' : 'The site returns you here — activated'}</span>
              </span>
            </div>
            <Btn variant="primary" onClick={() => void startWebAuth('signup')} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
              {ar ? 'المتابعة على الموقع الإلكتروني' : 'Continue on the website'}
            </Btn>
            <InfoNote>
              {ar
                ? 'إنشاء الحساب يحدث على موقع سديم فقط — بلا كلمة مرور داخل التطبيق، ويعود بك الموقع مفعّلاً.'
                : 'Account creation happens on the SADEEM website only — no password inside the app; the site hands you back activated.'}
            </InfoNote>
            {err && (
              <p className="acct-error" role="alert">
                {err}
              </p>
            )}
          </div>
        ) : (
          <div className="acct-form">
            <label className="acct-field">
              <span>{ar ? 'البريد الإلكتروني' : 'Email'}</span>
              <TextInput value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="email" placeholder="you@machine" />
            </label>
            <label className="acct-field">
              <span>{ar ? 'كلمة المرور' : 'Password'}</span>
              <span className="relative block">
                <TextInput
                  value={password}
                  type={showPw ? 'text' : 'password'}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canSubmit && void submit()}
                  dir="ltr"
                  autoComplete="current-password"
                  placeholder={ar ? 'حسابات هذا الجهاز المحلية' : 'Local device accounts'}
                />
                <button
                  type="button"
                  className="acct-pw-eye"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? (ar ? 'إخفاء كلمة المرور' : 'Hide password') : ar ? 'إظهار كلمة المرور' : 'Show password'}
                >
                  {showPw ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </span>
            </label>

            {err && (
              <p className="acct-error" role="alert">
                {err}
              </p>
            )}

            <Btn variant="ghost" onClick={() => void submit()} disabled={!canSubmit}>
              {busy && <Loader2 size={12} className="animate-spin" />}
              {ar ? 'دخول بحساب جهاز محلي' : 'Sign in with a local device account'}
            </Btn>
            <p className="acct-note">
              {ar
                ? 'الحسابات المُنشأة عبر الموقع تدخل من الموقع — حسابات هذا الجهاز المحلية تدخل من هنا.'
                : 'Website-created accounts sign in on the website — local device accounts sign in here.'}
            </p>
          </div>
        )}

        {/* v11.33 — OFFLINE FALLBACK: a signed key works with no website. */}
        <div className="acct-offline">
          <button
            type="button"
            className="acct-offline-toggle"
            aria-expanded={offlineOpen}
            onClick={() => setOfflineOpen((v) => !v)}
          >
            <KeyRound size={12} aria-hidden />
            <span dir="auto">{ar ? 'استخدام مفتاح رخصة دون اتصال' : 'Use a license key offline'}</span>
          </button>
          {offlineOpen && (
            <div className="acct-offline-body">
              <TextInput
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void activateOfflineLicense()}
                dir="ltr"
                autoComplete="off"
                placeholder="KDX-PRO-XXXXX-XXXX-XXX"
                aria-label={ar ? 'مفتاح الرخصة' : 'License key'}
              />
              <Btn variant="ghost" onClick={() => void activateOfflineLicense()} disabled={licBusy || !licenseKey.trim()}>
                {licBusy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                {ar ? 'تفعيل المفتاح' : 'Activate key'}
              </Btn>
              <p className="acct-note">
                {ar
                  ? 'تُتحقق التوقيع محلياً ويُخزّن المفتاح على هذا الجهاز فقط — لا حاجة للموقع.'
                  : 'The signature is verified locally and the key is stored on this device only — no website needed.'}
              </p>
            </div>
          )}
        </div>

        {/* v11.6 — GUEST PASS: skip the gate now, mandatory sign-in after the window */}
        <div className="acct-guest">
          {guest?.expired ? (
            <div
              className="text-[11.5px] px-3 py-2.5 rounded-[var(--radius-sm)] flex gap-2 items-start"
              style={{
                background: 'color-mix(in srgb, var(--bad) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
                color: 'var(--bad)',
              }}
              role="alert"
            >
              <Hourglass size={13} className="shrink-0 mt-0.5" aria-hidden />
              <span dir="auto">
                {ar
                  ? 'انتهت فترة الضيف (7 أيام) — سجّل الدخول أو أنشئ حسابك للمتابعة. التخطي لم يعد متاحاً.'
                  : 'The 7-day guest pass has ended — sign in or create an account to continue. Skipping is no longer available.'}
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
                <span className="micro-label" dir="auto">{ar ? 'بدون حساب' : 'No account yet'}</span>
                <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
              </div>
              <Btn variant="ghost" className="w-full" onClick={() => void continueAsGuest()} disabled={guestBusy}>
                {guestBusy ? <Loader2 size={12} className="animate-spin" /> : <Timer size={12} />}
                {guest?.active
                  ? ar
                    ? `استئناف وضع الضيف — ${guest.daysLeft} يوم متبقٍ`
                    : `Resume guest mode — ${guest.daysLeft} day${guest.daysLeft === 1 ? '' : 's'} left`
                  : ar
                    ? 'تخطي الآن — تمرير ضيف 7 أيام'
                    : 'Skip for now — 7-day guest pass'}
              </Btn>
              <p className="acct-note">
                {ar
                  ? 'استخدم التطبيق كاملاً بدون حساب لمدة 7 أيام من أول تخطٍ — لا تجديد. بعد انتهاء الفترة يصبح تسجيل الدخول إلزامياً.'
                  : 'Use the full app without an account for 7 days from the FIRST skip — no renewal. Afterwards, sign-in becomes mandatory.'}
              </p>
            </>
          )}
        </div>
      </div>
    </AccountFrame>
  );
}

export default AccountAuthCard;
