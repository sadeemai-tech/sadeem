// ============================================================
// SADEEM Remote (v11.7) — control the desktop agent from a REAL phone.
// The competitors' 2025-2026 mobile wave (Claude Code remote-control,
// Codex mobile, Cursor iOS) all converge on one architecture: the agent
// keeps running on your machine, the phone connects over a local relay
// with QR pairing, and you watch the live transcript, send/steer
// messages and approve permissions from the phone. SADEEM Remote is
// exactly that — honest, local-first, zero cloud:
//   • HTTP server bound to 0.0.0.0:<port> ONLY when explicitly enabled
//     (LAN / hotspot — never port-forwarded by us, never tunneled).
//   • Pairing token: 20-char URL-safe random; compared timing-safe; the
//     page embeds it in the URL fragment (#t=…) which browsers never send
//     back to the server in logs — and every API call re-checks it.
//   • Live feed: SSE mirror of the DESKTOP agent's event stream (the same
//     events the app renders) + full programmatic runs started from the
//     phone via the apiServer run pipeline.
//   • From the phone you can: watch thinking/text/tools live, send a new
//     task (when idle), steer a running one, approve or deny permissions,
//     abort the run, browse past sessions.
//   • node:http + node:crypto only; qrcode is used in the MAIN process to
//     render the pairing QR as a data URL for the Settings screen.
// ============================================================
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { app } from 'electron';
import QRCode from 'qrcode';
import * as sessions from './sessionService';
import { getSettings, saveSettings } from './storeService';
import {
  isDeviceRegistered,
  localAccountFingerprint,
  registerDevice,
  touchDevice,
} from './deviceService';
import { enqueueUserMessage } from '../agent/engine';
import {
  apiStartRun,
  apiAbortRun,
  apiSubscribeRun,
  apiResolveRunDecision,
} from './apiServerService';
import type { ApprovalPolicyAction } from './approvalPolicyService';
import type { AgentEvent, PermissionDecision } from '../../shared/types';

// ---------- config ----------

const DEFAULT_PORT = 48888;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const TOKEN_BYTES = 15; // → 20 base64url chars
const PAGE_CACHE = 60_000; // max seconds a phone caches the pairing page
const MAX_WS_MSGS = 120; // transcript rows sent to the phone
const MSG_TRIM = 1500; // per-row content cap for the phone payload
const SSE_HEARTBEAT_MS = 15_000;
const DESKTOP_IDLE_MS = 90_000; // last event older than this → agent idle
// v11.31 — pairing deep links are EPHEMERAL: a QR code is one-use and expires.
const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PAIRING_CODE_CAP = 32; // bounded in-memory challenge set
// v11.36 — QR scanability on real phone cameras. The old margin:1 / width:240
// with an ~85-char URL produced sub-pixel modules and no quiet zone; phones
// could not lock on it. ISO/IEC 18004 recommends >=4 modules of quiet zone.
const QR_MARGIN = 4;
const QR_WIDTH = 320;
const QR_ECC: 'L' | 'M' | 'Q' | 'H' = 'M';
const PAIRING_VERSION = 1;
// v11.36 — cheap "is the LAN URL actually reachable?" probe, cached so the
// 3s Settings poll does not open a socket on every tick.
const LAN_PROBE_MS = 800;
const LAN_PROBE_CACHE_MS = 5000;

interface RemoteCfg {
  enabled: boolean;
  port: number;
  token: string;
  /** '' = auto-detect the best physical LAN adapter; else manual IPv4 override. */
  host: string;
}

let cfgCache: RemoteCfg | null = null;
let server: http.Server | null = null;
let startedAt: number | undefined;
let lastError: string | undefined;
let pageCache: { at: number; html: string } | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let lanProbe: { at: number; host: string; port: number; ok: boolean } | null = null;

const clients = new Set<ServerResponse>(); // live SSE phones

// ---------- v11.31 — one-use, TTL'd, local-account-bound pairing ----------

export interface PairingChallenge {
  /** URL-safe one-use code embedded in the QR deep link (#p=…). */
  code: string;
  /** Absolute expiry timestamp (ms). */
  expiresAt: number;
  /** Fingerprint of the OS account that minted this link. */
  account: string;
  /** Set true at redemption; the challenge is then discarded. */
  used: boolean;
}

const pairingChallenges = new Map<string, PairingChallenge>();
/** Bounded tombstone set so a replay reports "used" instead of "unknown". */
const consumedPairingCodes = new Set<string>();
let currentPairingCode: string | null = null;

/** Mint a fresh pairing challenge. Exported so the TTL/one-use guard is testable. */
export function issuePairingChallenge(now = Date.now()): PairingChallenge {
  const code = randomBytes(18).toString('base64url');
  const challenge: PairingChallenge = {
    code,
    expiresAt: now + PAIRING_TTL_MS,
    account: localAccountFingerprint(),
    used: false,
  };
  pairingChallenges.set(code, challenge);
  if (pairingChallenges.size > PAIRING_CODE_CAP) {
    const oldest = pairingChallenges.keys().next().value;
    if (oldest && oldest !== code) pairingChallenges.delete(oldest);
  }
  currentPairingCode = code;
  console.log(`[sadeem-remote] pairing link issued for ${mask(code)} (expires in ${PAIRING_TTL_MS / 60000} min)`);
  return { ...challenge };
}

/** The QR link is stable until consumed or expired — not a new code per poll. */
function activePairing(now = Date.now()): PairingChallenge {
  const live = currentPairingCode ? pairingChallenges.get(currentPairingCode) : null;
  if (live && !live.used && live.expiresAt > now && live.account === localAccountFingerprint()) {
    return live;
  }
  for (const [code, ch] of [...pairingChallenges]) {
    if (ch.used || ch.expiresAt <= now) pairingChallenges.delete(code);
  }
  return issuePairingChallenge(now);
}

export type PairingState = 'valid' | 'used' | 'expired' | 'unknown';

/**
 * v11.36 — one stable code per failure mode. The Settings UI and the inline
 * phone page both map these to concrete, actionable EN/AR text; there is no
 * longer a single generic "pairing failed" that leaves the founder guessing.
 */
