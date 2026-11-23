// ============================================================
// SADEEM settings — Terminal section.
// Terminal font size (same persisted field as Appearance), the
// Command-guard instrument (settings.terminalGuard) and — v11.4 —
// the REAL shell picker + scrollback: terminalService reads
// settings.terminal.shell when it spawns the integrated terminal and
// scales its output cap from settings.terminal.scrollback.
// ============================================================
import { useStore } from '../../store';
import { useT, useDigits } from '../../i18n';
import { GroupCard, Segmented, SettingRow, Slider } from './controls';
import type { GuardModeValue } from '../panels/SecurityPanel';
import './s3-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

/** Shell choices — 'default' follows the OS (the honest default). */
type ShellChoice = 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'wsl';
const SHELL_OPTIONS: ShellChoice[] = ['default', 'powershell', 'pwsh', 'cmd', 'bash', 'wsl'];

/** Platform-default shell readout (shown beside the picker as the honest baseline). */
function platformShell(): { shell: string; platform: string } {
  if (typeof navigator === 'undefined') return { shell: 'sh', platform: 'unknown' };
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return { shell: 'zsh', platform: 'macOS' };
  if (/Win/i.test(ua)) return { shell: 'PowerShell', platform: 'Windows' };
  return { shell: 'bash', platform: 'Linux' };
}

