// SADEEM — Welcome, v11.8: the workspace-gate hero ("Deep Space Precision").
// A confident start page: SADEEM logo plate + version stamp + brand wordmark,
// display heading (font-display) with a quiet subline, three premium flat
// starter cards wired ONLY to existing store behaviors (open folder / new
// project wizard / clone dialog), a "Connect an AI model" + "Security level"
// panel row (ModelPicker / Settings→security deep link — both existing
// handlers), recent project cards from settings.recentPaths (existing
// openWorkspace action) and the "Enter SADEEM" primary gate button
// (launches the most recent project, else opens the folder dialog —
// existing actions only). Depth comes from the sa18-* shadow tokens; the
// hero band uses the single sanctioned 2-stop ambient (--sa18-hero-amb).
// Flat premium surfaces, token-only colors, lucide icons, bilingual
// t(key, fallback) pairs, dir="auto" on dynamic text. WorkspaceGate renders
// this full-stage under the title bar — the root scroll container stays
// h-full.
import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  FilePlus2,
  FolderOpen,
  GitBranch,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useStore, PROVIDER_PRESETS } from '../store';
import { useT } from '../i18n';
import { APP_VERSION } from '../version';
import { Logo } from './Logo';
import { IconTile } from './icons';
import { Kbd, MOD_KEY } from './ui';
// v11.11 (A9) — hand-authored empty-state illustration (license-clean SVG)
import emptySessions from '../assets/illustrations/empty-sessions.svg';
import type { PermissionMode } from '../../shared/types';

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** "Anthropic (Claude)" → "Anthropic" (same rule the TitleBar pill uses). */
const shortProvider = (label: string): string => label.replace(/\s*\(.*\)$/, '').trim();

/** Capability stamps preserved from the previous welcome (keys exist). */
const CAPS: { key: string; fb: string; tipKey: string; tipFb: string }[] = [
  {
    key: 'welcome.cap.multi',
    fb: 'Multi-provider',
    tipKey: 'welcome.f4',
    tipFb: 'Claude, GPT, Gemini, GLM, DeepSeek, Ollama & more',
  },
  { key: 'welcome.cap.mcp', fb: 'MCP', tipKey: 'welcome.f5', tipFb: 'MCP tools & subagents' },
  {
    key: 'welcome.cap.local',
    fb: 'Local-first',
    tipKey: 'auth.point.privacy',
    tipFb: 'Local-first: keys are encrypted, code never leaves this device',
  },
];

/** Permission-mode label keys — identical mapping to the TitleBar pill. */
const PERM_LABEL_KEY: Record<PermissionMode, string> = {
  plan: 'tb.mode.plan',
  default: 'tb.mode.default',
  autoEdit: 'tb.mode.autoEdit',
  fullAccess: 'tb.mode.fullAccess',
};
const PERM_LABEL_FB: Record<PermissionMode, string> = {
  plan: 'Plan',
  default: 'Ask',
  autoEdit: 'Auto-edit',
  fullAccess: 'Full access',
};

