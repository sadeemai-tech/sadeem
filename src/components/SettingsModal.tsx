// ============================================================
// SADEEM settings — AURORA two-pane view (replaces the v7.2 page).
// Exactly 6 groups — every legacy section is mapped (regrouped,
// nothing removed):
//   01 General · 02 Agent & Security · 03 Models & Providers
//   04 Integrations · 05 Editor & Terminal · 06 Account & Data
// Layout: left glass rail (icon + title + one-line description,
// active = iris rail + .aurora-ring), right scrollable content
// column. Header row = title + instant bilingual search (registry)
// + close. The old 3-card presets row is now ONE "Posture"
// segmented control (same applyPreset wiring, per-segment tooltip).
//
// DEEP-LINK FIX (B1): group selection lives in LOCAL state driven
// by BOTH the `surnia:open-settings` listener and the rail clicks.
// Root cause of the "stays on General" bug: SECTION_TO_GROUP did
// not map the GROUP ids themselves ('account'/'integrations'), so
// resolveGroup('account') fell back to 'general' and the listener
// wrote 'general' back over the deep link while the modal was
// already open. All six group ids now resolve to themselves, and
// the local state makes the switch synchronous — see groupFromStore
// notes at the bottom of the file for the store-side findings.
// Esc closes; the bilingual search index still filters every control.
// Also syncs the document-level reduce-motion / compact-ui classes.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Bot,
  Brain,
  FileText,
  Fingerprint,
  FolderGit2,
  Gauge,
  Keyboard,
  KeyRound,
  Mic,
  MonitorPlay,
  Palette,
  PenLine,
  Plug,
  Puzzle,
  Scale,
  Search,
  RefreshCcw,
  SearchX,
  Server,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  User,
  Wind,
  Wrench,
  X,
  MessageSquare,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import './settings/settings.css';
import { searchSettings, type SettingEntry } from './settings/registry';
import { PRESET_IDS, SECURITY_PRESETS, applyPreset, type PresetId, type SecurityPreset } from './settings/presets';
import { GeneralSection } from './settings/GeneralSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { EditorSection } from './settings/EditorSection';
import { TerminalSection } from './settings/TerminalSection';
import { AgentSection } from './settings/AgentSection';
import { SkillsMemorySection } from './settings/SkillsMemorySection';
import { ModelsSection } from './settings/ModelsSection';
import { PreviewSection } from './settings/PreviewSection';
import { McpSection } from './settings/McpSection';
import { ApiServerSection } from './settings/ApiServerSection';
import { RemoteSection } from './settings/RemoteSection';
import { BillingSection } from './settings/BillingSection';
import { NotificationsSection } from './settings/NotificationsSection';
import { VoiceSection } from './settings/VoiceSection';
import { PluginsSection } from './settings/PluginsSection';
import { PrivacySection } from './settings/PrivacySection';
import { AdvancedSection } from './settings/AdvancedSection';
import { FeedbackSection } from './settings/FeedbackSection';
import { GitWorktreeSection } from './settings/GitWorktreeSection';
import { ShortcutsSection } from './settings/ShortcutsSection';
import { UpdatesSection } from './settings/UpdatesSection';
import { LogsSection } from './settings/LogsSection';
import { EvidenceSection } from './settings/EvidenceSection';
// v11.10 — approvals manager (always-rules list + revoke + Full access toggle)
import { ApprovalsSection } from './settings/ApprovalsSection';
import type { AppSettings } from '../../shared/types';

// ---- v10.3 — Codex-grade flat sections: every feature gets its own pane ----
type GroupId =
  | 'general' | 'appearance' | 'notifications' | 'voice'
  | 'agent' | 'privacy' | 'memory'
  | 'models' | 'providers'
  | 'mcp' | 'plugins' | 'apiServer' | 'remote' | 'preview'
  | 'editor' | 'terminal' | 'git'
  | 'account' | 'shortcuts' | 'evidence' | 'feedback' | 'updates' | 'logs' | 'advanced'
  // v11.10 — approvals manager
  | 'approvals';

