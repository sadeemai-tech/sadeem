// AgentTeamCard — the elegant live "agent team" card shown in the chat stream
// wherever the `task` tool delegates to specialists. Agents sit on an EXACT
// trig orbit (equal angular spacing, verified below), a hairline ring turns
// slowly behind them, and every node carries a real status dot: running
// breathes, done draws an inked check, error draws a cross. A restrained
// stagger brings the nodes in one after another.
//
// Presentation-only: every fact comes from the subagent ledger slice + the
// tool result already in the transcript. No new IPC, no engine changes.
import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Users, X } from 'lucide-react';
import type { ChatMessage, SubagentStatus } from '../../shared/types';
import { useStore } from '../store';
import { useT, useDigits } from '../i18n';
import { parseToolArgs } from './MessageView';
import { agentVisual, dotOf, pctOf, type AgentVisual, type TeamDot } from '../lib/subagentDisplay';
import './subagents.css';

interface Member {
  key: string;
  role: string;
  visual: AgentVisual;
  status: SubagentStatus;
  pct: number;
  /** Ledger id — present once the engine has registered the subagent. */
  recordId?: string;
  /** Compact transcript output, kept discoverable without leaving the stream. */
  output?: string;
  ok?: boolean;
}

const DOT_LABEL: Record<TeamDot, string> = {
  breathing: 'sa.running',
  done: 'sa.done',
  warn: 'sa.failed',
};

/** Resolve the aggregate team state from its members. */
function teamState(members: Member[]): SubagentStatus {
  if (members.some((m) => m.status === 'running')) return 'running';
  if (members.some((m) => m.status === 'error' || m.status === 'aborted')) return 'error';
  return 'done';
}

/**
 * v11.31 — resolve the ledger row behind a `task` chip. The first two joins are
 * the exact ones (the ledger stores the verbatim delegated prompt). The extra
 * fallbacks matter: a record can be registered a beat after the transcript row
 * renders, or the model can paraphrase `description`, leaving the chip button
 * permanently `disabled` — a DEAD button that never opens the detail view.
 * `rows` is already newest-first from the store; every fallback is unique-safe.
 */
type LedgerLike = {
  id: string;
  prompt?: string;
  role: string;
  description?: string;
  status?: SubagentStatus;
  done: number;
  total: number;
};

function matchLedgerRecord(
  rows: LedgerLike[],
  role: string,
  description: string,
  prompt: string,
  used: Set<string>,
): LedgerLike | null {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => !used.has(r.id));
  const pick = (rec?: LedgerLike | null): LedgerLike | null => {
    if (!rec) return null;
    used.add(rec.id);
    return rec;
  };
  if (prompt) {
    const byPrompt = list.find((r) => r.prompt && r.prompt === prompt);
    if (byPrompt) return pick(byPrompt);
  }
  if (description) {
    const byDescription = list.find((r) => r.description === description && (!role || r.role === role));
    if (byDescription) return pick(byDescription);
  }
  const sameRole = list.filter((r) => r.role === role);
  if (sameRole.length === 1) return pick(sameRole[0]);
  // Last resort: a single running record anywhere is unambiguous enough to
  // make the chip clickable rather than dead while the ledger catches up.
  const running = list.filter((r) => r.status === 'running');
  return pick(running.length === 1 ? running[0] : null);
}

/* ── ORBITAL GEOMETRY ──────────────────────────────────────────────────────
   Exact placement, no eyeballed offsets. Every quantity is derived so nodes
   can never be off-centre or clipped:

   • Node box side D = 24 (radius 12); outer breathing room PAD = 3.
   • Neighbour centre distance (the chord of a circle) is 2R·sin(π/n).
     Requiring chord ≥ D + 2 guarantees a ≥2px hairline gap between adjacent
     nodes, so for n ≥ 3 we solve R ≥ (D + 2) / (2·sin(π/n)).
   • R never shrinks below BASE_R = 30, so small teams still read as a circle.
   • Stage side S = 2(R + D/2 + PAD) = 2(R + 15): centre + node + outer pad,
     so the furthest node edge (centre + R + D/2) stays PAD inside the stage.
   • Inner reach R − D/2 ≥ 30 − 12 = 18 > hub radius 9, so no node overlaps
     the centre hub.
   • θ_i = −π/2 + i·2π/n puts node 0 at 12 o'clock and spaces every other
     node by exactly 360°/n (equal angular spacing).
   • Node centre P_i = (C + R·cos θ_i, C + R·sin θ_i); the box top-left is
     P_i − (D/2, D/2), which is precisely what centres the box on P_i.
   ────────────────────────────────────────────────────────────────────────── */
