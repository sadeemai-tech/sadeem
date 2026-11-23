// ============================================================
// SADEEM settings — SADEEM Remote section (v11.7)
// Control the desktop agent from a REAL phone: QR pairing over
// LAN/hotspot, live transcript, send/steer, approvals, abort.
// Polls the main-process service every 3s while mounted.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Minus, Plus, RefreshCw } from 'lucide-react';
import { api, type RemoteStatus } from '../../lib/api';
import { useT, useDigits } from '../../i18n';
import { useStore } from '../../store';
import { Field, IconBtn, Spinner, TextInput, Toggle } from '../ui';
import './s3-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

const DEFAULT_PORT = 48888;

/**
 * v11.36 — local superset of RemoteStatus. Handoff to parent: mirror these
 * fields (`pairingExpiresAt`, `lanCandidates`, `reachable`, `errorCode`) into
 * `src/lib/api.ts:136` so this local cast can be removed.
 */
type LanCandidateView = { address: string; iface: string; kind: string; usable: boolean };
type RemoteStatusFull = RemoteStatus & {
  pairingExpiresAt?: number;
  lanCandidates?: LanCandidateView[];
  reachable?: boolean;
  errorCode?: string;
};
type RemoteSetPatch = { enabled?: boolean; port?: number; host?: string };
const remoteSet = api.remoteSet as (patch: RemoteSetPatch) => Promise<RemoteStatusFull>;

/** Same taxonomy as electron/services/remoteService.ts (kept local: the
 *  renderer must never import a main-process module that touches node:os). */
const REMOTE_ERRORS: Record<string, { en: string; ar: string }> = {
  NO_LAN_ADDRESS: {
    en: 'No phone-reachable network address found.',
    ar: 'لم يُعثر على عنوان شبكة يمكن للهاتف الوصول إليه.',
  },
  LAN_HOST_NOT_FOUND: {
    en: 'The selected LAN IP is not on this machine.',
    ar: 'عنوان الشبكة المختار غير موجود على هذا الجهاز.',
  },
  LAN_UNREACHABLE: {
    en: 'The desktop cannot reach its own LAN address — check the firewall/port.',
    ar: 'لا يستطيع الحاسوب الوصول إلى عنوانه على الشبكة — تحقق من الجدار الناري والمنفذ.',
  },
  BAD_PAIRING_TOKEN: {
    en: 'The phone token was rejected — re-scan the QR to pair again.',
    ar: 'رُفض رمز الهاتف — امسح رمز QR لإعادة الاقتران.',
  },
  FORBIDDEN_HOST: {
    en: 'Open the exact link shown here — do not retype the address.',
    ar: 'افتح الرابط الظاهر هنا كما هو — لا تكتب العنوان يدوياً.',
  },
  FORBIDDEN_ORIGIN: {
    en: 'A foreign page tried to drive the phone API. Open the QR link directly.',
    ar: 'حاولت صفحة غريبة التحكم بواجهة الهاتف — افتح رابط QR مباشرة.',
  },
  INVALID_PAIRING_CODE: { en: 'That QR was not issued here.', ar: 'هذا الرمز لم يُصدر من هذا الجهاز.' },
  PAIRING_CODE_MALFORMED: { en: 'The pairing code is corrupt.', ar: 'رمز الاقتران تالف.' },
  PAIRING_CODE_EXPIRED: { en: 'This QR expired after 10 minutes.', ar: 'انتهت صلاحية رمز QR بعد 10 دقائق.' },
  PAIRING_CODE_ALREADY_USED: { en: 'This QR was already used by a phone.', ar: 'استُخدم هذا الرمز على هاتف آخر.' },
  LOCAL_ACCOUNT_MISMATCH: { en: 'This link belongs to another OS account.', ar: 'هذا الرابط يخص حساب نظام آخر.' },
  DEVICE_REGISTRATION_FAILED: { en: 'Phone registration failed on the desktop.', ar: 'فشل تسجيل الهاتف على الحاسوب.' },
  MISSING_DEVICE_HEADER: { en: 'The phone did not identify its paired device.', ar: 'لم يرسل الهاتف معرّف الجهاز المقترن.' },
  DEVICE_NOT_REGISTERED: { en: 'This device is not paired (or was revoked).', ar: 'هذا الجهاز غير مقترن (أو أُلغي).' },
  ACCOUNT_MISMATCH: { en: 'The paired device belongs to another OS account.', ar: 'الجهاز المقترن يخص حساب نظام آخر.' },
  DEVICE_TOUCH_FAILED: { en: 'Could not update the device record.', ar: 'تعذّر تحديث سجل الجهاز.' },
};
function errText(code: string | undefined, arabic: boolean, fallback: string): string {
  const e = code ? REMOTE_ERRORS[code] : undefined;
  return e ? (arabic ? e.ar : e.en) : fallback;
}