export type RemoteErrorCode =
  | 'INVALID_PAIRING_CODE'
  | 'PAIRING_CODE_MALFORMED'
  | 'PAIRING_CODE_EXPIRED'
  | 'PAIRING_CODE_ALREADY_USED'
  | 'LOCAL_ACCOUNT_MISMATCH'
  | 'DEVICE_REGISTRATION_FAILED'
  | 'MISSING_DEVICE_HEADER'
  | 'DEVICE_NOT_REGISTERED'
  | 'ACCOUNT_MISMATCH'
  | 'DEVICE_TOUCH_FAILED'
  | 'BAD_PAIRING_TOKEN'
  | 'FORBIDDEN_HOST'
  | 'FORBIDDEN_ORIGIN'
  | 'NO_LAN_ADDRESS'
  | 'LAN_HOST_NOT_FOUND'
  | 'LAN_UNREACHABLE';

export const REMOTE_ERROR_TEXT: Record<RemoteErrorCode, { en: string; ar: string }> = {
  INVALID_PAIRING_CODE: {
    en: 'That QR was never issued here. Scan the current QR in Settings.',
    ar: 'هذا الرمز لم يُصدر من هذا الجهاز — امسح رمز QR الحالي من الإعدادات.',
  },
  PAIRING_CODE_MALFORMED: {
    en: 'The pairing code is corrupt. Regenerate the QR in Settings.',
    ar: 'رمز الاقتران تالف — جدّد رمز QR من الإعدادات.',
  },
  PAIRING_CODE_EXPIRED: {
    en: 'This QR expired after 10 minutes. Open Settings for a fresh one.',
    ar: 'انتهت صلاحية رمز QR بعد 10 دقائق — افتح الإعدادات للحصول على رمز جديد.',
  },
  PAIRING_CODE_ALREADY_USED: {
    en: 'This QR was already used by a phone. Scan a fresh one from Settings.',
    ar: 'استُخدم هذا الرمز على هاتف آخر — امسح رمزاً جديداً من الإعدادات.',
  },
  LOCAL_ACCOUNT_MISMATCH: {
    en: 'This link belongs to another OS account. Regenerate it on this machine.',
    ar: 'هذا الرابط يخص حساب نظام آخر — جدّده من هذا الجهاز.',
  },
  DEVICE_REGISTRATION_FAILED: {
    en: 'The phone could not be registered. Check disk permissions and retry.',
    ar: 'تعذّر تسجيل الهاتف — تحقق من صلاحيات القرص وأعد المحاولة.',
  },
  MISSING_DEVICE_HEADER: {
    en: 'The phone did not identify its paired device. Re-pair from Settings.',
    ar: 'لم يرسل الهاتف معرّف الجهاز المقترن — أعد الاقتران من الإعدادات.',
  },
  DEVICE_NOT_REGISTERED: {
    en: 'This device is not paired (or was revoked). Re-pair from Settings.',
    ar: 'هذا الجهاز غير مقترن (أو أُلغي) — أعد الاقتران من الإعدادات.',
  },
  ACCOUNT_MISMATCH: {
    en: 'The paired device belongs to another OS account. Re-pair on this account.',
    ar: 'الجهاز المقترن يخص حساب نظام آخر — أعد الاقتران على هذا الحساب.',
  },
  DEVICE_TOUCH_FAILED: {
    en: 'Could not update the device record. Check disk permissions.',
    ar: 'تعذّر تحديث سجل الجهاز — تحقق من صلاحيات القرص.',
  },
  BAD_PAIRING_TOKEN: {
    en: 'The saved token was rejected. Re-scan the QR in Settings to pair again.',
    ar: 'رُفض الرمز المحفوظ — امسح رمز QR من الإعدادات لإعادة الاقتران.',
  },
  FORBIDDEN_HOST: {
    en: 'Open the link shown in Settings (same IP and port) — do not retype the address.',
    ar: 'افتح الرابط الظاهر في الإعدادات (نفس العنوان والمنفذ) — لا تكتب العنوان يدوياً.',
  },
  FORBIDDEN_ORIGIN: {
    en: 'A foreign page tried to drive the phone API. Open the QR link directly.',
    ar: 'حاولت صفحة غريبة التحكم بواجهة الهاتف — افتح رابط QR مباشرة.',
  },
  NO_LAN_ADDRESS: {
    en: 'No Wi-Fi/Ethernet address found. Put the phone and desktop on the same network.',
    ar: 'لم يُعثر على عنوان شبكة — اربط الهاتف والحاسوب بالشبكة نفسها.',
  },
  LAN_HOST_NOT_FOUND: {
    en: 'The manual LAN IP is not on this machine. Fix it in Settings → SADEEM Remote.',
    ar: 'عنوان IP اليدوي غير موجود على هذا الجهاز — صحّحه من الإعدادات ← سديم عن بُعد.',
  },
  LAN_UNREACHABLE: {
    en: 'The desktop cannot reach its own LAN address. Check the firewall and port in Settings.',
    ar: 'لا يستطيع الحاسوب الوصول إلى عنوانه على الشبكة — تحقق من الجدار الناري والمنفذ في الإعدادات.',
  },
};

export function remoteErrorText(code: string, ar = false): string {
  const entry = REMOTE_ERROR_TEXT[code as RemoteErrorCode];
  return entry ? (ar ? entry.ar : entry.en) : code;
}

/** Diagnostic state for a code (never mutates it). */
export function pairingState(code: string, now = Date.now()): PairingState {
  const key = String(code ?? '');
  const ch = pairingChallenges.get(key);
  if (!ch) return consumedPairingCodes.has(key) ? 'used' : 'unknown';
  if (ch.used) return 'used';
  if (now >= ch.expiresAt) return 'expired';
  return 'valid';
}

export interface PairingRedeemInput {
  code: string;
  /** Account fingerprint presented by the phone; must match the local OS account. */
  account: string;
  name?: string;
  platform?: string;
}
export interface PairingRedeemResult {
  ok: boolean;
  token?: string;
  deviceId?: string;
  error?: string;
  status: number;
}

/**
 * Exchange a deep-link code for the persistent token. The code is consumed
 * exactly once, must be unexpired, and must carry the LOCAL account fingerprint
 * — a copied link from another machine/account is refused. Redemption also
 * REGISTERS the device, so later mutations can be sender-checked.
 */
