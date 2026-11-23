// ============================================================
// Surnia — persistent app store (settings.json / license.json)
// Lives in app.getPath('userData'). Provider API keys are
// encrypted at rest via safeStorage when available; when the OS
// keystore is unavailable they fall back to a marked `plain:`
// prefix (never silently raw). Both files are written with mode
// 0600. settings.json carries a schemaVersion with a small
// migration runner so older installs upgrade on first read.
// ============================================================
import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ALLOW_MODEL_FAILOVER_DEFAULT, type AppSettings, type LicenseState, type ProviderId } from '../../shared/types';

// ---------- schema versioning ----------
export const CURRENT_SCHEMA_VERSION = 4;

/**
 * v11.23 (FAILOVER-DEFAULTS) — normalize the failover opt-in to a STRICT
 * boolean. Only an explicit literal `true` keeps it on; absent, null, "true",
 * 1 or any other truthy value collapses to the canonical OFF default.
 * Shared by fresh defaults, migration, getSettings() and saveSettings() so no
 * code path (profile import included) can accidentally re-enable automatic
 * provider switching.
 */
export function normalizeAllowModelFailover(value: unknown): boolean {
  return value === true ? true : ALLOW_MODEL_FAILOVER_DEFAULT;
}

// ---------- defaults ----------
export const DEFAULT_SETTINGS: AppSettings & { schemaVersion?: number } = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  language: 'en',
  theme: 'obsidian',
  permissionMode: 'default',
  model: { provider: 'anthropic', model: 'claude-sonnet-5.5' },
  providers: {},
  fontSize: 13,
  terminalFontSize: 12,
  autoApproveEdits: false,
  checkpointsEnabled: true,
  onboardingDone: false,
  localOnly: false,
  recentPaths: [],
  mcpServers: [],
  billing: {},
  apiServer: {},
  usageLog: [],
  // v11.4 — additive group defaults (getSettings deep-merges these with disk)
  editor: { wordWrap: 'off', tabSize: 2, minimap: false, fontSize: 13, indentGuides: true },
  terminal: { shell: 'default', scrollback: 1000 },
  logs: { level: 'info' },
  voice: { asrProvider: 'auto', language: 'en-US', autoSend: false, deviceId: '' },
  shortcuts: {},
  // v12 — optional real embeddings for semantic search (offline hasher by default).
  embeddings: { enabled: false, model: 'text-embedding-3-small', batchSize: 64 },
  // v12 — tool profile: 'balanced' is the default so nothing breaks on upgrade.
  // v11.23 — failover is ALWAYS off on a fresh install (single source of truth).
  agent: { toolProfile: 'balanced', allowModelFailover: ALLOW_MODEL_FAILOVER_DEFAULT },
};

const ENC_PREFIX = 'enc:';
const PLAIN_PREFIX = 'plain:';

// ---------- v11.11 (A9) secret masking ----------
// Renderer responses never carry a full secret: `sk-li…9f4z` style masks
// (U+2026 ellipsis) are the wire form. A masked value can never collide with
// a real key (real keys do not contain '…'), so isMaskedSecret() lets
// saveSettings PRESERVE the stored secret instead of encrypting the mask on
// a settings round-trip.
const MASK_ELLIPSIS = '…';

/** Display-safe mask: keep the recognizable head + tail (sk-li…9f4z). */
export function maskSecret(value: string): string {
  const v = String(value ?? '');
  if (!v) return '';
  if (v.includes(MASK_ELLIPSIS)) return v; // already masked
  if (v.length <= 10) return `${v.slice(0, 2)}${MASK_ELLIPSIS}${v.slice(-4)}`;
  return `${v.slice(0, 5)}${MASK_ELLIPSIS}${v.slice(-4)}`;
}

/** True when `value` is one of OUR masks (never a usable credential). */
export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.includes(MASK_ELLIPSIS);
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}
function licensePath(): string {
  return path.join(app.getPath('userData'), 'license.json');
}

