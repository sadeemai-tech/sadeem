// ============================================================
// SADEEM settings — Plugins section (v11.38 PRO).
// Installable capability packs: MCP servers + slash prompts +
// bundled skills. One-click starters, file import, https URL
// import, enable/disable, uninstall. Every control has a real,
// visible effect: enabled plugins immediately contribute MCP
// servers to agent runs and REAL /slash commands to the composer.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Puzzle, Plus, Trash2, FolderOpen, Check, RotateCcw, Zap } from 'lucide-react';
import { useStore } from '../../store';
import { useT, useDigits } from '../../i18n';
import { api } from '../../lib/api';
import { Btn } from '../ui';
import { GroupCard, InfoNote, SettingRow, Toggle } from './controls';
import type { PluginInfo } from '../../../shared/types';
import './s2-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

/** v11.38 — starters now advertise their real contributions (ipc handlers). */
interface Starter {
  id: string;
  name: string;
  version: string;
  description: string;
  mcpCount?: number;
  promptCount?: number;
  mcpNames?: string[];
  promptNames?: string[];
}

/** modular grid — hairline seams at exact, repeated intervals. */
const GX = 12, GY = 12, CW = 38, CH = 34, COLS = 8, ROWS = 3;
const GRID_V = Array.from({ length: COLS + 1 }, (_, i) => GX + i * CW);
const GRID_H = Array.from({ length: ROWS + 1 }, (_, i) => GY + i * CH);
const MODULES: readonly (readonly [number, number])[] = [[0, 0], [2, 1], [4, 0], [6, 2], [7, 1]];