export function redeemPairingChallenge(input: PairingRedeemInput, now = Date.now()): PairingRedeemResult {
  const code = String(input?.code ?? '');
  // v11.36 — malformed input is its OWN actionable error. A truncated fragment
  // (common with QR scanners that mangle long URLs) is no longer reported as
  // the same "unknown code" as a replayed/expired link.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) {
    return { ok: false, error: 'PAIRING_CODE_MALFORMED', status: 400 };
  }
  if (consumedPairingCodes.has(code)) return { ok: false, error: 'PAIRING_CODE_ALREADY_USED', status: 403 };
  const ch = pairingChallenges.get(code);
  if (!ch) return { ok: false, error: 'INVALID_PAIRING_CODE', status: 400 };
  if (ch.used) return { ok: false, error: 'PAIRING_CODE_ALREADY_USED', status: 403 };
  if (now >= ch.expiresAt) {
    pairingChallenges.delete(code);
    return { ok: false, error: 'PAIRING_CODE_EXPIRED', status: 403 };
  }
  const account = String(input?.account ?? '');
  if (account !== ch.account || ch.account !== localAccountFingerprint()) {
    // Guard is against a link replayed under a DIFFERENT local account.
    console.warn('[sadeem-remote] pairing rejected — local account mismatch');
    return { ok: false, error: 'LOCAL_ACCOUNT_MISMATCH', status: 403 };
  }
  // Consume BEFORE registering: even a registration failure cannot be retried
  // with the same deep link (no silent second use).
  ch.used = true;
  pairingChallenges.delete(code);
  consumedPairingCodes.add(code);
  if (consumedPairingCodes.size > PAIRING_CODE_CAP) {
    const oldest = consumedPairingCodes.values().next().value;
    if (oldest) consumedPairingCodes.delete(oldest);
  }
  if (currentPairingCode === code) currentPairingCode = null;
  try {
    const device = registerDevice({
      name: String(input?.name ?? 'Paired phone'),
      platform: input?.platform,
      account: ch.account,
    });
    return { ok: true, token: cfg().token, deviceId: device.id, status: 200 };
  } catch (err) {
    console.warn('[sadeem-remote] device registration failed:', msgOf(err));
    return { ok: false, error: 'DEVICE_REGISTRATION_FAILED', status: 500 };
  }
}

/**
 * Sender check for state-changing phone requests: the token alone is not
 * enough — the caller must present a device id registered at pairing time.
 */
export function verifyRemoteSender(deviceId: unknown, account?: unknown): boolean {
  const reason = senderFailureReason(deviceId, account);
  if (reason) console.warn(`[sadeem-remote] sender rejected: ${reason}`);
  return reason === null;
}

/**
 * v11.36 — same guard as `verifyRemoteSender`, but returns WHICH check failed
 * so the HTTP layer can answer with a distinct actionable error instead of a
 * single opaque 403. Security is unchanged: every path below fails closed.
 */
export function senderFailureReason(deviceId: unknown, account?: unknown): RemoteErrorCode | null {
  if (typeof deviceId !== 'string' || !deviceId.trim()) return 'MISSING_DEVICE_HEADER';
  if (!isDeviceRegistered(deviceId)) return 'DEVICE_NOT_REGISTERED';
  if (typeof account === 'string' && account && account !== localAccountFingerprint()) return 'ACCOUNT_MISMATCH';
  try {
    if (!touchDevice(String(deviceId))) return 'DEVICE_NOT_REGISTERED';
  } catch (err) {
    console.warn('[sadeem-remote] device last-seen update failed:', msgOf(err));
    return 'DEVICE_TOUCH_FAILED';
  }
  return null;
}

// ---------- desktop agent mirror (register.ts feeds these) ----------

interface PhoneMsg {
  role: 'user' | 'assistant' | 'tool';
  kind?: string;
  toolName?: string;
  toolCallId?: string;
  text: string;
  thinking?: boolean;
  ok?: boolean;
  at: number;
}

let desktopRunning = false;
let lastDesktopEventAt = 0;
let pendingApproval: { requestId: string; title: string; kind: string; preview?: string } | null = null;
const desktopMessages: PhoneMsg[] = [];
let desktopUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
let desktopTodos: { text: string; status: string }[] = [];
// v11.7 — the DESKTOP session the phone is mirroring (set by register.ts at
// every run start; title + workspace come from the persisted session record).
let activeSessionTitle = '';
let activeSessionId = '';
let activeWorkspace = '';

/** register.ts calls this on every desktop run start. */
export function remoteSetActiveSession(id: string, title: string, workspace: string): void {
  activeSessionId = id;
  activeSessionTitle = title;
  activeWorkspace = workspace;
  broadcast({ t: 'state' });
}

/**
 * Mirror the DESKTOP agent's event stream into the phone feed. register.ts
 * calls this with every agent event it renders in the app — the phone sees
 * EXACTLY what the desktop shows, live. Nothing is invented here.
 */
export function remoteBroadcast(event: AgentEvent): void {
  try {
    lastDesktopEventAt = Date.now();
    const push = (m: PhoneMsg): void => {
      desktopMessages.push(m);
      if (desktopMessages.length > 300) desktopMessages.splice(0, desktopMessages.length - 300);
    };
    switch (event.type) {
      case 'text_delta': {
        const last = desktopMessages[desktopMessages.length - 1];
        if (last && last.role === 'assistant' && !last.kind) last.text += event.text;
        else push({ role: 'assistant', text: event.text, at: Date.now() });
        desktopRunning = true;
        break;
      }
      case 'think_delta': {
        const last = desktopMessages[desktopMessages.length - 1];
        if (last && last.role === 'assistant' && last.thinking) last.text += event.text;
        else push({ role: 'assistant', text: event.text, thinking: true, at: Date.now() });
        desktopRunning = true;
        break;
      }
      case 'tool_start':
        push({
          role: 'tool',
          kind: 'tool_call',
          toolName: event.name,
          toolCallId: event.toolCallId,
          text: typeof event.args === 'string' ? event.args : JSON.stringify(event.args ?? {}),
          at: Date.now(),
        });
        desktopRunning = true;
        break;
      case 'tool_result':
        push({
          role: 'tool',
          kind: 'tool_result',
          toolCallId: event.toolCallId,
          text: String(event.output ?? ''),
          ok: event.ok,
          at: Date.now(),
        });
        break;
      case 'sys_notice':
        push({ role: 'assistant', kind: 'notice', text: event.text, at: Date.now() });
        desktopRunning = true;
        break;
      case 'approval_request':
        pendingApproval = {
          requestId: event.requestId,
          title: event.title ?? 'Approval needed',
          kind: event.kind ?? 'command',
          // approval_request events carry an optional preview string outside
          // the narrowed shared union — read it defensively.
          preview: typeof (event as { preview?: unknown }).preview === 'string' ? String((event as { preview?: unknown }).preview).slice(0, 600) : undefined,
        };
        desktopRunning = true;
        break;
      case 'todo': {
        const items = (event as { todos?: { text?: string; status?: string }[] }).todos ?? [];
        desktopTodos = items.map((t) => ({ text: String(t.text ?? ''), status: String(t.status ?? '') }));
        desktopRunning = true;
        break;
      }
      case 'message_end': {
        const u = (event as { usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number } }).usage;
        if (u) {
          desktopUsage = {
            inputTokens: desktopUsage.inputTokens + (u.inputTokens ?? 0),
            outputTokens: desktopUsage.outputTokens + (u.outputTokens ?? 0),
            costUsd: desktopUsage.costUsd + (u.costUsd ?? 0),
          };
        }
        break;
      }
      case 'turn_end':
      case 'error':
      case 'aborted':
        desktopRunning = false;
        pendingApproval = event.type === 'turn_end' ? pendingApproval : pendingApproval;
        if (event.type === 'turn_end') pendingApproval = null;
        push({
          role: 'assistant',
          kind: event.type === 'error' ? 'error' : 'state',
          text: event.type === 'error' ? String((event as { message?: string }).message ?? 'error') : '',
          at: Date.now(),
        });
        break;
      default:
        break;
    }
    broadcast({ t: 'event', event: compactEvent(event) });
  } catch {
    /* the mirror must never break the desktop run */
  }
}

