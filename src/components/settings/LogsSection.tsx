// ============================================================
// SADEEM settings — Logs section (v11.4, new dedicated pane).
// Real diagnostics, no theatre:
//  • log level (settings.logs.level) — logService filters main.log by it;
//  • Open log folder → kdx:logs:openFolder (shell.openPath);
//  • Export log → kdx:logs:export (sanitized tail, download + clipboard);
//  • Clear log → kdx:logs:clear (truncates main.log + rotations).
// The masthead + ruled-ledger glyph are presentation only.
// ============================================================
import { useState } from 'react';
import { Download, FolderOpen, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { Btn, Chip, Spinner } from '../ui';
import { GroupCard, InfoNote, Segmented, SettingRow } from './controls';
import './s4-art.css';

type LogLevelChoice = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: LogLevelChoice[] = ['debug', 'info', 'warn', 'error'];

/** One precise artistic element of this page: a ruled ledger — a folded
 *  page, four ink rules and one quiet redaction bar (secrets never land). */
const RuledLedgerGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <path className="s4-ink" d="M16 7h28l10 10v32H16z" />
    <path className="s4-ink" d="M44 7v10h10" />
    <path className="s4-ink s4-thin" d="M22 25h28M22 34h28M22 43h20" />
    <path className="s4-ink" d="M22 31h28" opacity="0.28" />
    <rect x="22" y="29" width="11" height="4" fill="currentColor" opacity="0.5" />
    <circle className="s4-dot" cx="44" cy="7" r="1.2" />
  </svg>
);

