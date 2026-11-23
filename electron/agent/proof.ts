// ============================================================
// Surnia v8.1 — PROOF PACKAGE: the re-runnable, SIGNED proof of a change.
//
// v8.1 SIGNING UPGRADE (the third-party problem, fixed):
//   v7.1 signed with HMAC-SHA256 using a LOCAL random key. Nobody but the
//   signer could verify a package — a reviewer running `surnia verify` on
//   another machine had no key, so the "signature" proved nothing to them.
//   Now the signature is Ed25519 (asymmetric):
//     • the PRIVATE key stays on the signing machine (userData, 0600);
//     • every package carries its own PUBLIC key + keyId, so ANYONE can
//       check integrity anywhere with no key material at all;
//     • authenticity is layered: the embedded key is compared against the
//       Surnia release key (shipped in resources/) and a user trust store
//       (~/.surnia/known_keys). An unknown key is reported HONESTLY as
//       "internally consistent, authenticity unverified" — never faked.
//   Legacy hmac-sha256 packages still verify when the old key is present.
//
//   • Tree fingerprints: sha256 of every touched file BEFORE and AFTER the
//     run (engine records the "before" hash at first touch).
//   • Full command ledger + test evidence + gate verdicts.
//   • `surnia verify <proof.json> [--rerun]` re-checks the signature, the
//     CURRENT fingerprints and (with --rerun) re-runs the test command.
//   • proofToMarkdown() renders a paste-ready PR comment.
//
// Verdict is computed, never asserted: gates vote, the worst vote wins.
// ============================================================
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { runCaptured } from '../services/terminalService';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type ProofVerdict = 'proven' | 'partial' | 'unproven' | 'failed' | 'aborted';

export interface ProofFileEntry {
  path: string; // workspace-relative, slash-normalized
  status: 'added' | 'modified' | 'unchanged' | 'deleted' | 'missing-at-verify';
  shaBefore: string | null;
  shaAfter: string | null;
  bytesAfter: number | null;
}

export interface ProofCommand {
  command: string;
  exitCode: number;
  durationMs?: number;
  outputTail?: string; // ≤ 400 chars
}

export interface ProofTestRun {
  phase: 'before' | 'after' | 'red' | 'green';
  command: string;
  exitCode: number;
  at: string; // ISO
}

export interface ProofMutation {
  ran: number;
  killed: number;
  killRate: number;
  verdict: string;
  survivors: Array<{ file: string; lineNo: number; op: string; before?: string; after?: string }>;
}

export interface ProofGates {
  redGreen: 'ok' | 'missing' | 'not-applicable';
  mutationGate: 'killed-enough' | 'survivors' | 'boundary-survivors' | 'strong-small' | 'weak' | 'no-mutations' | 'baseline-failed' | 'skipped' | 'not-run';
  fakeTests: 'clean' | 'findings' | 'not-run';
  regressions: 'none' | 'present' | 'unknown';
}

export type ProofSignature =
  | { alg: 'ed25519'; keyId: string; publicKey: string; sig: string }
  | { alg: 'hmac-sha256'; keyId: string; mac: string };

export interface ProofPackage {
  format: 'surnia-proof';
  version: 1 | 2;
  id: string;
  createdAt: string;
  durationMs: number;
  task: { kind: string; goal?: string; prompt: string };
  model: { provider: string; model: string };
  workspaceName: string;
  verdict: ProofVerdict;
  fingerprint: { algorithm: 'sha256'; files: ProofFileEntry[] };
  commands: ProofCommand[];
  tests: { runs: ProofTestRun[]; regressions: string[] } | null;
  mutation: ProofMutation | null;
  fakeTests: { scanned: number; high: number; findings: Array<{ file: string; line: number; rule: string; note: string }> } | null;
  claimAudit: { total: number; unsupported: number; claims: Array<{ claim: string; kind: string; supported: boolean }> } | null;
  critic: { findings: number; critical: number; summary: string } | null;
  gates: ProofGates;
  signature: ProofSignature | null;
}