const GROUPS: {
  id: GroupId;
  no: string;
  icon: LucideIcon;
  key: string;
  fb: string;
  /** Optional Arabic fallback for keys that are NOT in the i18n dict yet. */
  fbAr?: string;
  descKey: string;
  descFb: string;
}[] = [
  {
    id: 'general', no: '01', icon: Settings2,
    key: 'set.group.general', fb: 'General', fbAr: 'عام',
    descKey: 'set.group.general.desc', descFb: 'Language, permissions, checkpoints, onboarding and recent projects.',
  },
  {
    id: 'appearance', no: '02', icon: Palette,
    key: 'set.group.appearance', fb: 'Appearance', fbAr: 'المظهر',
    descKey: 'set.group.appearance.desc', descFb: 'Theme, accent, glass, density, motion and fonts.',
  },
  {
    id: 'notifications', no: '03', icon: Bell,
    key: 'set.group.notifications', fb: 'Notifications', fbAr: 'التنبيهات',
    descKey: 'set.group.notifications.desc', descFb: 'Run completion, tray behavior and desktop alerts.',
  },
  {
    id: 'voice', no: '04', icon: Mic,
    key: 'set.group.voice', fb: 'Voice', fbAr: 'الصوت',
    descKey: 'set.group.voice.desc', descFb: 'Microphone input, transcription provider and voice test.',
  },
  {
    id: 'agent', no: '05', icon: Bot,
    key: 'set.group.agent', fb: 'Agent', fbAr: 'الوكيل',
    descKey: 'set.group.agent.desc', descFb: 'Engine loop, turns, caching, router and verification.',
  },
  {
    id: 'privacy', no: '06', icon: ShieldCheck,
    key: 'set.group.privacy', fb: 'Privacy & Security', fbAr: 'الخصوصية والأمان',
    descKey: 'set.group.privacy.desc', descFb: 'Telemetry, taint scanning, network allowlist and gates.',
  },
  {
    id: 'memory', no: '07', icon: Brain,
    key: 'set.group.memory', fb: 'Skills & Memory', fbAr: 'المهارات والذاكرة',
    descKey: 'set.group.memory.desc', descFb: 'Agent skills, memory scope and trust rules.',
  },
  {
    id: 'models', no: '08', icon: Gauge,
    key: 'set.group.models', fb: 'Models', fbAr: 'النماذج',
    descKey: 'set.group.models.desc', descFb: 'Active model, reasoning depth, tokens and temperature.',
  },
  {
    id: 'providers', no: '09', icon: KeyRound,
    key: 'set.group.providers', fb: 'Providers', fbAr: 'المزوّدون',
    descKey: 'set.group.providers.desc', descFb: 'API keys, base URLs, live model lists.',
  },
  {
    id: 'mcp', no: '10', icon: Plug,
    key: 'set.group.mcp', fb: 'MCP', fbAr: 'خوادم MCP',
    descKey: 'set.group.mcp.desc', descFb: 'Model Context Protocol servers and their tools.',
  },
  {
    id: 'plugins', no: '11', icon: Puzzle,
    key: 'set.group.plugins', fb: 'Plugins', fbAr: 'الإضافات',
    descKey: 'set.group.plugins.desc', descFb: 'Install and manage capability plugins.',
  },
  {
    id: 'apiServer', no: '12', icon: Server,
    key: 'set.group.apiServer', fb: 'API Server', fbAr: 'خادم API',
    descKey: 'set.group.apiServer.desc', descFb: 'Loopback control API with bearer auth.',
  },
  {
    id: 'remote', no: '13', icon: Smartphone,
    key: 'set.group.remote', fb: 'SADEEM Remote (Phone)', fbAr: 'سديم عن بُعد (الهاتف)',
    descKey: 'set.group.remote.desc', descFb: 'Control the agent from your phone: QR pairing, live feed, approvals.',
  },
  {
    id: 'preview', no: '14', icon: MonitorPlay,
    key: 'set.group.preview', fb: 'Live Preview', fbAr: 'المعاينة الحية',
    descKey: 'set.group.preview.desc', descFb: 'Dev servers (Node, Python, custom), console and zoom.',
  },
  {
    id: 'editor', no: '15', icon: PenLine,
    key: 'set.group.editor', fb: 'Editor', fbAr: 'المحرر',
    descKey: 'set.group.editor.desc', descFb: 'Ghost suggestions, minimap, wrap and indentation.',
  },
  {
    id: 'terminal', no: '16', icon: TerminalSquare,
    key: 'set.group.terminal', fb: 'Terminal', fbAr: 'الطرفية',
    descKey: 'set.group.terminal.desc', descFb: 'Shell, fonts and the command guard.',
  },
  {
    id: 'git', no: '17', icon: FolderGit2,
    key: 'set.group.git', fb: 'Git & Worktrees', fbAr: 'Git وأشجار العمل',
    descKey: 'set.group.git.desc', descFb: 'Worktrees, isolated parallel tasks and merging.',
  },
  {
    id: 'account', no: '18', icon: User,
    key: 'set.group.account.full', fb: 'Account & Billing', fbAr: 'الحساب والفوترة',
    descKey: 'set.group.account.desc', descFb: 'Profile, license, plans and usage on this device.',
  },
  {
    id: 'shortcuts', no: '19', icon: Keyboard,
    key: 'set.group.shortcuts', fb: 'Keyboard Shortcuts', fbAr: 'اختصارات لوحة المفاتيح',
    descKey: 'set.group.shortcuts.desc', descFb: 'Every shortcut, searchable, with the overlay.',
  },
  {
    id: 'evidence', no: '20', icon: Fingerprint,
    key: 'set.group.evidence', fb: 'Evidence', fbAr: 'الأدلة',
    descKey: 'set.group.evidence.desc', descFb: 'Signed proof packages and the False-Done ledger, read-only.',
  },
  {
    id: 'feedback', no: '21', icon: MessageSquare,
    key: 'set.group.feedback', fb: 'Feedback', fbAr: 'الملاحظات',
    descKey: 'set.group.feedback.desc', descFb: 'Send feedback and review past reports.',
  },
  {
    id: 'updates', no: '22', icon: RefreshCcw,
    key: 'set.group.updates', fb: 'Updates', fbAr: 'التحديثات',
    descKey: 'set.group.updates.desc', descFb: 'Check for releases, feed URL, auto-check and install.',
  },
  {
    id: 'logs', no: '23', icon: FileText,
    key: 'set.group.logs', fb: 'Logs', fbAr: 'السجلات',
    descKey: 'set.group.logs.desc', descFb: 'Diagnostics log level, folder, export and clear.',
  },
  {
    id: 'advanced', no: '24', icon: Wrench,
    key: 'set.group.advanced', fb: 'Advanced', fbAr: 'متقدم',
    descKey: 'set.group.advanced.desc', descFb: 'Environment, diagnostics, statistics and danger zone.',
  },
  {
    // v11.10 — approvals manager (founder complaint #1)
    id: 'approvals', no: '25', icon: ShieldCheck,
    key: 'set.group.approvals', fb: 'Approvals', fbAr: 'الموافقات',
    descKey: 'set.group.approvals.desc', descFb: 'Always-allow rules with revoke + the Full access master switch.',
  },
];

