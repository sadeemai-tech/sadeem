// ============================================================
// SADEEM v11.12 — PromptsPanel: the Prompt Library.
// A device-local collection of the user's OWN text snippets.
// These are not AI templates and nothing is invented here: every
// row is a saved name + the exact text the user wrote. Save a
// draft, name it, re-insert it into the composer in one click.
// Dedup by name (upsert), newest-first, 200-item cap — the power-
// user workflow unified as a first-class, calm section page.
// Storage stays on this device (prompts.json, mode 0600).
// Presentation lives in ../prompts.css (stable, version-free).
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookPlus, Check, CornerDownLeft, Copy, Pencil, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { Btn, SectionTitle, TextInput } from '../ui';
import type { PromptItem } from '../../../shared/types';
import { PageHead } from '../pages';
import '../workspace.css';
import '../pages.css';
import '../prompts.css';

/** Real `{{placeholder}}` tokens found in a prompt — the only honest "tags". */
const VAR_RE = /\{\{\s*([^{}]{1,40}?)\s*\}\}/g;
function varsIn(text: string): string[] {
  const out: string[] = [];
  VAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_RE.exec(text)) !== null) {
    const v = m[1].trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}
function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}

// v11.38 — a saved prompt must be FOLLOWED, not just stored. The plain
// "Insert" action keeps the user's exact text untouched (regression-safe);
// "Use with AI" wraps that SAME text in explicit-instruction markers so the
// model reads it as a direct order. Kept in sync with the service constants
// (promptLibraryService.PROMPT_AI_OPEN / PROMPT_AI_CLOSE) by the v1138 test.
export const AI_PROMPT_OPEN = '[SAVED PROMPT — follow these instructions exactly]';
export const AI_PROMPT_CLOSE = '[/SAVED PROMPT — carry out every step before improvising]';
export function formatPromptForAI(text: string): string {
  const clean = String(text ?? '').trim();
  return clean ? `${AI_PROMPT_OPEN}\n${clean}\n${AI_PROMPT_CLOSE}\n` : '';
}

/** Tiny quill / ink nib — fine strokes, currentColor only. */
function NibGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* body mirrored exactly about x=12; the tail is the only asymmetry */}
      <path d="M12 2.5C15 7 15.8 9.8 15.8 12c0 3.2-1.7 5.4-3.8 6.6C9.9 17.4 8.2 15.2 8.2 12 8.2 9.8 9 7 12 2.5Z" />
      <path d="M12 6.2v10.4" />
      <path d="M9.7 11.6h4.6" />
      <path d="M12 18.6c0 1.6.5 2.7 1.7 3.5" />
    </svg>
  );
}

/** Engraved nib + ink drop + stipple + crosshairs for the empty state. */
function NibEngraving({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 80"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="40" cy="38" r="27" opacity="0.42" />
      <circle cx="40" cy="38" r="23" opacity="0.22" />
      {/* mirrored exactly about x=40 */}
      <path d="M40 21c5.4 7.4 8.3 14 8.3 20 0 6.8-3.6 11.6-8.3 13.8-4.7-2.2-8.3-7-8.3-13.8 0-6 2.9-12.6 8.3-20Z" />
      <path d="M40 26.5v23" opacity="0.75" />
      <path d="M35.6 40.4h8.8" opacity="0.75" />
      {/* ink drop, filled with currentColor (softened in CSS) */}
      <path className="pm-engrave-drop" d="M40 58c1.7 2.4 2.7 4.1 2.7 5.5a2.7 2.7 0 1 1-5.4 0c0-1.4 1-3.1 2.7-5.5Z" fill="currentColor" stroke="none" />
      {/* crosshair ticks */}
      <path d="M40 4v7M40 65v7M6 38h7M67 38h7" opacity="0.5" />
      {/* stipple — ink texture drawn, never a gradient */}
      <circle cx="17" cy="17" r="0.6" fill="currentColor" stroke="none" opacity="0.5" />
      <circle cx="63" cy="17" r="0.6" fill="currentColor" stroke="none" opacity="0.5" />
      <circle cx="17" cy="59" r="0.6" fill="currentColor" stroke="none" opacity="0.5" />
      <circle cx="63" cy="59" r="0.6" fill="currentColor" stroke="none" opacity="0.5" />
    </svg>
  );
}

