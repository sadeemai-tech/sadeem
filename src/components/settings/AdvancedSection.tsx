// ============================================================
// SADEEM settings — Advanced section.
// About (version/tech stack), API-server status mirror, usage
// statistics, portable profile export/import, danger zone and the
// KODEX_* environment-variable reference. The masthead + compass
// glyph are presentation only; every action and key is unchanged.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Server, TerminalSquare } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api, type ApiServerStatus } from '../../lib/api';
import { Btn, Chip, fmtCost } from '../ui';
import { GroupCard, InfoNote } from './controls';
import './s4-art.css';
import { APP_VERSION } from '../../version';

/** Version-free so this readout can never go stale when dependencies upgrade
 *  (the runtime version is shown separately from APP_VERSION above). */
const TECH_STACK = ['Electron', 'React', 'TypeScript', 'Monaco Editor', 'xterm.js'];

const ENV_VARS: { name: string; descKey: string; descFb: string }[] = [
  {
    name: 'KODEX_HOME',
    descKey: 'settings.advanced.env.home',
    descFb: 'Overrides the SADEEM home directory (default ~/.surnia) — hooks, slash commands and app data.',
  },
  {
    name: 'KODEX_ENABLE_GPU',
    descKey: 'settings.advanced.env.gpu',
    descFb: 'Set to 1 to opt in to GPU acceleration. Software rendering is the deliberate safe default.',
  },
  {
    name: 'KODEX_SMOKE',
    descKey: 'settings.advanced.env.smoke',
    descFb: 'Set to 1 for CI smoke-test mode: headless-safe boot, prints KODEX_SMOKE_OK when healthy.',
  },
];

/** One precise artistic element of this page: a compass — a double ring,
 *  eight graduations and a split needle, all 1px currentColor ink. */
const CompassGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <circle className="s4-ink" cx="36" cy="28" r="19" />
    <circle className="s4-ink s4-thin" cx="36" cy="28" r="14" strokeDasharray="1 4" />
    <path className="s4-ink s4-thin" d="M36 4v5M36 47v5M12 28h5M55 28h5M19 11l4 4M49 41l4 4M53 11l-4 4M23 41l-4 4" />
    <path className="s4-ink" d="M36 14 41 30 36 26 31 30Z" />
    <path className="s4-ink s4-thin" d="M36 42 31 26 36 30 41 26Z" />
    <circle className="s4-dot" cx="36" cy="28" r="1.6" />
  </svg>
);

