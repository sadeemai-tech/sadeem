// SADEEM — main application layout.
// v10 SADEEM DESIGN SYSTEM: boot goes straight to the workspace / Welcome
// empty state; the rail's Home view owns the stage (no sidebar) and renders
// the real-data Home page. Onboarding is a single skippable screen;
// account/localOnly settings stay in the store but never block the UI.
// Focus mode collapses the layout to chat (+ diff modal only); Esc exits it.
import React, { useEffect, useState } from 'react';
import { Files, X } from 'lucide-react';
import { useStore } from './store';
import { useT } from './i18n';
import { TitleBar } from './components/TitleBar';
import { Rail } from './components/Rail';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { EditorArea } from './components/EditorArea';
// v11.12 (C5-CONTAIN) — per-surface crash containment: one broken panel no
// longer unmounts the whole app into the boot recovery screen.
import { SurfaceErrorBoundary } from './components/SurfaceErrorBoundary';
import { IconBtn } from './components/ui';
import { OPEN_FILES_EVENT, ProjectFiles } from './components/ProjectFiles';
import { PreviewArea } from './components/PreviewArea';
import { TerminalView } from './components/TerminalView';
import { Home } from './components/Home';
import { ChatPanel } from './components/ChatPanel';
import { CommandPalette } from './components/CommandPalette';
import { ModelPicker } from './components/ModelPicker';
import { SettingsModal } from './components/SettingsModal';
import { PlansScreen } from './components/PlansScreen';
import { Onboarding } from './components/Onboarding';
import { NewProjectWizard } from './components/NewProjectWizard';
import { CloneDialog } from './components/CloneDialog';
import { DiffModal } from './components/DiffModal';
import { SubagentDetailModal } from './components/SubagentDetailModal';
import { CapabilityGuide } from './components/CapabilityGuide'; // v11.16 — in-app field guide (opened from the palette)
import { OPEN_SEARCH_EVENT } from './components/SearchPanel';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { RightDock } from './components/RightDock';
import { WhatsNew } from './components/WhatsNew';
import { APP_VERSION } from './version';
import './components/shell.css';
import { STAGE_RAILS } from './components/panels/registry';

