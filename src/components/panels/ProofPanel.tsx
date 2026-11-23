// ============================================================
// SADEEM v11.43 — PROOF CENTER (rail page)
//
// A REAL, read-only ledger of the CURRENT session's proof events.
// Nothing here is painted green by hand. Every row is derived from
// data that actually exists in this renderer:
//
//   1. session.messages — tool_call / tool_result pairs that persist
//      across turns and reloads. A write, a command, a screenshot.
//      Status comes ONLY from the real `resultOk` bit; a call with no
//      result stays 'unverified'. Evidence is the real path, command,
//      output or image fingerprint.
//   2. store.proof.gates — gate verdicts folded by ingestProofEvent
//      from verify_run · red_green · fake_tests · mutation_gate ·
//      critic_verdict · run_receipt. These are PER-RUN (reset at every
//      user turn), so they are labelled "current run" in the UI — never
//      passed off as a permanent session record.
//
// The ribbon (ProofRibbon.tsx) deliberately stays a single copy button:
// v1131-full-smoke V3 forbids a popover there. This rail page is the
// Proof Center the founder asked to make genuinely useful.
// ============================================================
import React, { useMemo, useState } from 'react';
import type { ChatMessage } from '../../../shared/types';
import type { ProofGate, ProofMutation } from '../../store';
import { useStore } from '../../store';
import { useT, useDigits } from '../../i18n';
import '../proof.css';

export type ProofStatus = 'verified' | 'failed' | 'unverified';
export type ProofKind = 'test' | 'command' | 'file' | 'screenshot' | 'gate';

export interface ProofLedgerItem {
  id: string;
  /** Epoch ms — when the evidence actually landed (result / gate time). */
  at: number;
  kind: ProofKind;
  /** What was claimed (localized at derivation time). */
  claim: string;
  /** What evidence exists: path, exit code, output, fingerprint, detail. */
  evidence: string;
  status: ProofStatus;
  /** 'session' = persistent transcript, 'run' = current run's gate slice. */
  source: 'session' | 'run';
}

const EDIT_TOOLS = new Set(['edit_file', 'multi_edit', 'write_file', 'create_file', 'notebook_edit']);
const CMD_TOOLS = new Set(['run_command', 'run_background', 'bash', 'shell']);
const SHOT_TOOLS = new Set(['preview_screenshot', 'screenshot', 'read_image']);

