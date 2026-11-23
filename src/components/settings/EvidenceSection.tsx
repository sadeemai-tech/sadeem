// ============================================================
// SADEEM settings — Evidence section (v11.4, new dedicated pane).
// The honest-agent proof artifacts, surfaced read-only with REAL data:
//  • signed proof packages (userData/proofs/*.json — Ed25519-verified);
//  • the persisted False-Done ledger;
//  • a button that opens the artifacts folder in the OS file manager.
// Everything comes from kdx:evidence:list (paths + counts only). When
// no artifacts exist yet the pane says so honestly — nothing is faked.
// The masthead + wax-seal glyph are presentation only.
// ============================================================
import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api, type EvidenceSummary } from '../../lib/api';
import { Btn, Chip, Spinner } from '../ui';
import { GroupCard } from './controls';
import './s4-art.css';

function fmtWhen(ms: number | string | undefined, ar: boolean): string {
  if (!ms) return '—';
  const n = typeof ms === 'string' ? Date.parse(ms) : ms;
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n).toLocaleString(ar ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** One precise artistic element of this page: a wax seal — a scalloped
 *  outer edge, two embossed rings and a pressed check, all 1px ink. */
const WaxSealGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <circle className="s4-ink" cx="36" cy="28" r="19" strokeDasharray="2 2.6" />
    <circle className="s4-ink" cx="36" cy="28" r="14" />
    <circle className="s4-ink s4-thin" cx="36" cy="28" r="10.5" />
    <path className="s4-ink" d="M30.5 28l3.8 3.8 7.7-8.2" />
    <circle className="s4-dot" cx="36" cy="28" r="1" />
  </svg>
);

