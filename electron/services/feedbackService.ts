// ============================================================
// Surnia v6 — Feedback & Suggestions service ("صندوق الاقتراحات")
// ------------------------------------------------------------
// Surnia is NEW: the users who try it first see what we cannot.
// This service collects their reports (bugs, improvement ideas, feature
// requests, contact requests) as LOCAL json files under
// <userData>/feedback/ — nothing leaves the machine until the user
// chooses to send a bundle themselves (export/copy). We review every
// submission at release time and answer through the official channels.
// Privacy: diagnostics are opt-in and contain ONLY app version, platform,
// language and counters — never keys, never file contents, never paths.
//
// v11.31 audit fixes:
//   · message AND contact are redacted with the logger's E4 patterns
//     BEFORE they touch disk (users paste API keys into feedback boxes);
//   · a null/undefined input can no longer throw outside the try block;
//   · submitFeedback() makes the honest contract explicit: the report is
//     SAVED and EXPORTABLE, never transmitted (delivered: false);
//   · markdown rendering no longer throws on a corrupt `at` value, and
//     says plainly when secrets were scrubbed.
// ============================================================
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { redactText } from './logService';

export interface FeedbackEntry {
  id: string;
  at: number;
  kind: 'bug' | 'improvement' | 'feature' | 'other';
  message: string;
  contact?: string;
  diagnostics?: {
    appVersion: string;
    platform: string;
    language: string;
    workspacesOpened: number;
    sessions: number;
  };
  status: 'new' | 'acked';
  /** v11.31 — number of secret-like substrings scrubbed before storage. */
  redacted?: number;
  /** v11.31 — true when E4 redaction was applied to this entry. */
  sanitized?: boolean;
}

/** Honest result of a "send" action: saved locally + export, never delivered. */
export interface FeedbackSubmission {
  ok: boolean;
  entry?: FeedbackEntry;
  markdown?: string;
  /** Always false — there is no network submission path. */
  delivered: false;
  note: string;
  error?: string;
}

function feedbackDir(): string {
  let base = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
    base = app?.getPath?.('userData') ?? '';
  } catch {
    /* non-electron — fall through */
  }
  if (!base) base = process.env.SURNIA_HOME || path.join(process.env.HOME || process.cwd(), '.surnia');
  return path.join(base, 'feedback');
}

const MAX_STORED = 200;

/** Save one feedback entry. Returns the stored entry (with its id). */
export function saveFeedback(
  input: Omit<FeedbackEntry, 'id' | 'at' | 'status'>,
): { ok: boolean; entry?: FeedbackEntry; error?: string } {
  try {
    const src = input ?? ({} as Omit<FeedbackEntry, 'id' | 'at' | 'status'>);
    const rawMessage = String(src.message ?? '').trim();
    if (rawMessage.length < 3) return { ok: false, error: 'Message is required.' };

    // E4: scrub secrets BEFORE persistence — a pasted key must never land
    // in feedback/*.json or in the markdown a user copies to a public channel.
    const redMessage = redactText(rawMessage.slice(0, 8000));
    const rawContact = String(src.contact ?? '').trim().slice(0, 200);
    const redContact = rawContact ? redactText(rawContact) : null;

    const kinds: FeedbackEntry['kind'][] = ['bug', 'improvement', 'feature', 'other'];
    const kind = kinds.includes(src.kind) ? src.kind : 'other';
    const entry: FeedbackEntry = {
      id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      kind,
      message: redMessage.text,
      contact: redContact ? redContact.text : undefined,
      // v6 audit L-3 — diagnostics are WHITELISTED to the five known fields; a
      // crafted arbitrary object must never land on disk or echo into markdown.
      diagnostics: src.diagnostics
        ? {
            appVersion: String(src.diagnostics.appVersion ?? '').slice(0, 40),
            platform: String(src.diagnostics.platform ?? '').slice(0, 60),
            language: String(src.diagnostics.language ?? '').slice(0, 8),
            workspacesOpened: Number(src.diagnostics.workspacesOpened ?? 0) || 0,
            sessions: Number(src.diagnostics.sessions ?? 0) || 0,
          }
        : undefined,
      status: 'new',
      redacted: redMessage.hits + (redContact?.hits ?? 0),
      sanitized: true,
    };
    const dir = feedbackDir();
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    // cap: drop the oldest beyond MAX_STORED
    const files = fsSync
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    if (files.length > MAX_STORED) {
      for (const f of files.slice(0, files.length - MAX_STORED)) {
        try {
          fsSync.unlinkSync(path.join(dir, f));
        } catch {
          /* best-effort */
        }
      }
    }
    return { ok: true, entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * "Send suggestion" — an HONEST name for the actual behavior: the entry is
 * stored locally and a sanitized markdown bundle is prepared for the user to
 * copy/export. Nothing is transmitted (delivered is always false).
 */
export function submitFeedback(
  input: Omit<FeedbackEntry, 'id' | 'at' | 'status'>,
): FeedbackSubmission {
  const saved = saveFeedback(input);
  if (!saved.ok || !saved.entry) {
    return {
      ok: false,
      delivered: false,
      note: 'Nothing was saved and nothing was sent.',
      error: saved.error,
    };
  }
  return {
    ok: true,
    entry: saved.entry,
    markdown: feedbackToMarkdown(saved.entry),
    delivered: false,
    note:
      'Saved locally and ready to copy/export. Nothing is transmitted automatically — review the markdown and share it yourself.',
  };
}

/** List saved feedback (newest first). Never throws. */
export function listFeedback(): FeedbackEntry[] {
  const out: FeedbackEntry[] = [];
  try {
    const dir = feedbackDir();
    const files = fsSync
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    for (const f of files) {
      try {
        const parsed = JSON.parse(fsSync.readFileSync(path.join(dir, f), 'utf8')) as FeedbackEntry;
        if (parsed && typeof parsed.message === 'string') out.push(parsed);
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* no folder yet */
  }
  return out.slice(0, MAX_STORED);
}

/** The feedback folder path (for "open folder" in the UI). */
export function feedbackPath(): string {
  return feedbackDir();
}

/** Render one entry as a human-readable markdown block (for copy/export). */
export function feedbackToMarkdown(entry: FeedbackEntry): string {
  const e = entry ?? ({} as FeedbackEntry);
  const kindLabel: Record<FeedbackEntry['kind'], string> = {
    bug: 'Bug report',
    improvement: 'Improvement',
    feature: 'Feature idea',
    other: 'Other',
  };
  const when =
    typeof e.at === 'number' && Number.isFinite(e.at)
      ? new Date(e.at).toISOString()
      : 'unknown';
  const lines = [
    `# ${kindLabel[e.kind] ?? 'Other'}`,
    '',
    String(e.message ?? ''),
    '',
    `- id: ${String(e.id ?? 'unknown')}`,
    `- date: ${when}`,
  ];
  if (e.contact) lines.push(`- contact: ${String(e.contact)}`);
  if (e.diagnostics) {
    lines.push(
      `- app: Surnia ${String(e.diagnostics.appVersion ?? '')} (${String(e.diagnostics.platform ?? '')}, ${String(e.diagnostics.language ?? '')})`,
      `- workspaces opened: ${Number(e.diagnostics.workspacesOpened ?? 0)}`,
      `- sessions: ${Number(e.diagnostics.sessions ?? 0)}`,
    );
  }
  // Honest sanitization note: the user knows secrets were scrubbed.
  if (e.sanitized) lines.push(`- secrets redacted: ${Number(e.redacted ?? 0)}`);
  return lines.join('\n');
}
