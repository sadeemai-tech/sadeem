// SADEEM — frameless window title bar, SADEEM DESIGN SYSTEM v10 command bar:
//   left   = Logo + workspace name (truncated, click → workspace rail)
//   center = wide "Search or run a command…" pill → CommandPalette (⌘K wiring
//            unchanged — the pill only calls the existing setPalette)
//   right  = run/proof status pill (running · proven/failed verdicts),
//            model pill → ModelPicker, compact permission radiogroup,
//            focus / theme / language / plans toggles, settings gear,
//            then the window controls (full-height targets, inline-end side
//            via plain flex order → mirrors correctly in RTL).
// The whole bar is a drag region; every interactive child opts out with
// WebkitAppRegion: 'no-drag'. Bilingual strings via useT().
import React from 'react';
import { Crown, Focus, Loader2, Maximize2, Minus, Moon, Search, Settings2, Sun, UserRound, X } from 'lucide-react';
import { Eye, PenLine, ShieldCheck, Zap } from 'lucide-react';
import { useStore, PROVIDER_PRESETS } from '../store';
import { PERMISSION_MODES } from '../lib/modes';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { APP_VERSION } from '../version';
import { Logo } from './Logo';
import { IconBtn, Kbd, MOD_KEY } from './ui';
import { Toasts } from './Toasts';
import type { PermissionMode } from '../../shared/types';

const MODE_ICON: Record<PermissionMode, typeof Eye> = {
  plan: Eye,
  default: ShieldCheck,
  autoEdit: PenLine,
  fullAccess: Zap,
};
const MODE_LABEL_KEY: Record<PermissionMode, string> = {
  plan: 'tb.mode.plan',
  default: 'tb.mode.default',
  autoEdit: 'tb.mode.autoEdit',
  fullAccess: 'tb.mode.fullAccess',
};
const MODE_LABEL_FB: Record<PermissionMode, string> = {
  plan: 'Plan',
  default: 'Ask',
  autoEdit: 'Auto-edit',
  fullAccess: 'Full access',
};
const MODE_DESC_KEY: Record<PermissionMode, string> = {
  plan: 'tb.mode.plan.desc',
  default: 'tb.mode.default.desc',
  autoEdit: 'tb.mode.autoEdit.desc',
  fullAccess: 'tb.mode.fullAccess.desc',
};
const MODE_DESC_FB: Record<PermissionMode, string> = {
  plan: 'Read-only research, then proposes a plan',
  default: 'Ask before every write or command',
  autoEdit: 'Auto-approve file edits, ask for commands',
  fullAccess: 'Approve everything automatically',
};

const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

