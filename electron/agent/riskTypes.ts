// ============================================================
// Surnia (E4 security) — risk-classification CONTRACT types.
//
// The classifier IMPLEMENTATION lives in ./risk (owned by the
// ENGINE agent) and must export:
//     classifyCommand(cmd: string): RiskVerdict
// terminalGuard.ts imports the function at runtime (defensively)
// and shares THESE types so both sides stay shape-compatible.
// Keep this file dependency-free — it is imported from both the
// agent layer and the services layer.
// ============================================================

/** Severity of a shell-command classification. */
export type RiskLevel = 'safe' | 'warn' | 'danger';

/** Verdict returned by classifyCommand (see ./risk — ENGINE agent). */
export interface RiskVerdict {
  level: RiskLevel;
  /** Human-readable, renderer-displayable explanations. */
  reasons: string[];
}

/** Terminal-guard aggressiveness (persisted as settings.terminalGuard). */
export type GuardMode = 'on' | 'warn-only' | 'off';

/** Normalized guard mode — anything else on disk falls back to 'on'. */
export function normalizeGuardMode(v: unknown): GuardMode {
  return v === 'warn-only' || v === 'off' ? v : 'on';
}