function compactEvent(e: AgentEvent): Record<string, unknown> {
  // phone feed keeps the shape tiny: type + the fields it renders
  const base = { type: e.type, at: Date.now() } as Record<string, unknown>;
  if (e.type === 'text_delta' || e.type === 'think_delta') base.text = e.text;
  if (e.type === 'tool_start') {
    base.name = e.name;
    base.toolCallId = e.toolCallId;
  }
  if (e.type === 'tool_result') {
    base.toolCallId = e.toolCallId;
    base.ok = e.ok;
    base.output = String(e.output ?? '').slice(0, 600);
  }
  if (e.type === 'approval_request') {
    base.requestId = e.requestId;
    base.title = e.title;
    base.kind = e.kind;
  }
  return base;
}

/** A pending desktop approval was just resolved on the desktop — clear it. */
export function remoteClearApproval(requestId: string): void {
  if (pendingApproval?.requestId === requestId) {
    pendingApproval = null;
    broadcast({ t: 'state' });
  }
}

// ---------- helpers ----------

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mask(v: string): string {
  return v ? `${v.slice(0, 4)}…` : '';
}

/**
 * Rebound-host defense for the LAN server: only loopback or one of THIS
 * machine's own LAN addresses, on the configured port, is accepted. An
 * attacker domain resolving to 127.0.0.1 cannot drive the phone endpoints.
 */
function remoteHostAllowed(host: string | undefined): boolean {
  if (typeof host !== 'string' || !host) return false;
  const h = host.trim().toLowerCase();
  const idx = h.lastIndexOf(':');
  const name = (idx > 0 ? h.slice(0, idx) : h).replace(/^\[|\]$/g, '');
  if ((idx > 0 ? h.slice(idx + 1) : '') !== String(cfg().port)) return false;
  if (name === '127.0.0.1' || name === 'localhost' || name === '::1') return true;
  // v11.36 — a pinned LAN IP narrows the rebinding allow-list to that IP.
  const override = normalizeHostOverride(cfg().host);
  if (override) return name === override.toLowerCase();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (String(i.address).toLowerCase() === name) return true;
    }
  }
  return false;
}

function cfg(): RemoteCfg {
  if (cfgCache) return cfgCache;
  const s = getSettings();
  const r = s.remote ?? {};
  let token = typeof r.token === 'string' && r.token.length >= 20 ? r.token : '';
  if (!token) {
    token = randomBytes(TOKEN_BYTES).toString('base64url');
    try {
      saveSettings({ ...s, remote: { ...(r ?? {}), token } });
    } catch (err) {
      console.log('[sadeem-remote] token persist failed:', msgOf(err));
    }
  }
  cfgCache = {
    enabled: r.enabled === true,
    port: clampPort(r.port),
    token,
    host: normalizeHostOverride(r.host),
  };
  return cfgCache;
}

function clampPort(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_PORT;
  return Math.min(MAX_PORT, Math.max(MIN_PORT, n));
}

function tokenOk(provided: string): boolean {
  const expected = cfg().token;
  if (!expected || !provided) return false;
  try {
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function authed(req: IncomingMessage, url: URL): boolean {
  const h = req.headers.authorization;
  if (typeof h === 'string' && /^bearer\s+/i.test(h) && tokenOk(h.replace(/^bearer\s+/i, '').trim())) return true;
  const t = url.searchParams.get('t');
  return typeof t === 'string' && tokenOk(t);
}

// ---------- v11.36 — LAN address selection (THE phone-connectivity fix) ----------

export interface LanCandidate {
  address: string;
  iface: string;
  kind: 'wifi' | 'wired' | 'other' | 'virtual';
  /** False for host-only/bridge adapters a phone cannot route to. */
  usable: boolean;
}

/** Classify an adapter by NAME. Virtual NICs are not phone-reachable routes. */
function adapterKind(name: string): LanCandidate['kind'] {
  const n = name.toLowerCase();
  if (/wi-?fi|wlan|wireless|802\.11/.test(n)) return 'wifi';
  if (/vethernet|docker|wsl|hyper-?v|vmware|virtualbox|vbox|tap\b|tun\b|vpn|wireguard|tailscale|zerotier|loopback/.test(n)) return 'virtual';
  if (/ethernet|\blan\b|enp[0-9]|eno[0-9]|^eth[0-9]/.test(n)) return 'wired';
  return 'other';
}

/** Well-known host-only / bridge ranges. "Ethernet 2" on VirtualBox used to
 *  win the old prefix-only sort (192.168.56.* ties with real Wi-Fi 192.168.1.*)
 *  and the QR pointed at an address the phone has no route to. */
const VIRTUAL_RANGES = [
  /^192\.168\.56\./, // VirtualBox host-only
  /^192\.168\.99\./, // Vagrant / Docker Machine
  /^172\.1[7-9]\./, // Docker / Hyper-V defaults
  /^172\.2[0-9]\./,
  /^172\.3[01]\./,
];

function isVirtualRange(address: string): boolean {
  return VIRTUAL_RANGES.some((re) => re.test(address));
}

/** All non-internal IPv4 addresses with a phone-reachability hint. */
export function listLanCandidates(): LanCandidate[] {
  const out: LanCandidate[] = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      // Node >=18 uses 'IPv4'; older runtimes used 4. Accept both.
      if (!(i.family === 'IPv4' || (i.family as unknown as number) === 4)) continue;
      if (i.internal || i.address === '127.0.0.1') continue;
      const kind = adapterKind(iface);
      out.push({
        address: i.address,
        iface,
        kind,
        usable: kind !== 'virtual' && !isVirtualRange(i.address),
      });
    }
  }
  return out;
}

