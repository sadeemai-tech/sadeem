// SADEEM — v11.10 (A5) renderer-side usage attachment.
// GUARANTEE: every message_end usage delta attaches to EXACTLY ONE transcript
// row, so sum(per-message usage) == sessionUsage always reconciles. Before
// A5, a turn with no streaming assistant row (tool-only turns, error-only
// turns) silently dropped its usage from the per-message view while the
// session totals still counted it — the books didn't balance.
import type { ChatMessage, Usage } from '../../shared/types';

/**
 * Attach a turn's usage to the right row (mutates `msgs` in place, React-safe
 * by replacing rows — the store's reducer owns cloning).
 *
 * Order of ownership:
 *  1. the last assistant text row WITHOUT usage (normal + error-bubble turns);
 *  2. the last assistant text row at all (one nonzero message_end per user
 *     turn, so an overwrite here can only mean a second end for the same
 *     newest row — it is the honest owner);
 *  3. the last tool_call row (tool-only turns — the model call that produced
 *     them owns the tokens);
 *  4. a minimal synthetic assistant row (empty model output — the usage must
 *     still be visible and countable, never silently dropped).
 *
 * Returns the index the usage landed on.
 */
export function attachTurnUsage(msgs: ChatMessage[], usage: Usage): number {
  let lastAssistant = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant' && (m.kind ?? 'text') === 'text') {
      lastAssistant = i;
      break;
    }
  }
  if (lastAssistant >= 0) {
    msgs[lastAssistant] = { ...msgs[lastAssistant], usage };
    return lastAssistant;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].kind === 'tool_call') {
      msgs[i] = { ...msgs[i], usage };
      return i;
    }
  }
  msgs.push({
    id: `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    role: 'assistant',
    kind: 'text',
    content: '',
    timestamp: Date.now(),
    usage,
  });
  return msgs.length - 1;
}
