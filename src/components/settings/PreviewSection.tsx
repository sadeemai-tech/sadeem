// ============================================================
// SADEEM settings — Preview section.
// Defaults applied when the live preview opens: auto-detect,
// device frame, console panel, auto-refresh, zoom. Resettable.
// ============================================================
import { RotateCcw } from 'lucide-react';
import { useStore } from '../../store';
import { useT, useDigits } from '../../i18n';
import { IconBtn } from '../ui';
import { GroupCard, SettingRow, Slider, TextRow, Toggle } from './controls';
import type { AppSettings } from '../../../shared/types';
import './s3-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

export const PREVIEW_DEFAULTS: NonNullable<AppSettings['preview']> = {
  autoDetect: true,
  deviceFrame: false,
  console: false,
  autoRefresh: true,
  zoom: 100,
  customCommand: '',
};

export function PreviewSection() {
  const t = useT();
  const n = useDigits();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);

  const preview = settings.preview ?? {};
  const patch = (p: Partial<NonNullable<AppSettings['preview']>>) =>
    updateSettings({ preview: { ...PREVIEW_DEFAULTS, ...preview, ...p } });

  const resetPreview = () => {
    updateSettings({ preview: { ...PREVIEW_DEFAULTS } });
    notify(t('settings.saved', 'Saved'));
  };

  return (
    <section className="set-section s3-page">
      {/* ---------- refined page head · 08 / LIVE PREVIEW ---------- */}
      <header className="s3-head">
        <div className="s3-glyph-wrap">
          {/* a framed viewport with a folded top-right corner */}
          <svg className="s3-glyph" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M6 6h22l6 6v22H6z" />
            <path d="M28 6v6h6" />
            <path className="quiet" d="M11 27h14M11 31h9" />
          </svg>
        </div>
        <div className="s3-head-copy">
          <div className="s3-eyebrow">
            <span className="no">{n('08')}</span>
            <span className="slash">/</span>
            {t('set.group.preview', tx('LIVE PREVIEW', 'المعاينة الحية'))}
          </div>
          <h2 className="s3-display">{t('set.group.preview', tx('Live preview', 'المعاينة الحية'))}</h2>
          <p className="s3-desc">
            {t(
              'settings.preview.desc',
              'Defaults used the next time the live preview opens. Existing preview sessions keep their state.',
            )}
          </p>
        </div>
        <IconBtn
          className="s3-reset"
          onClick={resetPreview}
          title={t('settings.reset', 'Reset to defaults')}
          aria-label={t('settings.reset', 'Reset to defaults')}
        >
          <RotateCcw size={13} />
        </IconBtn>
        <span className="s3-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · miniature wireframe ---------- */}
      <div className="s3-plate s3-plate--preview" aria-hidden="true">
        <svg viewBox="0 0 320 200">
          {/* 16:10 viewport */}
          <rect x="20" y="13" width="280" height="175" />
          <line className="quiet" x1="20" y1="39" x2="300" y2="39" />
          <circle className="dot" cx="31" cy="26" r="2.1" />
          <circle className="dot" cx="39" cy="26" r="2.1" />
          <circle className="dot" cx="47" cy="26" r="2.1" />
          <line className="quiet" x1="100" y1="39" x2="100" y2="188" />
          {/* content: header, two text rails, a 4:3 figure + a side rail */}
          <rect className="quiet" x="112" y="51" width="150" height="12" />
          <line className="quiet" x1="112" y1="77" x2="250" y2="77" />
          <line className="quiet" x1="112" y1="85" x2="226" y2="85" />
          <rect x="112" y="99" width="96" height="72" />
          <path className="quiet" d="M112 157l30-30 22 22 18-16 26 24" />
          <circle className="dot" cx="133" cy="113" r="2" />
          <rect className="quiet" x="220" y="99" width="42" height="72" />
          <line className="quiet" x1="220" y1="117" x2="256" y2="117" />
          <line className="quiet" x1="220" y1="127" x2="248" y2="127" />
          <line className="quiet" x1="112" y1="181" x2="288" y2="181" />
        </svg>
      </div>

      <div className="s3-groups">
      <GroupCard title={t('settings.preview.behaviour', 'Behaviour')}>
        <SettingRow
          label={t('settings.preview.autoDetect', 'Auto-detect dev servers')}
          hint={t(
            'settings.preview.autoDetect.hint',
            'Watch package scripts and running ports to find the dev URL automatically',
          )}
        >
          <Toggle
            checked={preview.autoDetect !== false}
            onChange={(v) => patch({ autoDetect: v })}
            label={t('settings.preview.autoDetect', 'Auto-detect dev servers')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.preview.autoRefresh', 'Auto-refresh on file changes')}
          hint={t(
            'settings.preview.autoRefresh.hint',
            'Reload the preview when files in the workspace change',
          )}
        >
          <Toggle
            checked={preview.autoRefresh !== false}
            onChange={(v) => patch({ autoRefresh: v })}
            label={t('settings.preview.autoRefresh', 'Auto-refresh on file changes')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.preview.deviceFrame', 'Device frame by default')}
          hint={t(
            'settings.preview.deviceFrame.hint',
            'Open the preview inside a phone/tablet frame for responsive checks',
          )}
        >
          <Toggle
            checked={preview.deviceFrame === true}
            onChange={(v) => patch({ deviceFrame: v })}
            label={t('settings.preview.deviceFrame', 'Device frame by default')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.preview.console', 'Show console panel')}
          hint={t(
            'settings.preview.console.hint',
            'Pin the JavaScript console under the preview viewport',
          )}
        >
          <Toggle
            checked={preview.console === true}
            onChange={(v) => patch({ console: v })}
            label={t('settings.preview.console', 'Show console panel')}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('settings.preview.runtime', 'Runtimes')}>
        <SettingRow
          label={t('settings.preview.customCommand', 'Custom dev-server command')}
          hint={t(
            'settings.preview.customCommand.hint',
            'ANY runtime — Go, Rust, PHP, Rails… run from the workspace root; the URL and port are auto-detected. Example: go run ./cmd/server',
          )}
        >
          <TextRow
            value={preview.customCommand ?? ''}
            placeholder="go run ./cmd/server"
            onChange={(v) => patch({ customCommand: v })}
            label={t('settings.preview.customCommand', 'Custom dev-server command')}
            mono
          />
        </SettingRow>
        <div className="text-[11px] text-dim leading-relaxed px-1">
          {t(
            'settings.preview.runtimesHint',
            'Detected automatically: npm/Node frameworks (Vite, Next, Nuxt, Angular, Astro, Expo) and Python (Django, FastAPI/uvicorn, Flask, app.py/main.py). No package.json required anymore.',
          )}
        </div>
      </GroupCard>

      <GroupCard title={t('settings.preview.zoom', 'Zoom level')}>
        <SettingRow
          label={t('settings.preview.zoom', 'Zoom level')}
          hint={t('settings.preview.zoom.hint', 'Default viewport zoom, 50–150%')}
        >
          <Slider
            value={preview.zoom ?? 100}
            min={50}
            max={150}
            step={5}
            onChange={(v) => patch({ zoom: v })}
            label={t('settings.preview.zoom', 'Zoom level')}
            suffix="%"
          />
        </SettingRow>
      </GroupCard>
      </div>
    </section>
  );
}

export default PreviewSection;