function candidateScore(c: LanCandidate): number {
  const kindRank = c.kind === 'wifi' ? 0 : c.kind === 'wired' ? 10 : c.kind === 'other' ? 20 : 30;
  const rangeRank = c.address.startsWith('192.168.') ? 0 : c.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(c.address) ? 2 : 3;
  return kindRank + rangeRank + (isVirtualRange(c.address) ? 25 : 0);
}

function normalizeHostOverride(value: unknown): string {
  const h = String(value ?? '').trim();
  if (!h) return '';
  // Manual override must be a literal IPv4 — a hostname would fail the
  // rebinding guard and a URL would be nonsense in a data URL.
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(h) ? h : '';
}

/** Chosen LAN IP, or '' when nothing phone-reachable exists / override is bad. */
function selectedLanAddress(): string {
  const candidates = listLanCandidates();
  const override = normalizeHostOverride(cfg().host);
  if (override) {
    return candidates.some((c) => c.address === override) ? override : '';
  }
  const best = [...candidates].sort((a, b) => candidateScore(a) - candidateScore(b))[0];
  return best?.address ?? '';
}

/** Back-compat helper — NOW returns '' instead of a misleading 127.0.0.1. */
function lanAddress(): string {
  return selectedLanAddress();
}

export interface PairingUrl {
  url: string;
  code: string;
  expiresAt: number;
  account: string;
  host: string;
  /** False when no phone-reachable LAN address could be determined. */
  usable: boolean;
}

/**
 * The QR carries a one-use pairing CODE (never the persistent token), plus the
 * expiry and the local account fingerprint. v11.36 uses a real LAN IPv4 and a
 * version tag; the fragment stays first so existing scanners/parsers work.
 */
export function buildPairingUrl(now = Date.now()): PairingUrl {
  const c = cfg();
  const p = activePairing(now);
  const host = selectedLanAddress();
  // Never silently hand a phone a localhost URL. The '' host is surfaced as a
  // distinct NO_LAN_ADDRESS / LAN_HOST_NOT_FOUND error and the UI hides the QR.
  const h = host || '127.0.0.1';
  return {
    url: `http://${h}:${c.port}/#p=${p.code}&e=${p.expiresAt}&a=${p.account}&v=${PAIRING_VERSION}`,
    code: p.code,
    expiresAt: p.expiresAt,
    account: p.account,
    host: h,
    usable: !!host,
  };
}

function remoteUrl(now = Date.now()): string {
  return buildPairingUrl(now).url;
}