export function EvidenceSection() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';
  const notify = useStore((s) => s.notify);

  const [data, setData] = useState<EvidenceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setLoading(true);
    setFailed(false);
    Promise.resolve()
      .then(() => api.evidenceList(10))
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  };
  useEffect(load, []);

  const openFolder = async () => {
    const r = await Promise.resolve()
      .then(() => api.evidenceOpenFolder())
      .catch(() => null);
    if (!r?.ok) notify(r?.error || (ar ? 'تعذّر فتح مجلد الأدلة' : 'Could not open the artifacts folder'));
  };

  const proofs = data?.proofs;
  const fd = data?.falseDone;
  const ratePct = fd && fd.claimed > 0 ? Math.round(fd.rate * 100) : 0;

  return (
    <div className="s4-page s4-evidence">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.evidence.eyebrow', ar ? '١٩ / الإثبات' : '19 / PROOF')}
          </span>
          <WaxSealGlyph />
        </div>
        <h2 className="s4-title">
          {t('set.group.evidence', ar ? 'الأدلة' : 'Evidence')}
        </h2>
        <p className="s4-desc">
          {t(
            'set.group.evidence.desc',
            ar
              ? 'أدلة صدق الوكيل: حزم الإثبات الموقّعة وسجل «الإنجاز الكاذب» — بيانات حقيقية من هذا الجهاز، للقراءة فقط.'
              : 'The honest-agent artifacts: signed proof packages and the False-Done ledger — real data from this device, read-only.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        {/* ---------- counts (real, from disk) ---------- */}
        <GroupCard title={t('settings.evidence.counts', 'Counts')}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="set-stat">
              <div className="set-stat-v tnum">{loading ? <Spinner size={13} /> : (proofs?.count ?? 0)}</div>
              <div className="set-stat-k">{t('settings.evidence.proofs', 'Signed proofs')}</div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{loading ? <Spinner size={13} /> : (fd?.claimed ?? 0)}</div>
              <div className="set-stat-k">{t('settings.evidence.claimed', 'Runs claimed done')}</div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{loading ? <Spinner size={13} /> : (fd?.falseDone ?? 0)}</div>
              <div className="set-stat-k">{t('settings.evidence.falseDone', 'Overruled by gates')}</div>
            </div>
            <div className="set-stat">
              <div className="set-stat-v tnum">{loading ? <Spinner size={13} /> : `${ratePct}%`}</div>
              <div className="set-stat-k">{t('settings.evidence.rate', 'False-done rate')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Btn onClick={() => void openFolder()}>
              <span className="inline-flex items-center gap-1.5">
                <FolderOpen size={12} />
                {t('settings.evidence.openFolder', ar ? 'فتح مجلد الأدلة' : 'Open artifacts folder')}
              </span>
            </Btn>
            <Btn variant="ghost" onClick={load} disabled={loading}>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                {t('chat.retry', 'Retry')}
              </span>
            </Btn>
            {proofs?.dir && (
              <span className="font-code text-[10px] text-[var(--faint)] truncate max-w-[360px]" dir="ltr" title={proofs.dir}>
                {proofs.dir}
              </span>
            )}
          </div>
        </GroupCard>

        {/* ---------- latest proof packages ---------- */}
        <GroupCard title={t('settings.evidence.latestProofs', 'Latest proof packages')}>
          {failed && (
            <div className="text-[11.5px] text-warn" role="alert" dir="auto">
              {t(
                'settings.evidence.readFailed',
                ar ? 'تعذّرت قراءة الأدلة من القرص — أعد المحاولة.' : 'Could not read the artifacts from disk — try again.',
              )}
            </div>
          )}
          {!failed && !loading && (proofs?.recent?.length ?? 0) === 0 && (
            <div className="text-[11.5px] text-dim" dir="auto">
              {t(
                'settings.evidence.empty',
                ar
                  ? 'لا توجد حزم إثبات بعد — تُكتب هنا بعد أول تشغيل يجتاز بوابات التحقق.'
                  : 'No proof packages yet — they land here after the first verified agent run.',
              )}
            </div>
          )}
          {(proofs?.recent?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              {proofs?.recent.map((p) => (
                <div
                  key={p.file}
                  className="flex items-center gap-2 px-1 py-1 rounded-[6px] row-hover min-w-0"
                  title={p.file}
                >
                  <ShieldCheck size={12} className="text-acc shrink-0" aria-hidden />
                  <span className="font-code text-[10.5px] truncate min-w-0" dir="ltr">
                    {p.file.split(/[\\/]/).pop() ?? p.file}
                  </span>
                  <Chip tone={p.verdict === 'proven' ? 'acc' : p.verdict === 'partial' ? 'warn' : 'default'}>
                    {p.verdict ?? '—'}
                  </Chip>
                  {p.workspaceName && <span className="text-[10.5px] text-dim truncate max-w-[20ch]">{p.workspaceName}</span>}
                  <span className="ms-auto text-[10px] text-faint tnum shrink-0" dir="ltr">
                    {fmtWhen(p.createdAt, ar)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GroupCard>

        {/* ---------- False-Done ledger (published, not hidden) ---------- */}
        <GroupCard title={t('settings.evidence.falseDoneLedger', 'False-Done ledger (published)')}>
          {!failed && !loading && (fd?.recent?.length ?? 0) === 0 && (
            <div className="text-[11.5px] text-dim" dir="auto">
              {t(
                'settings.evidence.falseDoneEmpty',
                ar
                  ? 'السجل فارغ — يُسجَّل فيه كل تشغيل ادّعى النجاح وحكمت عليه بوابات الإثبات.'
                  : 'The ledger is empty — every run that claims success and is overruled by the proof gates lands here.',
              )}
            </div>
          )}
          {(fd?.recent?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              {fd?.recent
                .slice()
                .reverse()
                .map((e, i) => (
                  <div key={`${e.runId}-${e.at}-${i}`} className="flex items-center gap-2 px-1 py-1 rounded-[6px] row-hover min-w-0">
                    <span className="font-code text-[10.5px] truncate min-w-0" dir="ltr">
                      {e.runId || '—'}
                    </span>
                    <Chip tone={e.falseDone ? 'bad' : 'acc'}>
                      {e.falseDone
                        ? t('settings.evidence.falseDoneYes', 'false done')
                        : t('settings.evidence.falseDoneNo', 'verified')}
                    </Chip>
                    <span className="text-[10px] text-faint truncate" dir="ltr">
                      {e.gateVerdict}
                    </span>
                    <span className="ms-auto text-[10px] text-faint tnum shrink-0" dir="ltr">
                      {fmtWhen(e.at, ar)}
                    </span>
                  </div>
                ))}
            </div>
          )}
          <div className="text-[10.5px] text-[var(--faint)] mt-2 leading-relaxed" dir="auto">
            {t(
              'settings.evidence.falseDoneNote',
              ar
                ? 'معدل الإنجاز الكاذب يُنشر كما هو — الإخفاء ليس خياراً: كل تشغيل ادّعى النجاح ورفضته البوابات يُحتسب.'
                : 'The false-done rate is published as-is — claimed-success runs the proof gates overrule are counted, never hidden.',
            )}
          </div>
        </GroupCard>
      </div>
    </div>
  );
}

export default EvidenceSection;
