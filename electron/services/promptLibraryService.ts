// ============================================================
// SADEEM v11.6 — Prompt Library service (+ v11.31 CRUD/validation).
// A device-local collection of reusable prompts: save a draft,
// name it, re-insert it into the composer in one click. The most
// requested power-user feature across the tools SADEEM mirrors
// (Claude Code custom commands, Cursor prompt files, OpenCode
// commands) — unified here as a first-class library with CRUD
// IPC, dedup-by-name upsert and a 200-item cap.
// Storage: <userData>/prompts.json (mode 0600 like all stores).
//
// v11.31: reads are sanitized (a half-written file can no longer
// crash the panel), writes are atomic tmp+rename, and every call
// validates its inputs and reports an actionable error instead of
// silently no-oping. getPrompt/renamePrompt complete the CRUD set.
// ============================================================
import { app } from 'electron';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PromptItem } from '../../shared/types';

const MAX_PROMPTS = 200;
const MAX_NAME = 80;
const MAX_TEXT = 20_000;

export type PromptSaveError = 'name_required' | 'text_required' | 'storage_failed';
export interface PromptSaveResult {
  ok: boolean;
  item?: PromptItem;
  error?: PromptSaveError;
  /** Non-fatal notes (e.g. "name shortened to 80 characters"). */
  warnings?: string[];
  /** How many oldest prompts were evicted by the 200-item cap. */
  dropped?: number;
  persisted?: boolean;
}

function libFile(): string {
  try {
    if (app?.getPath) return path.join(app.getPath('userData'), 'prompts.json');
  } catch {
    /* headless/test */
  }
  return path.join(process.env.SURNIA_HOME || process.env.KODEX_HOME || path.join(process.cwd(), '.surnia-home'), 'prompts.json');
}

// ---------- in-process mirror + atomic persistence ----------
let cache: PromptItem[] | null = null;
let dirty = false;

function saneItem(raw: unknown): PromptItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PromptItem>;
  const id = typeof p.id === 'string' ? p.id.trim() : '';
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, MAX_NAME) : '';
  const text = typeof p.text === 'string' ? p.text.slice(0, MAX_TEXT) : '';
  if (!id || !name || !text.trim()) return null;
  const createdAt = typeof p.createdAt === 'number' && Number.isFinite(p.createdAt) ? p.createdAt : Date.now();
  const updatedAt = typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) ? p.updatedAt : createdAt;
  return { id, name, text, createdAt, updatedAt };
}

function readAll(): PromptItem[] {
  if (cache) return cache;
  const out: PromptItem[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(libFile(), 'utf8')) as { prompts?: unknown };
    if (Array.isArray(j.prompts)) {
      for (const raw of j.prompts) {
        const item = saneItem(raw);
        if (item && !out.some((x) => x.id === item.id)) out.push(item);
      }
    }
  } catch {
    /* no file / corrupted — start empty */
  }
  cache = out.slice(0, MAX_PROMPTS);
  return cache;
}

function flushAll(): { ok: boolean; persisted: boolean; error?: string } {
  if (!cache || !dirty) return { ok: true, persisted: true };
  const file = libFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ prompts: cache }, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    dirty = false;
    return { ok: true, persisted: true };
  } catch {
    return { ok: false, persisted: false, error: 'Could not write the prompt library to disk.' };
  }
}

function writeAll(items: PromptItem[]): { ok: boolean; persisted: boolean; error?: string } {
  cache = items.slice(0, MAX_PROMPTS);
  dirty = true;
  return flushAll();
}

/** Most-recently-updated first. */
export function listPrompts(): PromptItem[] {
  return readAll().slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Read one prompt by id (Read in CRUD). */
export function getPrompt(id: string): PromptItem | undefined {
  const clean = String(id ?? '');
  return clean ? readAll().find((p) => p.id === clean) : undefined;
}

/** Upsert by name (case-insensitive): updating an existing name keeps its id. */
export function savePrompt(name: string, text: string): PromptSaveResult {
  if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'name_required' };
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'text_required' };

  const warnings: string[] = [];
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME) warnings.push(`Name shortened to ${MAX_NAME} characters.`);
  if (text.length > MAX_TEXT) warnings.push(`Prompt shortened to ${MAX_TEXT} characters.`);
  const n = trimmed.slice(0, MAX_NAME);
  const t = text.slice(0, MAX_TEXT);

  try {
    const items = readAll().slice();
    const now = Date.now();
    const existing = items.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      existing.text = t;
      existing.updatedAt = now;
      const res = writeAll(items);
      return {
        ok: res.ok,
        item: existing,
        ...(warnings.length ? { warnings } : {}),
        ...(res.error ? { error: 'storage_failed', persisted: res.persisted } : {}),
      };
    }
    const item: PromptItem = { id: randomBytes(8).toString('hex'), name: n, text: t, createdAt: now, updatedAt: now };
    items.push(item);
    // cap: drop the oldest when full
    let dropped = 0;
    while (items.length > MAX_PROMPTS) {
      let oldest = 0;
      for (let i = 1; i < items.length; i++) if (items[i].updatedAt < items[oldest].updatedAt) oldest = i;
      items.splice(oldest, 1);
      dropped++;
    }
    const res = writeAll(items);
    return {
      ok: res.ok,
      item,
      ...(warnings.length ? { warnings } : {}),
      ...(dropped ? { dropped } : {}),
      ...(res.error ? { error: 'storage_failed', persisted: res.persisted } : {}),
    };
  } catch {
    return { ok: false, error: 'storage_failed' };
  }
}