export interface ProofInput {
  id?: string;
  createdAt?: string;
  durationMs: number;
  task: { kind: string; goal?: string; prompt: string };
  model: { provider: string; model: string };
  workspace: string;
  verdict: ProofVerdict;
  /** path → sha256 recorded at FIRST touch (before the agent edited it). */
  beforeHashes: Map<string, string | null>;
  /** Files the run touched (absolute paths). */
  touchedFiles: string[];
  commands: ProofCommand[];
  tests?: ProofPackage['tests'];
  mutation?: ProofMutation | null;
  fakeTests?: ProofPackage['fakeTests'];
  claimAudit?: ProofPackage['claimAudit'];
  critic?: ProofPackage['critic'];
  gates: ProofGates;
}

// ------------------------------------------------------------
// Hashing + canonical JSON
// ------------------------------------------------------------

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Stable JSON: sorted keys, no whitespace — the signature basis. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = walk((v as Record<string, unknown>)[k]);
    return o;
  };
  return JSON.stringify(walk(value));
}

async function hashFile(p: string): Promise<{ sha: string; bytes: number } | null> {
  try {
    const buf = await fs.readFile(p);
    return { sha: sha256(buf), bytes: buf.length };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Ed25519 signing key (userData/proof-ed25519.pem, 0600, first use)
// ------------------------------------------------------------

/** PEM of the Ed25519 private key (PKCS8). Created on first use (0600). */
export async function loadSigningKey(userDataDir: string): Promise<string> {
  const dir = path.resolve(userDataDir);
  const file = path.join(dir, 'proof-ed25519.pem');
  try {
    const pem = (await fs.readFile(file, 'utf8')).trim();
    if (pem.includes('BEGIN PRIVATE KEY')) {
      crypto.createPrivateKey(pem); // parse check — throws on corruption
      return pem;
    }
  } catch {
    /* first use */
  }
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString().trim();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, pem + '\n', { encoding: 'utf8', mode: 0o600 });
  return pem;
}

/** b64 SPKI DER public key for a private PEM — this is what packages carry. */
export function publicKeyB64Of(signingKeyPem: string): string {
  const pub = crypto.createPublicKey(signingKeyPem);
  return pub.export({ format: 'der', type: 'spki' }).toString('base64');
}

export function keyIdOf(publicKeyB64: string): string {
  return sha256(Buffer.from(publicKeyB64, 'base64')).slice(0, 12);
}

// ------------------------------------------------------------
// Trust anchors for AUTHENTICITY (integrity needs none of these)
//   1. $SURNUA_VERIFY_PUB   — b64 SPKI, or a path to a PEM/DER public key
//   2. ~/.surnia/known_keys — one b64 SPKI per line (user trust store)
//   3. resources/surnia-verify.pub — the Surnia release key shipped with
//      the app (packaged: process.resourcesPath; dev: <project>/resources)
// ------------------------------------------------------------

export async function findTrustedPublicKeys(): Promise<Array<{ b64: string; origin: string }>> {
  const out: Array<{ b64: string; origin: string }> = [];
  const pushPemOrB64 = (raw: string, origin: string): void => {
    try {
      const t = raw.trim();
      if (!t) return;
      if (t.includes('BEGIN PUBLIC KEY')) {
        const pub = crypto.createPublicKey(t);
        out.push({ b64: pub.export({ format: 'der', type: 'spki' }).toString('base64'), origin });
      } else if (/^[A-Za-z0-9+/=]+$/.test(t) && t.length > 40) {
        crypto.createPublicKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'spki' });
        out.push({ b64: t, origin });
      }
    } catch {
      /* not a valid key — skip, never guess */
    }
  };
  const env = process.env.SURNUA_VERIFY_PUB;
  if (env) {
    try {
      if (/^[A-Za-z0-9+/=]{40,}$/.test(env.trim())) pushPemOrB64(env, 'SURNUA_VERIFY_PUB');
      else pushPemOrB64(await fs.readFile(env, 'utf8'), 'SURNUA_VERIFY_PUB');
    } catch {
      /* skip */
    }
  }
  try {
    const known = path.join(os.homedir(), '.surnia', 'known_keys');
    const txt = await fs.readFile(known, 'utf8');
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) pushPemOrB64(t, '~/.surnia/known_keys');
    }
  } catch {
    /* no trust store yet */
  }
  const candidates = [
    process.env.SURNIA_RESOURCES,
    typeof (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath === 'string'
      ? path.join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'surnia-verify.pub')
      : '',
  ].filter(Boolean) as string[];
  try {
    // dev tree: <root>/resources/surnia-verify.pub (this file lives in <root>/dist-electron/electron/agent or dist-cli)
    candidates.push(path.resolve(__dirname, '..', '..', '..', 'resources', 'surnia-verify.pub'));
    candidates.push(path.resolve(__dirname, '..', 'resources', 'surnia-verify.pub'));
  } catch {
    /* __dirname unavailable — skip */
  }
  for (const c of candidates) {
    try {
      pushPemOrB64(await fs.readFile(c, 'utf8'), 'surnia release key');
      break; // first readable release key wins
    } catch {
      /* try next */
    }
  }
  return out;
}