export function PluginsSection() {
  const t = useT();
  const n = useDigits();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  const notify = useStore((s) => s.notify);
  const [list, setList] = useState<PluginInfo[] | null>(null);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([api.pluginsList(), api.pluginsStarters()]);
      setList(Array.isArray(l) ? l : []);
      setStarters(Array.isArray(s) ? (s as Starter[]) : []);
    } catch {
      setList([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const installedIds = new Set((list ?? []).map((p) => p.id));
  const installed = list ?? [];
  const active = installed.filter((p) => p.enabled);
  const activeMcp = active.reduce((sum, p) => sum + (p.mcpCount || 0), 0);
  const activePrompts = active.reduce((sum, p) => sum + (p.promptCount || 0), 0);

  const wrap = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) notify(okMsg);
      await reload();
    } catch (err) {
      // Honest errors — the raw main-process reason (PLUGIN_*: ...) is shown.
      notify(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  };

  const contributions = (mcp: number, prompts: number) =>
    tx(
      `${mcp} MCP server${mcp === 1 ? '' : 's'} · ${prompts} slash command${prompts === 1 ? '' : 's'}`,
      `${mcp} خادم MCP · ${prompts} أمر أوامر`,
    );

  return (
    <section className="set-section s2-page" dir={lang === 'ar' ? 'rtl' : undefined}>
      {/* ---------- refined page head · 05 / PLUGINS ---------- */}
      <header className="s2-head">
        <div className="s2-glyph-wrap">
          <svg className="s2-glyph" viewBox="0 0 40 40" aria-hidden="true">
            {/* interlocking squares */}
            <rect x="6" y="6" width="20" height="20" />
            <rect x="14" y="14" width="20" height="20" />
            <path className="quiet" d="M6 6h4M6 6v4M34 34h-4M34 34v-4" />
            <circle className="dot" cx="24" cy="24" r="1.4" />
          </svg>
        </div>
        <div className="s2-head-copy">
          <div className="s2-eyebrow">
            <span className="no">{n('05')}</span>
            <span className="slash">/</span>
            {t('set.group.plugins', 'Plugins')}
          </div>
          <h2 className="s2-display">{t('set.group.plugins', 'Plugins')}</h2>
          <p className="s2-desc">
            {tx(
              'Capability packs: MCP servers, slash commands and skills bundled as one installable JSON.',
              'حزم قدرات تجمع خوادم MCP والأوامر والمهارات في ملف JSON واحد قابل للتثبيت.',
            )}
          </p>
        </div>
        <span className="s2-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · modular grid ---------- */}
      <div className="s2-plate s2-plate--grid" aria-hidden="true">
        <svg viewBox="0 0 328 126">
          <rect className="quiet" x={GX} y={GY} width={COLS * CW} height={ROWS * CH} />
          {GRID_V.map((x, i) => (
            <line key={`v${i}`} className="quiet" x1={x} y1={GY} x2={x} y2={GY + ROWS * CH} />
          ))}
          {GRID_H.map((y, i) => (
            <line key={`h${i}`} className="quiet" x1={GX} y1={y} x2={GX + COLS * CW} y2={y} />
          ))}
          {MODULES.map(([col, row], i) => {
            const mx = GX + col * CW + 11;
            const my = GY + row * CH + 9;
            return (
              <g key={i}>
                <rect className="mid" x={mx} y={my} width="16" height="16" />
                {i % 2 === 0 && <circle className="dot accent" cx={mx + 8} cy={my + 8} r="1.6" />}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="s2-groups">
      {/* ---------- LIVE effect readout — not decoration ---------- */}
      <GroupCard title={t('settings.plugins.active', 'Active contributions')}>
        <SettingRow
          label={tx('Injected into every agent run', 'تُحقن في كل تشغيل للوكيل')}
          hint={tx('Enabled plugins only — MCP tools and /slash commands update instantly.', 'الإضافات المفعّلة فقط — أدوات MCP وأوامر الشرطة تتحدث فوراً.')}
        >
          <Zap size={13} className="text-accent" aria-hidden />
          <span className="stamp stamp-acc !h-[18px] !text-[9px] inline-flex items-center gap-1">
            {n(String(activeMcp))} MCP · {n(String(activePrompts))} /
          </span>
          <button
            className="ms-1 inline-flex p-1.5 text-faint hover:text-ink transition-colors cursor-pointer"
            title={t('settings.plugins.refresh', 'Refresh plugin state')}
            aria-label={t('settings.plugins.refresh', 'Refresh plugin state')}
            onClick={() => void wrap('reload', async () => undefined)}
          >
            <RotateCcw size={13} aria-hidden />
          </button>
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('settings.plugins.installed', 'Installed')}>
        {list === null ? (
          <div className="set-note">…</div>
        ) : list.length === 0 ? (
          <InfoNote>
            {t(
              'settings.plugins.empty',
              'No plugins installed yet — add one below or install a starter pack.',
            )}
          </InfoNote>
        ) : (
          list.map((p) => (
            <SettingRow
              key={p.id}
              label={p.name}
              hint={`${p.id} · v${p.version}${p.author ? ` · ${p.author}` : ''}${p.description ? ` — ${p.description}` : ''}`}
            >
              <span
                className={`stamp !h-[18px] !text-[9px] inline-flex items-center gap-1 ${p.enabled ? 'stamp-acc' : ''}`}
                title={contributions(p.mcpCount, p.promptCount)}
              >
                {contributions(p.mcpCount, p.promptCount)}
              </span>
              <span className="stamp !h-[18px] !text-[9px] inline-flex items-center gap-1">
                {p.enabled ? tx('ACTIVE', 'مفعّلة') : tx('OFF', 'متوقفة')}
              </span>
              <Toggle
                checked={p.enabled}
                disabled={busy !== null}
                onChange={(v) => void wrap(`tg:${p.id}`, () => api.pluginsSetEnabled(p.id, v), v
                  ? tx(`${p.name} enabled — contributions are live`, `تم تفعيل ${p.name} — مساهماتها نشطة`)
                  : tx(`${p.name} disabled — contributions removed`, `تم تعطيل ${p.name} — أُزيلت مساهماتها`))}
                label={`${p.name} enabled`}
              />
              <button
                className="ms-1 inline-flex p-1.5 text-faint hover:text-ink transition-colors cursor-pointer"
                title={t('settings.plugins.reveal', 'Open plugin folder')}
                aria-label={t('settings.plugins.reveal', 'Open plugin folder')}
                onClick={() => void api.pluginsReveal(p.id).catch((err) => notify(String(err instanceof Error ? err.message : err)))}
              >
                <FolderOpen size={13} aria-hidden />
              </button>
              <button
                className="ms-1 inline-flex p-1.5 text-faint hover:text-[var(--bad)] transition-colors cursor-pointer"
                title={t('settings.plugins.uninstall', 'Uninstall')}
                aria-label={t('settings.plugins.uninstall', 'Uninstall')}
                onClick={() => void wrap(`rm:${p.id}`, () => api.pluginsUninstall(p.id), t('settings.plugins.removed', 'Plugin removed'))}
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </SettingRow>
          ))
        )}
      </GroupCard>

      <GroupCard title={t('settings.plugins.starters', 'Starter packs')}>
        {starters.map((s) => (
          <SettingRow
            key={s.id}
            label={s.name}
            hint={`${s.description}${s.mcpNames?.length || s.promptNames?.length ? ` · /${[...(s.mcpNames ?? []), ...(s.promptNames ?? [])].join(' /')}` : ''}`}
          >
            <span className="stamp !h-[18px] !text-[9px] inline-flex items-center gap-1">
              {contributions(s.mcpCount ?? 0, s.promptCount ?? 0)}
            </span>
            {installedIds.has(s.id) ? (
              <span className="stamp stamp-acc !h-[18px] !text-[9px] inline-flex items-center gap-1">
                <Check size={9} aria-hidden /> {t('settings.plugins.installedOne', 'INSTALLED')}
              </span>
            ) : (
              <Btn
                onClick={() => void wrap(`st:${s.id}`, () => api.pluginsInstallStarter(s.id),
                  tx(`Installed ${s.name} — ${contributions(s.mcpCount ?? 0, s.promptCount ?? 0)} active`,
                    `تم تثبيت ${s.name} — ${contributions(s.mcpCount ?? 0, s.promptCount ?? 0)}`))}
                disabled={busy === `st:${s.id}`}
              >
                <Plus size={12} aria-hidden /> {t('settings.plugins.add', 'Install')}
              </Btn>
            )}
          </SettingRow>
        ))}
      </GroupCard>

      <GroupCard title={t('settings.plugins.import', 'Import')}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              className="set-input flex-1"
              dir="ltr"
              placeholder="https://example.com/sadeem-plugin.json"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
            />
            <Btn
              disabled={!urlDraft.trim() || busy !== null}
              onClick={() =>
                void wrap('url', () => api.pluginsInstallUrl(urlDraft.trim()), t('settings.plugins.added', 'Plugin installed — contributions active'))
              }
            >
              <Puzzle size={12} aria-hidden /> {t('settings.plugins.fromUrl', 'From URL')}
            </Btn>
          </div>
          <div>
            <Btn onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              <Plus size={12} aria-hidden /> {t('settings.plugins.fromFile', 'From JSON file…')}
            </Btn>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const p = (f as unknown as { path?: string }).path;
                  if (p) void wrap('file', () => api.pluginsInstallFile(p), t('settings.plugins.added', 'Plugin installed — contributions active'));
                  else notify(tx('No file path available from this build — use From URL or a starter.', 'لا يوجد مسار ملف في هذه النسخة — استخدم الرابط أو حزمة جاهزة.'));
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </GroupCard>

      <InfoNote>
        {t(
          'settings.plugins.note',
          'A plugin manifest is JSON: { id, name, version, mcpServers[], prompts[] } plus an optional skills/ folder beside it. Installed prompts become real /slash commands; enabled plugin MCP servers join every agent run. Only https:// URLs are accepted; manifests are capped at 2MB; invalid manifests are rejected with an exact reason.',
        )}
      </InfoNote>
      </div>
    </section>
  );
}