/** Group title: dict value when present, else the bilingual fallback. */
function groupLabel(
  g: (typeof GROUPS)[number],
  lang: 'ar' | 'en',
  t: (key: string, fallback?: string) => string,
): string {
  return t(g.key, lang === 'ar' && g.fbAr ? g.fbAr : g.fb);
}

/**
 * Legacy 16-pane ids → owning group (regroup, never delete).
 * B1 FIX: the GROUP ids themselves are mapped too — deep links may
 * arrive as either a group id ('account') or a legacy id ('billing').
 * 'account' and 'integrations' were missing before, so resolveGroup
 * fell back to 'general' and clobbered those deep links while open.
 */
const SECTION_TO_GROUP: Record<string, GroupId> = {
  // v10.3 — flat sections: every pane IS its own group (deep links land 1:1)
  general: 'general',
  appearance: 'appearance',
  notifications: 'notifications',
  voice: 'voice',
  agent: 'agent',
  privacy: 'privacy',
  security: 'privacy', // legacy alias
  memory: 'memory',
  models: 'models',
  providers: 'providers',
  mcp: 'mcp',
  plugins: 'plugins',
  apiServer: 'apiServer',
  remote: 'remote',
  preview: 'preview',
  editor: 'editor',
  terminal: 'terminal',
  git: 'git',
  account: 'account',
  billing: 'account', // legacy alias
  shortcuts: 'shortcuts',
  evidence: 'evidence',
  proof: 'evidence', // legacy alias
  artifacts: 'evidence', // legacy alias
  logs: 'logs',
  diagnostics: 'logs', // legacy alias
  feedback: 'feedback',
  updates: 'updates',
  advanced: 'advanced',
  about: 'advanced', // legacy alias
  integrations: 'mcp', // legacy group id → first pane
  approvals: 'approvals', // v11.10 — approvals manager
  permissions: 'approvals', // v11.10 — legacy alias
};

