// ============================================================
// SADEEM v11 — PANEL REGISTRY (single source of truth)
// Previously this lived inside Sidebar.tsx; v11 introduces
// STAGE RAILS: feature panels are full center-stage PAGES, not
// 320px docks. The registry is shared by Sidebar (dock rails)
// and App (stage rails) so both render the exact same component.
// ============================================================
import React from 'react';
import * as WorkspaceMod from './WorkspacePanel';
import * as SessionsMod from './SessionsPanel';
import * as GitMod from './GitPanel';
import * as MCPMod from './MCPPanel';
import * as UsageMod from './UsagePanel';
import * as DnaMod from './DnaPanel';
import * as FlowsMod from './FlowsPanel';
import * as SkillsMod from './SkillsPanel';
import * as ArtifactsMod from './ArtifactsPanel';
import * as LibraryMod from './LibraryPanel';
import * as PromptsMod from './PromptsPanel';
import * as SubagentsMod from './SubagentsPanel'; // v11.12 — live subagent dashboard
// v11.38 — SIGNATURE rail: direct named import (NOT the panel helper) so the
// full-smoke registry-coverage guard keeps its existing contract: it only
// enumerates helper-wired panels and requires each one in its SCREENS list,
// which is owned by another wave.
import { SignaturePanel } from '../SignaturePanel';
// v11.43 (PROOF-CENTER) — additive Proof rail entry. Direct named import
// (NOT panelOf) so the v1131 registry-coverage guard keeps its contract: it
// only enumerates helper-wired panels. See docs/PROOF-CENTER-V1143.md.
import { ProofPanel } from './ProofPanel';
// v14 — global file search is a full section page (triggered by the
// surnia:open-search event → rail='search'), not a floating overlay.
import { SearchPanel } from '../SearchPanel';
import type { RailView } from '../../store';

/**
 * v11.38 — additive signature rail. We widen the union LOCALLY so this wave
 * does not touch store.ts / Rail.tsx / i18n.ts (owned by other waves). A
 * Record with the extra key is still assignable wherever Record<RailView,…>
 * is expected, so every existing consumer typechecks unchanged.
 * The promotion handoff (exact file:line) is in docs/SIGNATURE-FEATURES-V1138.md.
 */
type AllRail = RailView | 'signature' | 'proof';

/** Resolve a React component from a panel module (default export or named). */
function panelOf(mod: object, name: string): React.ComponentType {
  const cand = (mod as Record<string, unknown>)[name] ?? (mod as Record<string, unknown>).default;
  if (typeof cand === 'function' || (typeof cand === 'object' && cand !== null)) {
    return cand as React.ComponentType;
  }
  throw new Error(`Cannot resolve panel component "${name}"`);
}

/** Rail-order numbers for the contract headers. */
export const RAIL_NO: Record<AllRail, string> = {
  home: '00',
  workspace: '01',
  sessions: '02',
  git: '03',
  mcp: '04',
  usage: '05',
  dna: '06',
  flows: '07',
  skills: '08',
  artifacts: '09',
  library: '10',
  wiki: '11',
  prompts: '13',
  search: '14',
  subagents: '15',
  signature: '16', // v11.38 — SADEEM-only instruments
  proof: '17', // v11.43 — PROOF CENTER (real session evidence ledger)
  // implicit surface (opened by clicking a file) — never shown in the rail
  editor: '—',
};

export const RAIL_TITLE: Record<AllRail, { key: string; fb: string }> = {
  home: { key: 'rail.home', fb: 'Home' },
  workspace: { key: 'rail.workspace', fb: 'Workspace' },
  sessions: { key: 'rail.sessions', fb: 'Sessions' },
  git: { key: 'rail.git', fb: 'Source control' },
  mcp: { key: 'rail.mcp', fb: 'MCP tools' },
  usage: { key: 'rail.usage', fb: 'Usage' },
  dna: { key: 'rail.dna', fb: 'DNA' },
  flows: { key: 'rail.flows', fb: 'Flows' },
  skills: { key: 'rail.skills', fb: 'Skills' },
  artifacts: { key: 'rail.artifacts', fb: 'Artifacts' },
  library: { key: 'rail.library', fb: 'Library' },
  wiki: { key: 'rail.wiki', fb: 'Repo Wiki' },
  prompts: { key: 'rail.prompts', fb: 'Prompts' },
  search: { key: 'search.title', fb: 'Search files' },
  subagents: { key: 'rail.subagents', fb: 'Subagents' },
  signature: { key: 'rail.signature', fb: 'Run Intelligence' }, // v11.40 — clearer than "Signature"
  // v11.43 — reuse the existing bilingual proof.title key; no i18n edit.
  proof: { key: 'proof.title', fb: 'Proof' },
  editor: { key: 'rail.workspace', fb: 'Editor' },
};

/**
 * STAGE RAILS — these panels are PAGES: they own the full center column
 * (Codex/OpenCode-style). 'workspace' and 'search' are included: the file
 * tree and global search must read as full sections, not as a narrow docked
 * fragment over the editor. Only 'home' (its own surface)
 * is outside this set.
 */
export const STAGE_RAILS: ReadonlySet<AllRail> = new Set<AllRail>([
  'workspace',
  'sessions',
  'git',
  'mcp',
  'usage',
  'dna',
  'flows',
  'skills',
  'artifacts',
  'library',
  // v1142 — the Wiki rail is removed from the visible set: it is the SAME
  // LibraryPanel with initialTab=wiki (see the compat alias in PANELS).
  // The Repo Wiki tab inside LibraryPanel is the single visible surface.
  'prompts',
  'search',
  'subagents',
  'signature', // v11.38 (G7) — original SADEEM signature features page
  'proof', // v11.43 — PROOF CENTER renders as a full stage page
]);

export const PANELS: Record<AllRail, React.ComponentType> = {
  home: () => null,
  workspace: panelOf(WorkspaceMod, 'WorkspacePanel'),
  sessions: panelOf(SessionsMod, 'SessionsPanel'),
  git: panelOf(GitMod, 'GitPanel'),
  mcp: panelOf(MCPMod, 'MCPPanel'),
  usage: panelOf(UsageMod, 'UsagePanel'),
  dna: panelOf(DnaMod, 'DnaPanel'),
  flows: panelOf(FlowsMod, 'FlowsPanel'),
  skills: panelOf(SkillsMod, 'SkillsPanel'),
  artifacts: panelOf(ArtifactsMod, 'ArtifactsPanel'),
  library: panelOf(LibraryMod, 'LibraryPanel'),
  prompts: panelOf(PromptsMod, 'PromptsPanel'),
  // v1142 — COMPAT ALIAS ONLY, not a rail: stale/deep-linked rail='wiki'
  // still resolves to the Library's Repo Wiki tab (RightDock/StagePage index
  // RAIL_TITLE[rail] without a fallback, so this entry must stay). The visible
  // rail entry was removed from Rail.tsx MORE + STAGE_RAILS above; the visible
  // way in is the "Repo Wiki" tab inside LibraryPanel.
  wiki: () => {
    const Comp = panelOf(LibraryMod, 'LibraryPanel') as React.ComponentType<{ initialTab?: 'files' | 'wiki' }>;
    return <Comp initialTab="wiki" />;
  },
  search: SearchPanel,
  subagents: panelOf(SubagentsMod, 'SubagentsPanel'),
  signature: SignaturePanel, // v11.38 — registered, reachable via setRail('signature')
  proof: ProofPanel, // v11.43 — PROOF CENTER: real, filterable session evidence ledger
  // 'editor' is rendered by App's work area, never through RightDock.
  editor: () => null,
};
