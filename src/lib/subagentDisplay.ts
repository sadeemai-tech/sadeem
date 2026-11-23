// subagentDisplay — pure presentation metadata for the agent-team surfaces.
// No React, no side effects: maps a `task` tool `agent` id (or a ledger role)
// to a readable name, compact initials, a family glyph and a PALETTE TOKEN
// (never a literal colour — the theme owns the hues). Shared by the inline
// AgentTeamCard, the Subagent detail view and the Subagents rail so all three
// speak the exact same visual language.
import {
  BookOpen,
  Bot,
  Bug,
  Code2,
  Database,
  FileText,
  Gauge,
  Globe,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { SubagentStatus } from '../../shared/types';

export interface AgentVisual {
  /** Human name (display). */
  name: string;
  /** Two-letter chip caption / legend initials. */
  initials: string;
  /** Family glyph shown inside the avatar. */
  icon: LucideIcon;
  /** CSS custom property carrying the family hue. */
  tone: string;
}

const tone = {
  research: 'var(--v-read)',
  build: 'var(--v-edit)',
  quality: 'var(--ok)',
  ops: 'var(--v-run)',
  general: 'var(--agent)',
} as const;

/**
 * Roster visuals keyed by the `SubagentId` values accepted by the `task` tool
 * (see electron/agent/agents.ts). Unknown/future ids fall back to a neutral
 * Bot glyph so a new specialist is never invisible.
 */
export const AGENT_VISUALS: Record<string, AgentVisual> = {
  explore: { name: 'Codebase Explorer', initials: 'EX', icon: Search, tone: tone.research },
  'web-research': { name: 'Web Researcher', initials: 'WR', icon: Globe, tone: tone.research },
  spec: { name: 'Spec Writer', initials: 'SP', icon: FileText, tone: tone.research },
  architect: { name: 'Architect', initials: 'AR', icon: Server, tone: tone.build },
  implement: { name: 'Implementer', initials: 'IM', icon: Code2, tone: tone.build },
  data: { name: 'Data & Schema', initials: 'DA', icon: Database, tone: tone.build },
  debugger: { name: 'Debugger', initials: 'DB', icon: Bug, tone: tone.quality },
  perf: { name: 'Performance', initials: 'PF', icon: Gauge, tone: tone.quality },
  devops: { name: 'DevOps', initials: 'DO', icon: Wrench, tone: tone.ops },
  docs: { name: 'Docs Writer', initials: 'DC', icon: BookOpen, tone: tone.ops },
  test: { name: 'Test Engineer', initials: 'TE', icon: TestTube2, tone: tone.quality },
  review: { name: 'Code Reviewer', initials: 'RV', icon: ShieldCheck, tone: tone.quality },
  refactor: { name: 'Refactoring', initials: 'RF', icon: Code2, tone: tone.quality },
  security: { name: 'Security Auditor', initials: 'SE', icon: ShieldCheck, tone: tone.quality },
  'skill-writer': { name: 'Skill Writer', initials: 'SK', icon: Sparkles, tone: tone.ops },
  general: { name: 'General Agent', initials: 'GA', icon: Bot, tone: tone.general },
};

const FALLBACK: AgentVisual = { name: 'Subagent', initials: 'SA', icon: Bot, tone: tone.general };

/** Metadata for a role id — always returns an object, never undefined. */
export function agentVisual(role?: string | null): AgentVisual {
  if (!role) return FALLBACK;
  return AGENT_VISUALS[role] ?? { ...FALLBACK, name: role.replace(/-/g, ' '), initials: initialsOf(role) };
}

/** Compact two-letter caption derived from an arbitrary label. */
export function initialsOf(label: string): string {
  const parts = label.replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return 'SA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Normalize the four ledger statuses into the three dots the UI draws. */
export type TeamDot = 'breathing' | 'done' | 'warn';

export function dotOf(status?: SubagentStatus | null): TeamDot {
  if (status === 'running') return 'breathing';
  if (status === 'error' || status === 'aborted') return 'warn';
  return 'done';
}

/** Human duration, tabular-friendly ("8ms", "3s", "2m 14s"). */
export function durationOf(ms?: number | null): string {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Progress percentage (0–100) from a ledger record's done/total counters. */
export function pctOf(done?: number, total?: number, status?: SubagentStatus): number {
  if (status === 'done') return 100;
  if (typeof total !== 'number' || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((done ?? 0) / total) * 100)));
}