/**
 * Exact error-code → message mapping for promptsSave (pure + testable).
 * The service emits name_required | text_required | storage_failed; mapping
 * every failure to "text required" showed the wrong reason for a disk error.
 */
export function promptSaveError(error: string | undefined, t: (key: string, fallback?: string) => string, ar: boolean): string {
  const msg =
    error === 'name_required'
      ? t('prompts.nameRequired', ar ? 'الاسم مطلوب' : 'A name is required')
      : error === 'text_required'
        ? t('prompts.textRequired', ar ? 'نص التوجيه مطلوب' : 'Prompt text is required')
        : error === 'storage_failed'
          ? t('prompts.storageFailed', ar ? 'تعذّر الحفظ على هذا الجهاز' : 'Could not save on this device')
          : t('prompts.saveFailed', ar ? 'تعذّر حفظ التوجيه' : 'Could not save the prompt');
  return error && !['name_required', 'text_required', 'storage_failed'].includes(error) ? `${msg}: ${error}` : msg;
}

type FlashKind = 'saved' | 'copied' | 'used';
interface Flash {
  id: string;
  kind: FlashKind;
}

export function PromptsPanel() {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const ar = lang === 'ar';
  const notify = useStore((s) => s.notify);
  const insertIntoComposer = useStore((s) => s.insertIntoComposer);

  const [items, setItems] = useState<PromptItem[] | null>(null);
  const [q, setQ] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const editing = useMemo(
    () => (editingId ? (items ?? []).find((p) => p.id === editingId) ?? null : null),
    [editingId, items],
  );

  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);

  const doFlash = useCallback((id: string, kind: FlashKind) => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    setFlash({ id, kind });
    flashTimer.current = window.setTimeout(() => setFlash(null), 1700);
  }, []);

  const reload = useCallback(async () => {
    try {
      const l = await api.promptsList();
      setItems(Array.isArray(l) ? l : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter((p) => p.name.toLowerCase().includes(query) || p.text.toLowerCase().includes(query));
  }, [items, q]);

  const editorVars = useMemo(() => varsIn(text), [text]);
  const tokenEstimate = text.trim() ? Math.max(1, Math.ceil(text.trim().length / 4)) : 0;

  const openNew = () => {
    setEditingId(null);
    setName('');
    setText('');
    setShowSave(true);
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const edit = (p: PromptItem) => {
    setEditingId(p.id);
    setName(p.name);
    setText(p.text);
    setShowSave(true);
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const cancel = () => {
    setShowSave(false);
    setEditingId(null);
    setName('');
    setText('');
  };

  const save = async () => {
    const n = name.trim();
    if (!n || !text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.promptsSave(n, text);
      if (!res.ok) {
        // The service returns name_required | text_required | storage_failed.
        // Mapping EVERY failure to "text required" was a wrong-error bug —
        // a failed disk write must never look like a validation problem.
        notify(promptSaveError(res.error, t, ar));
        return;
      }
      // Upsert is by name. On a rename, remove the original row so a single
      // prompt never becomes two — a real, honest save of the user's edit.
      if (editing && editing.name.toLowerCase() !== n.toLowerCase()) {
        try {
          await api.promptsDelete(editing.id);
        } catch {
          notify(t('prompts.renameCleanupFailed', ar ? 'حُفظ الاسم الجديد لكن تعذّر حذف القديم' : 'New name saved, but the old row could not be removed'));
        }
      }
      doFlash(res.item?.id ?? editing?.id ?? '', 'saved');
      cancel();
      notify(t('prompts.saved', ar ? 'حُفظ في مكتبة التوجيهات' : 'Saved to the prompt library'));
      await reload();
    } catch (err) {
      notify(`${t('prompts.saveFailed', ar ? 'تعذّر حفظ التوجيه' : 'Could not save the prompt')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: PromptItem) => {
    try {
      const res = await api.promptsDelete(p.id);
      if (!res?.ok) {
        notify(t('prompts.deleteFailed', ar ? 'تعذّر حذف التوجيه' : 'Could not delete the prompt'));
        return;
      }
      if (editingId === p.id) cancel();
      notify(t('prompts.deleted', ar ? 'حُذف التوجيه' : 'Prompt deleted'));
      await reload();
    } catch (err) {
      notify(`${t('prompts.deleteFailed', ar ? 'تعذّر حذف التوجيه' : 'Could not delete the prompt')}: ${String((err as Error)?.message ?? err)}`);
    }
  };

  const copy = async (p: PromptItem) => {
    try {
      await navigator.clipboard.writeText(p.text);
      doFlash(p.id, 'copied');
      notify(t('prompts.copied', ar ? 'نُسخ التوجيه' : 'Prompt copied to clipboard'));
    } catch {
      notify(t('prompts.copyFailed', ar ? 'النسخ غير متاح على هذا الجهاز' : 'Clipboard is unavailable on this device'));
    }
  };

  const use = (p: PromptItem) => {
    insertIntoComposer(p.text);
    doFlash(p.id, 'used');
    notify(t('prompts.inserted', ar ? 'أُدرج في المحادثة' : 'Inserted into the composer'));
  };

  // v11.38 — "USE WITH AI": the exact saved text, wrapped as an explicit user
  // instruction, goes into the composer. This is the visible effect the
  // founder asked for: the AI treats it as a direct order (PROMPTS-FIRST).
  const useWithAI = (p: PromptItem) => {
    insertIntoComposer(formatPromptForAI(p.text));
    doFlash(p.id, 'used');
    notify(t('prompts.useWithAI.done', ar ? 'أُدرج كتوجيه يتبعه الذكاء' : 'Inserted as an AI-followed instruction'));
  };

  const dateOf = (p: PromptItem) => {
    try {
      return new Date(p.updatedAt).toLocaleDateString(ar ? 'ar' : 'en-US');
    } catch {
      return '';
    }
  };

  return (
    <div className="page-v14 rail-page pm-page">
      <PageHead
        eyebrow={t('prompts.eyebrow', '07 / PROMPTS')}
        title={t('prompts.title', ar ? 'مكتبة التوجيهات' : 'Prompt Library')}
        description={t(
          'prompts.desc',
          ar
            ? 'نصوصك أنت، محفوظة على هذا الجهاز — قابلة لإعادة الاستخدام، ليست قوالب ذكاء اصطناعي.'
            : 'Your own text snippets, stored on this device — reusable, not AI templates.',
        )}
        meta={
          <div className="pm-headmark">
            <NibGlyph className="pm-nib" />
            <span className="pm-headmark-rule" aria-hidden="true" />
            <span className="stamp tnum" dir="ltr">
              {items ? `${filtered.length}` : '…'} {t('prompts.unit', ar ? 'توجيه' : 'PROMPTS')}
            </span>
          </div>
        }
        actions={
          <>
            <button className="ibtn press" title={t('prompts.refresh', ar ? 'تحديث' : 'Refresh')} onClick={() => void reload()}>
              <RefreshCw size={13} aria-hidden />
            </button>
            <Btn variant={showSave ? 'ghost' : 'primary'} onClick={() => (showSave ? cancel() : openNew())}>
              {showSave ? <X size={12} aria-hidden /> : <BookPlus size={12} aria-hidden />}
              {showSave ? t('prompts.cancel', ar ? 'إلغاء' : 'Cancel') : t('prompts.new', ar ? 'توجيه جديد' : 'New prompt')}
            </Btn>
          </>
        }
      />

      {/* Editor — a quiet inset panel, not a floating card. */}
      {showSave && (
        <div className="pm-editor" data-testid="prompt-save-form" ref={editorRef}>
          <div className="pm-editor-head">
            <span className="pm-editor-eyebrow" dir="auto">
              {editing
                ? t('prompts.editor.edit', ar ? 'تحرير توجيه' : 'EDIT PROMPT')
                : t('prompts.editor.new', ar ? 'توجيه جديد' : 'NEW PROMPT')}
            </span>
            <span className="pm-editor-rule" aria-hidden="true" />
            <button className="ibtn press" title={t('prompts.cancel', ar ? 'إلغاء' : 'Cancel')} onClick={cancel}>
              <X size={12} aria-hidden />
            </button>
          </div>
          <div className="pm-editor-grid">
            <div>
              <label className="micro-label" htmlFor="pm-name">
                {t('prompts.name', ar ? 'الاسم' : 'Name')}
              </label>
              <TextInput
                id="pm-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={ar ? 'مثال: مراجعة كود صارمة' : 'e.g. Strict code review'}
                maxLength={80}
                dir="auto"
              />
            </div>
            <div>
              <label className="micro-label" htmlFor="pm-text">
                {t('prompts.text', ar ? 'نص التوجيه' : 'Prompt text')}
              </label>
              <textarea
                id="pm-text"
                className="pm-editor-area"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={ar ? 'اكتب التوجيه القابل لإعادة الاستخدام هنا…' : 'Write the reusable prompt here…'}
                maxLength={20000}
                spellCheck={false}
                dir="auto"
              />
            </div>
          </div>
          <div className="pm-editor-meta">
            <span className="tnum" dir="ltr">
              {text.length}/20,000 · ≈ {tokenEstimate} {t('prompts.tokens', ar ? 'رمز' : 'tokens')} ({t('prompts.est', ar ? 'تقدير' : 'est.')})
            </span>
            {editorVars.length > 0 && (
              <span className="pm-editor-vars" dir="ltr">
                {editorVars.map((v) => (
                  <span className="pm-tag" key={v}>{`{{${v}}}`}</span>
                ))}
              </span>
            )}
          </div>
          <div className="pm-editor-hint" dir="auto">
            {t(
              'prompts.varHint',
              ar
                ? 'نصيحة: اكتب عناصر نائبة مثل {{path}} لتعيد استخدام التوجيه مع قيم مختلفة.'
                : 'Tip: write {{path}}-style placeholders to reuse this prompt with different values.',
            )}
          </div>
          <div className="pm-editor-foot">
            <Btn variant="primary" onClick={() => void save()} disabled={busy || !name.trim() || !text.trim()}>
              {busy ? '…' : <Check size={12} aria-hidden />}
              {t('prompts.save', ar ? 'حفظ في المكتبة' : 'Save to library')}
            </Btn>
            <Btn variant="ghost" onClick={cancel}>
              {t('prompts.cancel', ar ? 'إلغاء' : 'Cancel')}
            </Btn>
            <span className="pm-editor-valid" dir="auto">
              {t('prompts.validation', ar ? 'الاسم والنص مطلوبان.' : 'A name and text are required.')}
            </span>
          </div>
        </div>
      )}

      <div className="pm-search">
        <Search size={12} className="pm-search-ico" aria-hidden />
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('prompts.search', ar ? 'ابحث في التوجيهات…' : 'Search prompts…')}
          className="!ps-8"
          dir="auto"
        />
      </div>

      {items === null ? (
        <div className="pm-loading" dir="auto">{t('prompts.loading', ar ? 'جارِ التحميل…' : 'Loading…')}</div>
      ) : filtered.length === 0 ? (
        <div className="pm-empty">
          <NibEngraving className="pm-engrave" />
          <div className="pm-empty-title" dir="auto">
            {q
              ? t('prompts.noMatch', ar ? 'لا نتائج مطابقة' : 'No matching prompts')
              : t('prompts.empty', ar ? 'المكتبة فارغة' : 'The library is empty')}
          </div>
          <p className="pm-empty-sub" dir="auto">
            {t(
              'prompts.emptySub',
              ar
                ? 'احفظ توجيهاتك المتكررة (مراجعة كود، توصيف مهمة، صيغة تقرير…) ثم أدرجها في المحادثة بضغطة واحدة.'
                : 'Save your recurring prompts (code review, task brief, report format…) and re-insert them into the chat in one click.',
            )}
          </p>
          {!q && (
            <Btn variant="primary" onClick={openNew}>
              <BookPlus size={12} aria-hidden />
              {t('prompts.new', ar ? 'توجيه جديد' : 'New prompt')}
            </Btn>
          )}
        </div>
      ) : (
        <div className="pm-list" aria-label={t('prompts.listLabel', ar ? 'التوجيهات المحفوظة' : 'Saved prompts')}>
          {filtered.map((p, i) => {
            const pv = varsIn(p.text);
            const lines = lineCount(p.text);
            return (
              <div key={p.id} className="pm-row" data-testid={`prompt-item-${p.id}`}>
                <span className="pm-row-index tnum" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="pm-row-body">
                  <div className="pm-row-top">
                    <span className="pm-row-name" dir="auto">{p.name}</span>
                    {flash?.id === p.id && (
                      <span className="pm-flash" aria-live="polite" dir="auto">
                        {flash.kind === 'saved' ? <Check size={10} aria-hidden /> : flash.kind === 'copied' ? <Copy size={10} aria-hidden /> : <CornerDownLeft size={10} aria-hidden />}
                        <span>
                          {flash.kind === 'saved'
                            ? t('prompts.flash.saved', ar ? 'حُفظ' : 'saved')
                            : flash.kind === 'copied'
                              ? t('prompts.flash.copied', ar ? 'نُسخ' : 'copied')
                              : t('prompts.flash.used', ar ? 'أُدرج' : 'inserted')}
                        </span>
                      </span>
                    )}
                    <span className="pm-row-spacer" />
                    <span className="pm-row-date tnum" dir="ltr">{dateOf(p)}</span>
                  </div>
                  <div className="pm-row-preview" dir="ltr" title={p.text}>
                    {p.text.replace(/\s+/g, ' ').trim()}
                  </div>
                  {(pv.length > 0 || lines > 1) && (
                    <div className="pm-row-tags">
                      {pv.map((v) => (
                        <span className="pm-tag" key={v} dir="ltr">{`{{${v}}}`}</span>
                      ))}
                      {lines > 1 && (
                        <span className="pm-tag pm-tag-quiet tnum" dir="ltr">
                          {lines} {t('prompts.lines', ar ? 'سطور' : 'lines')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="pm-row-actions">
                  <button className="ibtn press" title={t('prompts.edit', ar ? 'تحرير' : 'Edit')} aria-label={t('prompts.edit', ar ? 'تحرير' : 'Edit')} onClick={() => edit(p)}>
                    <Pencil size={12} aria-hidden />
                  </button>
                  <button className="ibtn press" title={t('prompts.copy', ar ? 'نسخ' : 'Copy')} aria-label={t('prompts.copy', ar ? 'نسخ' : 'Copy')} onClick={() => void copy(p)}>
                    <Copy size={12} aria-hidden />
                  </button>
                  <button
                    className="ibtn press"
                    data-testid={`prompt-use-with-ai-${p.id}`}
                    title={t('prompts.useWithAI', ar ? 'استخدام مع الذكاء (توجيه ملزم)' : 'Use with AI (followed instruction)')}
                    aria-label={t('prompts.useWithAI', ar ? 'استخدام مع الذكاء (توجيه ملزم)' : 'Use with AI (followed instruction)')}
                    onClick={() => useWithAI(p)}
                  >
                    <Sparkles size={12} aria-hidden />
                  </button>
                  <button className="ibtn press" title={t('prompts.insert', ar ? 'إدراج' : 'Insert')} aria-label={t('prompts.insert', ar ? 'إدراج' : 'Insert')} onClick={() => use(p)}>
                    <CornerDownLeft size={12} aria-hidden />
                  </button>
                  <button className="ibtn press pm-del" title={t('prompts.delete', ar ? 'حذف' : 'Delete')} aria-label={t('prompts.delete', ar ? 'حذف' : 'Delete')} onClick={() => void remove(p)}>
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pm-how">
        <SectionTitle>{t('prompts.howTitle', ar ? 'كيف تستخدمها' : 'How it works')}</SectionTitle>
        <p dir="auto">
          {t(
            'prompts.how',
            ar
              ? 'كل توجيه يُحفظ على هذا الجهاز فقط (prompts.json). اكتب التوجيه مرة، ثم اضغط «استخدام مع الذكاء» ليُدرج كتوجيه ملزم يتبعه الوكيل حرفيًا — أو «إدراج» للنص الخام، أو الأمر السريع /prompts من المحادثة.'
              : 'Every prompt is stored on this device only (prompts.json). Write it once, then press “Use with AI” to insert it as an explicit instruction the agent follows literally — or “Insert” for the raw text, or the /prompts command in chat.',
          )}
          <br />
          <span dir="auto">
            {t(
              'prompts.firstHint',
              ar
                ? 'قاعدة PROMPTS-FIRST: التوجيه المُدرج من المكتبة أمر صريح منك — الوكيل ينفّذ خطواته قبل أي اجتهاد منه.'
                : 'PROMPTS-FIRST: a prompt inserted from this library is an explicit order from you — the agent runs its steps before improvising.',
            )}
          </span>
        </p>
      </div>
    </div>
  );
}

export default PromptsPanel;