const NODE_D = 24;
const NODE_PAD = 3;
const BASE_R = 30;

interface OrbitGeometry {
  size: number;
  radius: number;
  centre: number;
  node: number;
}

function orbitGeometry(count: number): OrbitGeometry {
  const radius =
    count >= 3
      ? Math.max(BASE_R, Math.ceil((NODE_D + 2) / (2 * Math.sin(Math.PI / count))))
      : BASE_R;
  const size = 2 * (radius + NODE_D / 2 + NODE_PAD);
  return { size, radius, centre: size / 2, node: NODE_D };
}

function nodePosition(index: number, count: number, g: OrbitGeometry) {
  const theta = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    left: g.centre + g.radius * Math.cos(theta) - g.node / 2,
    top: g.centre + g.radius * Math.sin(theta) - g.node / 2,
  };
}

export function AgentTeamCard({ tasks, resultById }: { tasks: ChatMessage[]; resultById: Map<string, ChatMessage> }) {
  const t = useT();
  const n = useDigits();
  const subagents = useStore((s) => s.subagents);
  const openSubagentDetail = useStore((s) => s.openSubagentDetail);
  const [showOutputs, setShowOutputs] = useState(false);

  const members = useMemo<Member[]>(
    () => {
      // One ledger row can back only one chip: without this latch every chip
      // would resolve to the same (e.g. running) row and the rest look stale.
      const used = new Set<string>();
      return tasks.map((msg) => {
        const args = parseToolArgs(msg.content);
        const role = typeof args.agent === 'string' && args.agent ? args.agent : 'general';
        const description = typeof args.description === 'string' ? args.description : '';
        const prompt = typeof args.prompt === 'string' ? args.prompt : '';
        // The ledger stores the exact delegated prompt, so prompt equality is
        // the strongest join; the helper's role/description/running fallbacks
        // keep the chip's detail button live while a row is being registered.
        const rec = matchLedgerRecord(subagents, role, description, prompt, used);
        const result = msg.toolCallId ? resultById.get(msg.toolCallId) : undefined;
        const status: SubagentStatus =
          rec?.status ?? (result ? (result.resultOk === false ? 'error' : 'done') : 'running');
        const pct = rec ? pctOf(rec.done, rec.total, rec.status) : result ? 100 : 0;
        return {
          key: msg.id,
          role,
          visual: agentVisual(role),
          status,
          pct,
          recordId: rec?.id,
          output: result ? (result.content || '').trim().slice(0, 600) : undefined,
          ok: result ? result.resultOk !== false : undefined,
        };
      });
    },
    [tasks, resultById, subagents],
  );

  if (!members.length) return null;

  const state = teamState(members);
  const overall = Math.round(members.reduce((sum, m) => sum + m.pct, 0) / members.length);
  const dotLabel = (d: TeamDot) => t(DOT_LABEL[d], d === 'breathing' ? 'RUNNING' : d === 'done' ? 'DONE' : 'FAILED');
  const geom = orbitGeometry(members.length);

  // v11.35 (A5) — the CARD itself is an entry point, not just the tiny orbit
  // dots. `focus` is the agent whose live session the header control enters:
  // prefer the running specialist, fall back to the first registered row.
  // When the ledger has not caught up yet there is genuinely nothing to drill
  // into, so the control is absent rather than a dead button.
  const focus =
    members.find((m) => m.recordId && m.status === 'running') ??
    members.find((m) => m.recordId);
  const openLabel = t('sa.openDetail', 'Open');

  return (
    <div className={`agt-card anim-in msg-in is-${state}`} data-agents={members.length} data-testid="agt-card">
      <div className="agt-head">
        <span className="agt-mark" aria-hidden>
          <Users size={12} strokeWidth={1.7} />
        </span>
        <span className="agt-word" dir="ltr">
          {t('sa.team', 'AGENT TEAM')}
        </span>
        <span className="agt-count">
          {n(members.length)} {t(members.length === 1 ? 'sa.specialist' : 'sa.specialists', members.length === 1 ? 'specialist' : 'specialists')}
        </span>
        <span className={`agt-state is-${state}`}>{t(`sa.${state === 'error' ? 'failed' : state}`, state.toUpperCase())}</span>
        {focus?.recordId && (
          <button
            type="button"
            className="agt-drill press"
            data-testid="agt-open-session"
            data-record-id={focus.recordId}
            onClick={() => openSubagentDetail?.(focus.recordId!)}
            title={`${openLabel} · ${focus.visual.name}`}
            aria-label={`${openLabel} · ${focus.visual.name}`}
          >
            <span>{openLabel}</span>
            <ArrowUpRight size={11} strokeWidth={1.9} className="agt-drill-arrow" aria-hidden />
          </button>
        )}
      </div>

      <div className="agt-body">
        {/* One positioned stage holds the decorative hairline orbit and the
            real node buttons. The ring/hub are aria-hidden; each node below
            is still a labelled button and the legend names everyone. */}
        <div
          className="agt-stage"
          style={
            {
              width: `${geom.size}px`,
              height: `${geom.size}px`,
              '--s': `${geom.size}px`,
              '--r': `${geom.radius}px`,
              '--d': `${geom.node}px`,
            } as React.CSSProperties
          }
        >
          <span className="agt-orbit-track" aria-hidden />
          <span className="agt-orbit-sweep" aria-hidden />
          <span className="agt-orbit-hub tnum" aria-hidden>{n(members.length)}</span>
          {/* DOM order matches angular order; `--i` drives the stagger. */}
          {members.map((m, i) => {
            const dot = dotOf(m.status);
            const Icon = m.visual.icon;
            const label = `${m.visual.name} · ${dotLabel(dot)}`;
            return (
              <button
                key={m.key}
                type="button"
                className={`agt-node is-${dot}`}
                data-status={m.status}
                data-record-id={m.recordId}
                style={
                  {
                    ...nodePosition(i, members.length, geom),
                    '--chip-tone': m.visual.tone,
                    '--i': i,
                  } as React.CSSProperties
                }
                onClick={() => m.recordId && openSubagentDetail?.(m.recordId)}
                disabled={!m.recordId}
                title={m.recordId ? label : `${label} · …`}
                aria-label={label}
              >
                <Icon size={13} strokeWidth={1.8} aria-hidden />
                <span className={`agt-node-dot is-${dot}`} aria-hidden>
                  {dot === 'done' ? (
                    <Check size={7} strokeWidth={2.6} />
                  ) : dot === 'warn' ? (
                    <X size={7} strokeWidth={2.6} />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="agt-legend" dir="auto">
          {members.map((m) => {
            const body = (
              <>
                <b className="agt-initials" dir="ltr">{m.visual.initials}</b>
                <span className="agt-legend-name">{m.visual.name}</span>
              </>
            );
            // A named, keyboard-reachable row per specialist: the founder can
            // click the AGENT (not only the 24px orbit dot) to enter its session.
            // Rows without a ledger id stay plain text — never a dead button.
            return m.recordId ? (
              <button
                key={m.key}
                type="button"
                className="agt-legend-item is-link press"
                data-testid="agt-agent-link"
                data-record-id={m.recordId}
                onClick={() => openSubagentDetail?.(m.recordId!)}
                title={`${openLabel} · ${m.visual.name}`}
                aria-label={`${openLabel} · ${m.visual.name}`}
              >
                {body}
              </button>
            ) : (
              <span key={m.key} className="agt-legend-item" title={m.visual.name}>
                {body}
              </span>
            );
          })}
        </div>
      </div>

      <div className="agt-progress">
        <div className="agt-track" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100}>
          <div className="agt-fill" style={{ width: `${overall}%` }} />
        </div>
        <span className="agt-pct tnum" dir="ltr">{n(overall)}%</span>
      </div>

      {/* Compact output drawer — the transcript no longer loses what each
          specialist returned (it used to ride inline on every task row). */}
      {members.some((m) => m.output) && (
        <div className="agt-outs">
          <button
            className="agt-outs-toggle"
            onClick={() => setShowOutputs((v) => !v)}
            aria-expanded={showOutputs}
          >
            {n(members.filter((m) => m.output).length)} {t('sa.outputs', 'outputs')}
            <ChevronDown size={11} className={showOutputs ? 'is-open' : ''} />
          </button>
          {showOutputs && (
            <div className="agt-outs-body">
              {members.filter((m) => m.output).map((m) => (
                <div key={m.key} className={`agt-out ${m.ok === false ? 'is-bad' : ''}`}>
                  <b className="agt-initials" dir="ltr">{m.visual.initials}</b>
                  <pre dir="auto">{m.output}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AgentTeamCard;