// ------------------------------------------------------------
// Build + sign
// ------------------------------------------------------------

export async function buildProofPackage(input: ProofInput, signingKey: string): Promise<ProofPackage> {
  const ws = path.resolve(input.workspace);
  const files: ProofFileEntry[] = [];
  const rel = (p: string): string => path.relative(ws, p).split(path.sep).join('/');

  for (const abs of [...new Set(input.touchedFiles)].slice(0, 200)) {
    const before = input.beforeHashes.get(abs) ?? null;
    const after = await hashFile(abs);
    let status: ProofFileEntry['status'];
    if (!after) status = 'missing-at-verify';
    else if (before === null) status = 'added';
    else if (before !== after.sha) status = 'modified';
    else status = 'unchanged';
    files.push({ path: rel(abs), status, shaBefore: before, shaAfter: after?.sha ?? null, bytesAfter: after?.bytes ?? null });
  }

  const pkg: ProofPackage = {
    format: 'surnia-proof',
    version: 2,
    id: input.id ?? crypto.randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    task: { kind: input.task.kind, ...(input.task.goal ? { goal: input.task.goal.slice(0, 400) } : {}), prompt: input.task.prompt.slice(0, 400) },
    model: { provider: input.model.provider, model: input.model.model },
    workspaceName: path.basename(ws),
    verdict: input.verdict,
    fingerprint: { algorithm: 'sha256', files },
    commands: input.commands.slice(-60).map((c) => ({ ...c, command: c.command.slice(0, 400), outputTail: (c.outputTail ?? '').slice(0, 400) })),
    tests: input.tests ?? null,
    mutation: input.mutation ?? null,
    fakeTests: input.fakeTests ?? null,
    claimAudit: input.claimAudit ?? null,
    critic: input.critic ?? null,
    gates: input.gates,
    signature: null,
  };
  // v8.1 — Ed25519 over the canonical JSON with `signature: null`
  const payload = Buffer.from(canonicalJson(pkg), 'utf8');
  const pubB64 = publicKeyB64Of(signingKey);
  const priv = crypto.createPrivateKey(signingKey);
  const sig = crypto.sign(null, payload, priv);
  pkg.signature = {
    alg: 'ed25519',
    keyId: keyIdOf(pubB64),
    publicKey: pubB64,
    sig: sig.toString('base64'),
  };
  return pkg;
}

// ------------------------------------------------------------
// Verify (signature + current-tree fingerprints + optional rerun)
// ------------------------------------------------------------

export interface VerifyReport {
  signatureValid: boolean;
  /** v8.1 — where the signing key stands relative to trust anchors. */
  authenticity: 'release' | 'trusted' | 'embedded-only' | 'legacy-hmac' | 'unknown';
  keyId: string;
  filesChecked: number;
  filesMatching: number;
  drift: Array<{ path: string; expected: string | null; actual: string | null }>;
  rerun: { command: string; exitCode: number; matchesRecorded: boolean } | null;
  verdict: 'valid' | 'signature-invalid' | 'drifted' | 'rerun-mismatch' | 'invalid';
  detail: string;
}

export interface VerifyOptions {
  workspace?: string;
  rerunTestCommand?: string | null;
  rerunTimeoutMs?: number;
  /** Extra trusted public keys (b64 SPKI) beyond the automatic anchors. */
  trustedPublicKeys?: string[];
  /** Legacy hmac key for v1 packages. */
  legacyHmacKey?: string;
}

/**
 * Verify a proof package. v8.1: needs NO local secret — the package carries
 * its own Ed25519 public key. Authenticity is graded honestly:
 *   release        — embedded key == the shipped Surnia release key
 *   trusted        — embedded key is in the trust store / provided keys
 *   embedded-only  — signature internally consistent; key is not a known
 *                    anchor (self-hosted install). Reported, never hidden.
 */