// ---------- encryption ----------
let warnedPlainSecrets = false;

function encryptSecret(value: string): string {
  if (!value || value.startsWith(ENC_PREFIX) || value.startsWith(PLAIN_PREFIX)) return value;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
    }
  } catch {
    /* fall through to the marked-plaintext fallback */
  }
  // SECURITY fallback: no OS keystore → store the secret UNENCRYPTED but
  // with an explicit `plain:` marker so the format is detectable on disk
  // (and so decryptSecret can distinguish it from ciphertext).
  if (!warnedPlainSecrets) {
    warnedPlainSecrets = true;
    console.warn('[surnia] safeStorage unavailable — provider keys stored unencrypted');
  }
  return PLAIN_PREFIX + value;
}

function decryptSecret(value: string): string {
  if (typeof value !== 'string' || !value) return value;
  // Marked-plaintext fallback (safeStorage unavailable at write time).
  if (value.startsWith(PLAIN_PREFIX)) return value.slice(PLAIN_PREFIX.length);
  if (!value.startsWith(ENC_PREFIX)) return value; // legacy raw (pre-prefix) value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    // Corrupted ciphertext (OS password changed, keychain reset, cross-machine
    // copy). NEVER return the encrypted blob as a usable key — that silently
    // produces "Invalid API key" 401s. Treat the secret as missing.
    console.warn('[surnia] settings: a stored secret could not be decrypted — treating it as missing.');
    return '';
  }
}

// ---------- schema migrations ----------
/**
 * Bring an on-disk settings.json up to CURRENT_SCHEMA_VERSION.
 * Missing version → treated as v2. Migrations operate on the RAW parsed
 * object (secrets still in their `enc:`/`plain:` on-disk form) and the
 * result is persisted back with owner-only permissions, so no secret is
 * ever re-encrypted or written in the clear by the migration itself.
 */
function migrateSettings(parsed: Record<string, unknown>): Record<string, unknown> {
  const from = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 2;
  if (from >= CURRENT_SCHEMA_VERSION) return parsed;

  let migrated = parsed;
  // v2 → v3: no data move (providers/billing/apiServer shapes already
  // merged defensively in getSettings) — stamp the new version.
  migrated = { ...migrated, schemaVersion: CURRENT_SCHEMA_VERSION };

  // v3 → v4 (Surnia 2.0): refresh the app-default model when an install
  // still carries the v1.5-era default. Users who explicitly pinned any
  // OTHER model are untouched; a one-time stamp prevents re-migrating a
  // deliberate downgrade.
  try {
    const m = migrated.model as { provider?: string; model?: string } | undefined;
    if (!migrated.modelRefreshedTo2026 && m?.model === 'claude-sonnet-4-5') {
      migrated.model = { provider: m.provider ?? 'anthropic', model: 'claude-sonnet-5.5' };
      migrated.modelRefreshedTo2026 = true;
    } else if (!migrated.modelRefreshedTo2026) {
      migrated.modelRefreshedTo2026 = true; // any other explicit choice — never touch it
    }
  } catch {
    /* never block settings load on the refresh */
  }

  // v11.23 (FAILOVER-DEFAULTS) — a migrated install must NOT inherit an
  // accidental truthy flag (e.g. "true"/1 written by an older build). Only a
  // literal boolean true is an opt-in; canonicalize everything else to OFF.
  // getSettings() re-normalizes on every read, so even a schema-v4 file that
  // skips this runner is safe.
  try {
    // Even a v2/v3 file with NO agent block lands on disk with the canonical
    // OFF value — no stale truthy can survive a migration, and no later reader
    // has to guess what an absent flag meant.
    const agent: Record<string, unknown> =
      migrated.agent && typeof migrated.agent === 'object'
        ? (migrated.agent as Record<string, unknown>)
        : {};
    agent.allowModelFailover = normalizeAllowModelFailover(agent.allowModelFailover);
    migrated.agent = agent;
  } catch {
    /* never block settings load on the failover normalization */
  }

  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(migrated, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* read-only userData — migration retries on the next launch */
  }
  return migrated;
}

