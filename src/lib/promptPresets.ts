// SADEEM — Prompt-presets quick insert (v12 competitive upgrade).
// The Prompt Library panel (PromptsPanel) already persists reusable prompts,
// but reaching it meant leaving the composer. This pure helper powers a
// keyboard-first quick-insert popover mounted directly on the composer:
// a fuzzy name/text filter, deterministic newest-first ordering and a
// hard cap so the popover stays snappy even with a full 200-item library.
//
// Pure + dependency-free on purpose (same posture as lib/ctx.ts and
// lib/linediff.ts) so it is unit-testable without an Electron bridge.

export interface PromptPresetLike {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
}

/**
 * Filter saved prompts for the quick-insert popover.
 *  · case/whitespace-insensitive substring over name AND body
 *  · newest-updated first (stable: ties keep the incoming order)
 *  · capped at `limit` rows (default 40)
 * Never throws on malformed input — a corrupt library degrades to [].
 */
export function filterPromptPresets(
  items: readonly PromptPresetLike[] | null | undefined,
  query: string,
  limit = 40,
): PromptPresetLike[] {
  if (!Array.isArray(items)) return [];
  const q = String(query ?? '').trim().toLowerCase();
  const safe = items.filter(
    (p): p is PromptPresetLike =>
      !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.text === 'string',
  );
  const matched = q
    ? safe.filter((p) => p.name.toLowerCase().includes(q) || p.text.toLowerCase().includes(q))
    : safe.slice();
  matched.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  const cap = Math.max(0, Math.min(limit, 200));
  return matched.slice(0, cap);
}

/**
 * One-line preview for a popover row: collapse whitespace so a multi-line
 * prompt never breaks the fixed-height layout. Kept as a helper (not inline
 * JSX) so the renderer's row markup stays declarative and this is testable.
 */
export function presetPreview(text: string, max = 90): string {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}