export async function verifyProofPackage(
  pkg: ProofPackage,
  opts?: VerifyOptions,
): Promise<VerifyReport> {
  const base = (extra: Partial<VerifyReport>): VerifyReport => ({
    signatureValid: false,
    authenticity: 'unknown',
    keyId: pkg.signature?.keyId ?? '',
    filesChecked: 0,
    filesMatching: 0,
    drift: [],
    rerun: null,
    verdict: 'invalid',
    detail: '',
    ...extra,
  });

  // 1) signature — covers the package with `signature: null`
  let sigOk = false;
  let authenticity: VerifyReport['authenticity'] = 'unknown';
  try {
    const rest: Record<string, unknown> = { ...(pkg as unknown as Record<string, unknown>), signature: null };
    const payload = Buffer.from(canonicalJson(rest), 'utf8');
    const sig = pkg.signature;
    if (sig?.alg === 'ed25519' && typeof sig.publicKey === 'string' && typeof sig.sig === 'string') {
      const pub = crypto.createPublicKey({ key: Buffer.from(sig.publicKey, 'base64'), format: 'der', type: 'spki' });
      sigOk = crypto.verify(null, payload, pub, Buffer.from(sig.sig, 'base64'));
      if (sigOk) {
        // authenticity grading (only meaningful when the signature held)
        const anchors = await findTrustedPublicKeys();
        const trustedKeys = [...(opts?.trustedPublicKeys ?? []), ...anchors.map((t) => t.b64)];
        if (trustedKeys.includes(sig.publicKey)) {
          authenticity = anchors.some((t) => t.origin === 'surnia release key' && t.b64 === sig.publicKey) ? 'release' : 'trusted';
        } else {
          authenticity = 'embedded-only';
        }
      }
    } else if (sig?.alg === 'hmac-sha256' && typeof sig.mac === 'string' && opts?.legacyHmacKey) {
      const expected = crypto.createHmac('sha256', opts.legacyHmacKey).update(payload).digest('hex');
      const got = sig.mac;
      sigOk = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
      if (sigOk) authenticity = 'legacy-hmac';
    }
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return base({ verdict: 'signature-invalid', detail: 'SIGNATURE INVALID — the package was edited after signing, or its key/alg is not verifiable here (legacy hmac packages need --legacy-key).' });
  }

  // 2) current-tree fingerprints (only when a workspace is supplied)
  const ws = opts?.workspace ? path.resolve(opts.workspace) : null;
  let checked = 0;
  let matching = 0;
  const drift: VerifyReport['drift'] = [];
  if (ws) {
    for (const f of pkg.fingerprint.files) {
      const abs = path.join(ws, f.path);
      const cur = await hashFile(abs);
      if (f.status === 'deleted') continue;
      checked++;
      if (cur && f.shaAfter && cur.sha === f.shaAfter) matching++;
      else drift.push({ path: f.path, expected: f.shaAfter, actual: cur?.sha ?? null });
    }
  }

  // 3) optional clean rerun of the test command
  let rerun: VerifyReport['rerun'] = null;
  const cmd = (opts?.rerunTestCommand ?? '').trim();
  const greenRun = pkg.tests?.runs?.filter((r) => r.exitCode === 0).at(-1) ?? null;
  if (cmd && ws && greenRun) {
    try {
      const r = await runCaptured(cmd, ws, Math.max(5_000, opts?.rerunTimeoutMs ?? 120_000));
      rerun = { command: cmd, exitCode: r.exitCode, matchesRecorded: r.exitCode === 0 };
    } catch (err) {
      rerun = { command: cmd, exitCode: -1, matchesRecorded: false };
      void err;
    }
  }

  const authNote = authenticity === 'release'
    ? 'key = Surnia release key (authentic)'
    : authenticity === 'trusted'
      ? 'key = user-trusted key'
      : authenticity === 'legacy-hmac'
        ? 'legacy local HMAC key (authenticity is machine-local)'
        : `key ${pkg.signature?.keyId ?? '?'} is embedded in the package — internally consistent, NOT a known release key (self-hosted install)`;

  if (drift.length > 0) {
    return base({
      signatureValid: true, authenticity, filesChecked: checked, filesMatching: matching, drift, rerun,
      verdict: 'drifted',
      detail: `SIGNATURE VALID (${authNote}), TREE DRIFTED: ${drift.length}/${checked} file(s) no longer match the proof (${drift.slice(0, 4).map((d) => d.path).join(', ')}). The workspace moved on after the run.`,
    });
  }
  if (rerun && !rerun.matchesRecorded) {
    return base({
      signatureValid: true, authenticity, filesChecked: checked, filesMatching: matching, drift, rerun,
      verdict: 'rerun-mismatch',
      detail: `SIGNATURE VALID (${authNote}), RE-RUN FAILED: "${cmd}" exited ${rerun.exitCode} but the proof records a green run. The result is not reproducible.`,
    });
  }
  return {
    signatureValid: true, authenticity, keyId: pkg.signature?.keyId ?? '', filesChecked: checked, filesMatching: matching, drift, rerun, verdict: 'valid',
    detail:
      `PROOF VALID: Ed25519 signature OK (${authNote})` +
      `${checked ? `, ${matching}/${checked} fingerprints match the current tree` : ''}` +
      `${rerun ? `, re-run "${cmd}" exit ${rerun.exitCode} (matches record)` : ''}.`,
  };
}