export function App() {
  const t = useT();
  const booted = useStore((s) => s.booted);
  const account = useStore((s) => s.account);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const termHeight = useStore((s) => s.termHeight);
  const previewOpen = useStore((s) => s.previewOpen);
  const wsPath = useStore((s) => s.wsPath);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const setTermHeight = useStore((s) => s.setTermHeight);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const setPalette = useStore((s) => s.setPalette);
  const modelPickerOpen = useStore((s) => s.modelPickerOpen);
  const setModelPicker = useStore((s) => s.setModelPicker);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setRail = useStore((s) => s.setRail);
  const ui = useStore((s) => s.settings.ui);
  const theme = useStore((s) => s.settings.theme);
  // v7.2 — focus mode: rail+sidebar+editor panels hidden, chat stays
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);

  // v11.12 — compact project-files drawer, the rail's second way into the
  // tree. The full Workspace page remains the primary home for PROJECT FILES.
  const [filesOpen, setFilesOpen] = useState(false);
  // v11.40 — value-first: the app opens on the workspace, account is optional
  // (sync/license only). The gate opens from the account button in TitleBar.
  const [authGateOpen, setAuthGateOpen] = useState(false);
  useEffect(() => {
    const onToggle = () => setFilesOpen((v) => !v);
    window.addEventListener(OPEN_FILES_EVENT, onToggle);
    return () => window.removeEventListener(OPEN_FILES_EVENT, onToggle);
  }, []);

  // global shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!paletteOpen);
      } else if (mod && e.key.toLowerCase() === 'p' && e.shiftKey) {
        e.preventDefault();
        setPalette(true);
      } else if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) {
        // v10 — Quick Open (Ctrl+P): same command palette, file commands first
        e.preventDefault();
        setPalette(true);
      } else if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        // v10 — New session (Ctrl+N)
        e.preventDefault();
        void useStore.getState().newSession();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('surnia:open-search'));
      } else if (mod && e.key === 's') {
        e.preventDefault();
        void useStore.getState().saveAll();
      } else if (mod && e.key === '`') {
        e.preventDefault();
        void toggleTerminal();
      } else if (mod && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setModelPicker(true);
      } else if (e.key === 'Escape' && useStore.getState().focusMode) {
        // v7.2 — Esc exits focus mode, but never while a modal/overlay owns
        // the key (they stopPropagation / handle Esc themselves; the guards
        // below keep this handler from yanking the UI out from under them).
        const st = useStore.getState();
        const overlayOpen =
          st.settingsOpen ||
          st.paletteOpen ||
          st.modelPickerOpen ||
          st.plansOpen ||
          st.shortcutsOpen ||
          st.newProjectOpen ||
          st.cloneOpen ||
          st.scheduledOpen ||
          st.onboardingOpen ||
          st.diffView !== null ||
          st.pendingApproval !== null;
        if (!overlayOpen) {
          const tgt = e.target as HTMLElement | null;
          const inField =
            tgt &&
            (tgt.tagName === 'INPUT' ||
              tgt.tagName === 'TEXTAREA' ||
              tgt.isContentEditable);
          if (!inField) {
            e.preventDefault();
            setFocusMode(false);
          }
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [paletteOpen, setPalette, setModelPicker, toggleTerminal, toggleSidebar, setFocusMode]);

  // v14 — file search is a FULL SECTION PAGE, not a floating overlay. Every
  // trigger (rail icon, Ctrl+Shift+F, palette, native menu) dispatches the same
  // event; mount the search stage rail so it renders through RightDock like
  // Home. Re-dispatch while already on the page just keeps it open.
  useEffect(() => {
    const onOpenSearch = () => {
      // FIX — live preview is a transient overlay that otherwise wins over
      // every stage rail. A real navigation must reveal the section, so clear
      // it first; otherwise every search trigger looked dead while preview
      // was open.
      useStore.getState().setPreviewOpen(false);
      if (useStore.getState().rail !== 'search') setRail('search');
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenSearch);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpenSearch);
  }, [setRail]);

  // v2.3 Liquid Glass v6 — sync appearance settings → root attributes:
  // glass level, ambient aurora, accent tint, transcript measure and the
  // motion-scale divisor. Null-safe while settings.ui boots up.
  useEffect(() => {
    const u = ui ?? {};
    const root = document.documentElement;
    // v2.6 — main-process fx circuit breaker: after a renderer crash the
    // window reloads with ?fx=off and the glass/aurora/specular layer is
    // hard-disabled regardless of user settings (stability > frost).
    const fxOff = new URLSearchParams(window.location.search).get('fx') === 'off';
    if (fxOff) {
      root.classList.add('fx-off');
      root.dataset.glass = 'off';
      root.dataset.ambient = 'off';
      root.dataset.specular = 'off';
      return;
    }
    root.dataset.glass = u.glassLevel ?? 'medium';
    root.dataset.ambient = (u.ambientGlow ?? true) ? 'on' : 'off';
    root.dataset.accent = u.accent ?? 'sage';
    root.dataset.chatwidth = u.chatWidth ?? 'cozy';
    // v2.4 — specular glass edges toggle (Liquid Glass v7)
    root.dataset.specular = (u.specularEdges ?? true) ? 'on' : 'off';
    const speed = typeof u.motionSpeed === 'number' && u.motionSpeed > 0 ? u.motionSpeed : 1;
    root.dataset.motion = String(speed);
    root.style.setProperty('--motion-scale', String(Math.min(3, Math.max(0.25, speed))));
  }, [ui]);

  // v7.2 — THEMES: 'follow' resolves to a real palette via
  // prefers-color-scheme (and keeps listening for OS changes); 'high' sets
  // data-theme="high" (high-contrast skin). Legacy ids apply verbatim.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'follow') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const apply = () => {
        root.dataset.theme = mq.matches ? 'light' : 'obsidian';
      };
      apply();
      root.dataset.themeMode = 'follow';
      mq.addEventListener('change', apply);
      return () => {
        mq.removeEventListener('change', apply);
        root.dataset.themeMode = '';
      };
    }
    root.dataset.themeMode = '';
    root.dataset.theme = theme;
  }, [theme]);

  // v7.2 — DENSITY + ZOOM: ui.zoom (0.9–1.25) → --zoom-factor on the root;
  // ui.density → data-density attribute for the compact chrome skin.
  useEffect(() => {
    const root = document.documentElement;
    const zoom = typeof ui?.zoom === 'number' && ui.zoom >= 0.9 && ui.zoom <= 1.25 ? ui.zoom : 1;
    root.style.setProperty('--zoom-factor', String(zoom));
    root.dataset.density = ui?.density === 'compact' ? 'compact' : 'comfortable';
  }, [ui?.zoom, ui?.density]);

  // BUG FIX — focus-mode CSS lives in shell.css under `html[data-focus='on']`,
  // but the attribute used to be written ONLY on the nested app <div>. The
  // selector never matched, so .chat-slot-v12 stayed flex:0 0 auto while the
  // panel asked for width:auto → collapsed/overlapping chat + leftover strips.
  // Mirror the flag onto the document root so the existing (and hardened) rules
  // actually apply. Esc-to-exit stays in the global shortcut handler above.
  useEffect(() => {
    document.documentElement.dataset.focus = focusMode ? 'on' : '';
  }, [focusMode]);

  // v11.34 — resizer constraints live at the shell boundary. The chat can now
  // grow to ~80% of the window; the work area keeps a 280px floor; the balanced
  // reset is 55/45. ChatPanel is the only reader of the numeric chatWidth slice
  // and owns the drag math, so publish the contract here and tell it to re-clamp
  // whenever the viewport changes (an over-wide chat must never strand the
  // editor with zero pixels after a window shrink).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.chatWorkMin = '280';
    root.dataset.chatMaxPct = '80';
    root.dataset.chatBalancePct = '55';
    const onResize = () => window.dispatchEvent(new Event('surnia:chat-reclamp'));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      root.removeAttribute('data-chat-work-min');
      root.removeAttribute('data-chat-max-pct');
      root.removeAttribute('data-chat-balance-pct');
    };
  }, []);

  // v7.2 — focus mode collapses the shell: rail, sidebar, editor/preview and
  // the terminal all hide; the chat panel (+ DiffModal / approvals) remains.
  // v10 — rail==='home': the Home page owns the stage (no sidebar, no editor).
  // STAGE RAILS: every section (now including 'workspace' and 'search') is a
  // full center-stage page rendered by RightDock, like Home. The editor
  // itself is an implicit 'editor' rail surfaced by opening a file.
  const rail = useStore((s) => s.rail);
  const isHome = rail === 'home';
  const isStage = STAGE_RAILS.has(rail);
  const workArea = focusMode ? null : (
    <div className="work-slot-v12 relative flex flex-col min-w-0 min-h-0 flex-1">
      {/* v13 — the workspace file tree is a floating overlay drawer, NOT an
          in-flow column. The editor/page fills the whole area (no split). */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* BUG FIX — the Live Preview / Terminal rail buttons must ALWAYS reveal
            their surface, even when the current rail is a full-stage page
            (workspace/search/etc — 'workspace' is the DEFAULT rail, so the
            old branch order made both buttons look dead). Preview wins over
            every stage; the terminal strip is appended on any rail. */}
        {previewOpen ? (
          <SurfaceErrorBoundary surface="preview">
            <PreviewArea />
          </SurfaceErrorBoundary>
        ) : isHome ? (
          <Home />
        ) : isStage ? (
          // FIX — a stage section (every "More" menu view) must ALWAYS render
          // its own page. The old `!terminalOpen` guard swapped it for the
          // editor while the terminal strip was open, which made EVERY item
          // in the More menu look dead. The terminal is appended below on any
          // rail, so the section and the terminal coexist correctly.
          <SurfaceErrorBoundary surface={'stage-' + rail}>
            <RightDock rail={rail} />
          </SurfaceErrorBoundary>
        ) : (
          <SurfaceErrorBoundary surface="editor">
            <EditorArea />
          </SurfaceErrorBoundary>
        )}
        {terminalOpen && (
          <div
            style={{ height: termHeight }}
            className="shrink-0 border-t border-[var(--line)] relative"
          >
            <div
              className="absolute top-0 inset-x-0 h-1 cursor-row-resize z-10 hover:bg-[var(--acc)]/40 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = termHeight;
                const move = (ev: MouseEvent) =>
                  setTermHeight(startH + (startY - ev.clientY));
                const up = () => {
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              }}
            />
            <TerminalView />
          </div>
        )}
      </div>
      {/* overlay drawer + scrim — never on Home, a full section page, or the
          editor surface (which owns the whole work area when a file is open) */}
      {sidebarOpen && !isHome && !isStage && rail !== 'editor' && (
        <>
          <div className="sidebar-scrim-v13" onClick={toggleSidebar} aria-hidden />
          <Sidebar />
        </>
      )}
      {/* v11.12 — compact project files drawer (rail "Files" button). Shows
          the SAME tree as the Workspace page, so there is no second confusing
          file model; it is simply a faster way in, available while editing. */}
      {filesOpen && (
        <>
          <div className="pf-scrim" onClick={() => setFilesOpen(false)} aria-hidden />
          <aside className="pf-drawer" aria-label={t('pf.title', 'Project files')}>
            <div className="pf-drawer-head">
              <Files size={14} className="text-acc shrink-0" aria-hidden />
              <span className="pf-drawer-head-title">{t('pf.title', 'Project files')}</span>
              <IconBtn className="!w-6 !h-6" title={t('diff.close', 'Close')} aria-label={t('diff.close', 'Close')} onClick={() => setFilesOpen(false)}>
                <X size={14} />
              </IconBtn>
            </div>
            <div className="pf-drawer-body">
              <ProjectFiles compact onOpened={() => setFilesOpen(false)} />
            </div>
          </aside>
        </>
      )}
    </div>
  );

  if (!booted) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--bg)]">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--line)] border-t-[var(--acc)] spin" />
      </div>
    );
  }

  // v11.4 — first-launch account gate: the app opens on sign-in / create-account,
  // linked to the SADEEM website. boot waits for `booted`, then the gate blocks
  // the workspace until an account exists (website pairing or local device).
  // Settings / onboarding can still read account state underneath.

  return (
    <div className="h-full flex flex-col bg-[var(--bg)] text-[var(--ink)] overflow-hidden" data-focus={focusMode ? 'on' : undefined}>
      {booted && authGateOpen && <AuthGate onClose={() => setAuthGateOpen(false)} />}
      <TitleBar onAccountClick={() => setAuthGateOpen(true)} />
      {/* v14 — the icon rail is now a FULL-WIDTH HORIZONTAL top bar directly
          under the TitleBar and above the workspace. Its physical position is
          identical in EN and AR (the bar forces an LTR main axis). */}
      {!focusMode && <Rail />}
      <div className="app-main-row-v12 flex-1 flex min-h-0">
        {chatOpen && (
          <div className="chat-slot-v12 flex min-w-0 min-h-0">
            <SurfaceErrorBoundary surface="chat">
              <ChatPanel />
            </SurfaceErrorBoundary>
          </div>
        )}
        {workArea}
      </div>
      {!focusMode && <StatusBar />}

      <CommandPalette open={paletteOpen} onClose={() => setPalette(false)} />
      <ModelPicker open={modelPickerOpen} onClose={() => setModelPicker(false)} />
      {/* SearchPanel now renders through the 'search' stage rail (RightDock). */}
      <ShortcutsOverlay />
      <WhatsNew />
      <SettingsModal />
      <PlansScreen />
      {account && <Onboarding />}
      <NewProjectWizard />
      <CloneDialog />
      <DiffModal />
      <SubagentDetailModal />
      <CapabilityGuide />
      {!wsPath && !focusMode && <WorkspaceGate />}
    </div>
  );
}

