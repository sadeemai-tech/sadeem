// ============================================================
// Surnia — custom slash commands (markdown prompt templates)
// User commands:      $KODEX_HOME/commands/*.md   (source 'user')
// Workspace commands: <workspace>/.surnia/commands/*.md (source
// 'workspace', shadows a user command with the same name).
// Every function is defensive: a missing dir or unreadable file
// must never throw — callers get [] / '' instead.
// ============================================================
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SlashCommandInfo, TaskMode } from '../../shared/types';

// v2.2 — fixed duplicated SURNIA_HOME condition: SURNIA_HOME || KODEX_HOME.
const KODEX_HOME = process.env.SURNIA_HOME || process.env.KODEX_HOME || path.join(os.homedir(), '.surnia');

/** Command files must be simple slugs: deploy.md, fix-lint.md, run2.md. */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*\.md$/;
const DESC_MAX = 100; // description cap ("~100 chars")
const HEAD_BYTES = 4096; // only read the head of a file to find its description

/**
 * Extract a command description from markdown: the first heading line
 * (leading '#'s stripped) or the first non-empty line, capped at ~100 chars.
 */
export function describe(raw: string): string | undefined {
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^#{1,6}\s+(.*)$/);
    const text = (heading ? heading[1] : t).trim();
    if (!text) continue;
    return text.length > DESC_MAX ? text.slice(0, DESC_MAX - 1) + '…' : text;
  }
  return undefined;
}

/** Bounded read of a file's head (first HEAD_BYTES bytes) for description extraction. */
function describeFromFile(file: string): string | undefined {
  try {
    const fh = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const n = fs.readSync(fh, buf, 0, buf.length, 0);
      return describe(buf.toString('utf8', 0, n));
    } finally {
      fs.closeSync(fh);
    }
  } catch {
    return undefined;
  }
}

/** Collect valid *.md commands from one directory; missing/unreadable dir → []. */
function scanDir(dir: string, source: SlashCommandInfo['source']): SlashCommandInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // dir does not exist (or unreadable) — silent
  }
  const out: SlashCommandInfo[] = [];
  for (const file of names) {
    if (!NAME_RE.test(file)) continue;
    const full = path.join(dir, file);
    try {
      if (!fs.statSync(full).isFile()) continue;
    } catch {
      continue; // stat raced / denied — skip
    }
    out.push({ name: file.replace(/\.md$/, ''), description: describeFromFile(full), source, path: full });
  }
  return out;
}

/**
 * List available custom slash commands: user-level first, then workspace
 * commands (a workspace command with the same name shadows the user one).
 * Sorted by name. Both directories may not exist → returns [] silently.
 */
export function listSlashCommands(workspace?: string): SlashCommandInfo[] {
  try {
    const all = [
      ...scanDir(path.join(KODEX_HOME, 'commands'), 'user'),
      ...(workspace ? scanDir(path.join(workspace, '.surnia', 'commands'), 'workspace') : []),
    ];
    // Later entries (workspace) overwrite earlier ones (user) per name.
    const byName = new Map<string, SlashCommandInfo>();
    for (const info of all) byName.set(info.name, info);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // never throw
  }
}

