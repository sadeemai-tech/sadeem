// ============================================================
// SADEEM settings — Appearance section (v2.7 audit hardening).
// First-class pane 02. Order top-to-bottom:
//   0. Live preview strip — a painted mini window (titlebar +
//      card + buttons) rendered ONLY from document CSS vars
//      (--bg/--acc/--glass-*) so it re-paints instantly with
//      every theme / glass / accent / ambient change. No JS
//      color wiring, no hardcoded colors.
//   1. Language — EN/AR segmented (same setLang path as 01).
//   2. Theme & Glass — theme swatch cards (real palette values
//      from THEME_META; same updateSettings({theme}) path as 01)
//      plus the Liquid Glass v6/v7 layer: intensity, ambient
//      aurora, specular edges, accent tint.
//   3. Typography — editor + terminal font size, live previews.
//   4. Layout & density — compact toggle + transcript measure.
//   5. Motion — reduce-motion + animation speed scale.
// Reset (header icon + ghost footer button) restores every field
// this pane owns to the documented defaults, preserving the
// unrelated ui.sidebarWidth drag state, and confirms via toast.
// ============================================================
import { Check, RotateCcw } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn } from '../ui';
import { pushToast } from '../Toasts';
import { S1Page, THEMES } from './GeneralSection';
import { THEME_META, type ThemeMeta } from '../themeMeta';
import { GroupCard, Segmented, SettingRow, Slider, Toggle } from './controls';
import type { AppSettings } from '../../../shared/types';
import './s1-art.css';

type GlassLevel = NonNullable<NonNullable<AppSettings['ui']>['glassLevel']>;
type AccentTint = NonNullable<NonNullable<AppSettings['ui']>['accent']>;
type ChatWidth = NonNullable<NonNullable<AppSettings['ui']>['chatWidth']>;

/** Sane defaults for everything this section owns (also the reset target). */
const UI_DEFAULTS: NonNullable<AppSettings['ui']> = {
  reduceMotion: false,
  compact: false,
  glassLevel: 'medium',
  ambientGlow: true,
  // v1131 — no accent control exists (palette law: one fixed accent), so the
  // reset target must not reintroduce the dead `ui.accent` value.
  chatWidth: 'cozy',
  motionSpeed: 1,
  specularEdges: true, // v2.4 documented default: ON
};

/** v11.3 — ACCENT_SWATCHES removed by palette law: ONE lemon accent for
 *  every theme. The picker UI is gone; ui.accent stays a stored no-op for
 *  settings-file compatibility. */

/** Per-theme painted preview card (Appearance section) — every pixel
 *  comes from THEME_META values (swatch + ui tones), never from tokens,
 *  so the card previews the TARGET theme, not the current one. */
function ThemePreview({ meta }: { meta: ThemeMeta }) {
  return (
    <span
      className="thm-prev"
      aria-hidden
      style={
        {
          background: meta.swatch[0],
          '--thm-line': meta.ui.line,
          '--thm-acc': meta.swatch[2],
          '--thm-acc2': meta.swatch[3],
          '--thm-ink': meta.ui.ink,
          '--thm-dim': meta.ui.dim,
        } as React.CSSProperties
      }
    >
      <span className="thm-prev-side" />
      <span className="thm-prev-bar" />
      <span className="thm-prev-line" />
      <span className="thm-prev-line thm-prev-line2" />
      <span className="thm-prev-dot" />
    </span>
  );
}

// ---------------- live appearance preview strip ----------------
/**
 * Painted mini window that mirrors the CURRENT theme/glass/accent.
 * Purely CSS-var driven: --glass-bg/-blur/-saturate/-shadow follow
 * html[data-glass], --acc/--acc2 follow html[data-accent + theme],
 * so the strip updates with zero prop wiring. `ambientOn` only dims
 * the painted backdrop blobs (the aurora's visual proxy).
 */
