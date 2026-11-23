// Surnia — ghost-text inline completions (AI autocomplete) for the Monaco editor.
// Registers an InlineCompletionsProvider that asks the model for a short
// continuation at the cursor. Every failure is swallowed → no suggestions, never
// an error surfacing in the editor.
import * as monaco from 'monaco-editor';
import { api } from './api';

/** Files larger than this are skipped (prompt would be huge + slow). */
const MAX_FILE_BYTES = 200 * 1024;
/** Characters of context captured before the cursor. */
const BEFORE_CHARS = 2000;
/** Characters of context captured after the cursor. */
const AFTER_CHARS = 500;
/** Completion budget — ghost text must stay short. */
const MAX_TOKENS = 96;

const GHOST_PROMPT =
  'Continue the code exactly where the cursor is. Output ONLY the continuation text that should be inserted at <CURSOR>, no repetition of existing code.';
const GHOST_SYSTEM =
  'You are a code completion engine. Output only raw code to insert at <CURSOR>. No markdown fences, no explanations.';

/** Strip one wrapping markdown code fence, if the whole reply is fenced. */
export function stripCodeFences(text: string): string {
  const t = String(text ?? '');
  const m = /^\s*```[^\n]*\n([\s\S]*?)\n?\s*```\s*$/.exec(t);
  return m ? m[1] : t;
}

/**
 * Register AI ghost-text inline completions for the given editor.
 * Returns an IDisposable that unregisters the provider and aborts any
 * in-flight request. Debounce is inherent in Monaco's inline-suggest fetch
 * trigger, so no extra timer is needed here.
 */
export function registerGhostText(
  monacoInstance: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  isEnabled: () => boolean,
): monaco.IDisposable {
  let disposed = false;
  // Plain abort token polled by the main process — flip `.aborted` to cancel.
  let inFlight: { aborted: boolean } | null = null;

  const provider: monaco.languages.InlineCompletionsProvider = {
    async provideInlineCompletions(model, position) {
      if (disposed || !isEnabled()) return { items: [] };
      try {
        // Abort the previous request before starting a new fetch.
        if (inFlight) inFlight.aborted = true;
        const token = { aborted: false };
        inFlight = token;

        const em = editor.getModel();
        if (!em || em.isDisposed() || em !== model) return { items: [] };
        if (model.getValueLength() > MAX_FILE_BYTES) return { items: [] };

        const offset = model.getOffsetAt(position);
        const value = model.getValue();
        const before = value.slice(Math.max(0, offset - BEFORE_CHARS), offset);
        const after = value.slice(offset, offset + AFTER_CHARS);
        // Empty prompt region → nothing sensible to continue.
        if (!before.trim() && !after.trim()) return { items: [] };

        const res = await api.aiComplete({
          prompt: GHOST_PROMPT,
          context: `${before}<CURSOR>${after}`,
          system: GHOST_SYSTEM,
          maxTokens: MAX_TOKENS,
          signal: token,
        });
        if (disposed || token.aborted || !res?.ok || !res.text) return { items: [] };
        const insertText = stripCodeFences(res.text);
        if (!insertText.trim()) return { items: [] };
        return { items: [{ insertText }] };
      } catch {
        // Ghost text must never throw — no provider configured, network down,
        // aborted request, anything: just show nothing.
        return { items: [] };
      }
    },
    freeInlineCompletions() {
      /* nothing cached — nothing to release */
    },
  };

  // Registered on '*' so every language used by the editor gets completions.
  const registration = monacoInstance.languages.registerInlineCompletionsProvider('*', provider);

  return {
    dispose() {
      disposed = true;
      if (inFlight) inFlight.aborted = true;
      registration.dispose();
    },
  };
}
