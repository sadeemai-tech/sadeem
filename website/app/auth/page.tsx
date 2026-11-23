'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Copy, Check } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import {
  EMAIL_RE,
  normEmail,
  displayName,
  loadAccounts,
  forgetAccount,
  writeAccount,
  webCryptoAvailable,
  validateLicenseFormat,
  normalizeKey,
  loadEntitlement,
  saveEntitlement,
  clearEntitlement,
  callbackUrl,
  type WebAccount,
  type Entitlement,
  type AccountPlan,
} from '@/lib/auth';
import './auth.css';

/* ============================================================
   Website ↔ desktop pairing.
   Mirrors electron/services/authService.ts (beginWebAuth /
   completeWebAuth): the app opens <site>/auth#pair=XXXXXX&mode=
   signup|signin, this page collects a name, email and a LOCAL
   password, then hands name/email/plan back through the existing
   sadeem://auth/callback deep link.

   HONESTY: there is no backend. The password is hashed with Web
   Crypto SHA-256 + salt in this browser and never leaves it. The
   desktop app creates its own local account from the pair code.
   A pasted license key is FORMAT-checked here, saved locally, and
   both its plan and the key itself ride in the deep link; the app
   verifies the HMAC signature on activation (device-local secret).
   ============================================================ */

type AuthMode = 'signup' | 'signin';
type Phase = 'loading' | 'form' | 'done' | 'no-pair';
type Pair = readonly [en: string, ar: string];
type Errors = { name?: string; email?: string; password?: string; license?: string; form?: string };

