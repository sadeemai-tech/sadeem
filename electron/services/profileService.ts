// ============================================================
// SADEEM v12 — FULL PROFILE export / import.
// One portable JSON file bundling the user's settings + learned DNA
// + authored skills + prompt library, so a profile can be moved to
// another machine or backed up in one click.
//
// SECURITY: an exported profile contains the DECRYPTED settings (incl.
// provider API keys) — it is a sensitive backup, treat it like a
// password vault. Import validates the shape strictly and merges into
// the existing stores (skills/prompts upsert, settings/DNA restore).
// ============================================================
import * as fs from 'fs';
import type { AppSettings, DNAData, PromptItem } from '../../shared/types';
import { getSettings, saveSettings } from './storeService';
import * as dna from '../agent/dna';
import { listSkills, parseSkillMarkdown, saveSkill } from '../agent/skills';
import { listPrompts, savePrompt } from './promptLibraryService';

export const PROFILE_FORMAT = 'sadeem-profile';
export const PROFILE_VERSION = 1;
const PROFILE_APP_VERSION = '11.12.0';

export interface ProfileSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
  scope: 'global' | 'workspace';
}

export interface SadeemProfile {
  format: typeof PROFILE_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  settings: AppSettings;
  dna: DNAData;
  skills: ProfileSkill[];
  prompts: PromptItem[];
}

export interface ProfileImportResult {
  ok: boolean;
  error?: string;
  settings?: boolean;
  dna?: boolean;
  skills?: number;
  prompts?: number;
}

/** Build the full profile snapshot from the main-process stores. Never throws. */
export async function exportProfile(workspace?: string): Promise<SadeemProfile> {
  const ws = typeof workspace === 'string' ? workspace : '';
  const settings = getSettings();
  const dnaData = dna.loadDNA(ws || undefined);

  const skills: ProfileSkill[] = [];
  try {
    const infos = await listSkills(ws);
    for (const info of infos) {
      // Built-ins ship with the app — only export user-authored skills.
      if (info.scope === 'builtin') continue;
      try {
        const raw = await fs.promises.readFile(info.path, 'utf8');
        const parsed = parseSkillMarkdown(raw, info.slug);
        skills.push({
          slug: info.slug,
          name: parsed.name || info.name,
          description: parsed.description || info.description,
          body: parsed.body,
          scope: info.scope === 'global' ? 'global' : 'workspace',
        });
      } catch {
        /* one unreadable skill never blocks the export */
      }
    }
  } catch {
    /* skill scan is best-effort */
  }

  let prompts: PromptItem[] = [];
  try {
    prompts = listPrompts();
  } catch {
    /* prompt library is best-effort */
  }

  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: PROFILE_APP_VERSION,
    settings,
    dna: dnaData,
    skills,
    prompts,
  };
}

/** Strict shape validation — an arbitrary JSON file must never be restored. */
export function validateProfile(raw: unknown): { ok: boolean; error?: string; profile?: SadeemProfile } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'PROFILE_NOT_OBJECT' };
  const p = raw as Record<string, unknown>;
  if (p.format !== PROFILE_FORMAT) return { ok: false, error: 'PROFILE_BAD_FORMAT' };
  if (p.version !== PROFILE_VERSION) return { ok: false, error: 'PROFILE_BAD_VERSION' };
  if (!p.settings || typeof p.settings !== 'object' || Array.isArray(p.settings)) return { ok: false, error: 'PROFILE_BAD_SETTINGS' };
  if (!p.dna || typeof p.dna !== 'object' || Array.isArray(p.dna)) return { ok: false, error: 'PROFILE_BAD_DNA' };
  if (!Array.isArray(p.skills)) return { ok: false, error: 'PROFILE_BAD_SKILLS' };
  if (!Array.isArray(p.prompts)) return { ok: false, error: 'PROFILE_BAD_PROMPTS' };
  return { ok: true, profile: raw as SadeemProfile };
}

/**
 * Restore a validated profile. Settings + DNA are restored wholesale;
 * skills + prompts are merged (upsert by name/slug). Every write is
 * isolated so a bad single entry cannot roll back the others.
 */
export async function importProfile(raw: unknown, workspace?: string): Promise<ProfileImportResult> {
  const v = validateProfile(raw);
  if (!v.ok || !v.profile) return { ok: false, error: v.error };
  const p = v.profile;
  const ws = typeof workspace === 'string' ? workspace : '';

  let settingsOk = false;
  let dnaOk = false;
  let skillsN = 0;
  let promptsN = 0;

  try {
    saveSettings(p.settings as AppSettings);
    settingsOk = true;
  } catch {
    /* keep going with the other stores */
  }
  try {
    dna.saveDNA(p.dna as DNAData);
    dnaOk = true;
  } catch {
    /* keep going */
  }

  for (const s of p.skills) {
    try {
      if (!s || typeof s !== 'object' || typeof s.name !== 'string' || typeof s.body !== 'string') continue;
      const scope = s.scope === 'global' ? 'global' : 'workspace';
      await saveSkill(ws, {
        name: s.name.slice(0, 80) || 'skill',
        description: typeof s.description === 'string' ? s.description : '',
        body: s.body,
      }, scope);
      skillsN++;
    } catch {
      /* skip one bad skill */
    }
  }
  for (const pr of p.prompts) {
    try {
      if (!pr || typeof pr !== 'object' || typeof pr.name !== 'string' || typeof pr.text !== 'string') continue;
      if (savePrompt(pr.name, pr.text).ok) promptsN++;
    } catch {
      /* skip one bad prompt */
    }
  }

  if (!settingsOk && !dnaOk && !skillsN && !promptsN) {
    return { ok: false, error: 'PROFILE_RESTORE_FAILED' };
  }
  return { ok: true, settings: settingsOk, dna: dnaOk, skills: skillsN, prompts: promptsN };
}
