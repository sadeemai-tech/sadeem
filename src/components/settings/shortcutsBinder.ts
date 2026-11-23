// ============================================================
// SADEEM settings — rebindable keyboard shortcuts binder (v11.4).
// REAL EFFECT: a window-capture keydown listener resolves chords from
// settings.shortcuts (fallback: the built-in defaults) and runs the
// matching action. Installed once at app boot (module scope of
// ShortcutsSection, which SettingsModal statically imports).
//
// Honesty rules (documented in the settings pane too):
//  • Actions whose DEFAULT is already handled elsewhere — new-session
//    (Ctrl+N in App.tsx), toggle-sidebar (Ctrl+B in App.tsx) and
//    toggle-settings (Ctrl+, in the Electron menu, outside renderer
//    scope) — are acted on here ONLY when the user overrode them, so
//    nothing double-fires. Their stock keys keep working until rebound.
//  • focus-composer / toggle-theme / stop-run had NO global key handler
//    before — the binder owns them (default binding or overridden).
//  • A binding must carry Ctrl/Alt/Cmd (or be an F-key): plain letters
//    are rejected at capture time so typing can never be hijacked.
// ============================================================
import { useStore } from '../../store';

export type ShortcutActionId =
  | 'toggle-settings'
  | 'new-session'
  | 'focus-composer'
  | 'toggle-sidebar'
  | 'toggle-theme'
  | 'stop-run';

/** The shipped defaults = the initial map (settings.shortcuts overrides it). */
export const DEFAULT_SHORTCUT_BINDINGS: Record<ShortcutActionId, string> = {
  'toggle-settings': 'Ctrl+,',
  'new-session': 'Ctrl+N',
  'focus-composer': 'Ctrl+Shift+L',
  'toggle-sidebar': 'Ctrl+B',
  'toggle-theme': 'Ctrl+Alt+T',
  'stop-run': 'Ctrl+.',
};

/** Bilingual rows for the settings pane (EN/AR per the settings law). */
export const SHORTCUT_ACTIONS: { id: ShortcutActionId; en: string; ar: string; hintEn: string; hintAr: string }[] = [
  {
    id: 'toggle-settings', en: 'Toggle settings', ar: 'فتح/إغلاق الإعدادات',
    hintEn: 'Default Ctrl+, — also bound in the app menu; the menu key keeps working.',
    hintAr: 'الافتراضي Ctrl+, — مرتبط أيضاً في قائمة التطبيق؛ مفتاح القائمة يبقى يعمل.',
  },
  {
    id: 'new-session', en: 'New session', ar: 'جلسة جديدة',
    hintEn: 'Default Ctrl+N — handled in the app shell; override adds your key.',
    hintAr: 'الافتراضي Ctrl+N — يُعالج في هيكل التطبيق؛ التغيير يضيف مفتاحك.',
  },
  {
    id: 'focus-composer', en: 'Focus composer', ar: 'التركيز على صندوق الكتابة',
    hintEn: 'Jumps the caret into the chat composer.',
    hintAr: 'ينقل المؤشر إلى صندوق كتابة المحادثة.',
  },
  {
    id: 'toggle-sidebar', en: 'Toggle sidebar', ar: 'إظهار/إخفاء الشريط الجانبي',
    hintEn: 'Default Ctrl+B — handled in the app shell; override adds your key.',
    hintAr: 'الافتراضي Ctrl+B — يُعالج في هيكل التطبيق؛ التغيير يضيف مفتاحك.',
  },
  {
    id: 'toggle-theme', en: 'Toggle theme', ar: 'تبديل السمة',
    hintEn: 'Cycles the same theme order as the title-bar button.',
    hintAr: 'يمر بترتيب السمات نفسه المستخدم في زر شريط العنوان.',
  },
  {
    id: 'stop-run', en: 'Stop the running agent', ar: 'إيقاف الوكيل الجاري',
    hintEn: 'Aborts the active run (no-op while idle).',
    hintAr: 'يوقف التشغيل النشط (بلا أثر أثناء الخمول).',
  },
];

/** Actions whose default binding lives OUTSIDE this binder. */
const HANDLED_ELSEWHERE: ReadonlySet<ShortcutActionId> = new Set([
  'toggle-settings',
  'new-session',
  'toggle-sidebar',
]);

const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Escape: 'Esc',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Del',
};

/** Normalize a keydown to the canonical binding string ('Ctrl+Shift+K'). */
export function chordOf(e: KeyboardEvent): string | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  const shift = e.shiftKey;
  const raw = KEY_LABELS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!raw || ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(e.key)) return null;
  const isFnKey = /^F\d{1,2}$/.test(raw);
  if (!ctrl && !alt && !isFnKey) return null; // plain keys / shift+key are never bindings
  const parts: string[] = [];
  if (ctrl) parts.push('Ctrl');
  if (alt) parts.push('Alt');
  if (shift) parts.push('Shift');
  parts.push(raw);
  return parts.join('+');
}

/** Resolve the current binding of an action from settings (default fallback). */
export function bindingFor(map: Record<string, string> | undefined, id: ShortcutActionId): string {
  const v = map?.[id];
  return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_SHORTCUT_BINDINGS[id];
}

function runAction(id: ShortcutActionId): void {
  const st = useStore.getState();
  switch (id) {
    case 'toggle-settings':
      st.setSettings(!st.settingsOpen);
      break;
    case 'new-session':
      void st.newSession();
      break;
    case 'focus-composer': {
      // The composer textarea lives inside the chat panel root (no stable id).
      const ta = document.querySelector<HTMLTextAreaElement>('.chat-panel-root textarea');
      ta?.focus();
      break;
    }
    case 'toggle-sidebar':
      st.toggleSidebar();
      break;
    case 'toggle-theme':
      st.cycleTheme();
      break;
    case 'stop-run':
      if (st.running) void st.abortAgent();
      break;
  }
}

let installed = false;

/** Install the capture-phase binder exactly once (safe to call at module scope). */
export function installShortcutsBinder(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      const chord = chordOf(e);
      if (!chord) return;
      const map = useStore.getState().settings.shortcuts;
      for (const action of Object.keys(DEFAULT_SHORTCUT_BINDINGS) as ShortcutActionId[]) {
        if (bindingFor(map, action) !== chord) continue;
        if (HANDLED_ELSEWHERE.has(action) && !map?.[action]) continue; // default owned elsewhere
        e.preventDefault();
        e.stopPropagation(); // capture phase — the hardcoded handlers never see it
        try {
          runAction(action);
        } catch {
          /* a shortcut must never crash the app */
        }
        return;
      }
    },
    true,
  );
}
