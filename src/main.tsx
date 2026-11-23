import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/arabic-400.css';
import '@fontsource/cairo/arabic-500.css';
import '@fontsource/cairo/arabic-600.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import 'highlight.js/styles/base16/atelier-forest.css';
import './styles.css';
import './assets/soft.css';
import { App } from './App';
import { useStore } from './store';

// ---------- renderer error forwarding (main.log via IPC) ----------
// Every uncaught renderer error lands in <userData>/logs/main.log so a
// user-visible bug is always diagnosable — never another silent screen.
function forwardError(kind: string, detail: unknown): void {
  const msg = detail instanceof Error ? detail.stack ?? detail.message : String(detail);
  try {
    void window.surnia?.log(3, `${kind}: ${msg}`);
  } catch {
    /* preload not ready — the main-process console-message hook still catches it */
  }
}
window.addEventListener('error', (e) => forwardError('window.onerror', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => forwardError('unhandledrejection', e.reason));

// ---------- crash recovery: a bug can never show a blank window ----------
class BootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          position: 'fixed', inset: 0, background: '#232A2E', color: '#979794',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, fontFamily: "'Inter', system-ui, sans-serif", textAlign: 'center', padding: 24,
        }}
      >
        <div style={{ width: 52, height: 52, borderRadius: 14, background: '#2E383D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 24, color: '#A8BFA8' }}>K</div>
        <div style={{ color: '#c9a488', fontWeight: 600 }}>
          {useStore.getState().settings.language === 'ar'
            ? 'حدث خطأ غير متوقع في الواجهة'
            : 'The interface hit an unexpected error'}
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 520, wordBreak: 'break-all' }}>
          {this.state.error.message}
        </div>
        <button
          onClick={() => location.reload()}
          style={{ padding: '8px 22px', borderRadius: 8, border: '1px solid #3A454B', background: '#2E383D', color: '#D5DEE2', fontSize: 14, cursor: 'pointer' }}
        >
          {useStore.getState().settings.language === 'ar' ? 'إعادة التحميل' : 'Reload'}
        </button>
      </div>
    );
  }
}

window.addEventListener('unhandledrejection', () => {
  /* logged by devtools; never kill the app silently */
});

// ---------- screenshot-tour bootstrap (KODEX_TOUR mode only) ----------
// ?screen=auth|auth-signup|welcome|newproject|clone|onboard-1..5
// Lets the automated screenshot harness pin the app to a specific
// screen. Harmless in production (no such query strings there).
const params = new URLSearchParams(window.location.search);
const shotScreen = params.get('screen');

if (shotScreen) {
  const store = useStore.getState();
  const fakeSettings = {
    ...store.settings,
    language: (params.get('lang') as 'ar' | 'en') ?? 'en',
    onboardingDone: !shotScreen.startsWith('onboard'),
    localOnly: shotScreen !== 'auth' && shotScreen !== 'auth-signup',
  };
  if (shotScreen.startsWith('onboard')) {
    const step = Number(shotScreen.split('-')[1] ?? '1');
    localStorage.setItem('surnia.onboarding.step', String(Math.min(5, Math.max(1, step))));
    fakeSettings.onboardingDone = false;
    fakeSettings.localOnly = false;
    useStore.setState({ settings: fakeSettings, onboardingOpen: true, booted: true, authChecked: true, account: null });
  } else {
    useStore.setState({ settings: fakeSettings, booted: true, authChecked: true, account: null });
    if (shotScreen === 'newproject') useStore.setState({ newProjectOpen: true });
    if (shotScreen === 'clone') useStore.setState({ cloneOpen: true });
  }
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <BootErrorBoundary>
    <App />
  </BootErrorBoundary>,
);

// Mount marker: the smoke test and the boot watchdog both key off this.
// Set ONLY after React has committed — a page that loads but never mounts
// counts as a boot failure (this is the false-OK that hid the white screen).
document.documentElement.dataset.appMounted = '1';

// App took over — remove the static boot canvas so it never covers the UI.
const boot = document.getElementById('boot');
if (boot) boot.remove();

// Workspace pins own their workspace state end-to-end: strip recentPaths so
// init()'s auto-open (and its competing newSession()) never runs for them.
const isWsPin = shotScreen === 'ws' || !!shotScreen?.startsWith('ws-');
if (isWsPin) {
  useStore.setState({ settings: { ...useStore.getState().settings, recentPaths: [] } });
}

void useStore.getState().init().then(() => {
  if (shotScreen && !shotScreen.startsWith('onboard')) {
    // keep the pinned screen on top of whatever init restored
    const s = useStore.getState();
    if (shotScreen !== 'auth' && shotScreen !== 'auth-signup') {
      useStore.setState({ settings: { ...s.settings, localOnly: true, onboardingDone: true } });
      if (shotScreen === 'newproject') useStore.setState({ newProjectOpen: true });
      if (shotScreen === 'clone') useStore.setState({ cloneOpen: true });
    }
  }
  if (shotScreen === 'ws' || shotScreen?.startsWith('ws-')) {
    void pinWorkspaceScreen(shotScreen);
  }
});

// ---------- workspace tour pins (screenshot harness only) ----------
// ?screen=ws|ws-editor|ws-terminal|ws-palette|ws-settings(-billing|
// -providers)|ws-plans|ws-usage|ws-git|ws-sessions|ws-mcp
const DEMO_WS = '/tmp/surnia-demo-workspace';

