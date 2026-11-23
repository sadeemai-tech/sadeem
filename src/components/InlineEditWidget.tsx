// SADEEM — inline AI edit widget: a small overlay anchored at the cursor that
// takes an instruction, asks the model for replacement code, previews it, and
// applies it to the editor on demand. Controlled by EditorArea via `request`.
// State machine: prompt → loading → preview → (closed by EditorArea).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { stripCodeFences } from '../lib/ghostText';
import { useT } from '../i18n';
import { Kbd, Spinner } from './ui';

export type InlineEditPreset = 'explain' | 'fix' | 'addTests' | 'refactor';

export interface InlineEditRequest {
  /** Bumps on every open so the widget can reset its internal state. */
  seq: number;
  /** Selection range — or the single line at the cursor when nothing is selected. */
  range: Monaco.IRange | null;
  /** Text inside `range` ('' for an empty line at the cursor). */
  selection: string;
  /** Language id used as the fenced-block tag in the prompt. */
  language: string;
  /** Absolute path of the open tab. */
  path: string;
  /** Prefilled instruction coming from a context-menu action. */
  preset?: InlineEditPreset;
}

const PRESET_KEYS: Record<InlineEditPreset, { key: string; fb: string }> = {
  explain: { key: 'inline-explain', fb: 'Explain what this code does, concisely.' },
  fix: { key: 'inline-fix', fb: 'Fix the bugs and problems in this code. Output only the corrected code.' },
  addTests: { key: 'inline-add-tests', fb: 'Write focused unit tests for this code.' },
  refactor: { key: 'inline-refactor', fb: 'Refactor this code for clarity and quality. Output only the refactored code.' },
};

type Phase = 'prompt' | 'loading' | 'preview';