// ---------- read / merge ----------
/**
 * v11.24 (FIRST-TOKEN LATENCY + G16) — getSettings() is called from many
 * main-process services (boot, IPC handlers, engine, router, billing, MCP…).
 * Every call used to re-read + migrate + migrate-write + decrypt settings.json,
 * so a single run paid for 4+ full reads before the model request was even
 * issued. Cache the merged/decrypted snapshot keyed by the file's mtimeMs:
 *   • repeated reads inside one run/boot window are one cheap statSync,
 *   • a direct external write (tests, profile import, another process) changes
 *     mtimeMs and is picked up on the very next read — no stale forever-cache,
 *   • saveSettings() invalidates explicitly (same-millisecond writes).
 * Counters are diagnostic-only and exported for the latency regression suite.
 */
let settingsCache: { mtimeMs: number; value: AppSettings } | null = null;
let settingsCalls = 0;
let settingsDiskReads = 0;

/** Total getSettings() calls since process start (diagnostic). */
export function getSettingsCallCount(): number { return settingsCalls; }
/** Full disk reads performed by getSettings() since process start (diagnostic). */
export function getSettingsDiskReadCount(): number { return settingsDiskReads; }
/** Reset both diagnostic counters (test-only; production never calls this). */
export function resetSettingsDiagnostics(): void { settingsCalls = 0; settingsDiskReads = 0; }
/** Drop the cached snapshot (used by saveSettings and profile/security paths). */
export function invalidateSettingsCache(): void { settingsCache = null; }

