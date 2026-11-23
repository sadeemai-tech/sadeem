// ============================================================
// SADEEM v11.10 settings — APPROVALS section ("who is pre-allowed?").
// Every "Always allow" / "Always reject" decision the engine persisted
// per workspace is listed with a per-rule REVOKE button, and the
// "Full access" master toggle drives the SAME permissionMode the
// engine gate reads every run. HIGH-RISK commands still ask once.
// The masthead + gate glyph are presentation only; no IPC changed.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { GroupCard, InfoNote, SettingRow, Toggle } from './controls';
import './s4-art.css';

type RuleEntry = {
  key: string;
  command: string;
  ts: number;
  allow: boolean;
};

/** One precise artistic element of this page: a portcullis gate — a
 *  lintel, five vertical bars and a sill, drawn in 1px currentColor. */
const GateGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <path className="s4-ink" d="M10 12h52M12 16v32M60 16v32M12 48h48" />
    <path className="s4-ink s4-thin" d="M22 16v32M32 16v32M42 16v32M50 16v32" />
    <path className="s4-ink" d="M28 34h16M36 30l4 4-4 4" />
    <circle className="s4-dot" cx="36" cy="12" r="1.8" />
    <circle className="s4-dot" cx="12" cy="12" r="1.2" />
    <circle className="s4-dot" cx="60" cy="12" r="1.2" />
  </svg>
);