export function RemoteSection() {
  const t = useT();
  const n = useDigits();
  const ar = useStore((s) => s.settings?.language === 'ar');
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const tx = (en: string, arabic: string) => pick(lang, en, arabic);
  const notify = useStore((s) => s.notify);
  const settingsEnabled = useStore((s) => s.settings?.remote?.enabled === true);

  const [status, setStatus] = useState<RemoteStatusFull | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabledOpt, setEnabledOpt] = useState<boolean | null>(null);
  const [portText, setPortText] = useState('');
  const [hostText, setHostText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<'url' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabled = enabledOpt ?? settingsEnabled;

  // ---- poll status every 3s while mounted ----
  const load = useCallback(() => {
    api
      .remoteGet()
      .then((st) => {
        const full = st as RemoteStatusFull;
        setStatus(full);
        if (st.port && !portText) setPortText(String(st.port));
        setHostText((prev) => prev || full.lanAddress || '');
      })
      .catch(() => {
        /* bridge not ready yet — retried on the next tick */
      });
  }, [portText]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 3000);
    const sec = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(iv);
      clearInterval(sec);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (patch: RemoteSetPatch) => {
    setBusy(true);
    try {
      const st = await remoteSet(patch);
      setStatus(st);
      if (patch.enabled !== undefined) setEnabledOpt(patch.enabled);
      if (st.port) setPortText(String(st.port));
      if (patch.host !== undefined) setHostText(st.lanAddress ?? patch.host);
      notify(
        patch.enabled
          ? ar
            ? st.running
              ? 'SADEEM Remote يعمل — امسح رمز QR بهاتفك'
              : 'تعذّر بدء الخدمة — جرّب منفذاً آخر'
            : st.running
              ? 'SADEEM Remote is live — scan the QR with your phone'
              : 'Could not start — try another port'
          : ar
            ? 'تم إيقاف SADEEM Remote'
            : 'SADEEM Remote stopped',
      );
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = () => {
    if (!status?.url) return;
    void navigator.clipboard?.writeText(status.url).then(() => {
      setCopied('url');
      copiedTimer.current = setTimeout(() => setCopied(null), 1400);
    });
  };

  const applyHost = (host: string) => {
    const clean = host.replace(/[^0-9.]/g, '');
    setHostText(clean);
    void apply({ host: clean });
  };

  const secsLeft = status?.pairingExpiresAt
    ? Math.max(0, Math.ceil((status.pairingExpiresAt - now) / 1000))
    : 0;
  const mmss = `${String(Math.floor(secsLeft / 60)).padStart(2, '0')}:${String(secsLeft % 60).padStart(2, '0')}`;
  /** Never present a QR that the phone demonstrably cannot reach. */
  const qrOk = !!status?.running && !!status.url && status.reachable !== false && !status.errorCode;

  return (
    <section className="set-section s3-page" dir={ar ? 'rtl' : undefined}>
      {/* ---------- refined page head · 07 / SADEEM REMOTE ---------- */}
      <header className="s3-head">
        <div className="s3-glyph-wrap">
          {/* two linked nodes, each with its own registration dot */}
          <svg className="s3-glyph" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="11" cy="20" r="6.5" />
            <circle cx="29" cy="20" r="6.5" />
            <path d="M17.5 20h5" />
            <path className="quiet" d="M11 13.5a6.5 6.5 0 0 1 18 0" />
            <circle className="dot" cx="11" cy="20" r="1.5" />
            <circle className="dot" cx="29" cy="20" r="1.5" />
          </svg>
        </div>
        <div className="s3-head-copy">
          <div className="s3-eyebrow">
            <span className="no">{n('07')}</span>
            <span className="slash">/</span>
            {t('set.group.remote', tx('SADEEM REMOTE', 'سديم عن بُعد'))}
          </div>
          <h2 className="s3-display">{t('set.group.remote', tx('SADEEM Remote', 'سديم عن بُعد'))}</h2>
          <p className="s3-desc">
            {tx(
              'Control the agent from your phone over your local network — QR pairing, live feed, approvals.',
              'تحكّم بالوكيل من هاتفك عبر شبكتك المحلية — اقتران برمز QR وبث مباشر وموافقات.',
            )}
          </p>
        </div>
        <span className="s3-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · loopback ring ---------- */}
      <div className="s3-plate s3-plate--remote" aria-hidden="true">
        <svg viewBox="0 0 320 124">
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <circle
                key={i}
                className="dot"
                cx={+(160 + Math.cos(a) * 42).toFixed(2)}
                cy={+(62 + Math.sin(a) * 42).toFixed(2)}
                r={i % 3 === 0 ? 2.1 : 1.4}
              />
            );
          })}
          <circle cx="160" cy="62" r="42" />
          <circle className="quiet" cx="160" cy="62" r="31" strokeDasharray="2 6" />
          {/* the loopback path returns to its own host */}
          <path d="M131 62h58" />
          <circle className="dot accent" cx="160" cy="62" r="2.6" />
          <path className="mid" d="M183 58l6 4-6 4" />
          <circle className="dot" cx="131" cy="62" r="2" />
          <circle className="dot" cx="189" cy="62" r="2" />
          <text className="num" x="104" y="66" textAnchor="end">PHONE</text>
          <text className="num" x="216" y="66">DESKTOP</text>
          <line className="quiet" x1="104" y1="78" x2="216" y2="78" />
        </svg>
      </div>

      <div className="s3-groups p-4 flex flex-col gap-4" dir={ar ? 'rtl' : undefined}>
      <Field label={t('remote.enabled', 'Enable SADEEM Remote')}>
        <Toggle
          checked={enabled}
          onChange={(v) => void apply({ enabled: v })}
          aria-label={t('remote.enabled', 'Enable SADEEM Remote')}
        />
      </Field>

      <Field label={t('remote.port', 'Port')}>
        <div className="flex items-center gap-1.5">
          <IconBtn
            onClick={() => void apply({ port: Math.max(1024, (Number(portText) || DEFAULT_PORT) - 1) })}
            disabled={busy}
            title="-1"
            aria-label="-1"
          >
            <Minus size={12} />
          </IconBtn>
          <TextInput
            value={portText}
            onChange={(e) => setPortText(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => {
              const p = Math.min(65535, Math.max(1024, Number(portText) || DEFAULT_PORT));
              setPortText(String(p));
              void apply({ port: p });
            }}
            className="!w-28"
            dir="ltr"
            inputMode="numeric"
          />
          <IconBtn
            onClick={() => void apply({ port: Math.min(65535, (Number(portText) || DEFAULT_PORT) + 1) })}
            disabled={busy}
            title="+1"
            aria-label="+1"
          >
            <Plus size={12} />
          </IconBtn>
          {busy && <Spinner />}
        </div>
      </Field>

      {qrOk && (
        <div className="flex flex-col items-center gap-3 p-4 rounded-xl border border-line bg-[var(--panel)]">
          {status.qrDataUrl && (
            <img
              src={status.qrDataUrl}
              alt="SADEEM Remote QR"
              className="rounded-lg border border-line bg-white p-2"
              width={248}
              height={248}
              draggable={false}
            />
          )}
          <code className="text-[11px] text-dim break-all text-center select-text" dir="ltr">
            {status.url}
          </code>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
            <span className="text-dim" dir="ltr">{tx('LAN', 'الشبكة')}: {status.lanAddress}</span>
            <span className={status.reachable ? 'text-ok' : 'text-bad'}>
              {status.reachable ? tx('reachable', 'قابل للوصول') : tx('unreachable', 'غير قابل للوصول')}
            </span>
            <span className="text-faint" dir="ltr">{tx('expires in', 'ينتهي خلال')} {mmss}</span>
          </div>
          <button
            className="inline-flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded-lg border border-line hover:border-acc transition-colors cursor-pointer"
            onClick={copyUrl}
          >
            {copied === 'url' ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
            {copied === 'url'
              ? t('remote.copied', 'Copied')
              : t('remote.copyUrl', 'Copy pairing link')}
          </button>
          <div className="text-[11px] text-faint text-center leading-relaxed" dir="auto">
            {ar
              ? 'افتح الكاميرا ← امسح الرمز ← تفتح صفحة التحكم. رمز الاقتران يُستخدم مرة واحدة وينتهي خلال 10 دقائق، ويظهر رمز جديد تلقائياً. الرمز يُخزّن في هاتفك فقط.'
              : 'Open the camera → scan → the control page opens. The code is one-use and expires in 10 minutes; a fresh QR appears automatically. The token is stored on your phone only.'}
          </div>
        </div>
      )}

      {status?.running && (
        <Field label={tx('LAN address used for the QR', 'عنوان الشبكة المستخدم في رمز QR')}>
          {!!status.lanCandidates?.length && (
            <div className="flex flex-wrap gap-1.5">
              {status.lanCandidates.map((c) => (
                <button
                  key={c.address}
                  type="button"
                  onClick={() => applyHost(c.address)}
                  title={`${c.iface} · ${c.kind}`}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-colors cursor-pointer ${
                    status.lanAddress === c.address
                      ? 'border-acc text-acc'
                      : 'border-line text-dim hover:border-acc'
                  }`}
                  dir="ltr"
                >
                  {c.address} · {c.iface} {c.usable ? '✓' : '⚠'}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <TextInput
              value={hostText}
              onChange={(e) => setHostText(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => applyHost(hostText)}
              placeholder="192.168.1.24"
              className="!w-36"
              dir="ltr"
              inputMode="decimal"
            />
            <span className="text-[10px] text-faint" dir="auto">
              {tx('Override if auto-pick chose a virtual adapter.', 'تجاوز تلقائي إذا اختار النظام بطاقة افتراضية.')}
            </span>
          </div>
        </Field>
      )}

      {status?.error && (
        <div className="text-[12px] text-bad rounded-lg border border-line p-3" dir="auto">
          <div className="font-semibold">{errText(status.errorCode, ar, status.error)}</div>
          {status.errorCode === 'NO_LAN_ADDRESS' && (
            <div className="mt-1 text-faint">
              {tx('Connect the phone and desktop to the same Wi-Fi/hotspot, then retry.', 'اربط الهاتف والحاسوب بنفس شبكة الواي فاي ثم أعد المحاولة.')}
            </div>
          )}
          {status.errorCode === 'LAN_HOST_NOT_FOUND' && (
            <div className="mt-1 text-faint">
              {tx('Choose one of the detected addresses above.', 'اختر أحد العناوين المكتشفة أعلاه.')}
            </div>
          )}
          {status.errorCode === 'LAN_UNREACHABLE' && (
            <div className="mt-1 text-faint">
              {tx('Allow the port through Windows Firewall, then retry.', 'اسمح بالمنفذ عبر جدار ويندوز الناري ثم أعد المحاولة.')}
            </div>
          )}
        </div>
      )}

      <div className="text-[11px] text-faint leading-relaxed" dir="auto">
        {ar
          ? 'أمان: الخدمة تعمل فقط عندما تفعّلها، على شبكتك المحلية (LAN/hotspot) — لا نفق سحابي ولا خوادم لنا. زوج التفويض رمز عشوائي يُولَّد على جهازك، وكل طلب يُتحقق منه. لإيقاف الوصول الكلّي أطفئ المفتاح.'
          : 'Security: the service runs only when you enable it, on your local network (LAN/hotspot) — no cloud tunnel, no servers of ours. The pairing token is random, generated on your machine, and checked on every request. Turn the toggle off to cut access entirely.'}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-faint">
        <RefreshCw size={10} className={status?.running ? 'animate-spin' : ''} />
        <span dir="ltr">
          {status?.running
            ? `listening 0.0.0.0:${status.port} → ${status.lanAddress || 'no LAN IP'} (${status.reachable ? 'reachable' : 'unreachable'})`
            : 'stopped'} · {status?.tokenMasked ?? '—'}
        </span>
      </div>
      </div>
    </section>
  );
}