// Full-screen welcome when no workspace is open.
import { Welcome } from './components/Welcome';
function WorkspaceGate() {
  return <div className="fixed inset-x-0 bottom-0 top-11 z-30 bg-[var(--bg)] ">{<Welcome />}</div>;
}

// v11.4 — first-launch account gate (full screen). Reuses the v11.3
// AccountAuthCard: website pairing (OpenCode-style) + local device sign-in.
import { AccountAuthCard } from './components/settings/AccountAuthCard';
function AuthGate({ onClose }: { onClose?: () => void }) {
  const lang = useStore((s) => s.settings?.language) === 'ar';
  return (
    <div
      className="auth-gate"
      style={{
        position: 'fixed', inset: 0, zIndex: 90, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', overflow: 'auto',
      }}
    >
      {onClose && (
        <button
          type="button"
          aria-label={lang ? 'إغلاق' : 'Close'}
          onClick={onClose}
          style={{ position: 'absolute', top: 18, right: 18, background: 'none', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--dim)', padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}
        >
          {lang ? 'إغلاق ×' : 'Close ×'}
        </button>
      )}
      <div style={{ width: 'min(560px, 92vw)', padding: '24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontFamily: 'var(--font-mono2)', fontSize: 13, letterSpacing: '0.14em', color: 'var(--dim)' }}>
            SADEEM · v{APP_VERSION}
          </span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, lineHeight: 1.05, margin: '0 0 6px', color: 'var(--ink)' }}>
          {lang ? 'سجّل الدخول أو أنشئ حسابك' : 'Sign in or create your account'}
        </h1>
        <p style={{ color: 'var(--dim)', fontSize: 13.5, margin: '0 0 20px', maxWidth: 480 }}>
          {lang
            ? 'الحساب يُنشأ على موقع سديم ويُربط بهذا الجهاز مباشرة. يمكنك أيضًا إنشاء حساب محلي على الجهاز فقط.'
            : 'Accounts are created on the SADEEM website and linked to this device. You can also create a local device-only account.'}
        </p>
        <AccountAuthCard />
      </div>
    </div>
  );
}
