// ============================================================
// SADEEM settings — Account & Data (B1 honest local-first rewrite).
// Everything shown here is REAL data that already exists on this
// device — no checkout, no coupon box, no plan-chooser rows:
//   (a) local profile card — device account (display-only) or the
//       honest "no account" state, always with a local-only chip
//   (b) license / plan readout from store.license (instant render,
//       NEVER a skeleton) — when the license probe fails: a clear
//       failure note with a Retry button
//   (c) this-month usage from settings.usageLog + live session counters
//   (d) local data actions that have real IPC support (secExportData
//       → ZIP in appData/exports, revealed in the file manager)
//   (e) license key activation + license endpoint (real offline
//       capabilities, kept from the legacy section)
// FINAL LAUNCH POLICY: the monthly subscription presentation is GONE.
// The Pro / Team plan cards, "$X/mo" prices, Checkout CTA, coupon and
// Stripe-secret-key field were removed. In their place: ONE honest
// free-season statement (shared with the Plans screen). License and
// account logic below is unchanged — only the copy/UI was removed.
// Strings: t(key, bilingual-fallback) — i18n.ts is NOT edited.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { effectivePlan, isLicenseExpired, isTrialActive, trialDaysLeft } from '../../lib/plan';
import { Btn, Chip, Field, Spinner, TextInput, fmtCost } from '../ui';
import { GroupCard, InfoNote, SettingRow } from './controls';
import {
  fmtDate,
  fmtInt,
  FreeSeasonStatement,
  LicenseModelStatement,
  OwnerLicenseBadge,
  isOwnerLicense,
} from '../billingShared';
import '../billing.css';
import './s4-art.css';
import { AccountAuthCard } from './AccountAuthCard';

/** License probe state — 'failed' shows the honest Retry note. */
type ProbeState = 'idle' | 'ok' | 'failed';

/** The one precise artistic element of this page: an open, blank ledger. */
const LedgerGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <path className="s4-ink" d="M36 13c-6-4-14-4-21-2v34c7-2 15-2 21 2 6-4 14-4 21-2V11c-7-2-15-2-21 2Z" />
    <path className="s4-ink" d="M36 13v34" />
    <path className="s4-ink s4-thin" d="M23 23h7M23 30h7M42 23h7M42 30h7M23 37h5M44 37h5" />
    <circle className="s4-dot" cx="36" cy="13" r="1.6" />
  </svg>
);

