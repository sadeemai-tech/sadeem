// ============================================================
// toolGrouping — v11.11 (wave3-A2) pure tool-card helpers
// ------------------------------------------------------------
// Two jobs, both pure and unit-tested (tests/v1111-toolvisuals.test.mjs):
//
//  1. toolFamilyOf — every tool the AI uses lands in ONE visual family.
//     Each family owns a distinct card identity in chat.css (`.tv-*`):
//       write   → lime left-rail card, "CREATE", filename chip + line-count
//       edit    → amber-cast rail, filename chip, inline DiffView mini-view
//       read    → cool steel, one-shot scanned sheen, lines/hits count chip
//       bash    → dark terminal strip, $ prompt glyph, EXIT code badge
//       browser → sage-cast steel, URL host chip, screenshot thumbnail
//       mcp     → violet-cast steel, server-name chip (mcp__<server>__…)
//       think   → untouched (the THINK branding is the brand mark — wave2)
//       other   → neutral but polished (same unified card grammar)
//
//  2. toolRunOrdinal — consecutive same-tool cards MERGE into a tight stack
//     with a "tool ×N" counter chip (the founder hates clutter): position 1
//     is the run head, 2..N are continuations; a different tool (or a
//     narration row — anything without the same family key) breaks the run.
//
// No React, no DOM, no imports — safe to bundle standalone with esbuild.
// ============================================================

export type ToolFamily = 'write' | 'edit' | 'read' | 'bash' | 'browser' | 'mcp' | 'think' | 'other';

/** tool name → family. mcp__* wins by prefix; everything else exact-match. */
const FAMILY_OF: Record<string, ToolFamily> = {
  // write — creation (new bytes on disk)
  write_file: 'write',
  image_generate: 'write',
  worktree_create: 'write',
  download: 'write',
  download_file: 'write',
  // edit — mutation of existing bytes
  edit_file: 'edit',
  multi_edit: 'edit',
  str_replace: 'edit',
  worktree_remove: 'edit',
  // read — perception (reads, listings, searches)
  read_file: 'read',
  list_dir: 'read',
  search_files: 'read',
  code_search: 'read',
  search_grep: 'read',
  grep: 'read',
  web_search: 'read',
  search_web: 'read',
  // bash — terminal work
  run_command: 'bash',
  run_background: 'bash',
  process_output: 'bash',
  stop_process: 'bash',
  test_run: 'bash',
  lint_check: 'bash',
  debug_start: 'bash',
  debug_state: 'bash',
  debug_eval: 'bash',
  debug_step: 'bash',
  debug_stop: 'bash',
  // browser — web surface (URL-shaped primaries)
  browser_open: 'browser',
  browser_navigate: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_read: 'browser',
  browser_snapshot: 'browser',
  browser_screenshot: 'browser',
  browser_eval: 'browser',
  browser_close: 'browser',
  web_fetch: 'browser',
  preview: 'browser',
  screenshot: 'browser',
  preview_screenshot: 'browser',
  // think — plan/meta (KEPT on the existing violet think coding; the THINK
  // phase itself is branded by the app logo and is NOT touched here)
  todo_write: 'think',
  task: 'think',
  ask_user: 'think',
  use_skill: 'think',
};

/** Family of a tool name — mcp__<server>__<tool> is always MCP, unknown → other. */
export function toolFamilyOf(toolName?: string): ToolFamily {
  const n = toolName ?? '';
  if (!n) return 'other';
  if (n.startsWith('mcp__')) return 'mcp';
  return FAMILY_OF[n] ?? 'other';
}

/**
 * Ordinal of `key` within the run of CONSECUTIVE equal keys that ends at the
 * end of `prevKeys` (1 = run head, 2..N = stacked continuation). Any other
 * key — a different tool, a narration gap (undefined/null) — breaks the run.
 *
 *   toolRunOrdinal([], 'read')                 → 1
 *   toolRunOrdinal(['read'], 'read')           → 2
 *   toolRunOrdinal(['read', 'read'], 'read')   → 3
 *   toolRunOrdinal(['read'], 'edit')           → 1   (different tool breaks)
 *   toolRunOrdinal(['read', undefined], 'read')→ 1   (narration breaks)
 */
export function toolRunOrdinal(prevKeys: ReadonlyArray<string | null | undefined>, key: string): number {
  let n = 0;
  for (let i = prevKeys.length - 1; i >= 0; i--) {
    if (prevKeys[i] === key) n++;
    else break;
  }
  return n + 1;
}