/** Rename without losing id/createdAt; refuses a case-insensitive collision. */
export function renamePrompt(id: string, newName: string): { ok: boolean; item?: PromptItem; error?: 'invalid_id' | 'name_required' | 'name_conflict' | 'storage_failed' } {
  const clean = String(id ?? '');
  if (!clean) return { ok: false, error: 'invalid_id' };
  if (typeof newName !== 'string' || !newName.trim()) return { ok: false, error: 'name_required' };
  const name = newName.trim().slice(0, MAX_NAME);
  const items = readAll().slice();
  const target = items.find((p) => p.id === clean);
  if (!target) return { ok: false, error: 'invalid_id' };
  if (items.some((p) => p.id !== clean && p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'name_conflict' };
  }
  target.name = name;
  target.updatedAt = Date.now();
  const res = writeAll(items);
  return { ok: res.ok, item: target, ...(res.error ? { error: 'storage_failed' } : {}) };
}

export function deletePrompt(id: string): { ok: boolean; error?: string } {
  const clean = String(id ?? '');
  if (!clean) return { ok: false, error: 'invalid_id' };
  try {
    const before = readAll();
    const after = before.filter((p) => p.id !== clean);
    if (after.length === before.length) return { ok: false, error: 'No prompt matched that id.' };
    const res = writeAll(after);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  } catch {
    return { ok: false, error: 'storage_failed' };
  }
}

/** v11.36 — Duplicate a prompt into a REAL new row (fresh id, distinct name,
 *  identical text). Collisions get " (2)", " (3)" … instead of silently
 *  upserting over the original; the 200-item cap evicts the oldest as on save. */
export function duplicatePrompt(id: string): { ok: boolean; item?: PromptItem; error?: 'invalid_id' | 'storage_failed' } {
  const clean = String(id ?? '');
  if (!clean) return { ok: false, error: 'invalid_id' };
  try {
    const src = getPrompt(clean);
    if (!src) return { ok: false, error: 'invalid_id' };
    const items = readAll().slice();
    const base = `${src.name} (copy)`.slice(0, MAX_NAME);
    let name = base;
    let n = 2;
    while (items.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      const suffix = ` (${n++})`;
      name = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    }
    const now = Date.now();
    const item: PromptItem = {
      id: randomBytes(8).toString('hex'),
      name,
      text: src.text.slice(0, MAX_TEXT),
      createdAt: now,
      updatedAt: now,
    };
    items.push(item);
    while (items.length > MAX_PROMPTS) {
      let oldest = 0;
      for (let i = 1; i < items.length; i++) if (items[i].updatedAt < items[oldest].updatedAt) oldest = i;
      items.splice(oldest, 1);
    }
    const res = writeAll(items);
    return { ok: res.ok, item, ...(res.error ? { error: 'storage_failed' } : {}) };
  } catch {
    return { ok: false, error: 'storage_failed' };
  }
}

// ============================================================
// v11.38 — SAVED PROMPTS MUST REACH THE MODEL (founder: "البرومتس يجب أن
// يتم استخدامه"). Until now this service ONLY stored prompts and the UI
// inserted their text; no prompt directive and no saved entry ever reached a
// provider request, so the model treated them as ordinary chat text and
// improvised. These pure helpers are the model-facing surface:
//   • promptsForModel() → compact, sanitized entries for the system prompt's
//     dynamic tail (electron/agent/prompts.ts `savedPrompts` option);
//   • findPrompt() → exact name/id resolution for a future `use_prompt` tool;
//   • promptInsertText() → the authoritative wrapper the "Use with AI" control
//     inserts into the composer so the model sees an explicit user order.
// ENGINE HANDOFF (not owned here): electron/agent/engine.ts:3024 buildSystemPrompt
//   call — add `savedPrompts: promptsForModel()` (import from
//   '../services/promptLibraryService'). Until that one line lands, the
//   directive still travels with user-inserted prompts via the wrapper below.
// ============================================================

/** Authoritative markers used when a saved prompt is sent to the AI. */
export const PROMPT_AI_OPEN = '[SAVED PROMPT — follow these instructions exactly]';
export const PROMPT_AI_CLOSE = '[/SAVED PROMPT — carry out every step before improvising]';

/** Wrap an exact saved prompt so both the user and the model see a direct order. */
export function promptInsertText(text: string): string {
  const clean = String(text ?? '').trim().slice(0, MAX_TEXT);
  return clean ? `${PROMPT_AI_OPEN}\n${clean}\n${PROMPT_AI_CLOSE}\n` : '';
}

export interface PromptForModel {
  name: string;
  text: string;
}

/**
 * Saved prompts formatted for the dynamic prompt tail. Bounded, sanitized
 * (control characters removed) and derived ONLY from the real on-disk library.
 * Never throws; an empty library returns an empty array (no section rendered).
 */
export function promptsForModel(limit = 12, textCap = 2000): PromptForModel[] {
  const n = Math.max(0, Math.min(Math.floor(limit), 40));
  const cap = Math.max(200, Math.min(Math.floor(textCap), MAX_TEXT));
  return listPrompts()
    .slice(0, n)
    .map((p) => ({
      name: p.name.slice(0, MAX_NAME),
      text: p.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').trim().slice(0, cap),
    }))
    .filter((p) => p.name.length > 0 && p.text.length > 0);
}

/** Resolve a saved prompt by exact id (preferred) or case-insensitive name.
 *  The seam a future `use_prompt` tool calls to load a whole entry on demand. */
export function findPrompt(ref: string): PromptItem | undefined {
  const clean = String(ref ?? '').trim();
  if (!clean) return undefined;
  const all = readAll();
  return all.find((p) => p.id === clean) ?? all.find((p) => p.name.toLowerCase() === clean.toLowerCase());
}