/** Read a command's full markdown body; unreadable → ''. */
export async function loadCommandBody(info: SlashCommandInfo): Promise<string> {
  try {
    return await fs.promises.readFile(info.path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Expand a command body: every literal $ARGUMENTS becomes the trimmed args
 * text; $1..$9 become positional whitespace-separated args (missing → '').
 */
export function expandCommand(body: string, argsText: string): string {
  const trimmed = String(argsText ?? '').trim();
  const positional = trimmed ? trimmed.split(/\s+/) : [];
  let out = String(body ?? '').split('$ARGUMENTS').join(trimmed);
  out = out.replace(/\$([1-9])/g, (_m, d: string) => positional[Number(d) - 1] ?? '');
  return out;
}

// ============================================================
// v11.10 (A4) — REAL builtin slash dispatch (main-process side).
// The renderer owns its UI-only commands; anything that still reaches
// the ENGINE as a '/'-message is executed HERE — never echoed to the
// model:
//   · /build /plan /debug /review → session TASK-MODE switches
//     (persist per session via the engine's sessionTaskModes map);
//   · custom markdown commands (commands/*.md) → expanded in place
//     ($ARGUMENTS / $1..$9) and run as a normal turn;
//   · anything else → friendly local notice (v11.9 E19 semantics
//     restored at the engine layer), run ends with no model call.
// Mode semantics come from the TASK_MODE_SPECS registry in prompts.ts
// (single source of truth — no if-chains here).
// ============================================================

/** The four task-mode slash commands → TaskMode (1:1 with the strip). */
export const TASK_MODE_SLASH_COMMANDS: Record<string, TaskMode> = {
  build: 'build',
  plan: 'plan',
  debug: 'debug',
  review: 'review',
};

export type SlashDispatchKind = 'pass' | 'task-mode' | 'custom' | 'unknown';

export interface SlashDispatch {
  kind: SlashDispatchKind;
  /** Matched command name (lowercased, no slash) — undefined for 'pass'. */
  command?: string;
  /** 'task-mode' only: the session task mode to switch to. */
  taskMode?: TaskMode;
  /** 'custom' only: the expanded command body (run as the user turn). */
  expanded?: string;
  /** 'task-mode' | 'unknown': user-visible notice text (EN + AR lines). */
  notice?: string;
}

const MODE_NOTICE_AR: Record<TaskMode, string> = {
  build: 'تم التبديل إلى وضع البناء — تنفيذ كامل مع التحقق بالاختبارات (يستمر لهذه الجلسة).',
  plan: 'تم التبديل إلى وضع الخطة — قراءة فقط: قدّم خطة تنفيذ (plan.md + propose_plan) دون تعديل الملفات (يستمر لهذه الجلسة).',
  debug: 'تم التبديل إلى وضع تصحيح الأخطاء — بروتوكول تشخيص + حلقة اختبارات تلقائية بعد الإصلاح (يستمر لهذه الجلسة).',
  review: 'تم التبديل إلى وضع المراجعة — قراءة فقط مع تقرير مراجعة منظم في نهاية التشغيل (يستمر لهذه الجلسة).',
};

const MODE_NOTICE_EN: Record<TaskMode, string> = {
  build: 'Switched to BUILD mode — full access, apply then verify with tests (persists for this session).',
  plan: 'Switched to PLAN mode — read-only: produce the step-by-step plan (plan.md + propose_plan); edits/commands are denied (persists for this session).',
  debug: 'Switched to DEBUG mode — debugging protocol + automatic post-fix test loop (persists for this session).',
  review: 'Switched to REVIEW mode — read-only review; a structured review report is produced at the end (persists for this session).',
};

const UNKNOWN_EN = (cmd: string) =>
  `Unknown command /${cmd} — nothing was sent to the model. Type /help for the available commands. If you meant a file path, drop the leading "/" or rephrase.`;
const UNKNOWN_AR = (cmd: string) =>
  `أمر غير معروف /${cmd} — لم يُرسل شيء إلى النموذج. اكتب /help لعرض الأوامر المتاحة. إن كان المقصود مسار ملف فاحذف الشرطة المائلة أو أعد الصياغة.`;

/**
 * Dispatch a raw chat input that starts with '/'. NEVER throws.
 *  'pass'      → not a slash command (or empty) — caller continues normally.
 *  'task-mode' → switch the session task mode; the caller must apply it via
 *                setSessionTaskMode(sessionId, d.taskMode), surface d.notice
 *                and END the run (no model call).
 *  'custom'    → the caller replaces the user turn text with d.expanded.
 *  'unknown'   → the caller surfaces d.notice and ENDS the run (no model call).
 */
export async function dispatchSlashCommand(args: {
  raw: string;
  workspace?: string;
}): Promise<SlashDispatch> {
  const raw = String(args?.raw ?? '').trim();
  // A command is "/name" or "/name args..." — name keeps it a plausible
  // command slug (a bare path like /home/user/x will NOT match the tail
  // rules and falls through to the friendly unknown notice per E19).
  // v11.11 (A6-ACCURACY) — the FIRST char class is [a-z0-9], matching the
  // scanner's NAME_RE (^[a-z0-9]…\.md$) and the Composer menu filter
  // (^[a-z0-9]…$). The old [a-z]-only head meant a REGISTERED digit-led
  // command file (2fa.md) showed in the slash menu, but typing "/2fa …"
  // never matched here → dispatch returned 'pass' and the literal text went
  // to the MODEL instead of expanding the command body (registered commands
  // must execute — menu list and dispatch must share one name contract).
  const m = /^\/([a-z0-9][a-z0-9_-]*)(?:\s+(.*))?$/i.exec(raw);
  if (!m) return { kind: 'pass' };
  const command = m[1].toLowerCase();
  const rest = (m[2] ?? '').trim();

  try {
    // 1) task modes — the real Build/Plan/Debug/Review switches.
    const tm = TASK_MODE_SLASH_COMMANDS[command];
    if (tm) {
      return {
        kind: 'task-mode',
        command,
        taskMode: tm,
        notice: `${MODE_NOTICE_EN[tm]}\n${MODE_NOTICE_AR[tm]}`,
      };
    }

    // 2) custom markdown commands (user + workspace scopes, workspace wins).
    const infos = listSlashCommands(args.workspace);
    const info = infos.find((i) => i.name === command);
    if (info) {
      const body = await loadCommandBody(info);
      if (body.trim()) return { kind: 'custom', command, expanded: expandCommand(body, rest) };
      // An empty command file is a config bug — fall through to unknown so
      // the user is never silently ignored.
    }

    // 3) unknown → friendly local notice (E19). Never reaches the model.
    return { kind: 'unknown', command, notice: `${UNKNOWN_EN(command)}\n${UNKNOWN_AR(command)}` };
  } catch {
    // Defensive: dispatch must never break a run — treat as unknown-safe pass.
    return { kind: 'unknown', command, notice: `${UNKNOWN_EN(command)}\n${UNKNOWN_AR(command)}` };
  }
}