/** v11.36 — cheap cached TCP probe so "listening" really means phone-reachable. */
async function lanReachable(host: string, port: number): Promise<boolean> {
  if (!host || host === '127.0.0.1') return true;
  const now = Date.now();
  if (lanProbe && lanProbe.host === host && lanProbe.port === port && now - lanProbe.at < LAN_PROBE_CACHE_MS) {
    return lanProbe.ok;
  }
  const ok = await new Promise<boolean>((resolve) => {
    let settled = false;
    let sock: net.Socket | undefined;
    const finish = (v: boolean): void => {
      if (settled) return;
      settled = true;
      try { sock?.destroy(); } catch { /* gone */ }
      resolve(v);
    };
    try {
      sock = net.createConnection({ host, port });
    } catch {
      resolve(false);
      return;
    }
    sock.setTimeout(LAN_PROBE_MS, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
  lanProbe = { at: now, host, port, ok };
  return ok;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function broadcast(payload: Record<string, unknown>): void {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

// ---------- phone state payload ----------

function trimMsg(m: PhoneMsg): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: m.role,
    kind: m.kind ?? '',
    at: m.at,
    text: (m.thinking ? `[thinking] ${m.text}` : m.text).slice(0, MSG_TRIM),
  };
  if (m.toolName) out.toolName = m.toolName;
  if (m.ok === false) out.failed = true;
  return out;
}

function phoneState(): Record<string, unknown> {
  const s = getSettings();
  const idle = Date.now() - lastDesktopEventAt > DESKTOP_IDLE_MS;
  const running = desktopRunning && !idle;
  const msgs = desktopMessages.slice(-MAX_WS_MSGS).map(trimMsg);
  return {
    ok: true,
    app: 'SADEEM Remote',
    version: process.env.npm_package_version || '11.7.0',
    workspace: activeWorkspace || s.recentPaths?.[0] || '',
    sessionTitle: activeSessionTitle,
    running,
    pendingApproval,
    todos: desktopTodos,
    usage: desktopUsage,
    messages: msgs,
    model: s.model ? `${s.model.provider}/${s.model.model}` : '',
  };
}

// ---------- the phone web app (inline, zero requests, brand-true) ----------

const PAGE_CSS = `
:root{--bg:#000;--panel:#0b0b0b;--ink:#fff;--dim:#9d9d9d;--line:#1f1f1f;--acc:#a3e635;--bad:#f87171;--warn:#fbbf24}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);font-family:'Segoe UI',system-ui,-apple-system,'Noto Sans Arabic',sans-serif;font-size:15px;height:100%}
#app{display:flex;flex-direction:column;height:100dvh}
header{padding:12px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;flex-shrink:0}
header .dot{width:8px;height:8px;border-radius:50%;background:var(--dim)}
header .dot.on{background:var(--acc);animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
header .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
header .ws{color:var(--dim);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:34%}
#feed{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.row{border:1px solid var(--line);border-radius:12px;padding:10px 12px;max-width:92%;word-break:break-word;white-space:pre-wrap;line-height:1.55}
.row.user{align-self:flex-end;background:#161616;border-color:#2a2a2a}
.row.assistant{align-self:flex-start;background:var(--panel)}
.row.tool{align-self:stretch;max-width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--dim);border-style:dashed}
.row.tool.failed{color:var(--bad)}
.row .tag{display:inline-block;font-size:10px;letter-spacing:.08em;color:var(--acc);margin-bottom:4px;text-transform:uppercase}
.row .think{color:var(--dim);font-size:13px}
.row.notice{color:var(--dim);border-style:dashed;font-size:12px}
.row.error{border-color:var(--bad);color:var(--bad)}
.approval{border:1px solid var(--warn);border-radius:12px;padding:12px;background:#151005;flex-shrink:0;margin:0 14px 8px}
.approval h3{font-size:13px;color:var(--warn);margin-bottom:6px}
.approval pre{font-size:11px;color:var(--dim);white-space:pre-wrap;word-break:break-word;max-height:110px;overflow:auto;margin-bottom:10px}
.approval .btns{display:flex;gap:8px}
button{font:inherit;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:10px 14px;cursor:pointer}
button.acc{background:var(--acc);border-color:var(--acc);color:#000;font-weight:700}
button.bad{border-color:var(--bad);color:var(--bad)}
form{display:flex;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line);flex-shrink:0}
form input{flex:1;background:#111;border:1px solid var(--line);border-radius:12px;color:var(--ink);padding:12px;font:inherit;outline:none}
form input:focus{border-color:var(--acc)}
form button.send{background:var(--acc);border-color:var(--acc);color:#000;font-weight:700;min-width:64px}
form button.stop{color:var(--bad);border-color:var(--bad);min-width:44px}
.empty{color:var(--dim);text-align:center;margin:auto;font-size:13px}
`;

function pageHtml(): string {
  if (pageCache && Date.now() - pageCache.at < PAGE_CACHE) return pageCache.html;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000"><title>SADEEM Remote</title>
<style>${PAGE_CSS}</style></head><body><div id="app">
<header><span class="dot" id="dot"></span><span class="title" id="title">SADEEM</span><span class="ws" id="ws"></span><button class="stop" id="stop" title="Abort">■</button></header>
<div id="approval" style="display:none"></div>
<div id="feed"><div class="empty">Connecting…</div></div>
<form id="f"><input id="m" type="text" autocomplete="off" placeholder="Message SADEEM…" dir="auto"><button class="send" type="submit">▶</button></form>
</div><script>
/* v11.36 — the SAME error taxonomy as the main process, injected verbatim so
   the phone never shows a generic "pairing failed". */
const ERRTXT=${JSON.stringify(REMOTE_ERROR_TEXT)};
const AR=/^ar/i.test(navigator.language||'');
const L=(en,ar)=>AR?ar:en;
function errText(c,f){var e=ERRTXT[c];return e?(AR?e.ar:e.en):(f||c)}
const H=new URLSearchParams(location.hash.slice(1));
const P=H.get('p')||'',E=Number(H.get('e')||0),A=H.get('a')||'';
let T=localStorage.getItem('srT')||'',D=localStorage.getItem('srD')||'';
if(!T&&H.get('t'))T=H.get('t');
const $=id=>document.getElementById(id);
const feed=$('feed');let lastSize=0,pairError='',netFails=0;
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function row(m){
 const div=document.createElement('div');
 div.className='row '+m.role+(m.failed?' failed':'')+(m.kind==='notice'||m.kind==='state'?' notice':'')+(m.kind==='error'?' error':'');
 if(m.toolName)div.innerHTML='<span class="tag">'+esc(m.toolName)+'</span><br>';
 if(m.text&&m.text.startsWith('[thinking] '))div.innerHTML+='<span class="think">'+esc(m.text.slice(11))+'</span>';
 else div.appendChild(document.createTextNode((m.text||'').replace(/^\\[thinking\\] /,'')));
 return div;
}
function fail(msg){pairError=msg;feed.innerHTML='<div class="empty">'+esc(msg)+'</div>'}
function netFail(){if(++netFails>=3)fail(L('Cannot reach the desktop — same Wi-Fi/hotspot? Check the firewall and port.','تعذّر الوصول إلى الحاسوب — نفس شبكة الواي فاي؟ تحقق من الجدار الناري والمنفذ.'))}
async function api(path,opts){
  opts=opts||{};opts.headers=opts.headers||{};opts.headers['X-Sadeem-Device']=D;
  const sep=path.indexOf('?')>=0?'&':'?';
  return fetch(path+sep+'t='+encodeURIComponent(T),opts);
}
async function pair(){
  if(!P){if(!T||!D)fail(L('This link has no pairing code. Scan the fresh QR from Settings.','هذا الرابط بلا رمز اقتران — امسح رمز QR الجديد من الإعدادات.'));return;}
  try{
   const r=await fetch('/api/pair',{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({code:P,expiresAt:E,account:A,name:(navigator.userAgent||'phone').slice(0,80),platform:navigator.platform||'unknown'})});
   const j=await r.json();
   if(j.ok&&j.token&&j.deviceId){T=j.token;D=j.deviceId;localStorage.setItem('srT',T);localStorage.setItem('srD',D);pairError='';netFails=0;}
   else fail(errText(j.error,j.error||'unknown'));
  }catch(e){fail(L('Cannot reach the desktop — same Wi-Fi/hotspot? Check the firewall and port.','تعذّر الوصول إلى الحاسوب — نفس شبكة الواي فاي؟ تحقق من الجدار الناري والمنفذ.'))}
}
async function refresh(){
 if(!T||!D){if(!pairError)feed.innerHTML='<div class="empty">'+L('Waiting for pairing…','بانتظار الاقتران…')+'</div>';return;}
 try{
  const r=await api('/api/state');const s=await r.json();
  if(!s.ok){fail(errText(s.error,s.error||'unauthorized'));return;}
  netFails=0;
  $('dot').className='dot'+(s.running?' on':'');
  $('title').textContent=s.running?(s.sessionTitle||'Working…'):(s.sessionTitle||'SADEEM');
  $('ws').textContent=(s.workspace||'').split(/[\\\\/]/).pop()||'';
  $('stop').style.display=s.running?'':'none';
  if(JSON.stringify(s.messages).length!==lastSize){lastSize=JSON.stringify(s.messages).length;
   feed.innerHTML='';(s.messages||[]).forEach(m=>feed.appendChild(row(m)));
   if(!s.messages||!s.messages.length)feed.innerHTML='<div class="empty">'+(s.running?L('Working…','جارٍ العمل…'):L('Idle — send a task from your phone.','خامل — أرسل مهمة من هاتفك.'))+'</div>';
   feed.scrollTop=feed.scrollHeight;}
  const ap=$('approval');
  if(s.pendingApproval){ap.style.display='';ap.innerHTML='<div class="approval"><h3>'+esc(s.pendingApproval.title)+' — '+esc(s.pendingApproval.kind)+'</h3><pre>'+esc(s.pendingApproval.preview||'')+'</pre><div class="btns"><button class="acc" id="ayes">Approve once</button><button class="bad" id="ano">Deny</button></div></div>';
   $('ayes').onclick=()=>decide(s.pendingApproval.requestId,'once');$('ano').onclick=()=>decide(s.pendingApproval.requestId,'deny');}
  else ap.style.display='none';
 }catch(e){netFail()}
}
async function decide(id,action){await api('/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:id,decision:action})});refresh()}
$('f').onsubmit=async e=>{e.preventDefault();const v=$('m').value.trim();if(!v)return;$('m').value='';
 await api('/api/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:v})});refresh()};
$('stop').onclick=async()=>{await api('/api/abort',{method:'POST'});refresh()};
pair().then(refresh);setInterval(refresh,2000);refresh();
</script></body></html>`;
  pageCache = { at: Date.now(), html };
  return html;
}

// ---------- HTTP handlers ----------

async function handleSend(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, error: 'text is required' };
  const s = getSettings();
  const idle = Date.now() - lastDesktopEventAt > DESKTOP_IDLE_MS || !desktopRunning;
  if (activeSessionId && !idle) {
    // steer a LIVE desktop run — the message lands at the next tool boundary
    const n = enqueueUserMessage(activeSessionId, text);
    return { ok: true, queued: true, n };
  }
  // idle → start a REAL agent run via the apiServer pipeline (full events,
  // session persisted, approvals flow back to the phone).
  try {
    const started = apiStartRun(text, activeWorkspace || s.recentPaths?.[0]);
    desktopMessages.length = 0;
    desktopTodos = [];
    desktopRunning = true;
    activeSessionId = started.sessionId;
    activeSessionTitle = text.slice(0, 60);
    lastDesktopEventAt = Date.now();
    apiSubscribeRun(started.runId, (ev) => {
      remoteBroadcast(ev);
    });
    return { ok: true, started: true, runId: started.runId };
  } catch (err) {
    return { ok: false, error: msgOf(err) };
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://phone');
  const method = (req.method ?? 'GET').toUpperCase();
  // Every request — including the pairing page and exchange — must name our
  // own loopback/LAN endpoint. Prevents DNS rebinding against the phone API.
  if (!remoteHostAllowed(req.headers.host)) {
    sendJson(res, 403, { ok: false, error: 'FORBIDDEN_HOST', hint: remoteErrorText('FORBIDDEN_HOST') });
    return;
  }
  // No foreign-origin page may submit state-changing requests.
  const origin = req.headers.origin;
  if (method !== 'GET' && typeof origin === 'string') {
    let allowed = false;
    try {
      const u = new URL(origin);
      allowed = remoteHostAllowed(`${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      sendJson(res, 403, { ok: false, error: 'FORBIDDEN_ORIGIN', hint: remoteErrorText('FORBIDDEN_ORIGIN') });
      return;
    }
  }
  try {
    // pairing page — open auth (the token lives in the fragment, never sent)
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': `max-age=${Math.floor(PAGE_CACHE / 1000)}`,
        'referrer-policy': 'no-referrer',
      });
      res.end(pageHtml());
      return;
    }

    // Pairing exchange — intentionally OPEN, but gated by the one-use code,
    // its TTL and the local-account fingerprint. No bearer token required;
    // the code IS the credential, consumed on first successful redemption.
    if (method === 'POST' && url.pathname === '/api/pair') {
      const body = await readJson(req);
      const result = redeemPairingChallenge({
        code: typeof body.code === 'string' ? body.code : '',
        account: typeof body.account === 'string' ? body.account : '',
        name: typeof body.name === 'string' ? body.name : undefined,
        platform: typeof body.platform === 'string' ? body.platform : undefined,
      });
      // The token goes ONLY into a successful 200 body — never into a log or
      // an error response.
      sendJson(res, result.status, {
        ok: result.ok,
        ...(result.ok
          ? { token: result.token, deviceId: result.deviceId }
          : { error: result.error, hint: remoteErrorText(String(result.error ?? '')) }),
      });
      return;
    }

    if (!authed(req, url)) {
      sendJson(res, 401, { ok: false, error: 'BAD_PAIRING_TOKEN', hint: remoteErrorText('BAD_PAIRING_TOKEN') });
      return;
    }

    // v11.31 — SENDER CHECK for every state-changing route. A stolen token
    // alone cannot send/approve/abort: the paired DEVICE must be registered.
    // v11.36 — the exact failed check is returned as an actionable code.
    if (method !== 'GET') {
      const deviceId = req.headers['x-sadeem-device'] ?? url.searchParams.get('d');
      const account = req.headers['x-sadeem-account'];
      const reason = senderFailureReason(deviceId, typeof account === 'string' ? account : undefined);
      if (reason) {
        sendJson(res, 403, { ok: false, error: reason, hint: remoteErrorText(reason) });
        return;
      }
    }

    if (method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, phoneState());
      return;
    }
    if (method === 'GET' && url.pathname === '/api/sse') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ t: 'hello' })}\n\n`);
      clients.add(res);
      const drop = (): void => {
        clients.delete(res);
      };
      req.on('close', drop);
      res.on('close', drop);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/send') {
      const body = await readJson(req);
      sendJson(res, 200, await handleSend(body));
      return;
    }
    if (method === 'POST' && url.pathname === '/api/approve') {
      const body = await readJson(req);
      const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
      const raw = body.decision;
      // NO silent fallback: an unknown decision used to be coerced to "once"
      // (a typo could approve a dangerous operation). Refuse it outright.
      const allowed: ApprovalPolicyAction[] = ['once', 'always', 'deny'];
      if (!allowed.includes(raw as ApprovalPolicyAction)) {
        sendJson(res, 400, { ok: false, error: 'decision must be once, always or deny' });
        return;
      }
      if (!requestId) {
        sendJson(res, 400, { ok: false, error: 'requestId is required' });
        return;
      }
      const decision = raw as ApprovalPolicyAction;
      const d: PermissionDecision = {
        requestId,
        action: decision === 'once' ? 'allow' : decision === 'always' ? 'always' : 'deny',
      };
      const resolvedDesktop = desktopResolveDecision(d);
      const resolvedApi = apiResolveRunDecision(requestId, decision);
      if (!resolvedDesktop && !resolvedApi) {
        // Honest failure: the request was already resolved/expired, not a
        // silently accepted "approval" that changed nothing.
        sendJson(res, 409, { ok: false, error: 'approval request is no longer pending' });
        return;
      }
      if (pendingApproval?.requestId === requestId) pendingApproval = null;
      sendJson(res, 200, { ok: true, action: decision });
      broadcast({ t: 'state' });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/abort') {
      apiAbortRun(undefined);
      desktopAbort();
      sendJson(res, 200, { ok: true });
      broadcast({ t: 'state' });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/sessions') {
      const list = await sessions.list();
      sendJson(res, 200, {
        ok: true,
        sessions: list.slice(0, 30).map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt })),
      });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: msgOf(err) });
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8');
      if (data.length > 512 * 1024) {
        data = '';
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(data || '{}') as unknown;
        resolve(v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ---------- side channels (wired by register.ts / apiServerBridge) ----------

let desktopResolveDecision: (d: PermissionDecision) => boolean = () => false;
let desktopAbort: () => void = () => undefined;

/** register.ts installs the real resolvers here at startup. */
export function remoteSetDesktopBridge(
  resolve: (d: PermissionDecision) => boolean,
  abort: () => void,
): void {
  desktopResolveDecision = resolve;
  desktopAbort = abort;
}

// ---------- lifecycle ----------

export interface RemoteStatus {
  running: boolean;
  enabled: boolean;
  port: number;
  url?: string;
  tokenMasked: string;
  /** When the currently displayed one-use pairing link stops working. */
  pairingExpiresAt?: number;
  /** QR (data URL) of the full pairing URL — rendered on the Settings screen. */
  qrDataUrl?: string;
  /** The LAN IP actually embedded in the QR (never a silent 127.0.0.1). */
  lanAddress?: string;
  /** v11.36 — every detected IPv4 + whether a phone can route to it. */
  lanCandidates?: LanCandidate[];
  /** v11.36 — true only when the advertised LAN IP is self-connectable. */
  reachable?: boolean;
  /** v11.36 — machine-readable failure code (see REMOTE_ERROR_TEXT). */
  errorCode?: RemoteErrorCode;
  error?: string;
}

export async function remoteStatus(): Promise<RemoteStatus> {
  const c = cfg();
  const now = Date.now();
  const pairing = buildPairingUrl(now);
  const candidates = listLanCandidates();
  const override = normalizeHostOverride(c.host);
  let errorCode: RemoteErrorCode | undefined;
  let error: string | undefined = lastError;

  if (override && !candidates.some((x) => x.address === override)) {
    errorCode = 'LAN_HOST_NOT_FOUND';
    error = remoteErrorText(errorCode);
  } else if (!pairing.usable) {
    errorCode = 'NO_LAN_ADDRESS';
    error = remoteErrorText(errorCode);
  }

  let reachable = !!server;
  if (server && pairing.usable && !errorCode) {
    reachable = await lanReachable(pairing.host, c.port);
    if (!reachable) {
      errorCode = 'LAN_UNREACHABLE';
      error = remoteErrorText(errorCode);
    }
  }

  let qr: string | undefined;
  try {
    qr = await QRCode.toDataURL(pairing.url, {
      errorCorrectionLevel: QR_ECC,
      margin: QR_MARGIN,
      width: QR_WIDTH,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    qr = undefined;
  }

  return {
    running: !!server,
    enabled: c.enabled,
    port: c.port,
    ...(server ? { url: pairing.url, lanAddress: pairing.host } : {}),
    tokenMasked: mask(c.token),
    pairingExpiresAt: pairing.expiresAt,
    ...(qr ? { qrDataUrl: qr } : {}),
    lanCandidates: candidates,
    reachable,
    ...(errorCode ? { errorCode } : {}),
    ...(error ? { error } : {}),
  };
}

export async function remoteConfigure(patch: { enabled?: boolean; port?: number; host?: string }): Promise<RemoteStatus> {
  const prev = cfg();
  const nextPort = patch.port !== undefined ? clampPort(patch.port) : prev.port;
  const nextEnabled = patch.enabled !== undefined ? !!patch.enabled : prev.enabled;
  // v11.36 — optional manual LAN IP. Preserve every other remote field: the
  // old code wrote only {enabled,port,token} and silently dropped `host`.
  const nextHost = patch.host !== undefined ? normalizeHostOverride(patch.host) : prev.host;
  try {
    const s = getSettings();
    saveSettings({
      ...s,
      remote: { ...(s.remote ?? {}), enabled: nextEnabled, port: nextPort, host: nextHost, token: prev.token },
    });
  } catch (err) {
    // Fail CLOSED: never start (or keep running) a remote server whose config
    // was not persisted — the UI must not show a false "enabled" state.
    lastError = `settings persist failed: ${msgOf(err)}`;
    console.warn(`[sadeem-remote] ${lastError}`);
    return remoteStatus();
  }
  cfgCache = { enabled: nextEnabled, port: nextPort, token: prev.token, host: nextHost };
  lanProbe = null;
  const portChanged = prev.port !== nextPort;
  if (nextEnabled) {
    if (server && portChanged) await stopServer();
    if (!server) await startServer();
  } else {
    await stopServer();
  }
  return remoteStatus();
}

function startServer(): Promise<void> {
  if (server) return Promise.resolve();
  const c = cfg();
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      handle(req, res).catch(() => {
        try {
          sendJson(res, 500, { ok: false, error: 'internal' });
        } catch {
          /* socket gone */
        }
      });
    });
    srv.on('error', (err: NodeJS.ErrnoException) => {
      server = null;
      startedAt = undefined;
      lastError = err.code === 'EADDRINUSE' ? 'port in use — pick another in Settings' : err.message;
      console.log('[sadeem-remote] server error:', lastError);
      resolve();
    });
    srv.listen(c.port, '0.0.0.0', () => {
      server = srv;
      startedAt = Date.now();
      lastError = undefined;
      if (!heartbeat) heartbeat = setInterval(() => broadcast({ t: 'hb' }), SSE_HEARTBEAT_MS);
      console.log(
        `[sadeem-remote] listening on 0.0.0.0:${c.port} → QR host ${selectedLanAddress() || 'NONE (no phone-reachable LAN IP)'} (token ${mask(c.token)})`,
      );
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  const srv = server;
  if (!srv) return Promise.resolve();
  server = null;
  startedAt = undefined;
  lanProbe = null;
  for (const res of [...clients]) {
    try {
      res.end();
    } catch {
      /* gone */
    }
  }
  clients.clear();
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  return new Promise((resolve) => {
    try {
      srv.close(() => resolve());
      setTimeout(resolve, 400).unref();
    } catch {
      resolve();
    }
  });
}

/** Called at app whenReady — starts the server when the user enabled it. */
export function initRemoteServer(): void {
  try {
    app.on('will-quit', () => {
      void stopServer();
    });
  } catch {
    /* tests — ignore */
  }
  const c = cfg();
  if (c.enabled) void startServer();
  else console.log('[sadeem-remote] disabled');
}

// security posture note: the server binds 0.0.0.0 ONLY when explicitly enabled
// (a phone cannot reach a loopback bind). There is no tunnel, no cloud relay,
// no credential beyond the one-use pairing code + persistent token, and every
// mutating route still requires a V1131 registered device. `net` drives the
// LAN self-check that backs the honest `reachable` status field.
