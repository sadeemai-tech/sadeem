// ============================================================
// SADEEM settings — Keyboard Shortcuts section (v10.3, v11.4 rebind).
// v11.4: the six core actions are REBINDABLE for real — rows show the
// current binding, "Change" captures the next keydown, "Reset all" clears
// the overrides. Capture/resolve logic lives in shortcutsBinder.ts.
// The masthead + keyboard-grid glyph are presentation only; every
// binding, key and IPC path is unchanged.
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Kbd, Btn } from '../ui';
import { shortcutSections } from '../ShortcutsOverlay';
import { GroupCard, InfoNote, SettingRow } from './controls';
import './s4-art.css';
import {
  SHORTCUT_ACTIONS,
  bindingFor,
  chordOf,
  installShortcutsBinder,
  type ShortcutActionId,
} from './shortcutsBinder';

// v11.4 — REAL EFFECT: the app-wide binder installs at boot (this module is
// statically imported by SettingsModal → App). Idempotent.
installShortcutsBinder();

/** One precise artistic element of this page: a keyboard grid — a plate
 *  of 1px keycaps with one wide space bar, drawn in currentColor ink. */
const KeyboardGridGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <rect className="s4-ink" x="6" y="13" width="60" height="32" rx="2" />
    <path className="s4-ink" d="M13 20h7M24 20h7M35 20h7M46 20h7M57 20h2M13 29h7M24 29h7M35 29h18M57 29h2M13 38h32M49 38h10" />
    <circle className="s4-dot" cx="10" cy="13" r="1.2" />
    <circle className="s4-dot" cx="62" cy="13" r="1.2" />
  </svg>
);