export function LogsSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const logsCfg = useStore((s) => s.settings.logs);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const ar = settings.language === 'ar';

  const level: LogLevelChoice = LEVELS.includes(logsCfg?.level as LogLevelChoice)
    ? (logsCfg?.level as LogLevelChoice)
    : 'info';

  const [busy, setBusy] = useState<'none' | 'export' | 'clear'>('none');

  const openFolder = async () => {
    const r = await Promise.resolve()
      .then(() => api.logsOpenFolder())
      .catch(() => null);
    if (!r?.ok) notify(r?.error || (ar ? 'تعذّر فتح مجلد السجل' : 'Could not open the log folder'));
  };

  // Download the sanitized tail as a file; clipboard as the honest fallback.
  const exportLog = async () => {
    if (busy !== 'none') return;
    setBusy('export');
    try {
      const r = await Promise.resolve()
        .then(() => api.logsExport())
        .catch(() => null);
      if (!r) {
        notify(ar ? 'تعذّر تصدير السجل' : 'Could not export the log');
        return;
      }
      const text = r.content ?? '';
      if (!text) {
        notify(ar ? 'السجل فارغ — لا شيء للتصدير بعد.' : 'The log is empty — nothing to export yet.');
        return;
      }
      try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'surnia-main-log.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        notify(
          ar
            ? `صُدِّر السجل (منقّح من الأسرار — ${r.sessionRedactions} مراجعة هذه الجلسة)`
            : `Log exported (secret-sanitized — ${r.sessionRedactions} redactions this session)`,
        );
      } catch {
        await navigator.clipboard?.writeText(text);
        notify(ar ? 'نُسخ السجل إلى الحافظة' : 'Log copied to the clipboard');
      }
    } finally {
      setBusy('none');
    }
  };

  const clearLog = async () => {
    if (busy !== 'none') return;
    setBusy('clear');
    try {
      const r = await Promise.resolve()
        .then(() => api.logsClear())
        .catch(() => null);
      notify(
        r?.ok
          ? ar
            ? 'مُسح السجل'
            : 'Log cleared'
          : r?.error || (ar ? 'تعذّر مسح السجل' : 'Could not clear the log'),
      );
    } finally {
      setBusy('none');
    }
  };

  return (
    <div className="s4-page s4-logs">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.logs.eyebrow', ar ? '٢٢ / السجلات' : '22 / DIAGNOSTICS')}
          </span>
          <RuledLedgerGlyph />
        </div>
        <h2 className="s4-title">
          {t('set.group.logs', ar ? 'السجلات' : 'Logs')}
        </h2>
        <p className="s4-desc">
          {t(
            'set.group.logs.desc',
            ar
              ? 'سجل التشخيص المحلي (main.log) — منقّح من الأسرار قبل الكتابة دوماً.'
              : 'The local diagnostics log (main.log) — always secret-redacted before it is written.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        <GroupCard title={t('settings.logs.level', 'Log level')}>
          <SettingRow
            label={t('settings.logs.level', 'Log level')}
            hint={t(
              'settings.logs.level.hint',
              ar
                ? 'أدنى مستوى يُكتب في main.log — يُطبَّق فوراً على مرسل السجلات في العملية الرئيسية.'
                : 'Minimum level written to main.log — applied live to the main-process logger.',
            )}
          >
            <Segmented<LogLevelChoice>
              value={level}
              options={LEVELS.map((l) => ({ value: l, label: l }))}
              onChange={(v) => updateSettings({ logs: { ...(logsCfg ?? {}), level: v } })}
              ariaLabel={t('settings.logs.level', 'Log level')}
            />
          </SettingRow>
        </GroupCard>

        <GroupCard title={t('settings.logs.actions', 'Actions')}>
          <SettingRow
            label={t('settings.logs.openFolder', 'Open log folder')}
            hint={t(
              'settings.logs.openFolder.hint',
              ar ? 'يكشف مجلد السجلات في مدير ملفات نظام التشغيل.' : 'Reveals the logs directory in your OS file manager.',
            )}
          >
            <Btn onClick={() => void openFolder()}>
              <span className="inline-flex items-center gap-1.5">
                <FolderOpen size={12} />
                {t('settings.logs.openFolder.go', ar ? 'فتح' : 'Open')}
              </span>
            </Btn>
          </SettingRow>

          <SettingRow
            label={t('settings.logs.export', 'Export log')}
            hint={t(
              'settings.logs.export.hint',
              ar
                ? 'ينزّل ذيل السجل (آخر 256KB) كملف نصي منقّح من الأسرار.'
                : 'Downloads the sanitized log tail (last 256KB) as a text file.',
            )}
          >
            <Btn onClick={() => void exportLog()} disabled={busy !== 'none'}>
              <span className="inline-flex items-center gap-1.5">
                {busy === 'export' ? <Spinner size={12} /> : <Download size={12} />}
                {t('settings.logs.export.go', ar ? 'تصدير' : 'Export')}
              </span>
            </Btn>
          </SettingRow>

          <SettingRow
            label={t('settings.logs.clear', 'Clear log')}
            hint={t(
              'settings.logs.clear.hint',
              ar ? 'يجرد main.log ويدوراته على هذا الجهاز — لا يُرسل شيئاً لأي جهة.' : 'Truncates main.log and its rotations on this device — nothing is sent anywhere.',
            )}
          >
            <Btn variant="danger" onClick={() => void clearLog()} disabled={busy !== 'none'}>
              <span className="inline-flex items-center gap-1.5">
                {busy === 'clear' ? <Spinner size={12} /> : <Trash2 size={12} />}
                {t('settings.logs.clear.go', ar ? 'مسح' : 'Clear')}
              </span>
            </Btn>
          </SettingRow>
        </GroupCard>

        <InfoNote>
          {t(
            'settings.logs.note',
            ar
              ? 'كل سطر يُفحص ضد أنماط الأسرار (sk-…، Bearer، AKIA…، ghp_…) قبل الكتابة — المطابقات تُستبدل بـ«redacted» وتُعدّ في التدقيق.'
              : 'Every line is scanned for credential patterns (sk-…, Bearer, AKIA…, ghp_…) before it lands — matches are replaced with «redacted» and counted in the audit.',
          )}
          <span className="ms-1 inline-flex items-center">
            <Chip>{t('settings.logs.file', 'main.log · 512KB × 4 rotations')}</Chip>
          </span>
        </InfoNote>
      </div>
    </div>
  );
}

export default LogsSection;
