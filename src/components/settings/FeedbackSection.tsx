// FeedbackSection — Settings · الاقتراحات والتواصل.
// SADEEM is NEW: the first users see what we cannot. This pane collects
// bugs, improvement ideas, feature requests and contact requests as LOCAL
// json files (<userData>/feedback/) — nothing leaves the machine until the
// user copies/exports a submission themselves. Diagnostics are opt-in and
// contain only version/platform/language/counters (never keys or paths).
// The masthead + inbox-tray glyph are presentation only; every action is
// wired exactly as before.
import React, { useEffect, useState } from 'react';
import { Check, MessageSquareHeart, Copy, FolderOpen, Send, LifeBuoy } from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { APP_VERSION } from '../../version';
import { Btn, Chip } from '../ui';
import './settings.css';
import './s4-art.css';

type Kind = 'bug' | 'improvement' | 'feature' | 'other';

interface FeedbackEntryLite {
  id: string;
  at: number;
  kind: Kind;
  message: string;
  contact?: string;
}

/** Official team contact — mirrors `website/lib/site.ts -> SITE.supportEmail`.
 *  The renderer cannot import the website module, so keep this value in sync. */
const TEAM_CONTACT = 'support@sadeem.app';

const KINDS: { id: Kind; en: string; ar: string }[] = [
  { id: 'bug', en: 'Bug', ar: 'مشكلة' },
  { id: 'improvement', en: 'Improvement', ar: 'تحسين' },
  { id: 'feature', en: 'Feature idea', ar: 'فكرة ميزة' },
  { id: 'other', en: 'Other', ar: 'أخرى' },
];

/** One precise artistic element of this page: an inbox tray with an
 *  incoming note — a 1px outline, a slot and a short descent arrow. */
const InboxTrayGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <path className="s4-ink" d="M12 24h14l4 7h12l4-7h14" />
    <path className="s4-ink" d="M12 24 18 11h36l6 13v21H12z" />
    <path className="s4-ink" d="M36 6v10M32 12l4 4 4-4" />
    <circle className="s4-dot" cx="36" cy="4" r="1.4" />
  </svg>
);

