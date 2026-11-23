// SADEEM — keyboard shortcuts cheat-sheet overlay.
// v10: a two-column kbd cheat-sheet in one 14px float panel (.glass-strong)
// on the sanctioned .scrim-glass scrim, opening on the shared pop curve;
// sections as .micro-label groups, rows in the .keyrow grammar with mono
// .kbd chips right-aligned. Reads `shortcutsOpen` from the store; Esc /
// click-outside / X all close it via setShortcuts(false).
//
// Binding truthfulness: every row below mirrors an accelerator that exists
// TODAY — global keys in App.tsx (Ctrl+K, Ctrl+Shift+P, Ctrl+Shift+F,
// Ctrl+S, Ctrl+`, Ctrl+B, Ctrl+M), the Electron menu (Ctrl+O, Ctrl+N,
// Ctrl+Shift+V, Ctrl+,) and the editor/composer (Ctrl+I, Ctrl+Shift+E,
// Enter / Shift+Enter / ↑↓). Nothing invented.
import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Kbd, MOD_KEY } from './ui';

interface ScRow {
  keys: string[];
  label: string;
}

/** Platform-aware display for the modifier (⌘ on macOS, Ctrl elsewhere). */
const mod = (): string => MOD_KEY;

/**
 * Shared shortcut table — used by the floating overlay AND the Settings →
 * Keyboard Shortcuts section (single source of truth, never duplicated).
 */
export function shortcutSections(
  t: (key: string, fallback?: string) => string,
): { title: string; no: string; rows: ScRow[] }[] {
  const M = mod();
  return [
    {
      no: '01',
      title: t('shortcuts.nav', 'Navigation'),
      rows: [
        { keys: [`${M}+K`], label: t('sc.palette', 'Command palette') },
        { keys: [`${M}+Shift+P`], label: t('sc.paletteAlso', 'Command palette (alternative)') },
        // v11.31 — App.tsx wires Ctrl+P to the same palette (Quick Open).
        // The cheat sheet omitted it while claiming to list every binding.
        { keys: [`${M}+P`], label: t('sc.quickOpen', 'Quick open · فتح سريع') },
        { keys: [`${M}+Shift+F`], label: t('pal.toggleSearch', 'Toggle global search') },
        { keys: [`${M}+O`], label: t('palette.openFolder', 'Open folder…') },
        { keys: [`${M}+N`], label: t('palette.newSession', 'New session') },
        { keys: [`${M}+B`], label: t('palette.toggleSidebar', 'Toggle sidebar') },
        { keys: [`${M}+\``], label: t('palette.toggleTerminal', 'Toggle terminal') },
      ],
    },
    {
      no: '02',
      title: t('shortcuts.files', 'Files & editor'),
      rows: [
        { keys: [`${M}+S`], label: t('palette.saveAll', 'Save all files') },
        { keys: [`${M}+I`], label: t('sc.inlineEdit', 'Inline AI edit (in the editor)') },
        { keys: [`${M}+Shift+E`], label: t('sc.explain', 'Explain selection to chat (editor)') },
      ],
    },
    {
      no: '03',
      title: t('shortcuts.agent', 'Agent & chat'),
      rows: [
        { keys: ['↵'], label: t('sc.send', 'Send message') },
        { keys: ['Shift+↵'], label: t('sc.newline', 'New line in the composer') },
        { keys: ['↑↓'], label: t('sc.suggestions', 'Navigate composer suggestions') },
        { keys: [`${M}+M`], label: t('palette.changeModel', 'Change AI model…') },
      ],
    },
    {
      no: '04',
      title: t('shortcuts.view', 'View & panels'),
      rows: [
        { keys: [`${M}+Shift+V`], label: t('palette.togglePreview', 'Toggle live preview') },
        { keys: [`${M}+,`], label: t('palette.openSettings', 'Open settings') },
        { keys: ['esc'], label: t('sc.esc', 'Close overlays · clear composer') },
      ],
    },
  ];
}

export function ShortcutsOverlay() {
  const t = useT();
  const open = useStore((s) => s.shortcutsOpen);
  const setShortcuts = useStore((s) => s.setShortcuts);

  // Esc closes (click-outside handled on the backdrop).
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShortcuts(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, setShortcuts]);

  if (!open) return null;

  const sections = shortcutSections(t);

  return (
    <div
      className="scrim-glass fixed inset-0 flex items-center justify-center p-6"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setShortcuts(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.title', 'Keyboard shortcuts')}
    >
      <div
        className="glass-strong w-[640px] max-w-[96vw] max-h-[82vh] flex flex-col overflow-hidden anim-glass-pop"
        style={{
          borderRadius: 'var(--radius-lg, 14px)',
          boxShadow: 'var(--sh-float)',
        }}
      >
        {/* header */}
        <div
          className="h-11 shrink-0 flex items-center gap-3 ps-4 pe-2.5"
          style={{ borderBottom: '1px solid var(--line-soft)' }}
        >
          <span className="caps caps-md flex-1 min-w-0 truncate" dir="auto">
            {t('shortcuts.title', 'Keyboard shortcuts')}
          </span>
          <button className="ibtn !w-8 !h-8" onClick={() => setShortcuts(false)} aria-label={t('shortcuts.close', 'Close')} title={t('shortcuts.close', 'Close')}>
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>

        {/* two-column cheat-sheet */}
        <div className="overflow-y-auto set-scroll py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 items-start">
            {sections.map((sec) => (
              <section key={sec.no} aria-label={sec.title}>
                <div className="micro-label px-4 pt-3 pb-1 flex items-center gap-2 select-none" dir="auto">
                  <span className="tnum" style={{ color: 'var(--acc2)' }}>
                    {sec.no}
                  </span>
                  <span dir="auto">{sec.title}</span>
                </div>
                <div className="flex flex-col" style={{ borderBottom: '1px solid var(--line-soft)' }}>
                  {sec.rows.map((r) => (
                    <div key={r.label} className="keyrow !py-[6px] px-4">
                      <span className="text-[12px] text-dim truncate min-w-0 flex-1" dir="auto">
                        {r.label}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {r.keys.map((k) => (
                          <Kbd key={k} className="tnum font-code">
                            {k}
                          </Kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* footer */}
        <div className="h-8 shrink-0 border-t border-line flex items-center px-4 text-[10px] text-faint">
          <span className="truncate min-w-0" dir="auto">
            {t('sc.footerHint', 'Shortcuts work everywhere unless a text field captures them')}
          </span>
          <span className="ms-auto flex items-center gap-1.5 shrink-0">
            <Kbd className="tnum">esc</Kbd>
            <span dir="auto">{t('shortcuts.close', 'Close')}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default ShortcutsOverlay;