function readPairHash(hash: string): { pair: string; mode: AuthMode; valid: boolean } {
  const params = new URLSearchParams((hash || '').replace(/^#/, ''));
  const pair = (params.get('pair') ?? '').trim().toUpperCase();
  const mode: AuthMode = (params.get('mode') ?? '').trim().toLowerCase() === 'signin' ? 'signin' : 'signup';
  return { pair, mode, valid: /^[A-Z0-9]{6}$/.test(pair) };
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const STEPS: { num: string; title: Pair; body: Pair }[] = [
  {
    num: '01',
    title: ['The app makes a code', 'التطبيق يُنشئ رمزاً'],
    body: [
      'In SADEEM choose Sign in → Continue on website. The app mints a six-character code that lives in memory for fifteen minutes only.',
      'في سديم اختر «تسجيل الدخول» ثم «المتابعة عبر الموقع». يُنشئ التطبيق رمزاً من ستة أحرف يبقى في الذاكرة خمس عشرة دقيقة فقط.',
    ],
  },
  {
    num: '02',
    title: ['You confirm here', 'تُؤكّد هنا'],
    body: [
      'This page reads the code from the link and asks for your name, email and a local password (hashed in this browser). You may also paste an Owner License key — its plan and the key ride back in the deep link for the app to verify. No server is involved.',
      'تقرأ هذه الصفحة الرمز من الرابط وتطلب اسمك وبريدك وكلمة مرور محلية (تُجزّأ في هذا المتصفح). يمكنك أيضاً لصق مفتاح رخصة المالك — تنتقل خطته والمفتاح مع الرابط العميق ليتحقق التطبيق منهما. لا خادم في الأمر.',
    ],
  },
  {
    num: '03',
    title: ['The desktop app opens', 'يفتح تطبيق سطح المكتب'],
    body: [
      'One click returns to sadeem://. The app checks the code, creates its own local account and opens your session. Your password and its hash are never sent.',
      'نقرة واحدة تعود إلى sadeem://. يتحقق التطبيق من الرمز وينشئ حسابه المحلي ويفتح جلستك. لا تُرسل كلمة المرور ولا تجزئتها أبداً.',
    ],
  },
];

const rise = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

/* SIGNATURE ELEMENT — a pairing diagram. Two orbits (desktop and browser)
   joined by a dashed ink line; the six-character code sits in a medallion
   whose frame turns while the numeral inside counter-turns to stay legible. */
function PairingDiagram({ code }: { code: string }) {
  const { tx } = useLang();
  const shown = code || 'XXXXXX';
  /* Two equal-radius orbits (r=57). The dashed link attaches at their edges:
     left orbit 96+57=153, right orbit 424-57=367 — never at the centres. */
  const ORBIT_R = 57;
  return (
    <svg
      className="au-diagram"
      viewBox="0 0 520 236"
      role="img"
      aria-label={tx('Pairing diagram: desktop and browser joined by a one-time code', 'رسم الاقتران: سطح المكتب والمتصفح يربطهما رمز لمرة واحدة')}
    >
      <g className="au-orbit">
        <circle cx="96" cy="112" r={ORBIT_R} fill="none" stroke="currentColor" strokeWidth=".8" opacity=".35" />
        <circle cx="96" cy="112" r="38" fill="var(--paper)" stroke="currentColor" strokeWidth="1" />
        <path d="M78 100h36v24H78z" fill="none" stroke="var(--accent)" strokeWidth="1" />
        <path d="M84 128h24" stroke="var(--accent)" strokeWidth="1" />
      </g>
      <g className="au-orbit au-orbit-b">
        <circle cx="424" cy="112" r={ORBIT_R} fill="none" stroke="currentColor" strokeWidth=".8" opacity=".35" />
        <circle cx="424" cy="112" r="38" fill="var(--paper)" stroke="currentColor" strokeWidth="1" />
        <path d="M406 96h36v30h-36z" fill="none" stroke="var(--accent)" strokeWidth="1" />
        <path d="M406 104h36" stroke="var(--accent)" strokeWidth=".8" />
      </g>

      {/* the animated dashed ink link, edge-to-edge, behind the medallion */}
      <path className="au-link-dash" d={`M${96 + ORBIT_R} 112h${(424 - ORBIT_R) - (96 + ORBIT_R)}`} fill="none" stroke="var(--accent)" strokeWidth="1.1" strokeDasharray="7 6" />
      <circle cx={96 + ORBIT_R} cy="112" r="2" fill="var(--accent)" />
      <circle cx={424 - ORBIT_R} cy="112" r="2" fill="var(--accent)" />

      <g className="au-medallion">
        <circle cx="260" cy="112" r="62" fill="none" stroke="currentColor" strokeWidth=".8" opacity=".4" />
        <circle cx="260" cy="112" r="54" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="2 6" />
        <circle cx="260" cy="112" r="47" fill="var(--paper)" stroke="currentColor" strokeWidth=".9" />
        {/* the frame turns; this disc counter-turns to keep the code upright */}
        <g className="au-medallion-inner">
          <text x="260" y="119" textAnchor="middle" fontFamily="var(--mono)" fontSize="20" letterSpacing="2.5" fill="var(--ink)" textLength="86" lengthAdjust="spacing">{shown}</text>
        </g>
      </g>

      <text className="au-diagram-label" x="96" y="196" textAnchor="middle">{tx('DESKTOP', 'سطح المكتب')}</text>
      <text className="au-diagram-label" x="424" y="196" textAnchor="middle">{tx('BROWSER', 'المتصفح')}</text>
      <text className="au-diagram-caption" x="260" y="196" textAnchor="middle">{tx('ONE-TIME PAIR', 'اقتران لمرة واحدة')}</text>
    </svg>
  );
}

/* Even scallops for a wax seal: one quadratic bump per lobe, control radius
   lifted to 2rOuter-rInner so each bump peaks exactly at rOuter. */
function waxPath(cx: number, cy: number, rOuter: number, rInner: number, lobes: number): string {
  const rControl = 2 * rOuter - rInner;
  const step = (Math.PI * 2) / lobes;
  let d = '';
  for (let i = 0; i < lobes; i++) {
    const a0 = -Math.PI / 2 + i * step;
    const amid = a0 + step / 2;
    const a1 = a0 + step;
    const vx = cx + Math.cos(a0) * rInner;
    const vy = cy + Math.sin(a0) * rInner;
    const px = cx + Math.cos(amid) * rControl;
    const py = cy + Math.sin(amid) * rControl;
    const nx = cx + Math.cos(a1) * rInner;
    const ny = cy + Math.sin(a1) * rInner;
    if (i === 0) d += `M${vx.toFixed(2)} ${vy.toFixed(2)}`;
    d += ` Q${px.toFixed(2)} ${py.toFixed(2)} ${nx.toFixed(2)} ${ny.toFixed(2)}`;
  }
  return `${d}Z`;
}

/* Confirmation state — a wax seal carrying the real pair code. */
function WaxSeal({ code }: { code: string }) {
  const { tx } = useLang();
  return (
    <svg className="au-wax" viewBox="0 0 120 120" role="img" aria-label={tx('Pairing sealed with code', 'تم الاقتران بالرمز')}>
      <path className="au-wax-body" d={waxPath(60, 60, 52, 46, 12)} />
      <circle className="au-wax-ring" cx="60" cy="60" r="38" />
      <text className="au-wax-code" x="60" y="65" textAnchor="middle">{code}</text>
      <path className="au-wax-star" d="M60 78l1.8 3.8 4.1.6-3 2.9.8 4.1L60 87.6l-3.7 1.8.8-4.1-3-2.9 4.1-.6z" />
    </svg>
  );
}

export default function AuthPage() {
  const { tx } = useLang();
  const t = (p: Pair) => tx(p[0], p[1]);

  const [phase, setPhase] = useState<Phase>('loading');
  const [pair, setPair] = useState('');
  const [mode, setMode] = useState<AuthMode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [accounts, setAccounts] = useState<WebAccount[]>([]);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [licenseInput, setLicenseInput] = useState('');
  const [licenseMsg, setLicenseMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [callback, setCallback] = useState('');
  const [resultName, setResultName] = useState('');
  const [resultEmail, setResultEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    const apply = () => {
      const info = readPairHash(window.location.hash);
      setAccounts(loadAccounts());
      setEntitlement(loadEntitlement());
      if (!info.valid) {
        setPair('');
        setPhase('no-pair');
        return;
      }
      setPair(info.pair);
      setMode(info.mode);
      setPhase('form');
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  /* Sign-in prefill never touches the password — it is local-only. */
  useEffect(() => {
    if (mode === 'signin' && phase === 'form' && accounts.length && !email && !name) {
      const last = accounts[accounts.length - 1];
      setEmail(last.email);
      setName(last.name);
    }
  }, [mode, phase, accounts, email, name]);

  /* Keep the deep link in sync if the license is redeemed after confirming.
     The recap and the Open-SADEEM button both read this `callback`, so passing
     the stored entitlement key here is what delivers the license to the app.
     With no entitlement, plan stays 'free' and no `lic` is appended. */
  useEffect(() => {
    if (phase === 'done' && resultEmail) {
      setCallback(callbackUrl(
        pair,
        resultEmail,
        resultName,
        entitlement?.plan ?? 'free',
        entitlement?.key,
      ));
    }
  }, [phase, pair, resultEmail, resultName, entitlement]);

  const plan: AccountPlan = entitlement?.plan ?? 'free';

  const accountError = (code: string): string => {
    switch (code) {
      case 'exists': return tx('This device already has a different password for that email. Switch to Sign in.', 'هذا الجهاز لديه كلمة مرور مختلفة لهذا البريد. انتقل إلى تسجيل الدخول.');
      case 'wrong-password': return tx('Wrong password for this device account.', 'كلمة المرور غير صحيحة لحساب هذا الجهاز.');
      case 'not-found': return tx('No account with this email on this device. Use Sign up first.', 'لا يوجد حساب بهذا البريد على هذا الجهاز. أنشئ حساباً أولاً.');
      case 'storage': return tx('This browser blocked local storage — nothing was saved.', 'منع هذا المتصفح التخزين المحلي — لم يُحفظ شيء.');
      default: return tx('A secure context (HTTPS) is required to hash the password here.', 'يلزم سياق آمن (HTTPS) لتجزئة كلمة المرور هنا.');
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const normalized = normEmail(email);
    const next: Errors = {};
    if (!name.trim()) next.name = tx('Please enter your name.', 'الرجاء إدخال اسمك.');
    if (!EMAIL_RE.test(normalized)) next.email = tx('Enter a valid email address.', 'أدخل بريداً إلكترونياً صالحاً.');
    if (password.length < 8) next.password = tx('Use at least 8 characters — this password locks the account on this device.', 'استخدم ٨ أحرف على الأقل — هذه الكلمة قفل الحساب على هذا الجهاز.');
    if (!webCryptoAvailable()) next.form = accountError('crypto');
    setErrors(next);
    if (next.name || next.email || next.password || next.form) return;

    setBusy(true);
    try {
      const result = await writeAccount({ email: normalized, name, password, mode, plan });
      if (!result.ok) {
        const text = accountError(result.code);
        if (result.code === 'exists' || result.code === 'wrong-password' || result.code === 'not-found') {
          setErrors((p) => ({ ...p, password: text }));
        } else {
          setErrors((p) => ({ ...p, form: text }));
        }
        return;
      }
      setAccounts(result.accounts);
      setNotice(
        result.adopted
          ? tx('This saved record was secured with a password on this device.', 'تم تأمين هذا السجل المحفوظ بكلمة مرور على هذا الجهاز.')
          : '',
      );
      setResultEmail(normalized);
      setResultName(displayName(name, normalized));
      // `entitlement` comes from loadEntitlement() (localStorage) and holds the
      // format-checked key. Hand it to the deep link so the app can verify its
      // HMAC and honor the paid plan; with no key the link stays `plan=free`.
      setCallback(callbackUrl(pair, normalized, name, plan, entitlement?.key));
      setCopied(false);
      setPhase('done');
    } finally {
      setBusy(false);
    }
  };

  const redeem = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const verdict = validateLicenseFormat(licenseInput);
    if (!verdict.ok) {
      const text = verdict.reason === 'empty'
        ? tx('Paste a license key first.', 'الصق مفتاح الرخصة أولاً.')
        : tx('That is not a signed-key format. Expected KDX-PRO-XXXXX-XXXX-XXX.', 'هذا ليس شكل مفتاح موقّع. المتوقع: KDX-PRO-XXXXX-XXXX-XXX.');
      setLicenseMsg({ ok: false, text });
      setErrors((p) => ({ ...p, license: text }));
      return;
    }
    const record: Entitlement = {
      key: normalizeKey(licenseInput),
      plan: verdict.plan,
      expiryDays: verdict.expiryDays,
      redeemedAt: Date.now(),
    };
    saveEntitlement(record);
    setEntitlement(record);
    setLicenseInput('');
    setErrors((p) => ({ ...p, license: undefined }));
    setLicenseMsg({
      ok: true,
      text: tx(
        `Format accepted: ${verdict.plan.toUpperCase()} key${verdict.expiryDays ? ` · ${verdict.expiryDays} days encoded` : ' · perpetual'}. This is NOT a signature check — the desktop app verifies it locally on activation.`,
        `تم قبول الشكل: مفتاح ${verdict.plan.toUpperCase()}${verdict.expiryDays ? ` · ${verdict.expiryDays} يوماً مشفّراً` : ' · دائم'}. هذا ليس تحققاً من التوقيع — يتحقق التطبيق محلياً عند التفعيل.`,
      ),
    });
  };

  const copyLink = async () => {
    if (await copyText(callback)) {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2400);
    }
  };

  const forget = (account: WebAccount) => {
    setAccounts(forgetAccount(account.email));
    if (normEmail(email) === account.email) { setEmail(''); setName(''); setPassword(''); }
  };

  const clearLicense = () => {
    clearEntitlement();
    setEntitlement(null);
    setLicenseMsg(null);
    setNotice('');
  };

  const honestNote = (
    <motion.aside className="auth-honest" {...rise} transition={{ duration: 0.5 }} aria-label={tx('Privacy note', 'ملاحظة الخصوصية')}>
      <span className="label">◆ {tx("THIS DEVICE'S ACCOUNT · LICENSE STORED LOCALLY", 'حساب هذا الجهاز · الرخصة محفوظة محلياً')}</span>
      <h3 className="h3">{tx('No server. Your password never leaves this browser.', 'لا خادم. كلمة المرور لا تغادر هذا المتصفح.')}</h3>
      <p>
        {tx(
          'This build has no backend. The password you type is hashed with Web Crypto SHA-256 plus a random salt in this browser, and stored only in this site’s localStorage — it is a local lock, not an account on any server. The deep link carries your name, email, plan and (only if you redeemed one) the stored license key; your password and its hash are never sent to the app. The desktop app creates its own local session from the pairing code and performs the real signature check on the key when you activate it there.',
          'لا يوجد خادم في هذه النسخة. تُجزّأ كلمة المرور بخوارزمية SHA-256 مع ملح عشوائي داخل هذا المتصفح، وتُحفظ فقط في التخزين المحلي للموقع — إنها قفل محلي، ليست حساباً على أي خادم. يحمل الرابط العميق اسمك وبريدك وخطتك ومفتاح الرخصة المحفوظ (إنوجد)؛ لا تُرسل كلمة المرور ولا تجزئتها إلى التطبيق. ينشئ تطبيق سطح المكتب جلسته المحلية من رمز الاقتران، وهو من يتحقق من التوقيع فعلياً عند تفعيل المفتاح هناك.',
        )}
      </p>
    </motion.aside>
  );

  const savedAccount = accounts.length > 0 && (
    <motion.div className="auth-saved" {...rise} transition={{ duration: 0.5 }}>
      <div className="auth-saved-mark" aria-hidden="true">{(accounts[accounts.length - 1].name || 'S').charAt(0).toUpperCase()}</div>
      <div className="auth-saved-info">
        <span className="label">{tx('SAVED IN THIS BROWSER', 'محفوظ في هذا المتصفح')}</span>
        <strong>{accounts[accounts.length - 1].name}</strong>
        <span dir="ltr">{accounts[accounts.length - 1].email}</span>
      </div>
      <button
        type="button"
        className="btn btn-sm auth-forget"
        onClick={() => forget(accounts[accounts.length - 1])}
        title={tx('Forget this account on this website', 'انسَ هذا الحساب في هذا الموقع')}
      >
        {tx('Forget', 'انسَ')}
      </button>
    </motion.div>
  );

  const licenseRecord = entitlement && (
    <motion.div className="auth-saved" {...rise} transition={{ duration: 0.5 }}>
      <div className="auth-saved-mark" aria-hidden="true">K</div>
      <div className="auth-saved-info">
        <span className="label">{tx('LICENSE ON THIS DEVICE', 'رخصة على هذا الجهاز')}</span>
        <strong>{entitlement.plan.toUpperCase()} · {tx('one-time', 'مرة واحدة')}</strong>
        <span dir="ltr">{entitlement.key.slice(0, 11)}…{entitlement.key.slice(-4)}</span>
      </div>
      <button
        type="button"
        className="btn btn-sm auth-forget"
        onClick={clearLicense}
        title={tx('Clear the saved license entitlement', 'امسح حق الرخصة المحفوظ')}
      >
        {tx('Clear', 'مسح')}
      </button>
    </motion.div>
  );

  return (
    <div className="auth-page">
      {/* ---------- hero ---------- */}
      <section className="wrap auth-hero">
        <motion.div {...rise} transition={{ duration: 0.6 }}>
          <div className="row">
            <span className="label">◆ {tx('ACCOUNT PAIRING', 'اقتران الحساب')}</span>
            <span className="num">v{SITE.version}</span>
          </div>
          <h1 className="display" style={{ marginTop: 26 }}>{tx('Your account, on your device.', 'حسابك، على جهازك.')}</h1>
          <p className="lead">
            {tx(
              'Create the account in the desktop app. This page pairs your browser with it using a short-lived code. The password stays hashed in this browser; the link carries only your name, email, plan and an optional license key.',
              'أنشئ الحساب في تطبيق سطح المكتب. تربط هذه الصفحة متصفحك به برمز قصير العمر. تبقى كلمة المرور مُجزّأة في هذا المتصفح، ولا يحمل الرابط سوى اسمك وبريدك وخطتك ومفتاح رخصة اختياري.',
            )}
          </p>
        </motion.div>
      </section>

      <div className="wrap"><hr className="rule" /></div>

      {/* ---------- signature pairing diagram ---------- */}
      <div className="wrap au-diagram-wrap">
        <PairingDiagram code={pair} />
      </div>

      {/* ---------- section head + three steps ---------- */}
      <section className="wrap section-tight">
        <div className="sec-head">
          <div className="sec-index">01 / {tx('THE HANDSHAKE', 'عملية الاقتران')}</div>
          <div className="sec-body">
            <h2 className="h2">{tx('How pairing works', 'كيف يعمل الاقتران')}</h2>
            <p className="lead">{tx('Three steps. One click back to the app. The password stays in this browser; the link carries only your name, email, plan and an optional license key.', 'ثلاث خطوات. نقرة واحدة للعودة إلى التطبيق. تبقى كلمة المرور في هذا المتصفح؛ ولا يحمل الرابط سوى اسمك وبريدك وخطتك ومفتاح رخصة اختياري.')}</p>
          </div>
        </div>

        <div className="auth-grid">
          <div className="auth-main">
            {phase === 'loading' && (
              <div className="auth-loading" aria-live="polite">
                <span className="label">{tx('READING THE PAIRING LINK…', 'جارٍ قراءة رابط الاقتران…')}</span>
              </div>
            )}

            {phase === 'no-pair' && (
              <>
                <motion.div className="auth-inline" {...rise} transition={{ duration: 0.5 }}>
                  <span className="label">◆ {tx('MISSING PAIR CODE', 'رمز الاقتران مفقود')}</span>
                  <h3 className="h3" style={{ marginTop: 14 }}>{tx('Start this from the desktop app', 'ابدأ هذا من تطبيق سطح المكتب')}</h3>
                  <p>
                    {tx(
                      'This page needs a six-character code generated by SADEEM. A website never makes one. Open the app, sign in, and choose to continue on the website — your browser will land here with the code attached.',
                      'تحتاج هذه الصفحة إلى رمز من ستة أحرف يُنشئه سديم. لا يُنشئه أي موقع. افتح التطبيق، سجّل الدخول، واختر المتابعة عبر الموقع — سيصل متصفحك إلى هنا ومعه الرمز.',
                    )}
                  </p>
                  <div className="panel panel-pad auth-snippet">
                    <span className="label">{tx('LINK SHAPE', 'شكل الرابط')}</span>
                    <code dir="ltr">/auth#pair=XXXXXX&amp;mode=signup</code>
                  </div>
                  <div className="row" style={{ marginTop: 24 }}>
                    <Link className="btn btn-solid" href="/download"><ArrowDownToLine size={17} />{tx('Get SADEEM', 'حمّل سديم')}</Link>
                    <Link className="btn" href="/download">{tx('How to install', 'كيفية التثبيت')}<ArrowRight size={16} /></Link>
                  </div>
                </motion.div>
                {honestNote}
                {savedAccount}
                {licenseRecord}
              </>
            )}

            {phase === 'form' && (
              <>
                <motion.div className="panel panel-pad auth-form" {...rise} transition={{ duration: 0.5 }}>
                  <div className="auth-form-top">
                    <span className="auth-pair"><span className="mono" dir="ltr">{pair}</span></span>
                    <span className="small">
                      {tx('Code from your app · valid for 15 minutes · one use', 'الرمز من تطبيقك · صالح 15 دقيقة · لاستخدام واحد')}
                    </span>
                  </div>

                  <div className="auth-tabs" role="tablist" aria-label={tx('Account mode', 'نوع الحساب')}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signup'}
                      className="auth-tab"
                      onClick={() => { setMode('signup'); setErrors({}); setNotice(''); }}
                    >
                      {tx('Sign up', 'إنشاء حساب')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signin'}
                      className="auth-tab"
                      onClick={() => { setMode('signin'); setErrors({}); setNotice(''); }}
                    >
                      {tx('Sign in', 'تسجيل الدخول')}
                    </button>
                  </div>

                  {/* License redemption is a sibling form — never nested in the
                      account form below (nested forms are invalid HTML). */}
                  <div className="auth-no-password">
                    <span className="label">◆ {tx('OWNER LICENSE KEY · OPTIONAL', 'مفتاح رخصة المالك · اختياري')}</span>
                    <p>
                      {tx(
                        'Have a license? Paste it here. We check the signed-key format (KDX-PLAN-…) and store the entitlement on this device; the desktop app verifies the real HMAC signature when you activate the key.',
                        'لديك رخصة؟ الصقها هنا. نتحقق من شكل المفتاح الموقّع (KDX-PLAN-…) ونحفظ الحق على هذا الجهاز؛ يتحقق تطبيق سطح المكتب من توقيع HMAC الحقيقي عند التفعيل.',
                      )}
                    </p>
                    <form onSubmit={redeem} noValidate style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        <label className="auth-field" style={{ flex: '1 1 260px', marginTop: 0 }}>
                          <span className="auth-label">{tx('LICENSE KEY', 'مفتاح الرخصة')}</span>
                          <input
                            className={`auth-input${errors.license ? ' invalid' : ''}`}
                            type="text"
                            value={licenseInput}
                            onChange={(e) => {
                              setLicenseInput(e.target.value);
                              setLicenseMsg(null);
                              setErrors((p) => ({ ...p, license: undefined }));
                            }}
                            placeholder="KDX-PRO-XXXXX-XXXX-XXX"
                            autoComplete="off"
                            spellCheck={false}
                            dir="ltr"
                          />
                        </label>
                        <button className="btn btn-sm" type="submit">{tx('Check format', 'تحقق من الشكل')}</button>
                      </div>
                      {errors.license && <span className="auth-error">{errors.license}</span>}
                    </form>
                    {licenseMsg && (
                      <p className="auth-micro" style={{ textAlign: 'start' }}>
                        {licenseMsg.ok ? '✓ ' : '◆ '}{licenseMsg.text}
                      </p>
                    )}
                  </div>

                  <form onSubmit={submit} noValidate>
                    <label className="auth-field">
                      <span className="auth-label">{tx('NAME', 'الاسم')}</span>
                      <input
                        className={`auth-input${errors.name ? ' invalid' : ''}`}
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }}
                        placeholder={tx('e.g. Layla', 'مثال: ليلى')}
                        dir="auto"
                      />
                      {errors.name && <span className="auth-error">{errors.name}</span>}
                    </label>

                    <label className="auth-field">
                      <span className="auth-label">{tx('EMAIL', 'البريد الإلكتروني')}</span>
                      <input
                        className={`auth-input${errors.email ? ' invalid' : ''}`}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: undefined })); }}
                        placeholder="you@example.com"
                        dir="ltr"
                      />
                      {errors.email && <span className="auth-error">{errors.email}</span>}
                    </label>

                    <label className="auth-field">
                      <span className="auth-label">{tx('PASSWORD · THIS DEVICE ONLY', 'كلمة المرور · هذا الجهاز فقط')}</span>
                      <input
                        className={`auth-input${errors.password ? ' invalid' : ''}`}
                        type="password"
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })); }}
                        placeholder={tx('At least 8 characters', '٨ أحرف على الأقل')}
                        dir="ltr"
                      />
                      {errors.password && <span className="auth-error">{errors.password}</span>}
                    </label>

                    <div className="auth-no-password">
                      <span className="label">{tx('WHY A PASSWORD?', 'لماذا كلمة مرور؟')}</span>
                      <p>
                        {tx(
                          'It is a local lock, not a server credential. The password is salted and hashed with SHA-256 in your browser and saved only here. It is never sent to SADEEM or to the desktop app — the app creates its own account from the pairing code. Use 8+ characters; this is not a substitute for a server-grade password store.',
                          'إنها قفل محلي، ليست بيانات دخول لخادم. تُملّح الكلمة وتُجزّأ بـ SHA-256 في متصفحك وتُحفظ هنا فقط. لا تُرسل إلى سديم ولا إلى تطبيق سطح المكتب — التطبيق ينشئ حسابه من رمز الاقتران. استخدم ٨ أحرف أو أكثر؛ هذا ليس بديلاً عن مخزن كلمات مرور على خادم.',
                        )}
                      </p>
                    </div>

                    {errors.form && <p className="auth-error">{errors.form}</p>}

                    <button className="btn btn-solid btn-block auth-submit" type="submit" disabled={busy}>
                      {busy
                        ? tx('Saving on this device…', 'جارٍ الحفظ على هذا الجهاز…')
                        : tx('Continue to SADEEM', 'المتابعة إلى سديم')}
                      {!busy && <ArrowRight size={17} />}
                    </button>
                    <p className="auth-micro">
                      {mode === 'signin'
                        ? tx('The password must match the one saved in this browser. The deep link sends your name, email, plan and stored license key (if any) — never your password.', 'يجب أن تطابق الكلمة المحفوظة في هذا المتصفح. يرسل الرابط العميق اسمك وبريدك وخطتك ومفتاح الرخصة المحفوظ (إن وُجد) — أبداً كلمة المرور.')
                        : tx('Nothing is uploaded. The app creates the local account when it receives the link.', 'لا يُرفع أي شيء. التطبيق هو من ينشئ الحساب المحلي عند استلام الرابط.')}
                    </p>
                  </form>
                </motion.div>
                {notice && <p className="auth-micro">{notice}</p>}
                {honestNote}
                {savedAccount}
                {licenseRecord}
              </>
            )}

            {phase === 'done' && (
              <>
                <motion.div className="panel panel-pad auth-done" {...rise} transition={{ duration: 0.5 }}>
                  <WaxSeal code={pair} />
                  <span className="label">✓ {tx('DETAILS SAVED IN THIS BROWSER', 'تم حفظ البيانات في هذا المتصفح')}</span>
                  <h3 className="h3" style={{ marginTop: 14 }}>{tx('One last step.', 'خطوة أخيرة.')}</h3>
                  <p>
                    {tx('Send the pair back to SADEEM. Nothing left to verify on this site.', 'أعد الرمز إلى سديم. لم يبقَ شيء للتحقق في هذا الموقع.')}
                  </p>

                  <div className="auth-recap">
                    <div className="auth-recap-row"><span className="label">{tx('NAME', 'الاسم')}</span><strong>{resultName}</strong></div>
                    <div className="auth-recap-row"><span className="label">{tx('EMAIL', 'البريد')}</span><strong dir="ltr">{resultEmail}</strong></div>
                    <div className="auth-recap-row"><span className="label">{tx('PAIR CODE', 'رمز الاقتران')}</span><strong className="mono" dir="ltr">{pair}</strong></div>
                    <div className="auth-recap-row">
                      <span className="label">{tx('PLAN IN LINK', 'الخطة في الرابط')}</span>
                      <strong>{plan} {entitlement && <span className="small">{tx('(format-checked key)', '(مفتاح تم فحص شكله)')}</span>}</strong>
                    </div>
                  </div>

                  <a className="btn btn-solid btn-block auth-open" href={callback}>
                    {tx('Open SADEEM', 'افتح سديم')}<ArrowUpRight size={19} />
                  </a>
                  <p className="auth-micro">
                    {tx('Browsers only open external apps after a click — this button is that click.', 'المتصفحات تفتح التطبيقات الخارجية بعد نقرة فقط — هذا الزر هو تلك النقرة.')}
                  </p>

                  <div className="auth-fallback">
                    <div className="auth-fallback-top">
                      <strong>{tx("If the app didn't open", 'إذا لم يفتح التطبيق')}</strong>
                      <button type="button" className="btn btn-sm" onClick={copyLink}>
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                        {copied ? tx('Copied!', 'تم النسخ!') : tx('Copy activation link', 'انسخ رابط التفعيل')}
                      </button>
                    </div>
                    <p className="auth-micro">
                      {tx('Paste the link into the address bar and press Enter, or run it from Windows Run (Win + R).', 'الصق الرابط في شريط العنوان واضغط Enter، أو نفّذه من نافذة تشغيل ويندوز (Win + R).')}
                    </p>
                    <div className="panel auth-snippet">
                      <code dir="ltr">{callback}</code>
                    </div>
                  </div>

                  <div className="auth-warn">
                    <span className="label">◆ {tx('ONE USE · 15 MINUTES', 'استخدام واحد · 15 دقيقة')}</span>
                    <p>
                      {tx('Codes expire after fifteen minutes and work once. If pairing fails, return to the app and start a new code.', 'تنتهي صلاحية الرمز بعد خمس عشرة دقيقة ويُستخدم مرة واحدة. إذا فشل الاقتران، عد إلى التطبيق وأنشئ رمزاً جديداً.')}
                    </p>
                  </div>

                  <button className="btn btn-sm auth-again" type="button" onClick={() => { setPhase('form'); setCopied(false); setPassword(''); }}>
                    {tx('Use a different email', 'استخدم بريداً آخر')}
                  </button>
                </motion.div>
                {honestNote}
                {savedAccount}
                {licenseRecord}
              </>
            )}
          </div>

          <div className="auth-steps">
            <span className="label">{tx('THE THREE-STEP RITUAL', 'الطريقة في ثلاث خطوات')}</span>
            {STEPS.map((step) => (
              <motion.div className="frow" key={step.num} {...rise} transition={{ duration: 0.5 }}>
                <span className="frow-num">{step.num}</span>
                <div>
                  <h3 className="h3 auth-step-title">{t(step.title)}</h3>
                  <p>{t(step.body)}</p>
                </div>
              </motion.div>
            ))}
            <p className="auth-steps-foot">
              {tx('Need the app?', 'تحتاج التطبيق؟')} <Link href="/download" className="link">{tx('Download it here', 'حمّله من هنا')}</Link>
            </p>
          </div>
        </div>
      </section>

      <div className="wrap">
        <p className="auth-footnote">
          {SITE.name} · {tx('Local-first by design. Keys stay here; provider calls go direct.', 'محلي بالتصميم. المفاتيح تبقى هنا، ونداءات المزوّد مباشرة.')}
        </p>
      </div>
    </div>
  );
}