export function ShortcutsSection() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setShortcuts = useStore((s) => s.setShortcuts);
  const sections = shortcutSections(t);

  const map = settings.shortcuts ?? {};
  const [capturing, setCapturing] = useState<ShortcutActionId | null>(null);
  const captureRef = useRef<ShortcutActionId | null>(null);
  captureRef.current = capturing;

  // Capture mode: the NEXT qualifying keydown becomes the binding.
  useEffect(() => {
    if (!capturing) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null); // cancel, keep the old binding
        return;
      }
      const chord = chordOf(e);
      if (!chord) return; // bare modifiers / plain letters are never bindings
      const id = captureRef.current;
      if (!id) return;
      updateSettings({ shortcuts: { ...(settings.shortcuts ?? {}), [id]: chord } });
      setCapturing(null);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [capturing, settings.shortcuts, updateSettings]);

  const clearBinding = (id: ShortcutActionId) => {
    const next = { ...(settings.shortcuts ?? {}) };
    delete next[id];
    updateSettings({ shortcuts: next });
  };

  return (
    <div className="s4-page s4-shortcuts">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.shortcuts.eyebrow', ar ? '١٨ / لوحة المفاتيح' : '18 / KEYBOARD')}
          </span>
          <KeyboardGridGlyph />
        </div>
        <h2 className="s4-title">
          {t('settings.nav.shortcuts', t('shortcuts.title', 'Keyboard shortcuts'))}
        </h2>
        <p className="s4-desc">
          {t(
            'settings.shortcuts.desc',
            ar
              ? 'كل اختصارات سديم. أعد ربط الأفعال الأساسية، ويُطبَّق الربط فوراً في كل التطبيق.'
              : 'Every shortcut in SADEEM. Rebind the core actions — the binding applies app-wide instantly.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        <GroupCard title={t('settings.shortcuts.rebind', ar ? 'إعادة الربط' : 'Rebindable actions')}>
          <div className="flex flex-col gap-0.5">
            {SHORTCUT_ACTIONS.map((a) => {
              const overridden = !!map[a.id];
              const binding = bindingFor(map, a.id);
              return (
                <SettingRow
                  key={a.id}
                  label={t(`settings.shortcuts.${a.id}`, ar ? a.ar : a.en)}
                  hint={
                    capturing === a.id
                      ? t('settings.shortcuts.press', ar ? 'اضغط المفاتيح الآن (Esc للإلغاء)' : 'Press the keys now (Esc to cancel)')
                      : t(`settings.shortcuts.${a.id}.hint`, ar ? a.hintAr : a.hintEn)
                  }
                >
                  <span className="flex items-center gap-1.5 shrink-0">
                    {overridden && (
                      <span
                        className="stamp !h-[16px] !px-1.5 text-[9px]"
                        title={t('settings.shortcuts.overridden', ar ? 'ربط مخصص' : 'custom binding')}
                      >
                        {t('settings.shortcuts.overridden', ar ? 'مخصص' : 'custom')}
                      </span>
                    )}
                    <Kbd className="tnum font-code">{capturing === a.id ? '…' : binding}</Kbd>
                    <Btn
                      className="!h-[24px] !px-2 !text-[10.5px]"
                      variant={capturing === a.id ? 'primary' : 'ghost'}
                      onClick={() => setCapturing(capturing === a.id ? null : a.id)}
                    >
                      {capturing === a.id
                        ? t('settings.shortcuts.cancel', ar ? 'إلغاء' : 'Cancel')
                        : t('settings.shortcuts.change', ar ? 'تغيير' : 'Change')}
                    </Btn>
                    {overridden && (
                      <button
                        className="text-[10px] text-faint hover:text-acc underline underline-offset-2 cursor-pointer"
                        onClick={() => clearBinding(a.id)}
                      >
                        {t('settings.shortcuts.resetOne', ar ? 'استعادة' : 'Reset')}
                      </button>
                    )}
                  </span>
                </SettingRow>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Btn
              className="!h-[26px] !text-[11px]"
              onClick={() => updateSettings({ shortcuts: {} })}
              disabled={Object.keys(map).length === 0}
            >
              {t('settings.shortcuts.resetAll', ar ? 'استعادة الكل' : 'Reset all')}
            </Btn>
            <span className="text-[10.5px] text-[var(--faint)] flex-1 min-w-0" dir="auto">
              {t(
                'settings.shortcuts.rebindNote',
                ar
                  ? 'الربط يجب أن يتضمن Ctrl/Alt (أو مفتاح F). الأفعال المربوطة في هيكل التطبيق أو القائمة تحتفظ بمفاتيحها الأصلية حتى تُغيَّر.'
                  : 'Bindings must include Ctrl/Alt (or an F-key). Shell- and menu-handled actions keep their stock keys until you override them.',
              )}
            </span>
          </div>
        </GroupCard>

        <GroupCard>
          <div className="flex items-center gap-2.5">
            <Keyboard size={14} className="text-acc shrink-0" aria-hidden />
            <span className="text-[11.5px] text-dim flex-1" dir="auto">
              {t('settings.shortcuts.openOverlay', 'Prefer the floating cheatsheet?')}
            </span>
            <Btn className="!h-[26px] !text-[11px]" onClick={() => setShortcuts(true)}>
              {t('settings.shortcuts.show', 'Show cheatsheet')}
            </Btn>
          </div>
        </GroupCard>

        {sections.map((sec) => (
          <GroupCard key={sec.no} title={sec.title}>
            <div className="flex flex-col gap-1">
              {sec.rows.map((r, i) => (
                <div
                  key={`${sec.no}-${i}`}
                  className="flex items-center justify-between gap-3 px-1 py-1 rounded-[6px] row-hover"
                >
                  <span className="text-[11.5px] text-dim" dir="auto">
                    {r.label}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {r.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </GroupCard>
        ))}

        <InfoNote>
          {t(
            'settings.shortcuts.honestNote',
            ar
              ? 'أوراق الغش أعلاه تعرض المفاتيح المدمجة؛ ربطك المخصص يظهر في بطاقة "إعادة الربط" وهو المُفعَّل فعلياً.'
              : 'The cheatsheet above shows the built-in keys; your overrides in the Rebindable actions card are what actually fire.',
          )}
        </InfoNote>
      </div>
    </div>
  );
}

export default ShortcutsSection;
