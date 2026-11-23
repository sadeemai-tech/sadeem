// ============================================================
// SADEEM settings — Editor section (v10.3, wired for real in v11.4).
// The Monaco options are no longer hardcoded in EditorArea: word wrap,
// tab size, font size, minimap and indent guides persist under
// settings.editor and EditorArea applies them live (options prop). The
// minimap row and the editor toolbar toggle drive the SAME field.
// ============================================================
import { useStore } from '../../store';
import { useT, useDigits } from '../../i18n';
import { GroupCard, Segmented, SettingRow, Slider, Toggle } from './controls';
import './s3-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

type WrapChoice = 'off' | 'on';
type TabChoice = '2' | '4' | '8';

export function EditorSection() {
  const t = useT();
  const n = useDigits();
  const settings = useStore((s) => s.settings);
  const lang = settings.language ?? 'en';
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  // React #185 guard: the selector returns the STABLE settings.editor object.
  const editor = useStore((s) => s.settings.editor);
  const updateSettings = useStore((s) => s.updateSettings);
  const ar = settings.language === 'ar';

  const cfg = editor ?? {};
  const patch = (p: Partial<NonNullable<typeof editor>>) =>
    updateSettings({ editor: { ...cfg, ...p } });

  const wrap = cfg.wordWrap === 'on' ? 'on' : 'off';
  const tabSize: TabChoice = cfg.tabSize === 4 ? '4' : cfg.tabSize === 8 ? '8' : '2';
  const fontSize = Math.max(10, Math.min(22, Math.round(cfg.fontSize ?? settings.fontSize ?? 13)));
  const minimap = cfg.minimap === true;
  const indentGuides = cfg.indentGuides !== false;

  return (
    <section className="set-section s3-page">
      {/* ---------- refined page head · 09 / EDITOR ---------- */}
      <header className="s3-head">
        <div className="s3-glyph-wrap">
          {/* a page with a caret and two text rails */}
          <svg className="s3-glyph" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M9 5h16l6 6v24H9z" />
            <path d="M25 5v6h6" />
            <path className="quiet" d="M13 16h12M13 21h7" />
            <path d="M22 26v6M21 26h2M21 32h2" />
          </svg>
        </div>
        <div className="s3-head-copy">
          <div className="s3-eyebrow">
            <span className="no">{n('09')}</span>
            <span className="slash">/</span>
            {t('set.group.editor', tx('EDITOR', 'المحرر'))}
          </div>
          <h2 className="s3-display">{t('set.group.editor', tx('Editor', 'المحرر'))}</h2>
          <p className="s3-desc">
            {t(
              'settings.editor.desc',
              tx(
                'Monaco editor behaviours, persisted for real — every row applies to the editor live.',
                'سلوك محرر Monaco محفوظ فعلياً الآن — كل صف هنا يُطبَّق على المحرر مباشرة.',
              ),
            )}
          </p>
        </div>
        <span className="s3-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · measured ruler ---------- */}
      <div className="s3-plate s3-plate--editor" aria-hidden="true">
        <svg viewBox="0 0 320 92">
          {/* twelve majors at an exact 24-unit pitch, minors between */}
          <line x1="12" y1="52" x2="308" y2="52" />
          {Array.from({ length: 12 }, (_, i) => {
            const x = 24 + i * 24;
            return (
              <g key={i}>
                <line className={i === 6 ? 'accent' : 'mid'} x1={x} y1="52" x2={x} y2="36" />
                <line className="quiet" x1={x + 12} y1="52" x2={x + 12} y2="44" />
                {i % 2 === 0 && (
                  <text className="num" x={x} y="31" textAnchor="middle">
                    {String(i).padStart(2, '0')}
                  </text>
                )}
              </g>
            );
          })}
          <circle className="dot accent" cx="168" cy="36" r="2.2" />
          <line className="quiet" x1="24" y1="76" x2="288" y2="76" />
          <path className="quiet" d="M24 72v8M288 72v8" />
          <text className="num" x="156" y="89" textAnchor="middle">0 — 11</text>
        </svg>
      </div>

      <div className="s3-groups">
      <GroupCard>
        <SettingRow
          label={t('settings.inlineSuggestions', 'Inline ghost suggestions')}
          hint={t('settings.inlineSuggestions.hint', 'AI completions as you type in the editor')}
        >
          <Toggle
            checked={settings.inlineSuggestions !== false}
            onChange={(v) => updateSettings({ inlineSuggestions: v })}
            label={t('settings.inlineSuggestions', 'Inline ghost suggestions')}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('settings.editor.chrome', 'Editor chrome')}>
        <SettingRow
          label={t('settings.editor.wordWrap', 'Word wrap')}
          hint={t(
            'settings.editor.wordWrap.hint',
            ar
              ? 'التفاف الأسطر الطويلة داخل عرض المحرر (افتراضياً معطّل).'
              : 'Wrap long lines inside the editor view (off by default).',
          )}
        >
          <Segmented<WrapChoice>
            value={wrap}
            options={[
              { value: 'off', label: t('settings.editor.wordWrap.off', ar ? 'إيقاف' : 'Off') },
              { value: 'on', label: t('settings.editor.wordWrap.on', ar ? 'تشغيل' : 'On') },
            ]}
            onChange={(v) => patch({ wordWrap: v })}
            ariaLabel={t('settings.editor.wordWrap', 'Word wrap')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.editor.tabSize', 'Tab size')}
          hint={t(
            'settings.editor.tabSize.hint',
            ar ? 'عرض المسافة البادئة الذي يُدرجه المحرر.' : 'Indent width the editor inserts.',
          )}
        >
          <Segmented<TabChoice>
            value={tabSize}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
              { value: '8', label: '8' },
            ]}
            onChange={(v) => patch({ tabSize: Number(v) as 2 | 4 | 8 })}
            ariaLabel={t('settings.editor.tabSize', 'Tab size')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.editor.fontSize', 'Editor font size')}
          hint={t('settings.editor.fontSize.hint', ar ? '10–22 بكسل — يُطبَّق فوراً.' : '10–22 px — applied live.')}
        >
          <Slider
            value={fontSize}
            min={10}
            max={22}
            onChange={(v) => patch({ fontSize: v })}
            label={t('settings.editor.fontSize', 'Editor font size')}
            suffix="px"
          />
        </SettingRow>

        <SettingRow
          label={t('settings.editor.minimap', 'Minimap')}
          hint={t(
            'settings.editor.minimap.hint',
            ar
              ? 'الخريطة المصغرة — تُزامن نفس الحقل مع زر شريط أدوات المحرر.'
              : 'The code overview — the editor toolbar button drives the same field.',
          )}
        >
          <Toggle
            checked={minimap}
            onChange={(v) => patch({ minimap: v })}
            label={t('settings.editor.minimap', 'Minimap')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.editor.indentGuides', 'Indent guides')}
          hint={t(
            'settings.editor.indentGuides.hint',
            ar ? 'خطوط رأسية تُظهر مستويات الإزاحة.' : 'Vertical rulers marking indentation levels.',
          )}
        >
          <Toggle
            checked={indentGuides}
            onChange={(v) => patch({ indentGuides: v })}
            label={t('settings.editor.indentGuides', 'Indent guides')}
          />
        </SettingRow>
      </GroupCard>
      </div>
    </section>
  );
}

export default EditorSection;