function AppearancePreview({ ambientOn, specularOn }: { ambientOn: boolean; specularOn: boolean }) {
  const t = useT();
  return (
    <div
      className="appx-strip"
      data-spec={specularOn ? 'on' : 'off'}
      role="img"
      aria-label={t('settings.appearance.preview', 'Appearance preview')}
    >
      <div className="appx-strip-head">
        <span className="caps text-[10.5px] text-[var(--faint)]">
          {t('settings.appearance.preview', 'Appearance preview')}
        </span>
        <span className="appx-live">
          <span className="appx-live-dot" aria-hidden />
          {t('settings.appearance.preview.live', 'LIVE')}
        </span>
      </div>
      {/* painted backdrop — gives the glass blur something to catch */}
      <div className="appx-stage" style={{ opacity: ambientOn ? 1 : 0.35 }} aria-hidden>
        <span className="appx-blob appx-blob-a" />
        <span className="appx-blob appx-blob-b" />
      </div>
      {/* mini window on real glass tokens */}
      <div className="appx-mock" aria-hidden>
        <div className="appx-titlebar">
          <span className="appx-dot" style={{ background: 'var(--acc)' }} />
          <span className="appx-dot" style={{ background: 'var(--acc2)' }} />
          <span className="appx-dot" style={{ background: 'var(--warn)' }} />
          <span className="appx-tt" />
        </div>
        <div className="appx-body">
          <div className="appx-card">
            <span className="appx-line appx-line-hl" />
            <span className="appx-line" />
            <span className="appx-line appx-line-short" />
          </div>
          <div className="appx-side">
            <span className="appx-btn" />
            <span className="appx-btn appx-btn-ghost" />
            <span className="appx-chip" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setLang = useStore((s) => s.setLang);
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';

  const ui = settings.ui ?? {};
  const reduceMotion = ui.reduceMotion === true;
  const compact = ui.compact === true;
  const glassLevel: GlassLevel = ui.glassLevel ?? 'medium';
  const ambientGlow = ui.ambientGlow !== false; // default ON
  const specularEdges = ui.specularEdges !== false; // default ON
  // v11.3 — accent is fixed lemon; the stored value is kept but unused.
  const chatWidth: ChatWidth = ui.chatWidth ?? 'cozy';
  const motionSpeed = ui.motionSpeed ?? 1;

  const patchUi = (patch: Partial<NonNullable<AppSettings['ui']>>) =>
    updateSettings({ ui: { ...(settings.ui ?? {}), ...patch } });

  const resetUi = () => {
    // Restore every field this pane owns; keep the unrelated
    // ui.sidebarWidth drag state (v2.4) untouched.
    const sidebarWidth = settings.ui?.sidebarWidth;
    updateSettings({
      ui: {
        ...UI_DEFAULTS,
        ...(typeof sidebarWidth === 'number' ? { sidebarWidth } : {}),
      },
    });
    pushToast({
      title: t('settings.appearance.reset.done', 'Appearance restored to defaults'),
      severity: 'success',
    });
  };

  return (
    <S1Page
      className="s1-appearance"
      eyebrow={t('s1.eyebrow.appearance', ar ? '٠٢ / المظهر' : '02 / APPEARANCE')}
      titleKey="settings.nav.appearance"
      titleFallback="Appearance"
      glyph="appearance"
      desc={t(
        'settings.appearance.desc',
        'Glass, type, layout and motion. Every control applies to the whole app immediately.',
      )}
      onReset={resetUi}
    >
      {/* ---- 0 · live appearance preview ---- */}
      <AppearancePreview ambientOn={ambientGlow} specularOn={specularEdges} />

      {/* ---- 1 · language (same setLang path as General) ---- */}
      <GroupCard title={t('settings.language', 'Interface language')}>
        <SettingRow
          label={t('settings.language', 'Interface language')}
          hint={t('settings.language.hint', 'Interface language — restart not required')}
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

      {/* ---- 2 · theme & glass (Liquid Glass v6/v7) ---- */}
      <GroupCard title={t('settings.appearance.glassGroup', 'Theme & Glass')}>
        {/* theme cards — labels + painted previews come straight from
            THEME_META (SADEEM-labeled, real palette values). The 'follow'
            and 'high' meta themes keep their split glyph cards. */}
        <div className="grid grid-cols-3 gap-2.5 mb-1">
          {THEMES.map((th) => {
            const active = settings.theme === th.id;
            const meta: ThemeMeta | null =
              th.id === 'soft' || th.id === 'obsidian' || th.id === 'midnight' || th.id === 'light'
                ? THEME_META[th.id]
                : null;
            const label = meta
              ? lang === 'ar'
                ? meta.label.ar
                : meta.label.en
              : t(th.labelKey, th.label);
            return (
              <button
                key={th.id}
                onClick={() => updateSettings({ theme: th.id })}
                aria-pressed={active}
                aria-label={label}
                title={label}
                className={`card p-3 text-start transition-colors cursor-pointer ${
                  active ? 'border-acc' : 'hover:border-[var(--dim)]'
                }`}
              >
                {meta ? (
                  <ThemePreview meta={meta} />
                ) : (
                  <span
                    className="w-[34px] h-4 rounded-[2px] border border-[var(--line)] overflow-hidden flex mb-2"
                    aria-hidden
                  >
                    <span
                      className="flex-1"
                      style={{ background: th.id === 'follow' ? '#faf9f6' : '#000' }}
                    />
                    <span
                      className="flex-1"
                      style={{ background: th.id === 'follow' ? '#141413' : '#fff' }}
                    />
                  </span>
                )}
                <div className="flex items-center justify-between gap-1 mt-2">
                  <span className="text-[12px] font-medium truncate">
                    {label}
                  </span>
                  {active && <Check size={13} className="text-acc shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>
        <div className="def-desc mb-2">
          {t(
            'settings.appearance.theme.hint',
            'Paints every surface — swatches show the real palette',
          )}
        </div>

        <SettingRow
          label={t('settings.appearance.glass', 'Glass intensity')}
          hint={t(
            'settings.appearance.glass.hint',
            'Backdrop blur depth for panels, modals, menus and cards — Strong is the deepest frost',
          )}
        >
          <Segmented<GlassLevel>
            value={glassLevel}
            ariaLabel={t('settings.appearance.glass', 'Glass intensity')}
            onChange={(v) => patchUi({ glassLevel: v })}
            options={[
              { value: 'off', label: t('settings.appearance.glass.off', 'Off') },
              { value: 'soft', label: t('settings.appearance.glass.soft', 'Soft') },
              { value: 'medium', label: t('settings.appearance.glass.medium', 'Medium') },
              { value: 'strong', label: t('settings.appearance.glass.strong', 'Strong') },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.appearance.ambient', 'Ambient glow')}
          hint={t(
            'settings.appearance.ambient.hint',
            'A slow aurora of light behind the window — glass surfaces pick it up as depth',
          )}
        >
          <Toggle
            checked={ambientGlow}
            onChange={(v) => patchUi({ ambientGlow: v })}
            label={t('settings.appearance.ambient', 'Ambient glow')}
          />
        </SettingRow>

        {/* v2.4 — Liquid Glass v7 specular edges */}
        <SettingRow
          label={t('set.appear.specular', 'Specular glass edges')}
          hint={t(
            'set.appear.specularHint.v1131',
            ar
              ? 'بريق ضوئي خفيف على حواف النوافذ واللوحات.'
              : 'Subtle light-catching highlights on window and panel edges.',
          )}
        >
          <Toggle
            checked={specularEdges}
            onChange={(v) => patchUi({ specularEdges: v })}
            label={t('set.appear.specular', 'Specular glass edges')}
          />
        </SettingRow>

        {/* v11.3 — accent picker REMOVED by palette law: the accent is ONE
            lemon for everyone. data-accent remaps in styles.css are inert. */}
      </GroupCard>

      {/* ---- 3 · typography ---- */}
      <GroupCard title={t('settings.appearance.typography', 'Typography')}>
        <SettingRow
          label={t('settings.fontSize', 'Editor font size')}
          hint={t('settings.fontSize.hint', '12–20 px — applied to every editor tab')}
        >
          <Slider
            value={Math.max(12, Math.min(20, settings.fontSize))}
            min={12}
            max={20}
            onChange={(v) => updateSettings({ fontSize: v })}
            label={t('settings.fontSize', 'Editor font size')}
            suffix="px"
          />
        </SettingRow>
        <div
          className="rounded-[8px] border border-[var(--line-soft)] bg-[var(--bg2)] px-3 py-2.5 mt-1"
          aria-hidden
        >
          <div
            className="font-code text-[var(--ink)] leading-relaxed whitespace-nowrap overflow-hidden"
            style={{ fontSize: settings.fontSize }}
          >
            <span className="text-[var(--acc2)]">const</span> <span className="text-[var(--warn)]">agent</span> = <span className="text-[var(--acc)]">createAgent</span>({'{'} model, mode {'}'})
          </div>
          <div className="text-[10px] text-[var(--faint)] mt-1">
            {t('settings.appearance.livePreview', 'Live preview')}
          </div>
        </div>

        <SettingRow
          label={t('settings.termFontSize', 'Terminal font size')}
          hint={t('settings.termFontSize.hint', '10–18 px — applied to the integrated terminal')}
        >
          <Slider
            value={Math.max(10, Math.min(18, settings.terminalFontSize))}
            min={10}
            max={18}
            onChange={(v) => updateSettings({ terminalFontSize: v })}
            label={t('settings.termFontSize', 'Terminal font size')}
            suffix="px"
          />
        </SettingRow>
        <div
          className="rounded-[8px] border border-[var(--line-soft)] bg-[var(--bg1)] px-3 py-2.5 mt-1"
          aria-hidden
        >
          <div
            className="font-code leading-relaxed whitespace-nowrap overflow-hidden"
            style={{ fontSize: settings.terminalFontSize, color: 'var(--dim)' }}
          >
            <span className="text-[var(--acc)]">❯</span> surnia &quot;explain this repo&quot; --mode plan{' '}
            <span className="text-[var(--faint)]">· ok, 0 errors</span>
          </div>
          <div className="text-[10px] text-[var(--faint)] mt-1">
            {t('settings.appearance.livePreview', 'Live preview')}
          </div>
        </div>
      </GroupCard>

      {/* ---- 4 · layout & density ---- */}
      <GroupCard title={t('settings.appearance.layout', 'Layout & Density')}>
        <SettingRow
          label={t('settings.ui.compact', 'Compact density')}
          hint={t(
            'settings.ui.compact.hint',
            'Tighter spacing and smaller controls across panels and lists',
          )}
        >
          <Toggle
            checked={compact}
            onChange={(v) => patchUi({ compact: v })}
            label={t('settings.ui.compact', 'Compact density')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.appearance.chatWidth', 'Transcript width')}
          hint={t(
            'settings.appearance.chatWidth.hint',
            'Measure of the chat transcript column — Cozy keeps an easy reading line',
          )}
        >
          <Segmented<ChatWidth>
            value={chatWidth}
            ariaLabel={t('settings.appearance.chatWidth', 'Transcript width')}
            onChange={(v) => patchUi({ chatWidth: v })}
            options={[
              { value: 'cozy', label: t('settings.appearance.chatWidth.cozy', 'Cozy') },
              { value: 'wide', label: t('settings.appearance.chatWidth.wide', 'Wide') },
              { value: 'full', label: t('settings.appearance.chatWidth.full', 'Full') },
            ]}
          />
        </SettingRow>
      </GroupCard>

      {/* ---- 5 · motion ---- */}
      <GroupCard title={t('settings.appearance.motion', 'Motion')}>
        <SettingRow
          label={t('settings.ui.reduceMotion', 'Reduce motion & animations')}
          hint={t(
            'settings.ui.reduceMotion.hint',
            'Disables non-essential animations and transitions across the app',
          )}
        >
          <Toggle
            checked={reduceMotion}
            onChange={(v) => patchUi({ reduceMotion: v })}
            label={t('settings.ui.reduceMotion', 'Reduce motion & animations')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.appearance.motionSpeed', 'Animation speed')}
          hint={t(
            'settings.appearance.motionSpeed.hint',
            'Scales every transition and keyframe — 0.5× brisk, 1× natural, 1.5× unhurried',
          )}
        >
          <Segmented<string>
            value={String(motionSpeed)}
            ariaLabel={t('settings.appearance.motionSpeed', 'Animation speed')}
            onChange={(v) => patchUi({ motionSpeed: Number(v) })}
            options={[
              { value: '0.5', label: '0.5×' },
              { value: '1', label: '1×' },
              { value: '1.5', label: '1.5×' },
            ]}
          />
        </SettingRow>
      </GroupCard>

      {/* ---- 6 · per-section reset (ghost, bottom) ---- */}
      <div className="card p-3.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="def-label">
            {t('settings.appearance.reset', 'Reset appearance to defaults')}
          </div>
          <div className="def-desc">
            {t(
              'settings.appearance.reset.hint.v1131',
              ar
                ? 'تستعيد الزجاج والتوهج والخطوط والتخطيط والحركة (لا يوجد إعداد لون مميّز).'
                : 'Restores glass, glow, type, layout and motion (the accent is fixed, not a setting).',
            )}
          </div>
        </div>
        <Btn variant="ghost" onClick={resetUi} className="shrink-0">
          <RotateCcw size={12} className="inline-block me-1.5" />
          {t('settings.appearance.reset.cta', 'Reset')}
        </Btn>
      </div>
    </S1Page>
  );
}

export default AppearanceSection;