async function pinWorkspaceScreen(screen: string): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(400);
  await useStore.getState().openWorkspace(DEMO_WS);
  await wait(2600); // let refreshTree / loadGit / newSession fully settle

  const now = Date.now();
  const msg = (
    id: string,
    role: 'user' | 'assistant',
    content: string,
    extra: Partial<import('../shared/types').ChatMessage> = {},
  ) => ({ id, role, content, timestamp: now - 600_000 + Number(id.slice(1) || '0') * 9_000, ...extra });

  const seededSession: import('../shared/types').SessionData = {
    id: 'demo-session',
    title: 'Add signup validation',
    createdAt: now - 900_000,
    updatedAt: now,
    workspace: DEMO_WS,
    model: 'claude-sonnet-5.5',
    messageCount: 7,
    totalTokens: 16_550,
    totalCostUsd: 0.143,
    todos: [
      { id: 't1', content: 'Read the signup form code', status: 'completed' },
      { id: 't2', content: 'Add validation rules to signup.ts', status: 'completed' },
      { id: 't3', content: 'Write vitest unit tests', status: 'in_progress' },
    ],
    messages: [
      msg('1', 'user', 'Add input validation to the signup form and write unit tests for it.', {
        images: [],
      }),
      msg('2', 'assistant', "I'll start by reading the current signup code, then add the validation rules.", {
        model: 'claude-sonnet-5.5',
        usage: { inputTokens: 4120, outputTokens: 210, costUsd: 0.021 },
      }),
      msg('3', 'assistant', JSON.stringify({ tool: 'read_file', path: 'src/signup.ts' }), {
        kind: 'tool_call',
        toolName: 'read_file',
        toolCallId: 'tc1',
      }),
      msg('4', 'assistant', 'src/signup.ts (28 lines)', {
        kind: 'tool_result',
        toolName: 'read_file',
        toolCallId: 'tc1',
        resultOk: true,
      }),
      msg('5', 'assistant', JSON.stringify({ tool: 'write_file', path: 'src/signup.ts' }), {
        kind: 'tool_call',
        toolName: 'write_file',
        toolCallId: 'tc2',
      }),
      msg('6', 'assistant', 'src/signup.ts written (+12 −3)', {
        kind: 'tool_result',
        toolName: 'write_file',
        toolCallId: 'tc2',
        resultOk: true,
      }),
      msg(
        '7',
        'assistant',
        "Done. `validateSignup` now rejects empty fields, malformed emails and short passwords.\n\nNext I'll add the vitest suite — running it after that to confirm everything passes.",
        {
          model: 'claude-sonnet-5.5',
          usage: { inputTokens: 8_620, outputTokens: 1_150, costUsd: 0.098 },
        },
      ),
    ],
  };

  useStore.setState({
    session: seededSession,
    sessionUsage: { inputTokens: 14_200, outputTokens: 2_350, costUsd: 0.143 },
  });

  if (screen !== 'ws') {
    try {
      await useStore.getState().openFile(DEMO_WS + '/src/signup.ts');
      await wait(900); // let Monaco mount
    } catch { /* shot still valid */ }
  }

  switch (screen) {
    case 'ws-editor':
      useStore.setState({ chatOpen: false });
      break;
    case 'ws-terminal':
      useStore.setState({ chatOpen: false });
      void useStore.getState().toggleTerminal();
      break;
    case 'ws-palette':
      useStore.setState({ paletteOpen: true });
      break;
    case 'ws-settings':
      useStore.setState({ settingsOpen: true, settingsSection: 'general' });
      break;
    case 'ws-settings-billing':
      useStore.setState({ settingsOpen: true, settingsSection: 'billing' });
      break;
    case 'ws-settings-providers':
      useStore.setState({ settingsOpen: true, settingsSection: 'providers' });
      break;
    case 'ws-settings-models':
      useStore.setState({ settingsOpen: true, settingsSection: 'models' });
      break;
    case 'ws-settings-apiserver':
      useStore.setState({ settingsOpen: true, settingsSection: 'apiServer' });
      break;
    case 'ws-plans':
      useStore.setState({ plansOpen: true });
      break;
    case 'ws-usage':
      useStore.setState({ rail: 'usage', sidebarOpen: true });
      break;
    case 'ws-git':
      useStore.setState({ rail: 'git', sidebarOpen: true });
      break;
    case 'ws-sessions':
      useStore.setState({ rail: 'sessions', sidebarOpen: true });
      break;
    case 'ws-mcp':
      useStore.setState({ rail: 'mcp', sidebarOpen: true });
      break;
    case 'ws-search':
      window.dispatchEvent(new CustomEvent('surnia:open-search'));
      break;
    case 'ws-shortcuts':
      useStore.setState({ shortcutsOpen: true });
      break;
    case 'ws-settings-agent':
      useStore.setState({ settingsOpen: true, settingsSection: 'agent' });
      break;
    case 'ws-settings-preview':
      useStore.setState({ settingsOpen: true, settingsSection: 'preview' });
      break;
    case 'ws-preview': {
      // Live Preview canvas over the demo site (screenshot harness only).
      useStore.setState({ chatOpen: false });
      void useStore.getState().startStaticPreview(DEMO_WS);
      break;
    }
    default:
      break;
  }

  // LAST step before the screenshot fires: keep re-asserting the seeded
  // transcript until capture — any late-resolving newSession() that slips
  // through must lose against the seed.
  for (let i = 0; i < 3; i++) {
    await wait(700);
    if ((useStore.getState().session?.messages.length ?? 0) === 0) {
      useStore.setState({
        session: seededSession,
        sessionUsage: { inputTokens: 14_200, outputTokens: 2_350, costUsd: 0.143 },
      });
    }
  }
}
