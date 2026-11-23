// ============================================================
// SADEEM settings — safety presets (v7.2).
// ONE source of truth for the 3 postures (Safe / Balanced /
// Independent) used by BOTH the settings presets row and the
// onboarding security step. Every key is a REAL AppSettings key —
// no invented settings. applyPreset persists via updateSettings.
// ============================================================
import { useStore } from '../../store';
import type { AppSettings } from '../../../shared/types';

export type PresetId = 'safe' | 'balanced' | 'indy';

export interface SecurityPreset {
  id: PresetId;
  labelKey: string;
  /** Human-readable summary of what the posture touches (tooltip / list). */
  summary: string[];
  patch: Omit<Partial<AppSettings>, 'agent'> & { agent?: Partial<NonNullable<AppSettings['agent']>> };
}

/** The three postures. Each sets ~10 real engine keys at once. */
export const SECURITY_PRESETS: SecurityPreset[] = [
  {
    id: 'safe',
    labelKey: 'set.preset.safe',
    summary: [
      'permissionMode=ask',
      'autoApproveEdits=false',
      'danger gate ON',
      'verifier fail-closed',
      'mutation gate 0.6',
      'task budget $2',
      'continueAuto=false',
      'terminal guard=on',
      'skills trust=ask',
      'taint-aware ON',
    ],
    patch: {
      permissionMode: 'default',
      autoApproveEdits: false,
      agent: {
        autoVerify: true,
        allowDangerousCommands: false,
        criticGate: true,
        taintAware: true,
        verifierMode: 'fail-closed',
        continueAuto: false,
        mutationGate: { enabled: true, threshold: 0.6, maxMutations: 60 },
        taskBudgetUsd: 2,
        autoCompact: true,
      },
      terminalGuard: 'on',
      trustWorkspaceSkills: 'ask',
    },
  },
  {
    id: 'balanced',
    labelKey: 'set.preset.balanced',
    summary: [
      'permissionMode=auto-edit',
      'autoApproveEdits=true',
      'danger gate ON',
      'verifier fail-open',
      'mutation gate 0.4',
      'auto-continue ON (4 rounds)',
      'terminal guard=warn-only',
      'skills trust=ask',
      'taint-aware ON',
      'autoVerify ON',
    ],
    patch: {
      permissionMode: 'autoEdit',
      autoApproveEdits: true,
      agent: {
        autoVerify: true,
        allowDangerousCommands: false,
        criticGate: true,
        taintAware: true,
        verifierMode: 'fail-open',
        continueAuto: true,
        maxContinueRounds: 4,
        mutationGate: { enabled: true, threshold: 0.4, maxMutations: 80 },
        autoCompact: true,
      },
      terminalGuard: 'warn-only',
      trustWorkspaceSkills: 'ask',
    },
  },
  {
    id: 'indy',
    labelKey: 'set.preset.indy',
    summary: [
      'permissionMode=full access',
      'autoApproveEdits=true',
      'danger gate SKIPPED',
      'mutation gate 0.3',
      'auto-continue 8 rounds',
      'terminal guard=off',
      'skills trust=always',
      'critic gate ON',
      'autoVerify ON',
      'network unrestricted',
    ],
    patch: {
      permissionMode: 'fullAccess',
      autoApproveEdits: true,
      agent: {
        autoVerify: true,
        allowDangerousCommands: true,
        criticGate: true,
        taintAware: true,
        continueAuto: true,
        maxContinueRounds: 8,
        mutationGate: { enabled: true, threshold: 0.3, maxMutations: 120 },
        networkAllowlist: [],
        autoCompact: true,
      },
      terminalGuard: 'off',
      trustWorkspaceSkills: 'always',
    },
  },
];

/** Preset ids in display order. */
export const PRESET_IDS: PresetId[] = ['safe', 'balanced', 'indy'];

/**
 * Apply one posture: the preset patch is merged agent-aware (the agent
 * object is merged key-by-key so unrelated engine tuning survives) and
 * persisted through the normal updateSettings path. Returns true when a
 * preset with that id exists.
 */
export function applyPreset(id: PresetId): boolean {
  const preset = SECURITY_PRESETS.find((p) => p.id === id);
  if (!preset) return false;
  const s = useStore.getState();
  const { agent: agentPatch, ...rest } = preset.patch;
  const nextAgent = { ...(s.settings.agent ?? {}), ...(agentPatch ?? {}) };
  s.updateSettings({
    ...rest,
    ...(agentPatch ? { agent: nextAgent } : {}),
  } as Partial<AppSettings>);
  return true;
}