/** "Anthropic (Claude)" → "Anthropic"; "/home/z/projects/foo" → "foo". */
const shortProvider = (label: string): string => label.replace(/\s*\(.*\)$/, '').trim();
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function TitleBar({ onAccountClick }: { onAccountClick?: () => void } = {}) {
  const t = useT();
  const wsPath = useStore((s) => s.wsPath);
  const theme = useStore((s) => s.settings.theme);
  const lang = useStore((s) => s.settings.language);
  const model = useStore((s) => s.settings.model);
  const mode = useStore((s) => s.settings.permissionMode);
  // v8 — run/proof status (subscriptions kept; the pill mirrors ProofRibbon tone)
  const running = useStore((s) => s.running);
  const proof = useStore((s) => s.proof);
  const setMode = useStore((s) => s.setMode);
  const cycleTheme = useStore((s) => s.cycleTheme);
  const setLang = useStore((s) => s.setLang);
  const setPlans = useStore((s) => s.setPlans);
  const setRail = useStore((s) => s.setRail);
  const setPalette = useStore((s) => s.setPalette);
  const setModelPicker = useStore((s) => s.setModelPicker);
  const setSettings = useStore((s) => s.setSettings);
  // v11.31 — the live-preview overlay is painted ABOVE every stage rail.
  // A real navigation must clear it first, otherwise the brand/workspace
  // button looks dead while preview is open (same bug the rail already
  // fixed in its `navigate()`).
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);
  const goWorkspace = () => {
    setPreviewOpen(false);
    setRail('workspace');
  };
  // v7.2 — focus mode toggle (rail+sidebar+panels hide; Esc exits)
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);

  const wsName = wsPath ? baseName(wsPath) : null;
  const proofTone =
    proof.status === 'proven' ? 'var(--ok)' : proof.status === 'failed' ? 'var(--bad)' : null;
  const proofLabel =
    proof.status === 'proven'
      ? t('proof.proven', 'Proven')
      : proof.status === 'failed'
        ? t('proof.failed', 'Failed proof')
        : null;

  return (
    <>
      {/* global toast stack — portal to document.body, floats above everything */}
      <Toasts />
      <header
        className="glass-chrome relative h-10 shrink-0 flex items-center gap-2 px-2.5 select-none"
        style={{ ...dragRegion, borderBottom: '1px solid var(--line)' }}
      >
        {/* ---------- left: brand + workspace name ---------- */}
        <button
          type="button"
          className="flex items-center gap-2 min-w-0 max-w-[230px] shrink-0 h-8 ps-1 pe-2.5 rounded-full cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--hover-2)_70%,transparent)]"
          style={noDragRegion}
          title={wsPath ?? t('app.tagline', 'AI Coding Workstation')}
          aria-label={t('tb.breadcrumb', 'Open workspace panel')}
          onClick={goWorkspace}
        >
          <Logo size={19} />
          <span className="font-semibold text-[12.5px] text-[var(--ink)] truncate min-w-0" dir="auto">
            {wsName ?? t('app.name', 'SADEEM')}
          </span>
          <span className="stamp tnum !h-[16px] !text-[9px] shrink-0" dir="ltr" title={`v${APP_VERSION}`}>
            v{APP_VERSION}
          </span>
        </button>

        {/* ---------- center: command pill → CommandPalette ---------- */}
        <div className="flex-1 flex justify-center items-center min-w-0 px-2">
          <button
            type="button"
            className="group flex items-center gap-2 w-full max-w-[460px] min-w-[120px] h-[28px] px-3 rounded-full cursor-pointer transition-colors text-start"
            style={{
              ...noDragRegion,
              border: '1px solid var(--line)',
              background: 'var(--bg3)',
            }}
            title={t('tb.searchPh', 'Search or run a command…')}
            aria-label={t('tb.searchPh', 'Search or run a command…')}
            onClick={() => setPalette(true)}
          >
            <Search size={13} className="shrink-0 text-dim group-hover:text-acc transition-colors" />
            <span className="flex-1 text-[12px] text-faint group-hover:text-dim transition-colors truncate" dir="auto">
              {t('tb.searchPh', 'Search or run a command…')}
            </span>
            <Kbd className="tnum shrink-0">{`${MOD_KEY}+K`}</Kbd>
          </button>
        </div>

        {/* ---------- right: run/proof · model · permissions · toggles · settings ---------- */}
        <div className="flex items-center gap-1.5 shrink-0" style={noDragRegion}>
          {/* run / proof status pill — honest, quiet when idle */}
          {running && (
            <span
              className="glass-pill !h-[22px] text-ink"
              title={t('chat.working', 'Working…')}
              role="status"
            >
              <Loader2 size={11} className="spin" style={{ color: 'var(--acc)' }} />
              {t('chat.working', 'Working…')}
            </span>
          )}
          {!running && proofTone && proofLabel && (
            <span
              className="glass-pill !h-[22px] text-ink"
              title={t('proof.title', 'Proof')}
              role="status"
            >
              <span
                aria-hidden
                className="w-[6px] h-[6px] rounded-full shrink-0"
                style={{ background: proofTone, boxShadow: `0 0 6px ${proofTone}` }}
              />
              {proofLabel}
            </span>
          )}

          {/* model pill → ModelPicker (same wiring as the ⌘M shortcut) */}
          <button
            type="button"
            className="glass-pill !h-[22px] max-w-[190px] cursor-pointer hover:!border-[color-mix(in_srgb,var(--acc)_40%,transparent)] transition-colors"
            title={t('palette.changeModel', 'Change AI model…')}
            aria-label={t('palette.changeModel', 'Change AI model…')}
            onClick={() => setModelPicker(true)}
          >
            <span
              aria-hidden
              className="w-[6px] h-[6px] rounded-full shrink-0"
              style={{ background: 'var(--acc)', boxShadow: '0 0 6px color-mix(in srgb, var(--acc) 70%, transparent)' }}
            />
            <span className="truncate min-w-0">{shortProvider(PROVIDER_PRESETS[model.provider]?.label ?? model.provider)}</span>
            <span className="font-code text-[10px] text-faint truncate min-w-0" dir="ltr">
              {model.model}
            </span>
          </button>

          {/* permission modes — compact icon radiogroup (tooltips carry the labels) */}
          <div
            className="flex items-center gap-0.5 h-[22px] px-1 rounded-full shrink-0"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--bg3)',
            }}
            role="radiogroup"
            aria-label={t('settings.permissions', 'Permissions')}
          >
            {PERMISSION_MODES.map((m) => {
              const active = mode === m;
              const MIcon = MODE_ICON[m];
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`inline-flex items-center justify-center w-[26px] h-[18px] rounded-full cursor-pointer transition-colors ${
                    active ? '' : 'text-dim hover:text-ink'
                  }`}
                  style={
                    active
                      ? {
                          background: 'color-mix(in srgb, var(--acc) 18%, transparent)',
                          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--acc) 45%, transparent)',
                          color: 'var(--acc)',
                        }
                      : undefined
                  }
                  aria-label={t(MODE_LABEL_KEY[m], MODE_LABEL_FB[m])}
                  title={`${t(MODE_LABEL_KEY[m], MODE_LABEL_FB[m])} — ${t(MODE_DESC_KEY[m], MODE_DESC_FB[m])}`}
                  onClick={() => setMode(m)}
                >
                  <MIcon size={11} strokeWidth={2} className="shrink-0" />
                </button>
              );
            })}
          </div>

          {/* quick toggles: focus / theme / language / plans */}
          <div className="flex items-center gap-0.5 shrink-0">
            <IconBtn
              title={t('focus.toggle', 'Focus mode') + ' — ' + t('focus.hint', 'Esc exits')}
              aria-label={t('focus.toggle', 'Focus mode')}
              aria-pressed={focusMode}
              className={focusMode ? '!text-[var(--acc)]' : undefined}
              onClick={() => setFocusMode(!focusMode)}
            >
              <Focus size={15} />
            </IconBtn>
            <IconBtn
              title={t('settings.theme', 'Theme')}
              aria-label={t('settings.theme', 'Theme')}
              onClick={() => cycleTheme()}
            >
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </IconBtn>
            <IconBtn
              title={t('palette.lang', 'Toggle language AR/EN')}
              aria-label={t('palette.lang', 'Toggle language AR/EN')}
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            >
              <span className="text-[11px] font-semibold leading-none">{lang === 'en' ? 'ع' : 'EN'}</span>
            </IconBtn>
            <IconBtn
              title={t('rail.plans', 'Plans & upgrade')}
              aria-label={t('rail.plans', 'Plans & upgrade')}
              onClick={() => setPlans(true)}
            >
              <Crown size={15} />
            </IconBtn>
            {/* v11.40 — account is OPTIONAL: value-first, sync/license on demand */}
            {onAccountClick && (
              <IconBtn
                title={t('account.open', 'Account & sign in')}
                aria-label={t('account.open', 'Account & sign in')}
                onClick={onAccountClick}
              >
                <UserRound size={15} />
              </IconBtn>
            )}
            {/* settings — same handler the ⌘, accelerator uses; Settings2 is
                the consistent, correctly-shaped gear across the shell. */}
            <IconBtn
              title={t('rail.settings', 'Settings')}
              aria-label={t('rail.settings', 'Settings')}
              onClick={() => setSettings(true)}
            >
              <Settings2 size={15} />
            </IconBtn>
          </div>
        </div>

        {/* window controls — full-height 40px-wide hit targets, small gap
            inside the group; plain flex order mirrors to the correct side
            of the bar in RTL (v11.8: bar is a consistent 40px tall) */}
        <div className="flex items-center gap-1 shrink-0 ms-1" style={noDragRegion}>
          <IconBtn
            title={t('win.minimize', 'Minimize')}
            aria-label={t('win.minimize', 'Minimize')}
            className="press !h-10 !w-10 !rounded-none"
            onClick={() => void api.win('min')}
          >
            <Minus size={15} />
          </IconBtn>
          <IconBtn
            title={t('win.maximize', 'Maximize')}
            aria-label={t('win.maximize', 'Maximize')}
            className="press !h-10 !w-10 !rounded-none"
            onClick={() => void api.win('max')}
          >
            <Maximize2 size={13} />
          </IconBtn>
          {/* Founder fix: --bad is WHITE in most themes, so hover used to turn
              the button white (white glyph on white fill). --win-close-hover is
              a dedicated, always-red token (tokens.css) — subtle at rest,
              unmistakably RED on hover, like every other app's close control. */}
          <IconBtn
            title={t('win.close', 'Close')}
            aria-label={t('win.close', 'Close')}
            className="press hover:!bg-[var(--win-close-hover)] hover:!text-white !h-10 !w-10 !rounded-none"
            onClick={() => void api.win('close')}
          >
            <X size={15} />
          </IconBtn>
        </div>

        {/* bottom hairline — flat, quiet (SADEEM); the chrome strip's inset
            shadow above it gives the bar its machined top edge */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{ background: 'var(--line)' }}
        />
      </header>
    </>
  );
}

export default TitleBar;