const L = {
  en: {
    wrote: 'wrote file',
    ran: 'ran command',
    shot: 'captured screenshot',
    verified: 'verified',
    failed: 'failed',
    unverified: 'unverified',
    session: 'session transcript',
    run: 'current run',
    noResult: 'no result recorded — claim is unverified',
    okResult: 'result: ok',
    badResult: 'result: failed',
    exit: 'exit',
    fp: 'fp',
    gate: {
      redGreen: 'red → green check',
      mutation: 'mutation gate',
      fakes: 'fake-test scan',
      critic: 'critic verdict',
      verify: 'verify command',
      receipt: 'run receipt',
    } as Record<string, string>,
  },
  ar: {
    wrote: 'كتب ملفاً',
    ran: 'نفّذ أمراً',
    shot: 'التقط لقطة شاشة',
    verified: 'مُثبَت',
    failed: 'فاشل',
    unverified: 'غير مُثبَت',
    session: 'سجل الجلسة',
    run: 'التشغيل الحالي',
    noResult: 'لا نتيجة مسجّلة — الادعاء غير مُثبَت',
    okResult: 'النتيجة: نجاح',
    badResult: 'النتيجة: فشل',
    exit: 'خروج',
    fp: 'بصمة',
    gate: {
      redGreen: 'فحص أحمر → أخضر',
      mutation: 'بوابة الطفرات',
      fakes: 'فحص الاختبارات المزيفة',
      critic: 'حكم الناقد',
      verify: 'أمر التحقق',
      receipt: 'إيصال التشغيل',
    } as Record<string, string>,
  },
};

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickString(args: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function snippet(s: string, n = 180): string {
  const one = String(s ?? '').replace(/\r/g, '').replace(/\n/g, ' ⏎ ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

function exitCodeOf(out: string): string {
  const m = /(?:exit(?:\s+code)?|code)\s*[:=]?\s*(-?\d+)/i.exec(out);
  return m ? m[1] : '';
}

/** Deterministic LOCAL fingerprint of screenshot bytes (djb2, 32-bit).
 *  Honest label: `fp:` — this is NOT a cryptographic hash / SHA proof. */
function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

function resultStatus(ok: boolean | undefined): ProofStatus {
  return ok === false ? 'failed' : ok === true ? 'verified' : 'unverified';
}

function toneStatus(tone: ProofGate['tone']): ProofStatus {
  return tone === 'ok' ? 'verified' : tone === 'bad' ? 'failed' : 'unverified';
}

/**
 * Pure derivation. Exported so the real-event test can assert statuses
 * without a DOM. Takes the actual transcript + actual gate slice; it
 * never invents a row, a path, a hash or a green state.
 */
export function deriveProofLedger(
  messages: ChatMessage[],
  gates: ProofGate[],
  lang: 'ar' | 'en' = 'en',
  mutation: ProofMutation | null = null,
): ProofLedgerItem[] {
  const w = L[lang];
  const items: ProofLedgerItem[] = [];
  const calls = new Map<string, ChatMessage>();

  for (const m of messages) {
    if (m.kind === 'tool_call' && m.toolName) {
      calls.set(m.toolCallId ?? m.id, m);
      continue;
    }
    if (m.kind !== 'tool_result') continue;
    const call = calls.get(m.toolCallId ?? '');
    if (!call?.toolName) continue;
    const name = call.toolName;
    const args = parseArgs(call.content ?? '');
    const at = m.timestamp || call.timestamp || 0;
    const status = resultStatus(m.resultOk);
    const resTag = status === 'verified' ? w.okResult : status === 'failed' ? w.badResult : w.noResult;
    const out = String(m.content ?? '');

    if (EDIT_TOOLS.has(name)) {
      const path = pickString(args, ['path', 'file_path', 'filePath', 'file', 'target']);
      items.push({
        id: `file-${m.toolCallId ?? m.id}`,
        at,
        kind: 'file',
        claim: `${w.wrote} ${path || name}`.trim(),
        evidence: [path ? `path: ${path}` : '', `tool: ${name}`, resTag].filter(Boolean).join(' · '),
        status,
        source: 'session',
      });
    } else if (CMD_TOOLS.has(name)) {
      const cmd = pickString(args, ['command', 'cmd', 'script']);
      const code = exitCodeOf(out);
      items.push({
        id: `cmd-${m.toolCallId ?? m.id}`,
        at,
        kind: 'command',
        claim: `${w.ran} ${cmd || name}`.trim(),
        evidence: [cmd ? `cmd: ${snippet(cmd, 140)}` : '', code ? `${w.exit} ${code}` : '', snippet(out, 200), resTag]
          .filter(Boolean)
          .join(' · '),
        status,
        source: 'session',
      });
    } else if (SHOT_TOOLS.has(name)) {
      const img = Array.isArray(m.images) && m.images.length ? String(m.images[0]) : '';
      const target = pickString(args, ['path', 'url', 'file', 'target']);
      items.push({
        id: `shot-${m.toolCallId ?? m.id}`,
        at,
        kind: 'screenshot',
        claim: `${w.shot}${target ? ' ' + snippet(target, 120) : ''}`.trim(),
        evidence: [
          `tool: ${name}`,
          img ? `${w.fp}: ${fingerprint(img)}` : 'no image bytes recorded',
          resTag,
        ]
          .filter(Boolean)
          .join(' · '),
        status,
        source: 'session',
      });
    }
  }

  // Tool calls with NO result yet are still honest 'unverified' rows —
  // a promise is not proof, but hiding it would be a lie of omission.
  for (const [key, call] of calls) {
    if (!call.toolName) continue;
    const name = call.toolName;
    if (!EDIT_TOOLS.has(name) && !CMD_TOOLS.has(name) && !SHOT_TOOLS.has(name)) continue;
    if (items.some((i) => i.id.endsWith(`-${key}`))) continue;
    const args = parseArgs(call.content ?? '');
    const path = pickString(args, ['path', 'file_path', 'filePath', 'file', 'target', 'command', 'cmd', 'script', 'url']);
    const kind: ProofKind = EDIT_TOOLS.has(name) ? 'file' : CMD_TOOLS.has(name) ? 'command' : 'screenshot';
    const claimBase =
      kind === 'file' ? w.wrote : kind === 'command' ? w.ran : w.shot;
    items.push({
      id: `pending-${key}`,
      at: call.timestamp || 0,
      kind,
      claim: `${claimBase} ${path || name}`.trim(),
      evidence: `${w.noResult} · tool: ${name}`,
      status: 'unverified',
      source: 'session',
    });
  }

  // Gate verdicts from the CURRENT run only (honest source label).
  for (const g of gates) {
    let status = toneStatus(g.tone);
    // A mutation gate that the engine marked inconclusive must NEVER read
    // green, whatever rollup tone the pre-v8.1 gate carried.
    if (g.id === 'mutation' && mutation?.inconclusive) status = 'unverified';
    items.push({
      id: `gate-${g.id}-${g.at}`,
      at: g.at || 0,
      kind: 'gate',
      claim: w.gate[g.id] ?? g.id,
      evidence: String(g.detail || '').trim() || 'no detail recorded',
      status,
      source: 'run',
    });
  }

  return items.sort((a, b) => a.at - b.at);
}

const STATUS_ORDER: ProofStatus[] = ['verified', 'failed', 'unverified'];
const KIND_ORDER: ProofKind[] = ['test', 'command', 'file', 'screenshot', 'gate'];

export function ProofPanel() {
  const t = useT();
  const digits = useDigits();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const ar = lang === 'ar';
  const messages = useStore((s) => s.session?.messages);
  const gates = useStore((s) => s.proof.gates);
  const mutation = useStore((s) => s.proof.mutation);
  const engineStatus = useStore((s) => s.proof.status);
  const updatedAt = useStore((s) => s.proof.updatedAt);
  const notify = useStore((s) => s.notify);

  const [statusFilter, setStatusFilter] = useState<'all' | ProofStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | ProofKind>('all');
  const [query, setQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);

  const w = ar ? L.ar : L.en;
  const items = useMemo(
    () => deriveProofLedger(messages ?? [], gates, ar ? 'ar' : 'en', mutation),
    [messages, gates, ar, mutation],
  );
  const counts = useMemo(() => {
    const c: Record<ProofStatus, number> = { verified: 0, failed: 0, unverified: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter(
      (i) =>
        (statusFilter === 'all' || i.status === statusFilter) &&
        (kindFilter === 'all' || i.kind === kindFilter) &&
        (!q || `${i.claim} ${i.evidence}`.toLowerCase().includes(q)),
    );
    return newestFirst ? [...out].reverse() : out;
  }, [items, statusFilter, kindFilter, query, newestFirst]);

  const copyLedger = async () => {
    const lines = shown.map((i) => {
      const time = i.at ? new Date(i.at).toISOString() : '-';
      return `[${i.status}] ${time} (${i.source}/${i.kind}) ${i.claim} — ${i.evidence}`;
    });
    const header = `SADEEM proof ledger — ${items.length} event(s) · verified ${counts.verified} / failed ${counts.failed} / unverified ${counts.unverified}`;
    const text = [header, ...lines].join('\n');
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip || typeof clip.writeText !== 'function') {
      notify(ar ? 'الحافظة غير متاحة' : 'Clipboard unavailable');
      return;
    }
    try {
      await clip.writeText(text);
      notify(ar ? 'تم نسخ سجل الإثبات' : 'Proof ledger copied');
    } catch {
      notify(ar ? 'تعذّر نسخ سجل الإثبات' : 'Could not copy proof ledger');
    }
  };

  const verdictText =
    engineStatus === 'proven'
      ? ar ? 'مُثبت (حكم التشغيل)' : 'proven (engine verdict)'
      : engineStatus === 'failed'
        ? ar ? 'فاشل (حكم التشغيل)' : 'failed (engine verdict)'
        : ar ? 'غير مُثبت' : 'unproven';

  return (
    <div className="pc-root" data-testid="proof-center">
      <div className="pc-head">
        <div className="pc-title">{t('proof.center.title', 'PROOF CENTER')}</div>
        <div className="pc-def">
          {ar
            ? 'سجل للقراءة فقط من أدلة هذه الجلسة الحقيقية: نتائج الأدوات + أحكام بوابات التشغيل الحالي. لا شيء هنا مُختلق.'
            : 'Read-only ledger built from this session\'s real tool results and the current run\'s gate verdicts. Nothing is fabricated.'}
        </div>
      </div>

      <div className="pc-summary">
        <span className="pc-sum"><b className="pc-v">{digits(counts.verified)}</b> {w.verified}</span>
        <span className="pc-sum"><b className="pc-f">{digits(counts.failed)}</b> {w.failed}</span>
        <span className="pc-sum"><b className="pc-u">{digits(counts.unverified)}</b> {w.unverified}</span>
        <span className="pc-verdict" data-testid="proof-engine-verdict">{verdictText}</span>
      </div>

      <div className="pc-filters">
        <div className="pc-group" role="group" aria-label={ar ? 'تصفية حسب الحالة' : 'Filter by status'}>
          <button type="button" className={`pc-chip${statusFilter === 'all' ? ' is-on' : ''}`} onClick={() => setStatusFilter('all')}>
            {ar ? 'الكل' : 'All'}
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`pc-chip${statusFilter === s ? ' is-on' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {w[s]} <span className="pc-n">{digits(counts[s])}</span>
            </button>
          ))}
        </div>
        <div className="pc-group" role="group" aria-label={ar ? 'تصفية حسب النوع' : 'Filter by kind'}>
          <button type="button" className={`pc-chip${kindFilter === 'all' ? ' is-on' : ''}`} onClick={() => setKindFilter('all')}>
            {ar ? 'كل الأدلة' : 'All kinds'}
          </button>
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              className={`pc-chip${kindFilter === k ? ' is-on' : ''}`}
              onClick={() => setKindFilter(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="pc-tools">
          <input
            className="pc-search"
            type="search"
            value={query}
            placeholder={ar ? 'ابحث في الأدلة…' : 'Filter evidence…'}
            aria-label={ar ? 'ابحث في الأدلة' : 'Filter evidence'}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="pc-tool" onClick={() => setNewestFirst((v) => !v)}>
            {newestFirst ? (ar ? 'الأحدث أولاً' : 'Newest first') : (ar ? 'الأقدم أولاً' : 'Oldest first')}
          </button>
          <button type="button" className="pc-tool" data-testid="proof-ledger-copy" onClick={() => void copyLedger()}>
            {ar ? 'نسخ السجل' : 'Copy ledger'}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="pc-empty" data-testid="proof-empty">
          {ar
            ? 'لم يُسجَّل إثبات بعد — شغّل اختبارات أو معاينة لتوليد الأدلة.'
            : 'No proof recorded yet — run tests or preview to generate evidence.'}
        </div>
      ) : shown.length === 0 ? (
        <div className="pc-empty" data-testid="proof-empty-filter">
          {ar ? 'لا عناصر مطابقة لهذا الفلتر.' : 'No evidence matches these filters.'}
        </div>
      ) : (
        <div className="pc-list" data-testid="proof-ledger">
          {shown.map((i) => (
            <div className={`pc-row is-${i.status}`} key={i.id} data-testid="proof-row" data-status={i.status}>
              <span className="pc-dot" aria-hidden="true" />
              <time className="pc-time" dateTime={i.at ? new Date(i.at).toISOString() : undefined}>
                {i.at ? new Date(i.at).toLocaleTimeString(ar ? 'ar' : 'en') : '—'}
              </time>
              <div className="pc-body">
                <div className="pc-claim">
                  {i.claim}
                  <span className="pc-badge">{i.kind} · {i.source === 'run' ? w.run : w.session}</span>
                </div>
                <code className="pc-evidence">{i.evidence}</code>
                <span className="pc-status">{w[i.status]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pc-foot">
        {t('proof.center.foot', 'Only events the run actually produced are shown.')}
        {updatedAt > 0 ? (
          <span className="pc-updated">
            {' · '}{ar ? 'آخر حكم:' : 'last verdict:'} {new Date(updatedAt).toLocaleTimeString(ar ? 'ar' : 'en')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default ProofPanel;