export function Welcome() {
  const t = useT();

  /* ---------- store (existing actions only) ---------- */
  const recentPaths = useStore((s) => s.settings.recentPaths);
  const openWorkspace = useStore((s) => s.openWorkspace);
  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const setNewProject = useStore((s) => s.setNewProject);
  const setCloneOpen = useStore((s) => s.setCloneOpen);
  const setPalette = useStore((s) => s.setPalette);
  const setModelPicker = useStore((s) => s.setModelPicker);
  const setSettings = useStore((s) => s.setSettings);
  const model = useStore((s) => s.settings.model);
  const permMode = useStore((s) => s.settings.permissionMode);
  const account = useStore((s) => s.account);
  const signOut = useStore((s) => s.signOut);

  /* ---------- starter actions — existing store behaviors only ---------- */
  const ACTIONS: {
    id: string;
    icon: React.ReactNode;
    titleKey: string;
    titleFb: string;
    subKey: string;
    subFb: string;
    run: () => void;
  }[] = [
    {
      id: 'open',
      icon: <FolderOpen size={15} strokeWidth={1.7} />,
      titleKey: 'welcome.open',
      titleFb: 'Open folder',
      subKey: 'welcome.openDesc',
      subFb: 'Work on any folder on this machine',
      run: () => void openFolderDialog(),
    },
    {
      id: 'new',
      icon: <FilePlus2 size={15} strokeWidth={1.7} />,
      titleKey: 'welcome.newProject',
      titleFb: 'New project',
      subKey: 'welcome.newProjectDesc',
      subFb: 'Create a project from scratch with the AI',
      run: () => setNewProject(true),
    },
    {
      id: 'clone',
      icon: <GitBranch size={15} strokeWidth={1.7} />,
      titleKey: 'welcome.clone',
      titleFb: 'Clone repository',
      subKey: 'welcome.cloneDesc',
      subFb: 'git clone from any URL',
      run: () => setCloneOpen(true),
    },
  ];

  /* ---------- launchpad panels — ModelPicker + Settings deep link ---------- */
  const modelProvider = shortProvider(PROVIDER_PRESETS[model.provider]?.label ?? model.provider);
  const PANELS: {
    id: string;
    icon: React.ReactNode;
    titleKey: string;
    titleFb: string;
    meta: React.ReactNode;
    ltr: boolean;
    run: () => void;
  }[] = [
    {
      id: 'model',
      icon: <Sparkles size={15} strokeWidth={1.7} />,
      titleKey: 'welcome.wt.model',
      titleFb: 'Connect an AI model',
      meta: (
        <span className="truncate min-w-0">
          {modelProvider} · <span className="font-code">{model.model}</span>
        </span>
      ),
      ltr: true,
      run: () => setModelPicker(true),
    },
    {
      id: 'security',
      icon: <ShieldCheck size={15} strokeWidth={1.7} />,
      titleKey: 'onboard.step.security',
      titleFb: 'Security level',
      meta: <span className="truncate min-w-0">{t(PERM_LABEL_KEY[permMode], PERM_LABEL_FB[permMode])}</span>,
      ltr: false,
      run: () => setSettings(true, 'security'),
    },
  ];

  /* ---------- Enter SADEEM — launch the most recent project, else the
     folder dialog (both existing actions; hint key exists). ---------- */
  const launchTarget = recentPaths[0];
  const enterSadeem = () => {
    if (launchTarget) void openWorkspace(launchTarget);
    else void openFolderDialog();
  };

  return (
    <div className="h-full overflow-y-auto relative set-scroll">
      {/* sanctioned hero ambient — token-derived, 2 stops, ≤6% alpha (guide §1b) */}
      <div aria-hidden className="w18-amb absolute inset-x-0 top-0 h-[420px] pointer-events-none" />

      <div className="relative w-full max-w-[680px] mx-auto px-6 pt-16 pb-12 anim-in">
        {/* ══════════════════════════════════════════════════
            HERO — logo plate · brand wordmark · display heading
            ══════════════════════════════════════════════════ */}
        <header className="flex flex-col items-center text-center">
          <span className="w18-plate" aria-hidden>
            <Logo size={52} />
          </span>
          <div className="flex items-center gap-2.5 mt-5 select-none">
            <span
              className="aurora-gradient-text font-display text-[13px] font-bold tracking-[0.22em] leading-none"
              dir="ltr"
            >
              {t('app.name', 'SADEEM')}
            </span>
            <span
              className="stamp tnum !h-[16px] !text-[9px]"
              dir="ltr"
              title={t('ck.hero.verTip', 'Version {v}', { v: APP_VERSION })}
            >
              v{APP_VERSION}
            </span>
          </div>
          <h1 className="w18-title mt-4 max-w-[22ch]" dir="auto">
            {t('welcome.title', 'Build at the speed of thought')}
          </h1>
          <p className="w18-sub mt-2.5" dir="auto">
            {t(
              'welcome.sub',
              'An agentic workstation that proves its work — plans, edits, verifies, shows the diff.',
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
            {CAPS.map(({ key, fb, tipKey, tipFb }) => (
              <span key={key} className="glass-pill cursor-default" title={t(tipKey, tipFb)}>
                <span dir="auto">{t(key, fb)}</span>
              </span>
            ))}
          </div>
        </header>

        {/* ══════════════════════════════════════════════════
            STARTER CARDS · open folder / new project / clone
            ══════════════════════════════════════════════════ */}
        <section className="mt-10" aria-label={t('welcome.quick.title', 'Quick start')}>
          <div className="grid sm:grid-cols-3 gap-3">
            {ACTIONS.map(({ id, icon, titleKey, titleFb, subKey, subFb, run }) => (
              <button
                key={id}
                type="button"
                className="w18-card p-4 text-start cursor-pointer group min-w-0 flex flex-col gap-3"
                onClick={run}
                aria-label={t(titleKey, titleFb)}
              >
                <span className="flex items-center justify-between gap-2">
                  <IconTile icon={icon} tone="var(--acc)" size={34} />
                  <ArrowUpRight
                    size={14}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flip-rtl"
                    style={{ color: 'var(--acc)' }}
                    aria-hidden
                  />
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-[13px] font-semibold text-[var(--ink)] truncate group-hover:text-[var(--acc)] transition-colors"
                    dir="auto"
                  >
                    {t(titleKey, titleFb)}
                  </span>
                  <span className="block text-[10.5px] text-faint leading-snug mt-1 line-clamp-2" dir="auto">
                    {t(subKey, subFb)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* connect a model · security level — same flat-card voice */}
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            {PANELS.map(({ id, icon, titleKey, titleFb, meta, ltr, run }) => (
              <button
                key={id}
                type="button"
                className="w18-card group flex items-center gap-3 p-3.5 text-start cursor-pointer min-w-0"
                onClick={run}
                aria-label={t(titleKey, titleFb)}
              >
                <IconTile icon={icon} tone="var(--acc2)" size={34} />
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-[12.5px] font-semibold text-[var(--ink)] truncate group-hover:text-[var(--acc)] transition-colors"
                    dir="auto"
                  >
                    {t(titleKey, titleFb)}
                  </span>
                  <span
                    className="block text-[10.5px] text-faint truncate mt-1"
                    dir={ltr ? 'ltr' : 'auto'}
                  >
                    {meta}
                  </span>
                </span>
                <ArrowUpRight
                  size={14}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flip-rtl"
                  style={{ color: 'var(--acc)' }}
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════
            RECENT PROJECTS · settings.recentPaths via openWorkspace
            ══════════════════════════════════════════════════ */}
        <section className="mt-10" aria-label={t('welcome.recent', 'Recent projects')}>
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <span className="caps caps-md text-[var(--ink)]">{t('welcome.recent', 'Recent projects')}</span>
            <span className="text-[10.5px] text-faint" dir="auto">
              {t('ck.recent.sub', 'Pick up where you left off')}
            </span>
          </div>
          {recentPaths.length === 0 ? (
            <div
              className="w18-card blank-state !py-7"
              style={{ borderStyle: 'dashed', boxShadow: 'none' }}
            >
              {/* v11.11 delight — the calm lantern (transform/opacity anim only) */}
              <img
                src={emptySessions}
                alt=""
                aria-hidden
                width={168}
                height={116}
                style={{ marginBottom: 2, borderRadius: 12 }}
              />
              <div className="bs-title !text-[13px]" dir="auto">
                {t('welcome.noRecent', 'No recent projects yet')}
              </div>
              <div className="bs-sub" dir="auto">
                {t('ck.recent.empty.sub', 'Open a folder — it will be listed here.')}
              </div>
              <button type="button" className="btn press mt-1" onClick={() => void openFolderDialog()}>
                <FolderOpen size={13} strokeWidth={1.8} />
                {t('welcome.open', 'Open folder')}
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {recentPaths.slice(0, 6).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="w18-card group p-3 text-start cursor-pointer min-w-0 flex items-center gap-2.5"
                  title={p}
                  onClick={() => void openWorkspace(p)}
                >
                  <IconTile icon={<FolderOpen size={15} strokeWidth={1.7} />} tone="var(--acc2)" size={34} />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-[12.5px] font-semibold truncate text-[var(--ink)] group-hover:text-[var(--acc)] transition-colors"
                      dir="auto"
                    >
                      {baseName(p)}
                    </span>
                    <span className="block text-[10px] text-faint truncate font-code mt-0.5" dir="ltr">
                      {p}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1.5 shrink-0">
                    <ArrowUpRight
                      size={14}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flip-rtl"
                      style={{ color: 'var(--acc)' }}
                      aria-hidden
                    />
                    <span
                      className="text-[9px] uppercase tracking-widest text-faint group-hover:text-dim transition-colors"
                      dir="auto"
                    >
                      {t('welcome.recent.open', 'Open project')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ---------- gate CTA: Enter SADEEM (primary, acc fill + acc-ink) ---------- */}
        <div className="mt-10 flex flex-col items-center gap-2.5">
          <button
            type="button"
            className="btn btn-primary press !h-10 !px-8 !text-[13.5px] !rounded-full"
            onClick={enterSadeem}
            title={launchTarget ? t('welcome.launchHint', 'launch on recent project') : undefined}
          >
            <ArrowRight size={15} strokeWidth={1.9} className="flip-rtl" aria-hidden />
            {t('onboard.enter', 'Enter SADEEM')}
          </button>
        </div>

        {/* ---------- footer: palette hint + local note + (dormant) account ---------- */}
        <footer className="mt-8 pt-5" style={{ borderTop: '1px solid var(--line-soft)' }}>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <button
              type="button"
              className="flex items-center gap-2 text-[11px] text-faint hover:text-dim transition-colors cursor-pointer"
              onClick={() => setPalette(true)}
            >
              <Kbd>{MOD_KEY}</Kbd>
              <span className="tnum text-[10.5px]">K</span>
              <span dir="auto">{t('welcome.hint.palette', 'Command palette')}</span>
            </button>
            <span className="flex items-center gap-2 text-[11px] text-faint">
              <Logo size={13} />
              <span dir="auto">{t('welcome.local', 'SADEEM — runs locally on your machine')}</span>
            </span>
            {account && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11px] text-faint hover:text-dim transition-colors cursor-pointer"
                onClick={() => void signOut()}
              >
                <X size={11} aria-hidden />
                <span dir="auto">
                  {t('auth.hello', 'Hello, {name}').replace('{name}', account.name || 'SADEEM')}
                </span>
                <span className="underline decoration-dotted underline-offset-2" dir="auto">
                  {t('welcome.signOut', 'Sign out')}
                </span>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default Welcome;