// ------------------------------------------------------------
// Markdown renderer — the PR-comment shape
// ------------------------------------------------------------

export function proofToMarkdown(pkg: ProofPackage): string {
  const gates = pkg.gates;
  const emoji = (v: ProofVerdict): string => (v === 'proven' ? '✅' : v === 'partial' ? '🟡' : '❌');
  const lines: string[] = [];
  lines.push(`## ${emoji(pkg.verdict)} Surnia Proven Change — ${pkg.verdict.toUpperCase()}`);
  lines.push('');
  lines.push(`| Gate | Result |`);
  lines.push(`|---|---|`);
  lines.push(`| Red→green | ${gates.redGreen} |`);
  lines.push(`| Mutation gate (changed lines) | ${gates.mutationGate}${pkg.mutation ? ` — killed ${pkg.mutation.killed}/${pkg.mutation.ran} (${Math.round(pkg.mutation.killRate * 100)}%)` : ''} |`);
  lines.push(`| Fake-test detector | ${gates.fakeTests}${pkg.fakeTests ? ` — ${pkg.fakeTests.high} high-severity in ${pkg.fakeTests.scanned} file(s)` : ''} |`);
  lines.push(`| Regressions | ${gates.regressions} |`);
  lines.push(`| Claim audit | ${pkg.claimAudit ? `${pkg.claimAudit.total - pkg.claimAudit.unsupported}/${pkg.claimAudit.total} claims evidenced` : 'not-run'} |`);
  lines.push(`| Critic | ${pkg.critic ? `${pkg.critic.critical} critical / ${pkg.critic.findings} findings` : 'not-run'} |`);
  lines.push('');
  lines.push(`Signed: Ed25519 · key \`${pkg.signature?.keyId ?? '—'}\` · the public key travels INSIDE the package — anyone can verify with \`surnia verify\`.`);
  lines.push('');
  if (pkg.fingerprint.files.length) {
    lines.push(`<details><summary>Touched files (${pkg.fingerprint.files.length}) — sha256 before → after</summary>`);
    lines.push('');
    lines.push('| File | Status | sha256 after |');
    lines.push(`|---|---|---|`);
    for (const f of pkg.fingerprint.files.slice(0, 40)) lines.push(`| ${f.path} | ${f.status} | ${f.shaAfter ? f.shaAfter.slice(0, 12) + '…' : '—'} |`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (pkg.commands.length) {
    lines.push('<details><summary>Commands executed (with exit codes)</summary>');
    lines.push('');
    lines.push('```');
    for (const c of pkg.commands.slice(-20)) lines.push(`$ ${c.command}  →  exit ${c.exitCode}`);
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  lines.push(`Re-verify locally: \`surnia verify surnia-proof-${pkg.id.slice(0, 8)}.json --rerun\``);
  lines.push('');
  lines.push(`<sub>signed ed25519/${pkg.signature?.keyId ?? '—'} · ${pkg.model.provider}/${pkg.model.model} · ${new Date(pkg.createdAt).toISOString()}</sub>`);
  return lines.join('\n');
}

/** Default file name for a proof package on disk. */
export function proofFileName(pkg: ProofPackage): string {
  return `surnia-proof-${pkg.id.slice(0, 8)}.json`;
}

export async function saveProofPackage(pkg: ProofPackage, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, proofFileName(pkg));
  await fs.writeFile(file, JSON.stringify(pkg, null, 2), 'utf8');
  return file;
}
