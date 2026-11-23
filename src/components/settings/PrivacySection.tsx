// ============================================================
// SADEEM settings — Privacy & data section (E4 hardening).
// Sections: Telemetry (off by default, explainer) · Terminal
// guard mode · Data controls (clear sessions / auto-memory / MCP
// approvals, export as JSON zip) · Permission rules (read-only
// viewer) · Secret storage (safeStorage backend + key count) ·
// Audit (inline recent list + SecurityPanel viewer hook).
//
// All security IPC goes through the DEFENSIVE bridge helpers in
// SecurityPanel.tsx — a preload bundle without the new channels
// shows "unavailable" instead of crashing the settings screen.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Download,
  Eraser,
  FileJson,
  History,
  KeyRound,
  ScrollText,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, Chip, Kbd } from '../ui';
import { S1Page } from './GeneralSection';
import { GroupCard, InfoNote, Segmented, SettingRow } from './controls';
import { secInvoke, secOn, type AuditEntry, type GuardModeValue, type SecurityStatus } from '../panels/SecurityPanel';
import { SecurityPanel } from '../panels/SecurityPanel';
import './s1-art.css';

function detailText(d: unknown): string {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  try {
    return Object.entries(d as Record<string, unknown>)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 36) : JSON.stringify(v)?.slice(0, 36) ?? ''}`)
      .join('  ');
  } catch {
    return String(d);
  }
}

function timeOf(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function InfoRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-[12px]">{label}</div>
        {hint && <div className="text-[10.5px] text-[var(--faint)] mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{value}</div>
    </div>
  );
}

export function PrivacySection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const wsPath = useStore((s) => s.wsPath);
  const ar = useStore((s) => s.settings.language === 'ar');

  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const refresh = useCallback(async () => {
    const st = await secInvoke<SecurityStatus>('secStatus');
    if (st) setStatus(st);
    const ev = await secInvoke<AuditEntry[]>('secAuditRecent', 6);
    if (ev) setAudit(ev);
  }, []);

  useEffect(() => {
    void refresh();
    const iv = window.setInterval(() => void refresh(), 8000);
    const off = secOn('onSecurityEvent', () => void refresh());
    return () => {
      window.clearInterval(iv);
      off();
    };
  }, [refresh]);

  const guardMode: GuardModeValue =
    status?.terminalGuard ??
    (settings as unknown as { terminalGuard?: GuardModeValue }).terminalGuard ??
    'on';

  const setGuardMode = (v: GuardModeValue) => {
    // settings.terminalGuard is new in E4 — AppSettings gains the field
    // via shared/types (integration point); stored/cast defensively here.
    updateSettings({ terminalGuard: v } as unknown as Partial<typeof settings>);
  };

  const unavailable = (): string =>
    t('security.unavailable', 'Security bridge unavailable in this build');

  // ---------------- data controls ----------------
  const clearSessions = async () => {
    if (!window.confirm(t('settings.privacy.clearSessions.confirm', 'Delete ALL saved agent sessions on this device? This cannot be undone.'))) return;
    const res = await secInvoke<{ ok?: boolean; removed?: number; error?: string }>('secClearSessions');
    notify(res?.ok ? `${t('settings.privacy.clearSessions.done', 'Deleted {{n}} sessions').replace('{{n}}', String(res.removed ?? 0))}` : res?.error || unavailable());
    void refresh();
  };

  const clearAutoMemory = async () => {
    if (!wsPath) return notify(t('settings.privacy.needWorkspace', 'Open a workspace first — auto-memory lives in the workspace.'));
    if (!window.confirm(t('settings.privacy.clearMemory.confirm', 'Clear the agent’s learned memory (MEMORY.md “## Learned”) for this workspace? Your hand-written notes are kept.'))) return;
    const res = await secInvoke<{ ok?: boolean; cleared?: boolean; error?: string }>('secClearMemory', wsPath);
    notify(res?.ok ? t('settings.privacy.clearMemory.done', 'Auto-memory cleared') : res?.error || unavailable());
    void refresh();
  };

  const clearMcpApprovals = async () => {
    if (!window.confirm(t('settings.privacy.clearMcp.confirm', 'Clear cached MCP/tool approval decisions? Tools will ask again.'))) return;
    const res = await secInvoke<{ ok?: boolean; cleared?: number; note?: string }>('secClearMcpApprovals');
    notify(res?.ok ? (res.note || t('settings.privacy.clearMcp.done', 'Approval cache cleared')) : res?.note || unavailable());
    void refresh();
  };

  const exportData = async () => {
    const res = await secInvoke<{ ok?: boolean; path?: string; error?: string }>('secExportData');
    notify(res?.path ? `${t('settings.privacy.export.done', 'Export saved to')} ${res.path}` : res?.error || unavailable());
  };

  const openSecurityPanel = () => {
    try {
      window.dispatchEvent(new CustomEvent('surnia:open-settings', { detail: { section: 'security' } }));
    } catch {
      /* no listener mounted — the inline list above still works */
    }
  };

  const clearAudit = async () => {
    if (!window.confirm(t('security.audit.clearConfirm', 'Clear the security audit trail? This cannot be undone.'))) return;
    const res = await secInvoke<{ cleared?: number }>('secAuditClear');
    notify(res ? t('security.audit.cleared', 'Audit trail cleared ({{n}} entries)').replace('{{n}}', String(res.cleared ?? 0)) : unavailable());
    void refresh();
  };

  return (
    <S1Page
      className="s1-privacy"
      eyebrow={t(
        's1.eyebrow.privacy',
        ar ? '١٢ / الخصوصية والأمان' : '12 / PRIVACY & SECURITY',
      )}
      titleKey="settings.nav.privacySecurity"
      titleFallback="Privacy & Security"
      glyph="privacy"
      desc={t('settings.privacy.desc', 'What leaves this device and what stays on it.')}
    >
      {/* ---- live security instrument (SecurityPanel, embedded) ---- */}
      <GroupCard title={t('settings.privacy.securityPanel', 'Security panel')}>
        <SecurityPanel embedded />
      </GroupCard>

      {/* ---- telemetry ---- */}
      <GroupCard title={t('settings.privacy.telemetry', 'Telemetry')}>
        <div className="flex items-start gap-2.5">
          <ShieldCheck size={16} className="text-ok shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Chip tone="ok">{t('settings.privacy.telemetry.state', 'OFF — always')}</Chip>
            </div>
            <p className="text-[11.5px] leading-relaxed text-dim m-0">
              {t(
                'settings.privacy.note',
                'SADEEM talks only to the AI providers you configure. There is no SADEEM telemetry server.',
              )}
            </p>
            <p className="text-[10.5px] leading-relaxed text-[var(--faint)] mt-1 m-0">
              {t(
                'settings.privacy.telemetry.explainer',
                'Usage counters (runs/tokens/cost) are computed locally and never uploaded. Diagnostics stay in appData/logs and are redacted for secrets before writing.',
              )}
            </p>
          </div>
        </div>
      </GroupCard>

      {/* ---- terminal guard mode ---- */}
      <GroupCard title={t('settings.privacy.terminalGuard', 'Terminal guard')}>
        <SettingRow
          label={t('settings.privacy.terminalGuard.label', 'Shell command screening')}
          hint={t(
            'settings.privacy.terminalGuard.hint',
            'Every line you run in the terminal is classified first. Dangerous commands are held until you approve them once.',
          )}
        >
          <Segmented<GuardModeValue>
            ariaLabel={t('settings.privacy.terminalGuard', 'Terminal guard')}
            value={guardMode}
            onChange={setGuardMode}
            options={[
              { value: 'on', label: t('security.mode.on', 'On') },
              { value: 'warn-only', label: t('security.mode.warnOnly', 'Warn only') },
              { value: 'off', label: t('security.mode.off', 'Off') },
            ]}
          />
        </SettingRow>
        <div className="text-[10.5px] text-[var(--faint)] mt-1">
          {status
            ? `${t('settings.privacy.terminalGuard.blocked', 'Blocked this trail')}: ${status.blockedCommands}`
            : t('security.unavailable', 'Security bridge unavailable in this build')}
        </div>
      </GroupCard>

      {/* ---- data controls ---- */}
      <GroupCard title={t('settings.privacy.dataControls', 'Data controls')}>
        <div className="grid grid-cols-1 gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11.5px] text-dim">
              <FileJson size={12} className="inline-block me-1.5 -mt-0.5" />
              {t('settings.privacy.clearSessions.label', 'Session history')}
            </div>
            <Btn onClick={() => void clearSessions()}>
              <Trash2 size={12} className="inline-block me-1" />
              {t('settings.privacy.clear', 'Clear')}
            </Btn>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11.5px] text-dim">
              <History size={12} className="inline-block me-1.5 -mt-0.5" />
              {t('settings.privacy.clearMemory.label', 'Agent auto-memory (this workspace)')}
            </div>
            <Btn onClick={() => void clearAutoMemory()}>
              <Trash2 size={12} className="inline-block me-1" />
              {t('settings.privacy.clear', 'Clear')}
            </Btn>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11.5px] text-dim">
              <ShieldCheck size={12} className="inline-block me-1.5 -mt-0.5" />
              {t('settings.privacy.clearMcp.label', 'MCP approvals cache')}
            </div>
            <Btn onClick={() => void clearMcpApprovals()}>
              <Trash2 size={12} className="inline-block me-1" />
              {t('settings.privacy.clear', 'Clear')}
            </Btn>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11.5px] text-dim">
              <Download size={12} className="inline-block me-1.5 -mt-0.5" />
              {t('settings.privacy.export.label', 'Export my data as a JSON zip')}
            </div>
            <Btn onClick={() => void exportData()}>
              <Download size={12} className="inline-block me-1" />
              {t('settings.privacy.export', 'Export')}
            </Btn>
          </div>
        </div>
        <div className="text-[10.5px] text-[var(--faint)] mt-2">
          {t(
            'settings.privacy.dataControls.hint',
            'Exports land in appData/exports. The export always strips provider API keys; every action above asks for confirmation first.',
          )}
        </div>
      </GroupCard>

      {/* ---- permission rules (read-only viewer) ---- */}
      <GroupCard title={t('settings.privacy.permissions', 'Permission rules')}>
        <InfoRow
          label={t('settings.privacy.permissions.mode', 'Permission mode')}
          value={<Kbd>{settings.permissionMode}</Kbd>}
          hint={t('settings.privacy.permissions.mode.hint', 'Cycle it from the status bar. Editor writes and shell commands ask in this mode.')}
        />
        <InfoRow
          label={t('settings.privacy.permissions.guard', 'Terminal guard')}
          value={<Chip tone={guardMode === 'on' ? 'ok' : guardMode === 'warn-only' ? 'warn' : 'bad'}>{guardMode}</Chip>}
        />
        <InfoRow
          label={t('settings.privacy.permissions.blocked', 'Blocked commands (trail)')}
          value={<span className="font-code text-[12px] tabular-nums">{status?.blockedCommands ?? '—'}</span>}
        />
        <InfoRow
          label={t('settings.privacy.permissions.autoApprove', 'Auto-approve file edits')}
          value={<Chip tone={settings.autoApproveEdits ? 'warn' : 'ok'}>{settings.autoApproveEdits ? t('common.on', 'ON') : t('common.off', 'OFF')}</Chip>}
        />
      </GroupCard>

      {/* ---- secret storage ---- */}
      <GroupCard title={t('settings.privacy.secrets', 'Secret storage')}>
        <InfoRow
          label={t('settings.privacy.secrets.backend', 'OS keystore backend')}
          value={
            status ? (
              <Chip tone={status.safeStorage.available ? 'ok' : 'warn'}>
                {status.safeStorage.available ? status.safeStorage.backend || 'OS keychain' : t('settings.privacy.secrets.fallback', 'unavailable — plain: fallback')}
              </Chip>
            ) : (
              <Chip>—</Chip>
            )
          }
          hint={t(
            'settings.privacy.secrets.hint',
            'Provider API keys are encrypted with the OS keystore when available; otherwise they are stored with an explicit plain: marker.',
          )}
        />
        <InfoRow
          label={t('settings.privacy.secrets.count', 'Stored secrets')}
          value={<span className="font-code text-[12px] tabular-nums">{status?.secretsStored ?? '—'}</span>}
        />
      </GroupCard>

      {/* ---- audit trail ---- */}
      <GroupCard title={t('security.audit.label', 'Audit trail')}>
        {audit.length === 0 ? (
          <div className="text-[11px] text-[var(--faint)] py-1">
            {t('security.audit.empty', 'Nothing recorded yet — this session has been quiet.')}
          </div>
        ) : (
          <div className="mb-2">
            {audit.map((e, i) => (
              <div key={`${e.ts}-${i}`} className="flex items-center gap-2 py-1 border-b border-[var(--line-soft)] last:border-b-0 text-[10.5px]">
                <span className="font-code text-[10px] text-[var(--faint)] tabular-nums" dir="ltr">{timeOf(e.ts)}</span>
                <Chip tone={e.kind === 'term_blocked' || e.kind === 'fs_block' ? 'bad' : e.kind === 'secret_redacted' ? 'warn' : 'acc'}>{e.kind}</Chip>
                <span className="font-code truncate min-w-0 flex-1 text-dim" dir="ltr" title={detailText(e.detail)}>{detailText(e.detail)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Btn onClick={openSecurityPanel}>
            <ScrollText size={12} className="inline-block me-1" />
            {t('security.audit.openViewer', 'Open security panel')}
          </Btn>
          <Btn variant="ghost" onClick={() => void clearAudit()}>
            <Eraser size={12} className="inline-block me-1" />
            {t('security.actions.clearAudit', 'Clear audit trail')}
          </Btn>
        </div>
        <div className="text-[10.5px] text-[var(--faint)] mt-2">
          {t(
            'settings.privacy.audit.hint',
            'Append-only JSONL at appData/audit.jsonl — terminal blocks, approvals, fs blocks and secret redactions.',
          )}
        </div>
      </GroupCard>

      {/* ---- global memory editor ---- */}
      <GroupCard title={t('settings.memory', 'Global memory')}>
        <label className="block">
          <textarea
            className="input font-code resize-y w-full"
            rows={5}
            dir="auto"
            value={settings.memory ?? ''}
            placeholder={t('settings.memory.ph', 'Anything the agent should always know…')}
            onChange={(e) => updateSettings({ memory: e.target.value })}
          />
          <div className="text-[10.5px] text-[var(--faint)] mt-1">
            {t(
              'settings.memory.hint',
              'Memory injected into every agent run, combined with the workspace MEMORY.md. Stored only on this device.',
            )}
          </div>
        </label>
      </GroupCard>

      {/* ---- usage data ---- */}
      <GroupCard title={t('settings.usageData', 'Local usage data')}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium">{t('settings.usageData', 'Local usage data')}</div>
            <div className="text-[10.5px] text-[var(--faint)] mt-0.5">
              {t(
                'settings.usageData.hint',
                'Runs/tokens/cost history used for limits and the usage panel. Never leaves this device.',
              )}
            </div>
          </div>
          <Btn
            onClick={() => {
              updateSettings({ usageLog: [] });
              notify(t('settings.usageData.cleared', 'Usage data cleared'));
            }}
          >
            <Trash2 size={12} className="inline-block me-1" />
            {t('settings.usageData.clear', 'Clear')}
          </Btn>
        </div>
      </GroupCard>

      <InfoNote>
        {t(
          'settings.privacy.footer',
          'Nothing here phones home. Every control on this page operates on files inside this user’s app data directory.',
        )}
      </InfoNote>
    </S1Page>
  );
}

export default PrivacySection;