export function ApprovalsSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const ar = settings.language === 'ar';
  const setMode = useStore((s) => s.setMode);
  const wsPath = useStore((s) => s.wsPath);
  const notify = useStore((s) => s.notify);

  const [rules, setRules] = useState<RuleEntry[]>([]);
  const [storeFile, setStoreFile] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fullAccess = settings.permissionMode === 'fullAccess';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.approvalsList?.(wsPath || undefined);
      const all: RuleEntry[] = [];
      for (const g of res?.groups ?? []) for (const r of g.rules) all.push(r);
      setRules(all);
      setStoreFile(res?.file ?? '');
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [wsPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (key: string): Promise<void> => {
    try {
      const res = await api.approvalsRevoke?.(wsPath || undefined, key);
      notify(
        t('settings.approvals.revoked', 'Rule revoked ({n})').replace('{n}', String(res?.revoked ?? 1)),
      );
    } catch {
      notify(t('settings.approvals.revokeFail', 'Could not revoke the rule'));
    }
    void refresh();
  };

  const shown = expanded ? rules : rules.slice(0, 6);
  const fmtTs = (ts: number): string => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return '';
    }
  };
  const ruleLabel = (r: RuleEntry): string => {
    if (r.key.startsWith('cmd:')) return r.command || r.key.slice(4);
    if (r.key.startsWith('mcp:')) return r.key.slice(4);
    return r.command || r.key;
  };

  return (
    <div className="s4-page s4-approvals">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.approvals.eyebrow', ar ? '٢٥ / الأذونات' : '25 / APPROVALS')}
          </span>
          <GateGlyph />
        </div>
        <h2 className="s4-title">
          {t('set.group.approvals', ar ? 'الموافقات' : 'Approvals')}
        </h2>
        <p className="s4-desc">
          {t('settings.approvals.desc', 'Everything the agent is pre-allowed to do — see it, revoke it.')}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        {/* ---------- Full access master toggle ---------- */}
        <GroupCard title={t('settings.approvals.fullAccess', 'Full access')}>
          <SettingRow
            label={t('settings.approvals.fullAccess.label', 'Full access master switch')}
            hint={t(
              'settings.approvals.fullAccess.hint',
              'Same switch as the title-bar mode strip. OFF (Ask) confirms every edit and command; AUTO-EDIT auto-approves file edits only; ON auto-approves everything below.',
            )}
          >
            <Toggle
              checked={fullAccess}
              onChange={(v) => setMode(v ? 'fullAccess' : 'default')}
              label={t('settings.approvals.fullAccess.label', 'Full access master switch')}
            />
          </SettingRow>
          <div
            className="mt-2 rounded-[8px] px-2.5 py-2 text-[11px] leading-relaxed"
            style={{
              background: 'color-mix(in srgb, var(--warn) 10%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent)',
            }}
          >
            <div className="font-semibold text-ink mb-1">
              {t('settings.approvals.exactly', 'What this grants — exactly')}
            </div>
            <ul className="list-disc ps-4 space-y-0.5 text-dim">
              <li>{t('settings.approvals.grant.write', 'File writes, edits and deletes inside the workspace — approved automatically.')}</li>
              <li>{t('settings.approvals.grant.cmd', 'Ordinary shell commands (npm, git, python, builds) — approved automatically.')}</li>
              <li>{t('settings.approvals.grant.keep', 'HIGH-RISK commands (sudo, rm -rf /, fork bombs) and commands flagged by taint/network checks STILL ask once.')}</li>
            </ul>
            <div className="text-[10.5px] text-faint mt-1">
              {t('settings.approvals.warning', 'Never enable on a machine with secrets you cannot afford to lose.')}
            </div>
          </div>
        </GroupCard>

        {/* ---------- granted rules + revoke ---------- */}
        <GroupCard title={t('settings.approvals.rules', 'Granted always-rules')}>
          {loading ? (
            <div className="text-[11.5px] text-faint py-2">{t('common.loading', 'Loading…')}</div>
          ) : rules.length === 0 ? (
            <div className="text-[11.5px] text-faint py-2 leading-relaxed">
              {t(
                'settings.approvals.empty',
                'Nothing granted yet — every edit/command asks until you pick “Always allow” on its card.',
              )}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--line)]">
              {shown.map((r) => (
                <div key={`${r.allow ? 'a' : 'd'}-${r.key}-${r.ts}`} className="flex items-center gap-2 py-1.5 min-w-0">
                  {r.allow ? (
                    <ShieldCheck size={13} className="text-ok shrink-0" aria-hidden />
                  ) : (
                    <ShieldOff size={13} className="text-bad shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-code text-[11.5px] text-ink truncate" dir="ltr" title={r.command || r.key}>
                      {ruleLabel(r)}
                    </div>
                    <div className="text-[10px] text-faint tnum" dir="ltr">
                      <span className={r.allow ? 'text-ok' : 'text-bad'}>
                        {r.allow
                          ? t('settings.approvals.alwaysAllow', 'ALWAYS ALLOW')
                          : t('settings.approvals.alwaysReject', 'ALWAYS REJECT')}
                      </span>
                      {' · '}
                      <span className="font-code">{r.key}</span>
                      {r.ts ? ` · ${fmtTs(r.ts)}` : ''}
                    </div>
                  </div>
                  <button
                    className="btn !h-[22px] !px-2 !text-[10.5px] shrink-0"
                    onClick={() => void revoke(r.key)}
                    title={t('settings.approvals.revoke', 'Revoke')}
                  >
                    <Trash2 size={11} aria-hidden />
                    <span className="ms-1">{t('settings.approvals.revoke', 'Revoke')}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {rules.length > 6 && (
            <button className="mt-2 text-[11px] text-dim hover:text-ink underline underline-offset-2" onClick={() => setExpanded(!expanded)}>
              {expanded
                ? t('settings.approvals.showLess', 'Show less')
                : t('settings.approvals.showMore', 'Show all {n} rules').replace('{n}', String(rules.length))}
            </button>
          )}
          <InfoNote>
            {t(
              'settings.approvals.note',
              'Rules are stored per workspace in the app-data approval stores. A revoke takes full effect for the active chat after its next run / app restart; new chats apply it immediately.',
            )}
          </InfoNote>
          {storeFile && (
            <div className="text-[10px] text-faint font-code mt-1 break-all" dir="ltr">
              {storeFile}
            </div>
          )}
        </GroupCard>
      </div>
    </div>
  );
}

export default ApprovalsSection;