export function TerminalSection() {
  const t = useT();
  const n = useDigits();
  const settings = useStore((s) => s.settings);
  const lang = settings.language ?? 'en';
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  // React #185 guard: selector returns the STABLE settings.terminal object.
  const termCfg = useStore((s) => s.settings.terminal);
  const updateSettings = useStore((s) => s.updateSettings);
  const ar = settings.language === 'ar';

  const { shell: osShell, platform } = platformShell();
  const shell: ShellChoice = termCfg?.shell ?? 'default';
  const scrollback = Math.max(1000, Math.min(50_000, Math.round(termCfg?.scrollback ?? 1000)));

  // Command guard — persisted at settings.terminalGuard ('on' default)
  const guard: GuardModeValue = settings.terminalGuard ?? 'on';
  const setGuard = (v: GuardModeValue) =>
    updateSettings({ terminalGuard: v } as unknown as Partial<typeof settings>);

  return (
    <section className="set-section s3-page">
      {/* ---------- refined page head · 10 / TERMINAL ---------- */}
      <header className="s3-head">
        <div className="s3-glyph-wrap">
          {/* the prompt drawn as a single path */}
          <svg className="s3-glyph" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M9 13l8 7-8 7M20 27h12" />
          </svg>
        </div>
        <div className="s3-head-copy">
          <div className="s3-eyebrow">
            <span className="no">{n('10')}</span>
            <span className="slash">/</span>
            {t('set.group.terminal', tx('TERMINAL', 'الطرفية'))}
          </div>
          <h2 className="s3-display">{t('set.group.terminal', tx('Terminal', 'الطرفية'))}</h2>
          <p className="s3-desc">
            {t(
              'settings.terminal.desc',
              'The integrated PTY runs your platform default shell inside the workspace.',
            )}
          </p>
        </div>
        <span className="s3-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · prompt waveform ---------- */}
      <div className="s3-plate s3-plate--terminal" aria-hidden="true">
        <svg viewBox="0 0 320 96">
          {/* even 16-unit pitch, mirrored around the 48-unit centre line */}
          {[8, 14, 22, 10, 6, 18, 26, 12, 8, 16, 24, 14, 8, 20, 28, 12, 10, 6].map((h, i) => {
            const x = 40 + i * 16;
            return (
              <line
                key={i}
                className={i === 10 ? 'accent' : i % 3 === 0 ? 'mid' : ''}
                x1={x}
                x2={x}
                y1={48 - h / 2}
                y2={48 + h / 2}
              />
            );
          })}
          <line className="quiet" x1="40" y1="48" x2="312" y2="48" />
          <path d="M8 40l7 8-7 8M20 56h10" />
          <circle className="dot accent" cx="40" cy="48" r="2" />
        </svg>
      </div>

      <div className="s3-groups">
      <GroupCard title={t('settings.terminal.guard', 'Command guard')}>
        <SettingRow
          label={t('settings.terminal.guard.label', 'Command guard')}
          hint={t(
            'settings.terminal.guard.hint',
            'Every shell line is classified before it runs: dangerous commands are blocked (ON), flagged (WARN-ONLY) or passed through (OFF).',
          )}
        >
          <Segmented<GuardModeValue>
            ariaLabel={t('settings.terminal.guard', 'Command guard')}
            value={guard}
            onChange={setGuard}
            options={[
              { value: 'on', label: t('security.mode.on', 'ON') },
              { value: 'warn-only', label: t('security.mode.warnOnly', 'WARN-ONLY') },
              { value: 'off', label: t('security.mode.off', 'OFF') },
            ]}
          />
        </SettingRow>
        <div className="text-[10.5px] text-[var(--faint)] mt-1.5">
          {guard === 'on'
            ? t('settings.terminal.guard.on.hint', 'Dangerous commands are held until you approve them once.')
            : guard === 'warn-only'
              ? t('settings.terminal.guard.warn.hint', 'Dangerous commands run, but a warning toast fires first.')
              : t('settings.terminal.guard.off.hint', 'No screening — every command runs immediately.')}
        </div>
      </GroupCard>

      <GroupCard title={t('settings.termFontSize', 'Terminal font size')}>
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
            className="tnum leading-relaxed whitespace-nowrap overflow-hidden"
            style={{ fontSize: settings.terminalFontSize, color: 'var(--acc)' }}
          >
            $ npm run dev
          </div>
          <div className="text-[10px] text-[var(--faint)] mt-1">
            {t('settings.appearance.livePreview', 'Live preview')}
          </div>
        </div>
      </GroupCard>

      <GroupCard title={t('settings.terminal.shell', 'Shell')}>
        <SettingRow
          label={t('settings.terminal.shell', 'Shell')}
          hint={t(
            'settings.terminal.shell.hint',
            ar
              ? 'الصدفة التي تُشغّل أوامر الطرفية المتكاملة. الافتراضي يتبع نظام التشغيل.'
              : 'The shell that runs integrated-terminal commands. Default follows the OS.',
          )}
        >
          <Segmented<ShellChoice>
            value={SHELL_OPTIONS.includes(shell) ? shell : 'default'}
            options={SHELL_OPTIONS.map((s) => ({ value: s, label: s === 'default' ? t('settings.terminal.shell.default', ar ? 'افتراضي' : 'Default') : s }))}
            onChange={(v) => updateSettings({ terminal: { ...(termCfg ?? {}), shell: v } })}
            ariaLabel={t('settings.terminal.shell', 'Shell')}
          />
        </SettingRow>
        <div className="text-[10.5px] text-[var(--faint)] mt-1.5 leading-relaxed" dir="auto">
          {shell === 'default'
            ? t(
                'settings.terminal.shell.defaultNote',
                ar
                  ? `افتراضي: صدفة نظام التشغيل (${osShell} على ${platform}).`
                  : `Default: the OS shell (${osShell} on ${platform}).`,
              )
            : shell === 'powershell' || shell === 'pwsh' || shell === 'cmd' || shell === 'wsl'
              ? t(
                  'settings.terminal.shell.winNote',
                  ar
                    ? 'خيار Windows — على الأنظمة الأخرى يُستخدم bash تواماً مع نظام التشغيل.'
                    : 'A Windows choice — on other systems SADEEM falls back to the OS bash.',
                )
              : t(
                  'settings.terminal.shell.bashNote',
                  ar
                    ? 'bash — مستخدم على لينكس/ماك؛ على Windows يتطلب bash.exe على PATH.'
                    : 'bash — native on Linux/macOS; on Windows it needs bash.exe on PATH.',
                )}
          {' '}
          {t(
            'settings.terminal.shell.newTermNote',
            ar ? 'يُطبَّق على الأمر التالي الذي تشغّله في الطرفية.' : 'Applies from the next command the terminal runs.',
          )}
        </div>
      </GroupCard>

      <GroupCard title={t('settings.terminal.scrollback', 'Scrollback')}>
        <SettingRow
          label={t('settings.terminal.scrollback', 'Scrollback')}
          hint={t(
            'settings.terminal.scrollback.hint',
            ar
              ? 'حد أسطر الطرفية المحفوظة (1000–50000) — يرفع أيضاً سقف مخرجات الطرفية في العملية الرئيسية.'
              : 'Kept terminal lines (1000–50000) — also raises the main-process terminal output cap to match.',
          )}
        >
          <Slider
            value={scrollback}
            min={1000}
            max={50000}
            step={500}
            onChange={(v) => updateSettings({ terminal: { ...(termCfg ?? {}), scrollback: v } })}
            label={t('settings.terminal.scrollback', 'Scrollback')}
          />
        </SettingRow>
      </GroupCard>
      </div>
    </section>
  );
}

export default TerminalSection;