function readJson(file: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch (err) {
    // No silent failure: a corrupt settings file must be visible in the main
    // log even though we fall back to safe defaults.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[surnia] settings: ${path.basename(file)} could not be read/parsed — using safe defaults:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}

function decryptProviders(raw: AppSettings): AppSettings {
  const providers: AppSettings['providers'] = {};
  for (const [id, entry] of Object.entries(raw.providers ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    providers[id as ProviderId] = {
      ...entry,
      apiKey: entry.apiKey ? decryptSecret(entry.apiKey) : undefined,
    };
  }
  return { ...raw, providers };
}

/** v11.31 — the Remote pairing token is a credential too: same pipeline. */
function decryptRemote(raw: AppSettings): AppSettings {
  const r = raw.remote;
  if (!r || typeof r !== 'object') return raw;
  return { ...raw, remote: { ...r, token: r.token ? decryptSecret(r.token) : undefined } };
}

/** v11.4 — the Stripe secret key rides the same safeStorage pipeline as provider keys. */
function decryptBilling(raw: AppSettings): AppSettings {
  const b = raw.billing;
  if (!b || typeof b !== 'object') return raw;
  return {
    ...raw,
    billing: {
      ...b,
      stripeSecretKey: b.stripeSecretKey ? decryptSecret(b.stripeSecretKey) : undefined,
    },
  };
}

export function getSettings(): AppSettings {
  settingsCalls++;
  const file = settingsPath();
  // v11.24 — cheap freshness probe. statSync on a tiny local file is ~microseconds
  // vs a full read+migrate+write+decrypt; an external write bumps mtimeMs so the
  // cache can never mask a test/user settings change (the fresh-read failover
  // gate keeps calling getSettings() and still sees the new values).
  let mtimeMs = -1;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* settings.json missing */ }
  if (settingsCache && settingsCache.mtimeMs === mtimeMs) return settingsCache.value;

  settingsDiskReads++;
  const parsed = readJson(file);
  if (!parsed) return { ...DEFAULT_SETTINGS };
  const migrated = migrateSettings(parsed); // v2 → v3 on first read
  // v11.11 — a MASKED value must never be treated as a credential: swap any
  // mask back to "missing" before main-process consumers read them.
  unmaskSettings(migrated);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...migrated,
    model: { ...DEFAULT_SETTINGS.model, ...((migrated.model as object) ?? {}) },
    providers: { ...((migrated.providers as object) ?? {}) },
    billing: { ...DEFAULT_SETTINGS.billing, ...((migrated.billing as object) ?? {}) },
    apiServer: { ...DEFAULT_SETTINGS.apiServer, ...((migrated.apiServer as object) ?? {}) },
    // v11.4 — nested group defaults (a missing group on disk still gets its defaults)
    editor: { ...DEFAULT_SETTINGS.editor, ...((migrated.editor as object) ?? {}) },
    terminal: { ...DEFAULT_SETTINGS.terminal, ...((migrated.terminal as object) ?? {}) },
    logs: { ...DEFAULT_SETTINGS.logs, ...((migrated.logs as object) ?? {}) },
    voice: { ...DEFAULT_SETTINGS.voice, ...((migrated.voice as object) ?? {}) },
    shortcuts: { ...((migrated.shortcuts as object) ?? {}) },
    embeddings: { ...DEFAULT_SETTINGS.embeddings, ...((migrated.embeddings as object) ?? {}) },
    agent: { ...DEFAULT_SETTINGS.agent, ...((migrated.agent as object) ?? {}) },
  } as AppSettings;
  // v11.23 (FAILOVER-DEFAULTS) — read-time hardening. A stale/malformed value
  // on disk (or one written by a profile import) can never turn automatic
  // provider switching on: only a literal boolean true survives. This is done
  // on EVERY cache refill, so callers (engine/router/CLI/headless) see a fresh,
  // safe value with no stale forever-cache.
  merged.agent!.allowModelFailover = normalizeAllowModelFailover(merged.agent!.allowModelFailover);
  const value = decryptRemote(decryptBilling(decryptProviders(merged)));
  settingsCache = { mtimeMs, value };
  return value;
}

// ---------- write ----------
/**
 * v11.11 (A9) — the renderer only ever sees MASKED secrets, so a settings
 * round-trip carries masks back. A masked incoming value is replaced with
 * the STORED secret (mask ⇒ "keep what is stored"); a real value is
 * encrypted as before. apiServer.token rides the same safeStorage pipeline
 * now (previously a decrypted round-trip re-persisted it in the clear).
 */
export function saveSettings(settings: AppSettings): AppSettings {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const stored = readJson(settingsPath()) ?? {};
  const storedProviders = (stored.providers ?? {}) as Record<string, { apiKey?: string }>;
  const storedBilling = (stored.billing ?? {}) as { stripeSecretKey?: string };
  const storedApiServer = (stored.apiServer ?? {}) as { token?: string };
  const storedRemote = (stored.remote ?? {}) as { token?: string };

  const providers: AppSettings['providers'] = {};
  for (const [id, entry] of Object.entries(settings.providers ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    // Trim credentials on write: a pasted key with a trailing newline passes
    // "Verify" (which trims) but then 401s in chat. Empty keys are dropped.
    let rawKey = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '';
    if (isMaskedSecret(rawKey)) rawKey = String(storedProviders[id]?.apiKey ?? ''); // masked → keep stored (enc:/plain: form)
    const rawBase = typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : '';
    providers[id as ProviderId] = {
      ...entry,
      apiKey: rawKey ? encryptSecret(rawKey) : undefined,
      baseUrl: rawBase || undefined,
    };
  }

  // v11.4 — Stripe secret key: masked round-trips keep the stored value.
  let stripeKey = typeof settings.billing?.stripeSecretKey === 'string' ? settings.billing.stripeSecretKey.trim() : '';
  if (isMaskedSecret(stripeKey)) stripeKey = String(storedBilling.stripeSecretKey ?? '');

  // v11.11 — apiServer.token: encrypt like every other secret; never write
  // a decrypted round-trip value back in the clear (masked → keep stored).
  const incomingApiServer = (settings.apiServer ?? {}) as { token?: string };
  let apiToken = typeof incomingApiServer.token === 'string' ? incomingApiServer.token.trim() : '';
  if (isMaskedSecret(apiToken)) apiToken = String(storedApiServer.token ?? '');

  // v11.31 — the Remote pairing token must never be written in the clear
  // (previously it survived every settings round-trip as raw JSON).
  const incomingRemote = (settings.remote ?? {}) as { token?: string };
  let remoteToken = typeof incomingRemote.token === 'string' ? incomingRemote.token.trim() : '';
  if (isMaskedSecret(remoteToken)) remoteToken = String(storedRemote.token ?? '');

  const toWrite: AppSettings & { schemaVersion?: number } = {
    ...settings,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // v11.23 (FAILOVER-DEFAULTS) — write-time hardening. A profile import
    // writes settings wholesale; an absent/truthy-non-boolean flag must land
    // on disk as the canonical OFF value (an explicit literal true is kept).
    agent: {
      ...(settings.agent ?? {}),
      allowModelFailover: normalizeAllowModelFailover(settings.agent?.allowModelFailover),
    },
    providers,
    billing: {
      ...settings.billing,
      stripeSecretKey: stripeKey ? encryptSecret(stripeKey) : undefined,
    },
    apiServer: {
      ...incomingApiServer,
      token: apiToken ? encryptSecret(apiToken) : undefined,
    },
    remote: {
      ...incomingRemote,
      token: remoteToken ? encryptSecret(remoteToken) : undefined,
    },
  };
  fs.writeFileSync(settingsPath(), JSON.stringify(toWrite, null, 2), { encoding: 'utf8', mode: 0o600 });
  invalidateSettingsCache(); // v11.24 — same-ms writes must not be masked by the mtime cache
  return getSettings(); // round-trip so renderer sees the stored (encrypted) state
}

/** v11.11 — masks inside a RAW parsed object are not credentials → undefined. */
function unmaskSettings(parsed: Record<string, unknown>): void {
  try {
    const providers = parsed.providers as Record<string, { apiKey?: string }> | undefined;
    if (providers && typeof providers === 'object') {
      for (const entry of Object.values(providers)) {
        if (entry && isMaskedSecret(entry.apiKey)) entry.apiKey = undefined;
      }
    }
    const billing = parsed.billing as { stripeSecretKey?: string } | undefined;
    if (billing && isMaskedSecret(billing.stripeSecretKey)) billing.stripeSecretKey = undefined;
    const apiServerCfg = parsed.apiServer as { token?: string } | undefined;
    if (apiServerCfg && isMaskedSecret(apiServerCfg.token)) apiServerCfg.token = undefined;
    const remoteCfg = parsed.remote as { token?: string } | undefined;
    if (remoteCfg && isMaskedSecret(remoteCfg.token)) remoteCfg.token = undefined;
  } catch {
    /* masking is best-effort */
  }
}

// ---------- license ----------
export function getLicense(): LicenseState {
  const parsed = readJson(licensePath());
  if (!parsed) return { plan: 'free', mode: 'local' };
  return {
    plan: (parsed.plan as LicenseState['plan']) ?? 'free',
    licensedTo: parsed.licensedTo as string | undefined,
    activatedAt: parsed.activatedAt as number | undefined,
    mode: 'local',
    expiresAt: parsed.expiresAt as number | undefined,
    seats: parsed.seats as number | undefined,
    trialUntil: parsed.trialUntil as number | undefined,
    source: parsed.source as LicenseState['source'],
    email: parsed.email as string | undefined,
  };
}

export function saveLicense(license: LicenseState): LicenseState {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(licensePath(), JSON.stringify(license, null, 2), { encoding: 'utf8', mode: 0o600 });
  return license;
}