function resolveGroup(raw: string | undefined): GroupId {
  const s = raw ?? 'general';
  return SECTION_TO_GROUP[s] ?? 'general';
}

// ---- posture matching (which preset is currently in force?) ----
/** Value compare that also handles arrays/objects (mutationGate, allowlist). */
function postureValEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when every key the preset patches currently equals that value. */
function postureMatches(settings: AppSettings, patch: SecurityPreset['patch']): boolean {
  const flat = settings as unknown as Record<string, unknown>;
  const agentFlat = (settings.agent ?? {}) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'agent') {
      for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
        if (!postureValEq(agentFlat[ak], av)) return false;
      }
    } else if (!postureValEq(flat[k], v)) {
      return false;
    }
  }
  return true;
}

export function SettingsModal() {
  const t = useT();
  const open = useStore((s) => s.settingsOpen);
  const rawSection = useStore((s) => s.settingsSection);
  const setSettings = useStore((s) => s.setSettings);
  const lang = useStore((s) => s.settings.language);
  const reduceMotion = useStore((s) => s.settings.ui?.reduceMotion === true);
  const compact = useStore((s) => s.settings.ui?.compact === true);

  const [query, setQuery] = useState('');
  // B1: the visible group lives in LOCAL state so both the deep-link
  // listener and rail clicks switch it synchronously, without a store
  // round-trip (and without depending on how setSettings merges).
  const [group, setGroup] = useState<GroupId>(() => resolveGroup(rawSection));
  const searchRef = useRef<HTMLInputElement>(null);
  const railRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeGroup = GROUPS.find((g) => g.id === group) ?? GROUPS[0];

  /** One switch point for every entry path (rail, search, deep links). */
  const selectGroup = (id: GroupId) => {
    setQuery('');
    setGroup(id);
    // keep the store in sync so external surfaces (palette, send() guards)
    // observe the same group; the modal itself no longer READS this live.
    setSettings(true, id);
  };

  // A deep link / external caller may change settingsSection while the
  // modal is open (store send()-guards, CommandPalette) or while closed.
  // Mirror it into local state; group ids all resolve now, so this can
  // never bounce back to 'general' anymore.
  useEffect(() => {
    setGroup(resolveGroup(rawSection));
  }, [rawSection, open]);

  // Deep links / search jumps may select a section off-screen. Keep the
  // active nav item visible with a smooth, nearest-edge scroll.
  useEffect(() => {
    const idx = GROUPS.findIndex((g) => g.id === group);
    if (idx >= 0) railRefs.current[idx]?.scrollIntoView({ block: 'nearest' });
  }, [group]);

  // focus the search box whenever the page opens; drop stale queries
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const id = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open]);

  // surnia:open-settings {detail:{section}} — deep links land here.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: string }>).detail;
      // resolve FIRST, drive local state directly — the switch is instant
      // even while the modal is already open.
      const g = resolveGroup(detail?.section);
      setGroup(g);
      setSettings(true, g);
    };
    window.addEventListener('surnia:open-settings', onOpen);
    return () => window.removeEventListener('surnia:open-settings', onOpen);
  }, [setSettings]);

  // Esc closes the full page (search query clears first)
  const queryRef = useRef('');
  queryRef.current = query;
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (queryRef.current) setQuery('');
      else setSettings(false);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, setSettings]);

  // document-level class sync (works even while closed)
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);
  useEffect(() => {
    document.documentElement.classList.toggle('compact-ui', compact);
  }, [compact]);

  // ---- search (bilingual registry; hits jump to the owning GROUP) ----
  const hits = useMemo(() => searchSettings(query), [query]);
  const grouped = useMemo(() => {
    const map = new Map<GroupId, SettingEntry[]>();
    for (const h of hits) {
      const g = resolveGroup(h.section);
      const arr = map.get(g) ?? [];
      arr.push(h);
      map.set(g, arr);
    }
    return GROUPS.filter((g) => map.has(g.id)).map((g) => ({ group: g, items: map.get(g.id) ?? [] }));
  }, [hits]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // Esc belongs to the search box first, then the page
    if (e.key === 'Escape') {
      if (query) setQuery('');
      else setSettings(false);
    } else if (e.key === 'Enter' && hits.length > 0) {
      selectGroup(resolveGroup(hits[0].section));
    }
  };

  // ---- rail keyboard navigation ----
  const onRailKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
    const clamped = Math.max(0, Math.min(GROUPS.length - 1, next));
    railRefs.current[clamped]?.focus();
  };

  if (!open) return null;

  return (
    <div
      className="set-overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && setSettings(false)}
    >
      <div
        className="set-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title', 'Settings')}
      >
        {/* ---------- header: title · search · close ---------- */}
        <header className="set-head">
          <div className="set-head-brand">
            <span className="set-head-tt">{t('settings.title', 'Settings')}</span>
            <span className="set-head-sub" dir="auto">
              {t(activeGroup.descKey, activeGroup.descFb)}
            </span>
          </div>
          <span className="flex-1" />
          <div className="set-search">
            <Search size={14} aria-hidden className="set-search-ic" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={t('settings.search', 'Search settings…')}
              aria-label={t('settings.search', 'Search settings…')}
              className="set-search-input"
              dir="auto"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button className="ibtn !w-9 !h-9" onClick={() => setSettings(false)} aria-label={t('ui.close', 'Close')}>
            <X size={17} />
          </button>
        </header>

        {/* ---------- posture strip (3 postures, ~10 real keys each) ---------- */}
        <PostureStrip />

        <div className="set-body">
          {/* ---- glass nav rail: icon + title + one-line description ---- */}
          <nav aria-label={t('settings.title', 'Settings')} className="set-rail set-scroll">
            <div className="set-rail-label caps">
              <span>{t('set.rail.sections', 'Sections')}</span>
              <span className="tnum">{String(GROUPS.length).padStart(2, '0')}</span>
            </div>
            {GROUPS.map((g, i) => (
              <button
                key={g.id}
                ref={(el) => {
                  railRefs.current[i] = el;
                }}
                onClick={() => selectGroup(g.id)}
                onKeyDown={(e) => onRailKeyDown(e, i)}
                aria-current={group === g.id ? 'page' : undefined}
                className={`set-nav-item${group === g.id ? ' is-active' : ''}`}
                title={t(g.descKey, g.descFb)}
              >
                <span className="set-nav-ic" aria-hidden>
                  <g.icon size={15} />
                </span>
                <span className="set-nav-tt">
                  <span className="set-no caps tnum" aria-hidden>
                    {g.no}
                  </span>
                  {groupLabel(g, lang, t)}
                </span>
              </button>
            ))}
          </nav>

          {/* ---- small-screen group bar (rail is hidden below 760px) ---- */}
          <div className="set-groupbar set-scroll" role="tablist" aria-label={t('settings.title', 'Settings')}>
            {GROUPS.map((g) => (
              <button
                key={g.id}
                role="tab"
                aria-selected={group === g.id}
                onClick={() => selectGroup(g.id)}
                className={`set-group-pill${group === g.id ? ' is-active' : ''}`}
              >
                <g.icon size={13} aria-hidden />
                {groupLabel(g, lang, t)}
              </button>
            ))}
          </div>

          {/* ---- content column ---- */}
          <div className="set-content set-scroll" role="region" aria-live="polite">
            {query.trim() ? (
              <SearchResults grouped={grouped} total={hits.length} query={query} onJump={selectGroup} />
            ) : (
              <ActiveGroup id={group} onJump={selectGroup} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- posture strip (single segmented control) ----------------
function PostureStrip() {
  const t = useT();
  const notify = useStore((s) => s.notify);
  const settings = useStore((s) => s.settings);
  const lang = useStore((s) => s.settings.language);

  // Which posture is currently in force? Exact match over every patched
  // key — nothing matches → honest "Custom mix" hint, never a fake active.
  const matched = useMemo<PresetId | null>(() => {
    for (const p of SECURITY_PRESETS) {
      if (postureMatches(settings, p.patch)) return p.id;
    }
    return null;
  }, [settings]);

  const apply = (id: PresetId) => {
    if (applyPreset(id)) {
      const preset = SECURITY_PRESETS.find((p) => p.id === id);
      notify(t('set.presets.applied', 'Preset applied: {name}', { name: t(preset?.labelKey ?? id, id) }));
    }
  };

  return (
    <div className="set-posture">
      <span className="caps set-posture-label">{t('set.posture.title', lang === 'ar' ? 'النمط' : 'Posture')}</span>
      <div className="set-posture-seg" role="radiogroup" aria-label={t('set.presets.title', 'Safety presets')}>
        {PRESET_IDS.map((id) => {
          const preset = SECURITY_PRESETS.find((p) => p.id === id);
          if (!preset) return null;
          const isSafe = id === 'safe';
          const isIndy = id === 'indy';
          return (
            <button
              key={id}
              role="radio"
              aria-checked={matched === id}
              title={preset.summary.join(' · ')}
              onClick={() => apply(id)}
              className={`set-posture-btn${matched === id ? ' is-active' : ''}`}
            >
              {isSafe ? (
                <ShieldCheck size={12} className="set-posture-ic is-safe" aria-hidden />
              ) : isIndy ? (
                <Wind size={12} className="set-posture-ic is-indy" aria-hidden />
              ) : (
                <Scale size={12} className="set-posture-ic is-balanced" aria-hidden />
              )}
              {t(preset.labelKey, id)}
            </button>
          );
        })}
      </div>
      {!matched && (
        <span className="set-posture-custom" dir="auto">
          {t('set.posture.custom', lang === 'ar' ? 'مزيج مخصص' : 'Custom mix')}
        </span>
      )}
      <span className="set-posture-sub" dir="auto">
        {t('set.presets.sub', 'One click applies a coherent posture across ~10 engine keys — adjust anything after.')}
      </span>
    </div>
  );
}

// ---------------- search results ----------------
function SearchResults({
  grouped,
  total,
  query,
  onJump,
}: {
  grouped: { group: (typeof GROUPS)[number]; items: SettingEntry[] }[];
  total: number;
  query: string;
  onJump: (id: GroupId) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);

  if (total === 0) {
    return (
      <div className="blank-state">
        <SearchX size={22} className="text-faint" aria-hidden />
        <div className="bs-title">{t('settings.search.empty', 'No matching settings')}</div>
        <div className="bs-sub">
          {t('settings.search.emptyHint', 'Try another term — matches both English and Arabic labels.')}
          <span className="sr-only">{query}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-2">
      {grouped.map(({ group, items }) => (
        <div key={group.id}>
          <button
            onClick={() => onJump(group.id)}
            className="set-hit-group"
          >
            <span className="tnum set-hit-no">{group.no}</span>
            <group.icon size={12} aria-hidden />
            {groupLabel(group, lang, t)}
            <span className="opacity-70 tnum">({items.length})</span>
          </button>
          <div className="flex flex-col gap-1.5">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => onJump(group.id)}
                className="set-hit"
              >
                <span className="text-[12.5px] truncate">{lang === 'ar' ? it.ar : it.en}</span>
                <span className="set-hit-owner">{groupLabel(group, lang, t)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- router summary card (top of the Models group) ----------------
function RouterSummaryCard({ onJump }: { onJump: (id: GroupId) => void }) {
  const t = useT();
  const model = useStore((s) => s.settings.model);
  // B1 selector audit — React #185 guard: the selector returns the STABLE
  // `settings.agent` object; the `?? {}` coalescing happens in render, never
  // inside the selector, so useSyncExternalStore always sees one snapshot.
  const agent = useStore((s) => s.settings.agent);
  const roles = agent?.modelRoles ?? {};
  const roleIds = ['plan', 'search', 'edit', 'verify', 'context'] as const;
  const set = roleIds.filter((r) => roles[r]);
  return (
    <div className="aurora-panel set-card">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="caps text-[10.5px] text-[var(--faint)]">{t('set.router.summary', 'Model routing')}</span>
        <span className="text-[10px] text-faint" dir="auto">
          {t('set.router.summary.sub', 'Role → model map the engine uses for each step. Unset roles use the session model.')}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {roleIds.map((r) => {
          const cfg = roles[r];
          return (
            <span key={r} className="stamp !h-[18px] max-w-[30ch]" title={cfg ? `${cfg.provider} · ${cfg.model}` : t('settings.agent.router.sessionDefault', 'session default')}>
              <span className="text-[9px] uppercase tracking-wider opacity-75">{t(`set.router.role.${r}`, r)}</span>
              <span className="bidi-num font-code text-[9.5px] truncate min-w-0" dir="ltr">
                {cfg ? cfg.model : t('settings.agent.router.sessionDefault', 'session default')}
              </span>
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-[10px] text-faint" dir="auto">
          {`${t('settings.agent.router.session', 'Session model')}: ${model.provider}/${model.model} · ${set.length}/5`}
        </span>
        <button
          className="text-[10.5px] text-acc hover:underline cursor-pointer ms-auto"
          onClick={() => onJump('agent')}
        >
          {t('set.router.edit', 'Edit routing in Agent & Security')}
        </button>
      </div>
    </div>
  );
}

// ---------------- active group body ----------------
// v11 note: every section pane opens with its own SectionShell header
// (number + title + one-line desc), so no extra page-level header —
// the earlier one duplicated it visually. The rail keeps native
// tooltips for the descriptions.
function ActiveGroup({ id, onJump }: { id: GroupId; onJump: (id: GroupId) => void }) {
  return <ActiveGroupBody id={id} onJump={onJump} />;
}

function ActiveGroupBody({ id, onJump }: { id: GroupId; onJump: (id: GroupId) => void }) {
  switch (id) {
    case 'general':
      return <GeneralSection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'notifications':
      return <NotificationsSection />;
    case 'voice':
      return <VoiceSection />;
    case 'agent':
      return <AgentSection />;
    case 'privacy':
      return <PrivacySection />;
    case 'memory':
      return <SkillsMemorySection />;
    case 'models':
      return <ModelsSection />;
    case 'providers':
      return <ModelsSection providersOnly />;
    case 'mcp':
      return <McpSection />;
    case 'plugins':
      return <PluginsSection />;
    case 'apiServer':
      return <ApiServerSection />;
    case 'remote':
      return <RemoteSection />;
    case 'preview':
      return <PreviewSection />;
    case 'editor':
      return <EditorSection />;
    case 'terminal':
      return <TerminalSection />;
    case 'git':
      return <GitWorktreeSection />;
    case 'account':
      return <BillingSection />;
    case 'shortcuts':
      return <ShortcutsSection />;
    case 'evidence':
      return <EvidenceSection />;
    case 'logs':
      return <LogsSection />;
    case 'updates':
      return <UpdatesSection />;
    case 'feedback':
      return <FeedbackSection />;
    case 'advanced':
      return <AdvancedSection />;
    case 'approvals':
      return <ApprovalsSection />;
    default:
      return <GeneralSection />;
  }
}

export default SettingsModal;

// ============================================================
// STORE-SIDE NOTES for the integrator (B1 — read-only findings on
// src/store.ts; NOT edited here):
//  • setSettings(o, section?) = set({ settingsOpen: o, ...(section
//    ? { settingsSection: section } : {}) }) — callers WITHOUT a
//    section (Rail button, ⌘, 'settings' menu action) keep the
//    previous settingsSection; the modal now owns the group, so
//    reopening "just shows the last group" (unchanged behaviour).
//  • The real deep-link bug was resolveGroup() in THIS file (group
//    ids 'account'/'integrations' missing from SECTION_TO_GROUP) —
//    no store change is required. If the integrator wants belt-and-
//    braces, normalizing settingsSection to a GroupId inside
//    setSettings would also fix it store-side; the modal tolerates
//    either form.
// ============================================================