export function AdvancedSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const ar = settings.language === 'ar';
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const setSettings = useStore((s) => s.setSettings);
  const wsPath = useStore((s) => s.wsPath);

  // ---- v12 — full profile export / import ----
  const profileFileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const downloadProfile = () => {
    setBusy(true);
    api
      .profileExport(wsPath || undefined)
      .then((profile) => {
        const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `sadeem-profile-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        notify(t('settings.advanced.profile.exported', 'Profile exported — keep this file private (it contains API keys)'));
      })
      .catch(() => notify(t('settings.advanced.profile.exportFailed', 'Profile export failed')))
      .finally(() => setBusy(false));
  };
  const loadProfile = (file?: File) => {
    if (!file) return;
    setBusy(true);
    file
      .text()
      .then((text) => api.profileImport(JSON.parse(text), wsPath || undefined))
      .then((res) => {
        if (!res.ok) {
          notify(t('settings.advanced.profile.importFailed', 'Import failed — invalid profile file'));
          return;
        }
        notify(
          t(
            'settings.advanced.profile.imported',
            'Profile restored: {n} skills, {p} prompts'.replace('{n}', String(res.skills ?? 0)).replace('{p}', String(res.prompts ?? 0)),
          ),
        );
      })
      .catch(() => notify(t('settings.advanced.profile.importFailed', 'Import failed — invalid profile file')))
      .finally(() => {
        setBusy(false);
        if (profileFileRef.current) profileFileRef.current.value = '';
      });
  };

  // ---- api server mirror (one-shot status) ----
  const [srv, setSrv] = useState<ApiServerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .apiServerGet()
      .then((st) => alive && setSrv(st))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ---- usage stats ----
  const log = settings.usageLog ?? [];
  const totalRuns = log.reduce((n, e) => n + e.runs, 0);
  const totalTokens = log.reduce((n, e) => n + e.tokens, 0);
  const totalCost = log.reduce((n, e) => n + e.costUsd, 0);

  // ---- danger zone: two-step inline confirms ----
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );
  const arm = (set: (v: boolean) => void) => {
    set(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => {
      setConfirmClear(false);
      setConfirmReset(false);
    }, 3500);
  };

  const clearUsage = () => {
    updateSettings({ usageLog: [] });
    setConfirmClear(false);
    notify(t('settings.usageData.cleared', 'Usage data cleared'));
  };

  const resetAll = () => {
    // Sensible defaults built from the current object: identity,
    // appearance, onboarding, recent projects and billing survive;
    // every behaviour override returns to factory values.
    updateSettings({
      ...settings,
      permissionMode: 'default',
      model: { provider: 'anthropic', model: 'claude-sonnet-5.5' },
      providers: {},
      fontSize: 13,
      terminalFontSize: 12,
      autoApproveEdits: false,
      checkpointsEnabled: true,
      mcpServers: [],
      memory: undefined,
      inlineSuggestions: undefined,
      closeToTray: undefined,
      doneNotifications: undefined,
      apiServer: undefined,
      preview: undefined,
      agent: undefined,
      ui: undefined,
      usageLog: [],
    });
    setConfirmReset(false);
    notify(t('settings.advanced.resetAll.done', 'Settings restored to defaults'));
  };

  return (
    <div className="s4-page s4-advanced">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.advanced.eyebrow', ar ? '١٣ / متقدم' : '13 / ADVANCED')}
          </span>
          <CompassGlyph />
        </div>
        <h2 className="s4-title">
          {t('settings.nav.advanced', ar ? 'متقدم' : 'Advanced')}
        </h2>
        <p className="s4-desc">
          {t(
            'settings.advanced.desc',
            ar
              ? 'التشخيص ومحاسبة الاستخدام ومرجع المتغيرات والإجراءات الخطيرة.'
              : 'Diagnostics, usage accounting, environment reference and destructive actions.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        {/* ---- about (legacy 'about' section lands here) ---- */}
        <GroupCard title={t('settings.about', 'About')}>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Chip tone="acc">{`${t('settings.about.version', 'Version')} ${APP_VERSION}`}</Chip>
            <Chip>SADEEM</Chip>
          </div>
          <p className="text-[11.5px] leading-relaxed text-dim m-0 mb-2.5">
            {t(
              'settings.about.keys',
              'Your API keys are stored locally with OS-level encryption when available. Nothing is sent to SADEEM servers.',
            )}
          </p>
          <ul className="flex flex-col gap-1">
            {TECH_STACK.map((s) => (
              <li key={s} className="flex items-center gap-2 text-[12px] text-dim">
                <Check size={13} className="text-ok shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </GroupCard>

        {/* ---- api server mirror ---- */}
        <GroupCard title={t('settings.nav.apiServer', 'API server')}>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Server size={14} className="text-[var(--acc2)] shrink-0" />
            <Chip tone={srv?.running ? 'ok' : 'default'}>
              {srv?.running
                ? t('apiserver.running', 'Running')
                : t('apiserver.stopped', 'Stopped')}
            </Chip>
            <span className="font-code text-[11.5px] text-dim" dir="ltr">
              127.0.0.1:{srv?.port ?? settings.apiServer?.port ?? 47777}
            </span>
            <span className="ms-auto">
              <Btn onClick={() => setSettings(true, 'apiServer')}>
                {t('settings.advanced.goApiServer', 'Manage API server')}
              </Btn>
            </span>
          </div>
        </GroupCard>

        {/* ---- usage statistics ---- */}
        <GroupCard title={t('settings.advanced.usageStats', 'Usage statistics')}>
          <div className="grid grid-cols-4 gap-2.5 text-center">
            <div className="set-stat">
              <div className="set-stat-v tnum">{totalRuns}</div>
              <div className="set-stat-k">
                {t('settings.advanced.totalRuns', 'Total runs')}
              </div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{totalTokens.toLocaleString()}</div>
              <div className="set-stat-k">
                {t('settings.advanced.totalTokens', 'Total tokens')}
              </div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{fmtCost(totalCost)}</div>
              <div className="set-stat-k">
                {t('settings.advanced.totalCost', 'Est. cost')}
              </div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{log.length}</div>
              <div className="set-stat-k">
                {t('settings.advanced.days', 'Days tracked')}
              </div>
            </div>
          </div>
        </GroupCard>

        {/* ---- KODEX_* env reference ---- */}
        <GroupCard title={t('settings.advanced.env', 'Environment variables')}>
          <div className="flex flex-col gap-2">
            {ENV_VARS.map((v) => (
              <div key={v.name} className="flex items-start gap-2.5">
                <span className="font-code text-[11px] px-1.5 py-0.5 rounded-[2px] border border-[var(--line)] bg-[var(--bg2)] text-[var(--acc2)] shrink-0" dir="ltr">
                  {v.name}
                </span>
                <span className="text-[11px] leading-relaxed text-dim">
                  {t(v.descKey, v.descFb)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5">
            <InfoNote>
              <TerminalSquare size={12} className="inline-block me-1.5 -mt-0.5" />
              {t(
                'settings.advanced.env.hint',
                'Read-only reference — set these before launching the SADEEM executable.',
              )}
            </InfoNote>
          </div>
        </GroupCard>

        {/* ---- v12 — portable full profile (settings + DNA + skills + prompts) ---- */}
        <GroupCard title={t('settings.advanced.profile', 'Portable profile')}>
          <p className="text-[11.5px] leading-relaxed text-dim m-0 mb-2.5">
            {t(
              'settings.advanced.profile.hint',
              'Back up or move your whole setup in one file: settings, learned DNA, your skills and saved prompts.',
            )}
          </p>
          <input
            ref={profileFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              void loadProfile(e.target.files?.[0]);
            }}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Btn onClick={downloadProfile} disabled={busy}>
              {t('settings.advanced.profile.export', 'Export profile')}
            </Btn>
            <Btn onClick={() => profileFileRef.current?.click()} disabled={busy}>
              {t('settings.advanced.profile.import', 'Import profile')}
            </Btn>
          </div>
          <div className="text-[10.5px] text-[var(--faint)] mt-2">
            {t(
              'settings.advanced.profile.privacy',
              'Exported JSON contains API keys — store it somewhere private. Import merges skills/prompts and restores settings/DNA.',
            )}
          </div>
        </GroupCard>

        {/* ---- danger zone — clearly separated, --bad tones ---- */}
        <div className="card p-4 set-danger">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-[var(--bad)]" aria-hidden />
            <span className="caps text-[11px] font-bold text-[var(--bad)]">
              {t('settings.advanced.danger', 'Danger zone')}
            </span>
          </div>
          <p className="text-[10.5px] text-[var(--faint)] mb-2 m-0">
            {t(
              'settings.advanced.danger.hint',
              'These actions are immediate and local — they cannot be undone.',
            )}
          </p>

          <div className="flex items-center justify-between gap-3 py-2 border-t border-[var(--line-soft)]">
            <div className="min-w-0">
              <div className="text-[12.5px]">{t('settings.usageData', 'Local usage data')}</div>
              <div className="text-[10.5px] text-[var(--faint)] mt-0.5">
                {t('settings.advanced.clearUsage.hint', 'Erase the runs/tokens/cost history on this device')}
              </div>
            </div>
            <Btn variant={confirmClear ? 'danger' : 'default'} onClick={() => (confirmClear ? clearUsage() : arm(setConfirmClear))}>
              {confirmClear
                ? t('settings.advanced.confirm', 'Click again to confirm')
                : t('settings.usageData.clear', 'Clear')}
            </Btn>
          </div>

          <div className="flex items-center justify-between gap-3 py-2 border-t border-[var(--line-soft)]">
            <div className="min-w-0">
              <div className="text-[12.5px]">{t('settings.advanced.resetAll', 'Reset all settings')}</div>
              <div className="text-[10.5px] text-[var(--faint)] mt-0.5">
                {t(
                  'settings.advanced.resetAll.hint',
                  'Restores factory defaults — keys, model, agent/preview/UI tuning, MCP servers. Keeps sign-in, appearance, recent projects and billing.',
                )}
              </div>
            </div>
            <Btn variant={confirmReset ? 'danger' : 'default'} onClick={() => (confirmReset ? resetAll() : arm(setConfirmReset))}>
              {confirmReset
                ? t('settings.advanced.confirm', 'Click again to confirm')
                : t('settings.advanced.resetAll', 'Reset all')}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdvancedSection;