export function FeedbackSection() {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const ar = lang === 'ar';
  const notify = useStore((s) => s.notify);
  const [kind, setKind] = useState<Kind>('improvement');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [withDiag, setWithDiag] = useState(true);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [history, setHistory] = useState<FeedbackEntryLite[]>([]);

  const loadHistory = () => {
    void Promise.resolve(api.feedbackList())
      .then((list) => setHistory((Array.isArray(list) ? list : []) as FeedbackEntryLite[]))
      .catch(() => setHistory([]));
  };
  useEffect(loadHistory, []);

  const submit = async () => {
    if (message.trim().length < 3) {
      notify(lang === 'ar' ? 'اكتب الاقتراح أولاً' : 'Write the message first');
      return;
    }
    setSending(true);
    try {
      const res = await api.feedbackSave({
        kind,
        message: message.trim(),
        contact: contact.trim() || undefined,
        diagnostics: withDiag
          ? {
              appVersion: APP_VERSION,
              platform: navigator.platform ?? '',
              language: lang,
              workspacesOpened: (useStore.getState().settings.recentPaths ?? []).length,
              sessions: 0,
            }
          : undefined,
      });
      if (res?.ok) {
        setSaved(res.entry?.id ?? 'saved');
        setMessage('');
        notify(lang === 'ar' ? 'حُفظ اقتراحك — نقرأ كل واحدة' : 'Saved — we read every one');
        loadHistory();
      } else {
        notify(res?.error ?? 'Save failed');
      }
    } catch (err) {
      notify(String((err as Error)?.message ?? err));
    } finally {
      setSending(false);
    }
  };

  const copyLast = async () => {
    const last = history[0];
    if (!last) return;
    try {
      const md = await api.feedbackMarkdown(last);
      await navigator.clipboard.writeText(md);
      notify(lang === 'ar' ? 'نُسخ التقرير — أرسله لنا في قنوات الدعم' : 'Copied — send it to our support channels');
    } catch {
      notify(lang === 'ar' ? 'تعذّر النسخ' : 'Copy failed');
    }
  };

  const openFolder = async () => {
    try {
      const p = await api.feedbackPath();
      await api.openExternal(`file://${p}`);
    } catch {
      notify(lang === 'ar' ? 'تعذّر فتح المجلد' : 'Could not open the folder');
    }
  };

  const kindOf = (k: string): string => KINDS.find((x) => x.id === k)?.[lang === 'ar' ? 'ar' : 'en'] ?? k;

  return (
    <div className="s4-page s4-feedback">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.feedback.eyebrow', ar ? '٢٠ / صندوق الاقتراحات' : '20 / SUGGESTIONS')}
          </span>
          <InboxTrayGlyph />
        </div>
        <h2 className="s4-title" dir="auto">
          {t('feedback.title', 'صندوق الاقتراحات · Suggestions box')}
        </h2>
        <p className="s4-desc" dir="auto">
          {t(
            'feedback.intro',
            'SADEEM is new — YOU see what we cannot. Report problems, tell us what to improve, and suggest the features you need. We read every single submission and improve the app because of it.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body max-w-[620px]">
        {/* composer */}
        <div className="set-card flex flex-col gap-2.5">
          <div className="flex items-center gap-2 mb-0.5">
            <MessageSquareHeart size={16} className="text-acc shrink-0" aria-hidden />
            <span className="s4-mono">
              {t('feedback.compose', ar ? 'اكتب رسالتك' : 'COMPOSE')}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                className={`set-posture-btn ${
                  kind === k.id ? 'is-active' : ''
                }`}
                aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}
              >
                {lang === 'ar' ? k.ar : k.en}
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            dir="auto"
            placeholder={t(
              'feedback.placeholder',
              'What happened? What should we improve? Be as specific as you like — steps, screenshots paths, what you expected…',
            )}
            className="set-textarea min-h-[110px]"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            dir="auto"
            placeholder={t('feedback.contact', 'Optional contact (email / Telegram) — so we can follow up')}
            className="input"
          />
          <label className="flex items-center gap-2 text-[12px] text-dim cursor-pointer select-none" dir="auto">
            <input type="checkbox" checked={withDiag} onChange={(e) => setWithDiag(e.target.checked)} />
            {t('feedback.diag', 'Attach basic diagnostics (version, OS, language — never keys or file paths)')}
          </label>
          <div className="flex items-center gap-2">
            <Btn variant="primary" disabled={sending || message.trim().length < 3} onClick={() => void submit()}>
              <Send size={12} />
              {sending ? t('feedback.sending', 'Saving…') : t('feedback.send', 'Send suggestion')}
            </Btn>
            {saved && (
              <Chip tone="ok">
                <Check size={11} className="shrink-0" aria-hidden />
                {t('feedback.saved', 'Saved locally')} · {saved}
              </Chip>
            )}
          </div>
        </div>

        {/* history — hairline rows */}
        {history.length > 0 && (
          <div className="set-card">
            <div className="caps text-[10.5px] text-[var(--faint)] mb-1.5" dir="auto">
              {t('feedback.history', 'Your recent submissions')}
            </div>
            <div className="flex flex-col">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-2 py-1.5 border-b border-[var(--line-soft)] last:border-b-0"
                >
                  <span className="stamp !h-[14px] !px-1.5 !text-[8.5px] shrink-0">{kindOf(h.kind)}</span>
                  <span className="text-[10.5px] text-[var(--faint)] tnum shrink-0" dir="ltr">
                    {new Date(h.at).toLocaleDateString()}
                  </span>
                  <span className="text-[12px] text-dim truncate min-w-0 flex-1" dir="auto">
                    {h.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* contact + export */}
        <div className="set-card flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <LifeBuoy size={13} className="text-acc shrink-0" aria-hidden />
            <span className="text-[12.5px]" dir="auto">
              {t('feedback.contactUs', 'Reach the team directly')}:{' '}
              <span className="font-code text-[12px] text-acc" dir="ltr">
                {TEAM_CONTACT}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Btn onClick={() => void copyLast()} disabled={!history.length}>
              <Copy size={11} />
              {t('feedback.copyLast', 'Copy latest as markdown')}
            </Btn>
            <Btn onClick={() => void openFolder()}>
              <FolderOpen size={11} />
              {t('feedback.openFolder', 'Open the feedback folder')}
            </Btn>
          </div>
          <p className="text-[11px] text-[var(--faint)] leading-relaxed" dir="auto">
            {t(
              'feedback.privacyNote',
              'Submissions are stored on YOUR device only. Nothing is uploaded automatically — you choose what to send us.',
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default FeedbackSection;