export function InlineEditWidget({
  editor,
  request,
  onClose,
}: {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  request: InlineEditRequest;
  onClose: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('prompt');
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 28, left: 24 });
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<{ aborted: boolean } | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the machine for each new request; abort anything still in flight.
  useEffect(() => {
    if (tokenRef.current) tokenRef.current.aborted = true;
    tokenRef.current = null;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = null;
    setPhase('prompt');
    setInstruction(request.preset ? t(PRESET_KEYS[request.preset].key, PRESET_KEYS[request.preset].fb) : '');
    setResult('');
    setError('');
  }, [request.seq, request.preset, t]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(''), 4000);
  }, []);

  // ---- positioning: keep the widget pinned to the anchor line ----
  const reposition = useCallback(() => {
    if (!editor) return;
    const anchor = request.range
      ? { lineNumber: request.range.startLineNumber, column: request.range.startColumn }
      : editor.getPosition();
    if (!anchor) return;
    const p = editor.getScrolledVisiblePosition(anchor);
    if (!p) return;
    const dom = editor.getDomNode();
    const maxW = dom?.clientWidth ?? 640;
    const maxH = dom?.clientHeight ?? 420;
    const w = boxRef.current?.offsetWidth ?? 460;
    const h = boxRef.current?.offsetHeight ?? 92;
    let top = p.top + (p.height || 18) + 6;
    if (top + h > maxH - 8) top = Math.max(4, p.top - h - 6); // flip above when near the bottom
    const left = Math.max(10, Math.min(p.left, Math.max(10, maxW - w - 10)));
    setPos({ top, left });
  }, [editor, request.range]);

  useEffect(() => {
    reposition();
    if (!editor) return;
    const d1 = editor.onDidScrollChange(() => reposition());
    const d2 = editor.onDidLayoutChange(() => reposition());
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [reposition, editor, phase, request.seq]);

  // Focus the instruction input whenever the prompt phase is shown.
  useEffect(() => {
    if (phase !== 'prompt') return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [phase, request.seq]);

  // Abort in-flight request + timers on unmount.
  useEffect(() => {
    return () => {
      if (tokenRef.current) tokenRef.current.aborted = true;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const generate = () => {
    if (!editor || phase !== 'prompt') return;
    const inst = instruction.trim();
    if (!inst) return;
    const lang = request.language === 'plaintext' ? '' : request.language;
    const code = request.selection;
    const prompt = `${inst}\n\nSelected code:\n\`\`\`${lang}\n${code}\n\`\`\``;
    setPhase('loading');
    setError('');
    if (tokenRef.current) tokenRef.current.aborted = true;
    const token = { aborted: false };
    tokenRef.current = token;
    api
      .aiComplete({ prompt, context: request.selection, maxTokens: 1024, signal: token })
      .then((res) => {
        if (token.aborted) return;
        if (!res?.ok || !res.text) {
          showError(res?.error || t('editor.inlineEdit.failed'));
          setPhase('prompt');
          return;
        }
        setResult(stripCodeFences(res.text));
        setPhase('preview');
      })
      .catch(() => {
        if (token.aborted) return;
        showError(t('editor.inlineEdit.failed'));
        setPhase('prompt');
      });
  };

  const cancel = () => {
    if (tokenRef.current) tokenRef.current.aborted = true;
    onClose();
  };

  // v11.31 — the prompt input handled Escape, but once generation started the
  // widget had NO keyboard exit (the user had to hunt for the Cancel button).
  // Capture-phase so Monaco never swallows it; only active outside 'prompt'.
  useEffect(() => {
    if (phase === 'prompt') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const apply = () => {
    if (!editor || !request.range) return;
    // v11.31 — bracket the synthetic edit with undo stops so one Ctrl+Z
    // cleanly reverts the whole AI edit instead of a character at a time.
    editor.pushUndoStop();
    editor.executeEdits('surnia-inline-edit', [{ range: request.range, text: result }]);
    editor.pushUndoStop();
    onClose();
    editor.focus();
  };

  if (!editor) return null;

  // SADEEM voice: the prompt state is a floating rounded pill (teal accent);
  // loading/preview grow into a rounded panel to fit their content.
  const pillShape = phase === 'prompt' && !error ? 'rounded-full' : 'rounded-[var(--radius-lg)]';

  return (
    <div
      ref={boxRef}
      className={`absolute z-30 aurora-panel shadow-card anim-in overflow-hidden ${pillShape}`}
      style={{ top: pos.top, left: pos.left, width: 'min(480px, calc(100% - 24px))', direction: 'ltr' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {phase === 'prompt' && (
        <div className={error ? 'p-2 flex flex-col gap-1.5' : 'p-1.5 flex flex-col gap-1.5'}>
          {error && <div className="text-[11px] text-[var(--bad)] font-medium px-2">{error}</div>}
          <div className="flex items-center gap-1.5">
            <span className="text-acc shrink-0 ps-1" aria-hidden>
              <Sparkles size={13} />
            </span>
            <input
              ref={inputRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  generate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
              }}
              placeholder={t('editor.inlineEdit.ph')}
              className="input flex-1 !h-7 !text-[12px] !bg-transparent !border-0 !shadow-none !px-1 focus:!shadow-none"
              dir="auto"
              autoFocus
            />
            <button className="btn btn-primary !h-7 !px-3 !text-[11.5px] !rounded-full" onClick={generate}>
              {t('editor.inlineEdit.generate')}
            </button>
            <button className="btn btn-ghost !h-7 !px-2.5 !text-[11.5px] !rounded-full" onClick={cancel}>
              {t('ws.cancel')}
            </button>
          </div>
          {error ? null : (
            <div className="px-3 pb-0.5 flex items-center gap-2 text-[9.5px] text-faint">
              <span className="inline-flex items-center gap-1">
                <Kbd>↵</Kbd> {t('editor.inlineEdit.generate')}
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>esc</Kbd> {t('ws.cancel')}
              </span>
            </div>
          )}
        </div>
      )}

      {phase === 'loading' && (
        <div className="p-1.5 flex items-center gap-2">
          <span className="text-acc shrink-0 ps-1" aria-hidden>
            <Sparkles size={13} />
          </span>
          <Spinner size={13} />
          <span className="text-[12px] text-[var(--dim)] flex-1">{t('editor.inlineEdit.working')}</span>
          <button className="btn btn-ghost !h-7 !px-2.5 !text-[11.5px] !rounded-full" onClick={cancel}>
            {t('ws.cancel')}
          </button>
        </div>
      )}

      {phase === 'preview' && (
        <div className="p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-acc">
            <Sparkles size={12} aria-hidden />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-faint truncate min-w-0" title={request.path}>
              {request.path.split(/[\\/]/).pop() ?? ''}
            </span>
          </div>
          <pre className="m-0 font-code text-[11.5px] leading-relaxed bg-[var(--bg1)] border border-[var(--line-soft)] rounded-[var(--radius-md)] p-2.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words select-text">
            {result}
          </pre>
          <div className="flex items-center justify-end gap-1.5">
            <button className="btn !h-7 !px-3 !text-[11.5px] !rounded-full" onClick={cancel}>
              {t('editor.inlineEdit.reject')}
            </button>
            <button className="btn btn-primary !h-7 !px-3 !text-[11.5px] !rounded-full" onClick={apply}>
              {t('editor.inlineEdit.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default InlineEditWidget;
