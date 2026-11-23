// ============================================================
// SADEEM settings — General section.
// Language, theme swatches, permission-mode explainer cards,
// checkpoints, onboarding re-run, recent projects.
// Also the landing section for the legacy 'permissions' id.
// ============================================================
import type { ReactNode } from 'react';
import { Check, FolderOpen, MapPin, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, Chip, IconBtn } from '../ui';
import { GroupCard, Segmented, SettingRow, Slider, Toggle } from './controls';
import type { AppSettings, PermissionMode } from '../../../shared/types';
import { THEME_META } from '../themeMeta';
import './s1-art.css';

/* ============================================================
   Shared editorial head + engraved glyphs for the six polished
   settings pages. Every drawing is authored here (no icon pack):
   a 1px, square-join stroke, at most three strokes per mark,
   each one meaningful to its page. The head owns the single
   deliberate hairline draw; motion is killed by both the OS
   preference and html.reduce-motion in s1-art.css.
   ============================================================ */
export type S1GlyphKind =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'voice'
  | 'agent'
  | 'privacy';

/** point on a circle, measured clockwise from 12 o'clock */
const s1Polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)];
};

export function S1Glyph({ kind }: { kind: S1GlyphKind }) {
  let paths: ReactNode;
  switch (kind) {
    case 'general':
      // dial + axis marker: orbit, four cardinal ticks, one pointer
      paths = (
        <>
          <path d="M20 4a16 16 0 1 0 0 32a16 16 0 1 0 0-32" />
          <path d="M20 1v7M20 32v7M1 20h7M32 20h7" />
          <path d="M20 20 31 10" />
        </>
      );
      break;
    case 'appearance':
      // two overlapping palette plates with their registration rules
      paths = (
        <>
          <path d="M6 6h20v20H6z" />
          <path d="M14 14h20v20H14z" />
          <path d="M6 34h28M34 6v28" />
        </>
      );
      break;
    case 'notifications':
      // bell outline, a measured tick triad and the quiet waveform
      paths = (
        <>
          <path d="M8 26c0-9 5-16 12-16s12 7 12 16H8zM17 30h6" />
          <path d="M20 3v4M4 13l3 2M36 13l-3 2" />
          <path d="M4 35h4l3-4 4 7 4-5 3 2h14" />
        </>
      );
      break;
    case 'voice':
      // symmetric engraved bars about the centre line + baseline
      paths = (
        <>
          <path d="M3 20h34" />
          <path d="M6 18v4M10 16v8M14 14v12M18 9v22M22 9v22M26 14v12M30 16v8M34 18v4" />
        </>
      );
      break;
    case 'agent': {
      // five roles at exact 72° spacing: orbit, spokes, node marks
      const pts = [0, 72, 144, 216, 288].map((d) => s1Polar(20, 20, 15, d));
      const orbit = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('') + 'Z';
      const spokes = pts.map((p) => `M20 20L${p[0]} ${p[1]}`).join('');
      const nodes = pts
        .map((p) => `M${p[0] - 1} ${p[1] - 1}h2v2h-2z`)
        .join('');
      paths = (
        <>
          <path d={orbit} />
          <path d={spokes} />
          <path d={nodes} />
        </>
      );
      break;
    }
    case 'privacy':
      // shield, inner contour, engraved diagonal hatch
      paths = (
        <>
          <path d="M20 3 33 8v10c0 8-5 14-13 18C12 32 7 26 7 18V8z" />
          <path d="M20 8 28 11v7c0 5-3 9-8 11-5-2-8-6-8-11v-7z" />
          <path d="M12 17l5-5M13 23l9-9M17 27l10-10M23 28l6-6" />
        </>
      );
      break;
  }
  return (
    <svg
      className="s1-glyph-svg"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={4}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

/** The refined page head used in place of SectionShell on polished pages.
 *  SectionShell's reset affordance is preserved verbatim via `onReset`. */
export function S1Page({
  eyebrow,
  titleKey,
  titleFallback,
  desc,
  glyph,
  onReset,
  className,
  children,
}: {
  eyebrow: string;
  titleKey: string;
  titleFallback: string;
  desc: string;
  glyph: S1GlyphKind;
  onReset?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className={`set-section s1-page${className ? ' ' + className : ''}`}>
      <header className="s1-head">
        <div className="s1-head-copy">
          <span className="s1-eyebrow">{eyebrow}</span>
          <h2 className="s1-title">{t(titleKey, titleFallback)}</h2>
          <p className="s1-lede">{desc}</p>
          <span className="s1-rule" aria-hidden="true" />
        </div>
        <div className="s1-head-side">
          <span className="s1-glyph"><S1Glyph kind={glyph} /></span>
          {onReset && (
            <IconBtn
              className="s1-reset"
              onClick={onReset}
              title={t('settings.reset', 'Reset to defaults')}
              aria-label={t('settings.reset', 'Reset to defaults')}
            >
              <RotateCcw size={13} />
            </IconBtn>
          )}
        </div>
      </header>
      <div className="s1-body">{children}</div>
    </section>
  );
}

// ---- theme swatch cards (shared definition — swatches come from THEME_META,
// which mirrors the real styles.css tokens). v7.2 adds the two meta themes:
// 'follow' (prefers-color-scheme) and 'high' (high contrast) — they have no
// palette swatches, so they render a distinct glyph card instead. ----
export const THEMES: { id: AppSettings['theme']; labelKey: string; label: string }[] = [
  { id: 'follow', labelKey: 'settings.theme.follow', label: 'Follow device (default)' },
  { id: 'light', labelKey: 'settings.theme.light', label: 'Light (primary)' },
  { id: 'obsidian', labelKey: 'settings.theme.obsidian', label: 'Dark (secondary)' },
  { id: 'midnight', labelKey: 'settings.theme.midnight', label: 'Deep (secondary)' },
  { id: 'soft', labelKey: 'settings.theme.soft', label: 'Carbon (secondary)' },
  { id: 'high', labelKey: 'settings.theme.high', label: 'High contrast' },
];

/** Palette-card themes (have real swatches in THEME_META). */
const isPaletteTheme = (id: AppSettings['theme']): id is 'soft' | 'obsidian' | 'midnight' | 'light' | 'follow' =>
  id === 'soft' || id === 'obsidian' || id === 'midnight' || id === 'light' || id === 'follow';

const MODES: { id: PermissionMode; nameKey: string; nameFb: string; descKey: string; descFb: string }[] = [
  { id: 'plan', nameKey: 'tb.mode.plan', nameFb: 'Plan', descKey: 'tb.mode.plan.desc', descFb: 'Read-only research, then proposes a plan' },
  { id: 'default', nameKey: 'tb.mode.default', nameFb: 'Ask', descKey: 'tb.mode.default.desc', descFb: 'Ask before every write or command' },
  { id: 'autoEdit', nameKey: 'tb.mode.autoEdit', nameFb: 'Auto-edit', descKey: 'tb.mode.autoEdit.desc', descFb: 'Auto-approve file edits, ask for commands' },
  { id: 'fullAccess', nameKey: 'tb.mode.fullAccess', nameFb: 'Full access', descKey: 'tb.mode.fullAccess.desc', descFb: 'Approve everything automatically' },
];

export function GeneralSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setLang = useStore((s) => s.setLang);
  const setMode = useStore((s) => s.setMode);
  const setSettings = useStore((s) => s.setSettings);
  const openWorkspace = useStore((s) => s.openWorkspace);
  const notify = useStore((s) => s.notify);
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';

  const rerunOnboarding = () => {
    updateSettings({ onboardingDone: false });
    notify(t('settings.general.onboarding.armed', 'The tour will start on the next launch'));
    setSettings(false);
  };

  // v7.2 — density / zoom / numerals (document-root application lives in App.tsx)
  const zoom = settings.ui?.zoom ?? 1;
  const density = settings.ui?.density ?? 'comfortable';
  const numerals = settings.numerals ?? 'western';
  const patchUi = (patch: Partial<NonNullable<AppSettings['ui']>>) =>
    updateSettings({ ui: { ...(settings.ui ?? {}), ...patch } });

  return (
    <S1Page
      className="s1-general"
      eyebrow={t('s1.eyebrow.general', ar ? '٠١ / عام' : '01 / GENERAL')}
      titleKey="settings.nav.general"
      titleFallback="General"
      glyph="general"
      desc={t(
        'settings.general.desc',
        'Language, theme and safety defaults for the whole workstation.',
      )}
    >
      {/* ---- language ---- */}
      <GroupCard>
        <SettingRow
          label={t('settings.language', 'Interface language')}
          hint={t('settings.language.hint', 'Switches the UI and text direction (RTL for Arabic)')}
        >
          <Segmented<AppSettings['language']>
            value={settings.language}
            ariaLabel={t('settings.language', 'Interface language')}
            onChange={(v) => setLang(v)}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
        </SettingRow>
      </GroupCard>

      {/* ---- theme ---- */}
      <GroupCard title={t('settings.theme', 'Theme')}>
        <div className="grid grid-cols-3 gap-2.5">
          {THEMES.map((th) => {
            const active = settings.theme === th.id;
            return (
              <button
                key={th.id}
                onClick={() => updateSettings({ theme: th.id })}
                aria-pressed={active}
                className={`card p-3 text-start transition-colors ${
                  active ? 'border-acc' : 'hover:border-[var(--dim)]'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  {th.id === 'follow' ? (
                    // follow system: split SADEEM paper / SADEEM dark glyph
                    <span
                      className="w-8 h-4 rounded-[2px] border border-[var(--line)] overflow-hidden flex"
                      aria-hidden
                    >
                      <span className="flex-1" style={{ background: '#faf9f6' }} />
                      <span className="flex-1" style={{ background: '#141413' }} />
                    </span>
                  ) : isPaletteTheme(th.id) ? (
                    THEME_META[th.id].swatch.map((c, i) => (
                      <span
                        key={i}
                        className="w-4 h-4 rounded-[2px] border border-[var(--line)]"
                        style={{ background: c }}
                      />
                    ))
                  ) : (
                    // high contrast: split black/white glyph
                    <span
                      className="w-8 h-4 rounded-[2px] border border-[var(--line)] overflow-hidden flex"
                      aria-hidden
                    >
                      <span className="flex-1" style={{ background: '#000' }} />
                      <span className="flex-1" style={{ background: '#fff' }} />
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[12px] font-medium truncate">
                    {isPaletteTheme(th.id)
                      ? lang === 'ar'
                        ? THEME_META[th.id].label.ar
                        : THEME_META[th.id].label.en
                      : t(th.labelKey, th.label)}
                  </span>
                  {active && <Check size={13} className="text-acc shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>
      </GroupCard>

      {/* ---- v7.2 zoom · density · numerals (applied live on documentElement) ---- */}
      <GroupCard title={t('set.ui.density', 'Density') + ' · ' + t('set.ui.zoom', 'Interface zoom')}>
        <SettingRow
          label={t('set.ui.zoom', 'Interface zoom')}
          hint={t('set.ui.zoom.hint', 'Scales the whole UI (0.9–1.25). Applied live.')}
        >
          <Slider
            value={zoom}
            min={0.9}
            max={1.25}
            step={0.05}
            onChange={(v) => patchUi({ zoom: v })}
            label={t('set.ui.zoom', 'Interface zoom')}
            suffix="×"
          />
        </SettingRow>
        <SettingRow
          label={t('set.ui.density', 'Density')}
          hint={t('settings.appearance.compact.hint', 'Compact density tightens chrome spacing app-wide')}
        >
          <Segmented<'comfortable' | 'compact'>
            value={density}
            ariaLabel={t('set.ui.density', 'Density')}
            onChange={(v) => patchUi({ density: v, ...(v === 'compact' ? { compact: true } : { compact: false }) })}
            options={[
              { value: 'comfortable', label: t('set.ui.density.comfortable', 'Comfortable') },
              { value: 'compact', label: t('set.ui.density.compact', 'Compact') },
            ]}
          />
        </SettingRow>
        <SettingRow
          label={t('set.ui.numerals', 'Numerals')}
          hint={t('set.ui.numerals.arabic', 'Arabic (١٢٣)') + ' / ' + t('set.ui.numerals.western', 'Western (123)')}
        >
          <Segmented<'western' | 'arabic'>
            value={numerals}
            ariaLabel={t('set.ui.numerals', 'Numerals')}
            onChange={(v) => updateSettings({ numerals: v })}
            options={[
              { value: 'western', label: t('set.ui.numerals.western', 'Western (123)') },
              { value: 'arabic', label: t('set.ui.numerals.arabic', 'Arabic (١٢٣)') },
            ]}
          />
        </SettingRow>
      </GroupCard>

      {/* ---- permission modes ---- */}
      <GroupCard title={t('settings.mode', 'Default permission mode')}>
        <div className="grid grid-cols-2 gap-2.5">
          {MODES.map((m) => {
            const active = settings.permissionMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                aria-pressed={active}
                className={`card p-3 text-start transition-colors ${
                  active ? 'border-acc' : 'hover:border-[var(--dim)]'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[12.5px] font-semibold">{t(m.nameKey, m.nameFb)}</span>
                  {active ? (
                    <Check size={13} className="text-acc shrink-0" />
                  ) : (
                    <Chip>{m.id}</Chip>
                  )}
                </div>
                <div className="text-[10.5px] text-dim leading-relaxed">
                  {t(m.descKey, m.descFb)}
                </div>
              </button>
            );
          })}
        </div>

        <SettingRow
          label={t('settings.checkpoints', 'Create checkpoints before agent edits')}
          hint={t('settings.checkpoints.hint', 'Snapshots let you restore any file the agent changed')}
        >
          <Toggle
            checked={settings.checkpointsEnabled}
            onChange={(v) => updateSettings({ checkpointsEnabled: v })}
            label={t('settings.checkpoints', 'Create checkpoints before agent edits')}
          />
        </SettingRow>
      </GroupCard>

      {/* ---- onboarding ---- */}
      <GroupCard>
        <SettingRow
          label={t('settings.general.onboarding', 'Onboarding tour')}
          hint={t(
            'settings.general.onboarding.hint',
            'Walks through language, workspace and model setup. Runs again on the next launch.',
          )}
        >
          <Btn onClick={rerunOnboarding}>
            <Play size={12} className="inline-block me-1.5" />
            {t('settings.general.onboarding.run', 'Re-run tour')}
          </Btn>
        </SettingRow>
      </GroupCard>

      {/* ---- recent projects ---- */}
      <GroupCard title={t('settings.general.recent', 'Recent projects')}>
        {(settings.recentPaths ?? []).length === 0 ? (
          <div className="text-[11.5px] text-[var(--faint)] py-1.5 flex items-center gap-2">
            <MapPin size={13} />
            {t('settings.general.recent.empty', 'No recent folders yet')}
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto pe-1 mb-2 set-scroll">
              {settings.recentPaths.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => void openWorkspace(p)}
                    title={t('settings.general.recent.open', 'Open this workspace')}
                    className="w-full flex items-center gap-2 rounded-[8px] px-2 h-8 text-start hover:bg-[var(--panel2)] transition-colors"
                  >
                    <FolderOpen size={13} className="text-[var(--acc2)] shrink-0" />
                    <span className="font-code text-[11.5px] truncate" dir="ltr">
                      {p}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <Btn
                variant="ghost"
                onClick={() => updateSettings({ recentPaths: [] })}
              >
                <Trash2 size={12} className="inline-block me-1.5" />
                {t('settings.general.recent.clear', 'Clear list')}
              </Btn>
            </div>
          </>
        )}
      </GroupCard>
    </S1Page>
  );
}

export default GeneralSection;