export function BillingSection() {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const license = useStore((s) => s.license);
  const refreshLicense = useStore((s) => s.refreshLicense);
  const account = useStore((s) => s.account);
  const sessionUsage = useStore((s) => s.sessionUsage);
  const notify = useStore((s) => s.notify);
  const ar = lang === 'ar';

  // ---- (b) license probe: the store renders instantly; this probe only
  // decides whether a "could not verify" note with Retry is shown. -----
  const [probe, setProbe] = useState<ProbeState>('idle');
  const [probing, setProbing] = useState(false);
  const probeSeq = useRef(0);
  const runProbe = useCallback(() => {
    const seq = ++probeSeq.current;
    setProbing(true);
    Promise.resolve()
      .then(() => api.licenseGet())
      .then((lic) => {
        if (probeSeq.current !== seq) return;
        setProbe('ok');
        if (lic) void refreshLicense(); // mirror into the store
      })
      .catch(() => {
        if (probeSeq.current !== seq) return;
        setProbe('failed');
      })
      .finally(() => {
        if (probeSeq.current === seq) setProbing(false);
      });
  }, [refreshLicense]);
  useEffect(() => {
    runProbe();
  }, [runProbe]);

  // ---- (c) usage this month (sum of usageLog entries in the current YYYY-MM)
  const month = new Date().toISOString().slice(0, 7);
  const monthEntries = useMemo(
    () =>
      (settings.usageLog ?? []).filter(
        (e) => typeof e.date === 'string' && e.date.slice(0, 7) === month,
      ),
    [settings.usageLog, month],
  );
  const mRuns = monthEntries.reduce((a, e) => a + (e.runs || 0), 0);
  const mTokens = monthEntries.reduce((a, e) => a + (e.tokens || 0), 0);
  const mCost = monthEntries.reduce((a, e) => a + (e.costUsd || 0), 0);

  // ---- (d) local data export (real IPC: kdx:sec:exportData → ZIP) -----
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const r = await Promise.resolve()
        .then(() => api.secExportData())
        .catch(() => null);
      if (r?.ok && r.path) {
        setExportPath(r.path);
        notify(t('set.account.export.done', ar ? 'تم التصدير — يُكشف ملف ZIP الآن' : 'Exported — revealing the ZIP'));
      } else {
        notify(r?.error || t('set.account.export.failed', ar ? 'تعذّر إنشاء ملف التصدير' : 'Could not create the export'));
      }
    } finally {
      setExporting(false);
    }
  };

  // ---- (e) license redemption — wired to the REAL offline redeem action ----
  // The renderer cannot import main-process services; the closed IPC allowlist
  // api.licenseActivate → licenseSvc.activate → redeemLicense() is that path.
  // The main process verifies HMAC offline, stores the key 0600 and throws ONE
  // clear English sentence on a bad key (never raw JSON / provider noise).
  const [key, setKey] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState('');
  const redeem = async () => {
    const k = key.trim();
    if (!k || redeeming) return;
    setRedeeming(true);
    setRedeemError('');
    try {
      const lic = await api.licenseActivate(k);
      await refreshLicense();
      if (!lic || lic.plan === 'free') {
        throw new Error(
          t('plans.invalidKey', ar ? 'مفتاح الترخيص غير صالح' : 'Invalid license key.'),
        );
      }
      setKey('');
      runProbe();
      notify(t('plans.activated', ar ? 'تم تفعيل الترخيص' : 'License redeemed'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRedeemError(msg);
      notify(msg);
    } finally {
      setRedeeming(false);
    }
  };

  // ---- honest plan math (mirror of the main-process license service) ----
  const eff = effectivePlan(license);
  const owner = isOwnerLicense(license);
  const planName = owner
    ? t('billing.owner.label', ar ? 'ترخيص المالك (سلسلة v11)' : 'Owner License (v11 series)')
    : t(`plans.${eff}.name`, eff.toUpperCase());
  const trial = isTrialActive(license);
  const trialLeft = trialDaysLeft(license);
  const expired = isLicenseExpired(license);

  // ---- (a) profile initials ----
  const initials = useMemo(() => {
    const name = (account?.name ?? '').trim();
    return name
      ? name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? '')
          .join('')
      : '';
  }, [account?.name]);
  void initials;

  return (
    <div className="s4-page s4-billing">
      {/* ---------- editorial masthead ---------- */}
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.billing.eyebrow', ar ? '١٤ / الحساب والبيانات' : '14 / ACCOUNT & DATA')}
          </span>
          <LedgerGlyph />
        </div>
        <h2 className="s4-title">
          {t('set.account.title', ar ? 'الحساب والبيانات' : 'Account & Data')}
        </h2>
        <p className="s4-desc">
          {t(
            'set.account.desc',
            ar
              ? 'سديم محلية أولاً: ملفك والترخيص والاستخدام تعيش على هذا الجهاز. لا شيء هنا يتحدث مع خادم دفع.'
              : 'SADEEM is local-first: your profile, license and usage live on this device. Nothing here talks to a payment server.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        {/* ---------- (a) local profile card — REAL account flows (v11) ---------- */}
        <GroupCard title={t('set.account.profile', ar ? 'الحساب المحلي' : 'Local account')}>
          <AccountAuthCard />
        </GroupCard>

        {/* ---------- (b) license / plan honest readout ---------- */}
        <GroupCard title={t('set.account.plan', ar ? 'الخطة والترخيص' : 'Plan & license')}>
          {probe === 'failed' && (
            <div className="set-probe-fail" role="alert">
              <AlertTriangle size={13} aria-hidden />
              <span className="flex-1 min-w-0">
                {t(
                  'set.account.probe.failed',
                  ar
                    ? 'تعذّر التحقق من الترخيص على هذا الجهاز — تُعرض آخر حالة معروفة.'
                    : 'Could not verify the license on this device — showing the last known state.',
                )}
              </span>
              <Btn onClick={runProbe} disabled={probing}>
                <span className="inline-flex items-center gap-1.5">
                  {probing ? <Spinner size={11} /> : <RefreshCw size={12} />}
                  {t('chat.retry', ar ? 'إعادة المحاولة' : 'Retry')}
                </span>
              </Btn>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck size={14} className="text-ok shrink-0" aria-hidden />
            <span className="text-[15px] font-bold">{planName}</span>
            {owner && <OwnerLicenseBadge />}
            {trial && (
              <Chip tone="warn">
                {t('set.account.trialDays', ar ? 'متبقٍ {n} يوم تجربة' : '{n} trial days left').replace(
                  '{n}',
                  String(trialLeft),
                )}
              </Chip>
            )}
            {expired && <Chip tone="bad">{t('settings.billing.expired', 'Expired')}</Chip>}
            <span className="ms-auto">
              <Btn variant="ghost" onClick={() => void refreshLicense()} disabled={probing}>
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw size={12} className={probing ? 'animate-spin' : ''} />
                  {t('set.account.recheck', ar ? 'إعادة الفحص' : 'Re-check')}
                </span>
              </Btn>
            </span>
          </div>

          <div className="set-kvlist mt-2">
            <div className="set-kv">
              <span className="set-kv-k">{t('set.account.mode', ar ? 'الوضع' : 'Mode')}</span>
              <span className="set-kv-v">
                {license.mode === 'local'
                  ? t('set.account.mode.local', ar ? 'محلي — بلا خوادم' : 'Local — no servers involved')
                  : license.mode}
              </span>
            </div>
            {(license.licensedTo || license.email) && (
              <div className="set-kv">
                <span className="set-kv-k">{t('set.account.licensedTo', ar ? 'مرخّص لـ' : 'Licensed to')}</span>
                <span className="set-kv-v font-code" dir="ltr">
                  {license.licensedTo || license.email}
                </span>
              </div>
            )}
            {typeof license.activatedAt === 'number' && license.activatedAt > 0 && (
              <div className="set-kv">
                <span className="set-kv-k">{t('set.account.activatedAt', ar ? 'التفعيل' : 'Activated')}</span>
                <span className="set-kv-v tnum" dir="ltr">
                  {fmtDate(license.activatedAt)}
                </span>
              </div>
            )}
            <div className="set-kv">
              <span className="set-kv-k">{t('set.account.expires', ar ? 'انتهاء الصلاحية' : 'Expiry')}</span>
              <span className="set-kv-v tnum" dir="ltr">
                {typeof license.expiresAt === 'number' && license.expiresAt > 0
                  ? fmtDate(license.expiresAt)
                  : t('set.account.perpetual', ar ? 'دائم — لا ينتهي' : 'Perpetual — never expires')}
              </span>
            </div>
            {typeof license.seats === 'number' && license.seats > 0 && (
              <div className="set-kv">
                <span className="set-kv-k">{t('billing.seats', '{n} seats')}</span>
                <span className="set-kv-v tnum" dir="ltr">
                  {license.seats}
                </span>
              </div>
            )}
            {license.source && (
              <div className="set-kv">
                <span className="set-kv-k">{t('set.account.source', ar ? 'المصدر' : 'Source')}</span>
                <span className="set-kv-v">{license.source}</span>
              </div>
            )}
          </div>

          {/* v11.33 — honest Owner License status (never "lifetime forever") */}
          {owner && (
            <div className="set-kvlist mt-2">
              <div className="set-kv">
                <span className="set-kv-k">{t('billing.owner.entitlement', ar ? 'الاستحقاق' : 'Entitlement')}</span>
                <span className="set-kv-v">
                  {t('billing.owner.scope', ar ? 'سلسلة v11 كلها (v11 وكل v11.x) — دفعة واحدة' : 'Whole v11 series (v11 + all v11.x) — one-time')}
                </span>
              </div>
              <div className="set-kv">
                <span className="set-kv-k">{t('billing.owner.nextMajor', ar ? 'الإصدار الرئيسي القادم' : 'Next major')}</span>
                <span className="set-kv-v">
                  {t('billing.owner.half', ar ? 'خصم ٥٠٪ — وليس مجاناً للأبد' : '50% discount — not free forever')}
                </span>
              </div>
              <div className="set-kv">
                <span className="set-kv-k">{t('billing.owner.byok', ar ? 'مفاتيحك (BYOK)' : 'Bring your own keys')}</span>
                <span className="set-kv-v">
                  {t('billing.owner.freeForever', ar ? 'مجانية للأبد · بلا حد يومي' : 'Free forever · no daily cap')}
                </span>
              </div>
            </div>
          )}

          {/* license redemption (real, offline-capable) */}
          <Field label={t('settings.billing.license', 'License key')}>
            <div className="flex gap-2">
              <TextInput
                value={key}
                placeholder={t('settings.billing.keyPh', 'KDX-…')}
                onChange={(e) => {
                  setKey(e.target.value);
                  if (redeemError) setRedeemError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && void redeem()}
                className="font-code"
                dir="ltr"
              />
              <Btn variant="primary" onClick={() => void redeem()} disabled={!key.trim() || redeeming}>
                {redeeming && <Spinner size={12} />}
                <KeyRound size={12} className="inline-block me-1.5" />
                {t('settings.billing.activate', ar ? 'تفعيل المفتاح' : 'Redeem key')}
              </Btn>
            </div>
            {redeemError && (
              <div className="text-[10.5px] text-red-400 mt-1" role="alert" dir="auto">
                {redeemError}
              </div>
            )}
            <div className="text-[10.5px] text-[var(--faint)] mt-1 font-code" dir="ltr">
              {t(
                'plans.key.hint',
                'Signed v2 KDX-PRO-XXXXX-XXXX-XXX, Owner KDX-OWNER-…, and legacy KDX-PRO-XXXX-XXXX-XXXX keys all verify offline. A bad key shows one clear error.',
              )}
            </div>
          </Field>

          <Field
            label={t('settings.billing.endpoint', 'License endpoint (optional)')}
            hint={t(
              'settings.billing.endpoint.hint',
              'During activation SADEEM POSTs {key} here and accepts JSON {plan, licensedTo?, email?, expiresAt?, seats?} in return.',
            )}
          >
            <TextInput
              value={settings.billing?.licenseEndpoint ?? ''}
              placeholder={t('settings.billing.endpointPh.v1131', 'https://licenses.example.com/verify')}
              onChange={(e) =>
                updateSettings({ billing: { ...(settings.billing ?? {}), licenseEndpoint: e.target.value } })
              }
              className="font-code"
              dir="ltr"
            />
          </Field>

          <div className="text-[10.5px] text-[var(--faint)] mt-1 leading-relaxed">
            {t('settings.billing.gen', 'Mint a one-time offline Owner License key:')}
            <div className="font-code mt-1" dir="ltr">
              node scripts/license-gen.cjs --plan owner --days 0 --count 1
            </div>
          </div>
        </GroupCard>

        {/* ---------- honest model: free season + one-time Owner License ---------- */}
        <FreeSeasonStatement />
        <LicenseModelStatement />

        {/* ---------- (c) this-month usage (local counters only) ---------- */}
        <GroupCard title={t('settings.billing.usageMonth', 'Usage this month')}>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="set-stat">
              <div className="set-stat-v tnum">{mRuns}</div>
              <div className="set-stat-k">{t('settings.billing.usage.runs', 'Runs')}</div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{fmtInt(mTokens)}</div>
              <div className="set-stat-k">{t('settings.billing.usage.tokens', 'Tokens')}</div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{fmtCost(mCost)}</div>
              <div className="set-stat-k">{t('settings.billing.usage.cost', 'Est. cost')}</div>
            </div>
          </div>
          <div className="text-[10.5px] text-[var(--faint)] mt-2.5 leading-relaxed" dir="auto">
            {t(
              'set.account.usage.note',
              ar
                ? 'يُحسب محلياً من سجل تشغيلاتك — لا يُبلَّغ عنه لأي جهة.'
                : 'Counted locally from your own run history — nothing is reported anywhere.',
            )}
            {(sessionUsage.inputTokens > 0 || sessionUsage.outputTokens > 0) && (
              <span dir="ltr">
                {' '}
                ·{' '}
                {t('set.account.usage.session', ar ? 'هذه الجلسة: {n} توكن · {c}' : 'This session: {n} tokens · {c}', {
                  n: fmtInt(sessionUsage.inputTokens + sessionUsage.outputTokens),
                  c: fmtCost(sessionUsage.costUsd),
                })}
              </span>
            )}
          </div>
        </GroupCard>

        {/* ---------- (d) local data actions (real IPC only) ---------- */}
        <GroupCard title={t('set.account.data', ar ? 'بياناتك' : 'Your data')}>
          <SettingRow
            label={t('set.account.export', ar ? 'تصدير البيانات (ZIP)' : 'Export data (ZIP)')}
            hint={t(
              'set.account.export.hint',
              ar
                ? 'يجمع الإعدادات (مفاتيح API مُنقَّحة) والجلسات والذاكرة والاستخدام والتدقيق في ملف ZIP — يُحفظ محلياً ثم يُكشف في مدير الملفات.'
                : 'Bundles settings (API keys redacted), sessions, memory, usage and audit into one ZIP — saved locally, then revealed in your file manager.',
            )}
          >
            <Btn onClick={() => void exportData()} disabled={exporting}>
              {exporting ? <Spinner size={12} /> : <Download size={12} className="inline-block me-1.5" />}
              {t('set.account.export.go', ar ? 'تصدير' : 'Export')}
            </Btn>
          </SettingRow>
          {exportPath && (
            <div className="font-code text-[10.5px] text-[var(--acc2)] mt-1 truncate" dir="ltr" title={exportPath}>
              {exportPath}
            </div>
          )}
          <div className="mt-2.5">
            <InfoNote>
              {t(
                'set.account.data.note',
                ar
                  ? 'كل ما تعرفه سديم يعيش في ‎~/.surnia على هذا الجهاز. صندوق الاقتراحات أدناه وقسم الخيارات المتقدمة يبقيان أفعالهما المحلية.'
                  : 'Everything SADEEM knows lives in ~/.surnia on this machine. The suggestions box below and the Advanced section keep their own local actions.',
              )}
            </InfoNote>
          </div>
        </GroupCard>
      </div>
    </div>
  );
}

export default BillingSection;
