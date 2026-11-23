// ArtifactsPanel — Rail view 09 (v5) · مركز الأدلة / Artifacts Hub.
// The trust center: derives verifiable proof from the CURRENT session —
// stats, todo checklist, files touched, the agent's screenshots, final
// walkthrough — and exports a self-contained shareable HTML proof page
// into the workspace. Antigravity-parity: work you can verify, not claims.
// v6 — pending-comment box: comments queue as chips and ride along with the
// user's NEXT message (no agent interruption mid-run).
import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Check, Copy, Download, Camera, FileCheck2, Terminal, MessageSquarePlus, X } from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { Btn, SectionTitle } from '../ui';
import { buildProofHtml, deriveArtifacts } from '../../lib/artifacts';
import '../workspace.css';

export function ArtifactsPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const session = useStore((s) => s.session);
  const messages = session?.messages ?? [];
  const todos = useStore((s) => s.todos);
  const wsPath = useStore((s) => s.wsPath);
  const model = useStore((s) => s.settings.model);
  const notify = useStore((s) => s.notify);
  const artifactComments = useStore((s) => s.artifactComments);
  const addArtifactComment = useStore((s) => s.addArtifactComment);
  const removeArtifactComment = useStore((s) => s.removeArtifactComment);
  const [exported, setExported] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');

  // A "saved: file.html" line from a previous session is stale the moment the
  // active session changes — clear it instead of claiming a foreign export.
  useEffect(() => {
    setExported(null);
    setCopied(false);
  }, [session?.id]);

  const report = useMemo(
    () =>
      deriveArtifacts(messages, {
        sessionId: session?.id ?? 'current',
        title: session?.title ?? (lang === 'ar' ? 'الجلسة الحالية' : 'Current session'),
        model: model?.model,
        todos,
      }),
    [messages, session, todos, model, lang],
  );

  const total = report.stats.edits + report.stats.commands + report.stats.documents;
  const done = report.todos.filter((x) => x.status === 'completed').length;

  const exportProof = async () => {
    if (!wsPath) {
      notify(t('artifacts.needWs', 'Open a workspace first — the proof page is saved into it.'));
      return;
    }
    const html = buildProofHtml(report, lang);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = `surnia-proof-${stamp}.html`;
    try {
      await api.writeFile(`${wsPath}/${file}`, html);
      setExported(file);
      notify(t('artifacts.exported', 'Proof page saved') + `: ${file}`);
    } catch (err) {
      // Prefix the raw (English, main-process) error with a localized label so
      // an Arabic UI never looks like it emitted English prose on its own.
      notify(`${t('artifacts.exportFailed', lang === 'ar' ? 'تعذّر تصدير صفحة الإثبات' : 'Could not export the proof page')}: ${String((err as Error)?.message ?? err)}`);
    }
  };

  /** Copy the SAME self-contained proof HTML to the clipboard — a real action,
   *  useful when saving a file is blocked. Never claims success on failure. */
  const copyProof = async () => {
    const html = buildProofHtml(report, lang);
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      notify(t('artifacts.copied', lang === 'ar' ? 'نُسخت صفحة الإثبات' : 'Proof page copied to clipboard'));
    } catch {
      notify(t('artifacts.copyFailed', lang === 'ar' ? 'النسخ غير متاح على هذا الجهاز' : 'Clipboard is unavailable on this device'));
    }
  };

  const Stat = ({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) => (
    <div
      className="flex flex-col items-center gap-1 px-3 py-2.5 min-w-[86px]"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--panel)',
      }}
    >
      <span className="text-acc">{icon}</span>
      <b className="tnum text-[18px] leading-none" dir="ltr">{n}</b>
      <span className="text-[10.5px] text-dim">{label}</span>
    </div>
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 pt-3">
        <SectionTitle no="09" title={t('rail.artifacts', 'Artifacts Hub')} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-3">
        {/* header card */}
        <div
          className="p-3"
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--panel)',
          }}
        >
          <div className="flex items-center gap-2">
            <BadgeCheck size={16} className="text-acc shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold truncate" dir="auto">
                {session?.title ?? '—'}
              </div>
              <div className="text-[11px] text-dim">
                {total === 0
                  ? t('artifacts.nothingYet', 'No proof yet — ask the agent to build something.')
                  : t('artifacts.subtitle', 'Every claim below is extracted from this session transcript.')}
              </div>
            </div>
          </div>
        </div>

        {/* stats */}
        <div className="flex flex-wrap gap-2">
          <Stat icon={<FileCheck2 size={13} />} n={report.stats.edits} label={t('artifacts.edits', 'file edits')} />
          <Stat icon={<Terminal size={13} />} n={report.stats.commands} label={t('artifacts.commands', 'commands')} />
          <Stat icon={<FileCheck2 size={13} />} n={report.stats.documents} label={t('artifacts.docs', 'documents')} />
          <Stat icon={<Camera size={13} />} n={report.stats.screenshots} label={t('artifacts.shots', 'screenshots')} />
        </div>

        {/* checklist */}
        {report.todos.length > 0 && (
          <div>
            <div className="sec-titled">
              <span className="sec-no">01</span>
              <span className="sec-tt flex-1">{t('artifacts.checklist', 'Task checklist')}</span>
              <span className="text-[10.5px] text-faint tnum">
                {done}/{report.todos.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {report.todos.map((td) => (
                <div key={td.content} className="flex items-start gap-2 text-[12.5px] py-0.5">
                  <span
                    className="mt-[3px] inline-flex h-[13px] w-[13px] flex-none items-center justify-center text-[9px] leading-none"
                    style={
                      td.status === 'completed'
                        ? {
                            border: '1px solid var(--acc)',
                            background: 'var(--acc)',
                            color: 'var(--acc-ink)',
                            borderRadius: 4,
                          }
                        : {
                            border: '1px solid var(--line-strong)',
                            color: 'transparent',
                            borderRadius: 4,
                          }
                    }
                  >
                    <Check size={9} strokeWidth={2.4} aria-hidden />
                  </span>
                  <span className={td.status === 'completed' ? 'text-dim' : ''} dir="auto">
                    {td.content}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* screenshots */}
        {report.screenshots.length > 0 && (
          <div>
            <div className="sec-titled">
              <span className="sec-no">02</span>
              <span className="sec-tt flex-1">{t('artifacts.shots', 'Verification screenshots')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {report.screenshots.map((s, i) => (
                <img
                  key={i}
                  src={s.dataUrl}
                  alt={s.label}
                  className="w-full rounded-[8px] border border-line"
                  style={{ aspectRatio: '16/10', objectFit: 'cover' }}
                />
              ))}
            </div>
          </div>
        )}

        {/* files touched */}
        {report.filesTouched.length > 0 && (
          <div>
            <div className="sec-titled">
              <span className="sec-no">03</span>
              <span className="sec-tt flex-1">{t('artifacts.files', 'Files touched')}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {report.filesTouched.slice(0, 24).map((f) => (
                <div key={f} className="font-code text-[11.5px] text-dim truncate" dir="ltr">
                  {f}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* walkthrough excerpt */}
        {report.walkthrough && (
          <div>
            <div className="sec-titled">
              <span className="sec-no">04</span>
              <span className="sec-tt flex-1">{t('artifacts.walkthrough', 'Final walkthrough')}</span>
            </div>
            <pre className="text-[12px] leading-[1.6] whitespace-pre-wrap break-words bg-[var(--bg2)] border border-line rounded-[10px] p-3 max-h-[30vh] overflow-auto select-text" dir="auto">
              {report.walkthrough.slice(0, 2400)}
            </pre>
          </div>
        )}

        {/* v6 — pending comments (ride along with the next message) */}
        <div
          className="p-2.5"
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--panel)',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <MessageSquarePlus size={12} className="text-acc shrink-0" />
            <span className="text-[11px] font-medium" dir="auto">
              {t('artifacts.commentTitle', 'Comment for the agent (sends with your next message)')}
            </span>
          </div>
          {artifactComments.length > 0 && (
            <div className="flex flex-col gap-1 mb-1.5">
              {artifactComments.map((c, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1.5 text-[11.5px] bg-[var(--bg2)] border border-line rounded-[6px] px-2 py-1"
                  dir="auto"
                >
                  <span className="stamp stamp-acc !h-[14px] !px-1 !text-[8.5px] shrink-0 tnum">{i + 1}</span>
                  <span className="flex-1 min-w-0 break-words">{c}</span>
                  <button
                    className="text-faint hover:text-bad shrink-0 cursor-pointer"
                    onClick={() => removeArtifactComment(i)}
                    aria-label={t('artifacts.commentRemove', 'Remove comment')}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && commentDraft.trim()) {
                  addArtifactComment(commentDraft);
                  setCommentDraft('');
                }
              }}
              placeholder={t('artifacts.commentPlaceholder', 'e.g. the mobile header overlaps — fix before shipping')}
              className="flex-1 min-w-0 h-7 text-[12px] px-2 rounded-[6px] border border-line bg-[var(--bg2)] outline-none focus:border-[var(--acc)]"
              dir="auto"
            />
            <Btn
              className="!h-7 !px-2 !text-[11px] shrink-0"
              disabled={!commentDraft.trim()}
              onClick={() => {
                addArtifactComment(commentDraft);
                setCommentDraft('');
              }}
            >
              {t('artifacts.commentAdd', 'Queue')}
            </Btn>
          </div>
        </div>

        {/* export / copy */}
        <div className="mt-auto pt-2">
          <div className="flex gap-2">
            <Btn variant={total > 0 ? 'primary' : 'default'} className="flex-1" onClick={() => void exportProof()}>
              <Download size={13} />
              {t('artifacts.export', 'Export shareable proof page (HTML)')}
            </Btn>
            <Btn className="!px-3 shrink-0" title={t('artifacts.copy', 'Copy proof HTML')} onClick={() => void copyProof()}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {t('artifacts.copyShort', 'Copy')}
            </Btn>
          </div>
          {exported && (
            <div className="mt-1.5 text-[11px] text-ok text-center flex items-center justify-center gap-1" dir="ltr">
              <Check size={11} aria-hidden />
              {exported}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ArtifactsPanel;
