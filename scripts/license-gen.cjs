#!/usr/bin/env node
// ============================================================
// SADEEM / KODex — offline license key generator (v11.33)
// ============================================================
// Mints HMAC-SHA256 signed keys in the exact format verified by
// electron/services/licenseService.ts::decodeKeyV2():
//
//   KDX-PLAN-EXPIP(5)-SIG1(4)-SIG2(3)
//     PLAN  ∈ {PRO, TEAM, OWNER, FOUNDER}
//     EXPIP = Crockford base32 of expiry epoch-DAYS (0 = perpetual)
//     SIG   = first 35 bits of HMAC-SHA256(secret, `${PLAN}|${days}|`),
//             rendered as 7 Crockford base32 chars, split 4 + 3.
//
// WHY THE LEGACY SECRET IS THE DEFAULT
// ------------------------------------
// The app also generates a per-device runtime secret (0600) in newer builds.
// That secret only verifies on the machine that generated it. A key handed to
// a customer MUST verify on ANY device, so this tool defaults to the
// documented legacy secret 'KODex-license-v1' that every build still accepts.
// That secret is PUBLIC / documented — it is NOT a real private credential.
// Use --secret to override it for a private deployment (and ship that same
// override in your verifier build).
//
// HONEST LIMITATION — PLEASE READ
// -------------------------------
// Offline keys are SELF-CONTAINED AND SHAREABLE. Anyone who holds a valid key
// can use it on any device; there is no activation server, no device binding
// and no revocation. Treat keys like cash: hand ONE to the customer after
// payment and do not post them in public channels, screenshots or support
// threads. The signature stops random guessing, not redistribution.
// ============================================================
'use strict';

const { createHmac } = require('crypto');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Documented, public legacy secret — accepted by every v2+ verifier. */
const LEGACY_SECRET = 'KODex-license-v1';
const MAX_EXPIRY_DAYS = 32 ** 5 - 1; // 5 base32 chars

function b32Encode(value, length) {
  const v = Math.max(0, Math.floor(value));
  let out = '';
  for (let i = length - 1; i >= 0; i--) {
    const digit = Math.floor(v / 32 ** i) % 32;
    out += CROCKFORD[digit];
  }
  return out;
}

/** First 35 bits of HMAC-SHA256, as 7 Crockford base32 chars. */
function signWithSecret(planUpper, expiryDays, secret) {
  const digest = createHmac('sha256', secret)
    .update(`${planUpper}|${expiryDays}|`, 'utf8')
    .digest();
  // 35 bits = 4 full bytes + the top 3 bits of byte 5.
  const bits =
    (digest[0] & 0xff) * 0x8000000 + // 2^27
    (digest[1] & 0xff) * 0x100000 + // 2^19
    (digest[2] & 0xff) * 0x2000 + // 2^11
    (digest[3] & 0xff) * 0x8 + // 2^3
    ((digest[4] & 0xff) >>> 5);
  return b32Encode(bits, 7);
}

function mintKey(planCode, expiryDays, secret) {
  const days = Math.max(0, Math.floor(expiryDays));
  const sig = signWithSecret(planCode, days, secret);
  return `KDX-${planCode}-${b32Encode(days, 5)}-${sig.slice(0, 4)}-${sig.slice(4)}`;
}

function parseArgs(argv) {
  const opts = { plan: 'pro', days: 0, count: 1, secret: LEGACY_SECRET, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--plan' || a === '--days' || a === '--count' || a === '--secret') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      if (a === '--plan') opts.plan = value;
      else if (a === '--secret') opts.secret = value;
      else {
        const n = Number(value);
        if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${a} must be a whole number`);
        if (a === '--days') opts.days = n;
        else opts.count = n;
      }
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}

const USAGE = `
Usage: node scripts/license-gen.cjs [options]

  --plan <pro|team|owner|founder>   Plan code (default: pro).
                                    owner/founder mint an OWNER/FOUNDER key
                                    that the app maps to the Pro entitlement
                                    with the honest label "Owner License
                                    (v11 series)".
  --days <n>                        Expiry in epoch-DAYS; 0 = perpetual
                                    (default: 0). Owner keys are perpetual.
  --count <n>                       How many keys to mint (default: 1).
  --secret <text>                   HMAC secret override. Default is the
                                    documented PUBLIC legacy secret
                                    'KODex-license-v1' so keys verify on any
                                    device. A private secret must be compiled
                                    into every verifier that should accept it.
  -h, --help                        Show this help.

Example:
  node scripts/license-gen.cjs --plan pro --days 0 --count 1
  node scripts/license-gen.cjs --plan owner --days 0 --count 1
`;

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  const planUpper = String(opts.plan).toUpperCase();
  const allowed = ['PRO', 'TEAM', 'OWNER', 'FOUNDER'];
  if (!allowed.includes(planUpper)) {
    process.stderr.write(`error: --plan must be one of ${allowed.join(', ')} (got ${opts.plan})\n`);
    process.exitCode = 2;
    return;
  }
  if (opts.days < 0 || opts.days > MAX_EXPIRY_DAYS) {
    process.stderr.write(`error: --days must be 0..${MAX_EXPIRY_DAYS}\n`);
    process.exitCode = 2;
    return;
  }
  if (opts.count < 1 || opts.count > 1000) {
    process.stderr.write('error: --count must be 1..1000\n');
    process.exitCode = 2;
    return;
  }
  if (!opts.secret) {
    process.stderr.write('error: --secret cannot be empty\n');
    process.exitCode = 2;
    return;
  }

  // Keys go to stdout (one per line) so they can be piped into a file.
  const keys = [];
  for (let i = 0; i < opts.count; i++) keys.push(mintKey(planUpper, opts.days, opts.secret));
  process.stdout.write(keys.join('\n') + '\n');

  // Instructions go to stderr so stdout stays pipe-clean.
  const isOwner = planUpper === 'OWNER' || planUpper === 'FOUNDER';
  const scope =
    'The Owner License covers the whole v11 series (v11 and every v11.x) and includes a 50% discount on the next major. It is NOT "all future versions free forever" and is NOT a monthly subscription.';
  const note = isOwner
    ? `This key IS an Owner License. ${scope}`
    : `This key is a Pro/Team key (${opts.days === 0 ? 'perpetual' : `${opts.days}-day`}, no monthly charge). ${scope}`;
  process.stderr.write(`
--- How to hand this key to a customer (after payment) ---
1. Confirm payment FIRST, then send exactly ONE key to that customer via a
   private channel (email / DM). Do not paste keys in public.
2. Customer opens Settings -> Account & Data -> "Plan & license", pastes the
   key into "License key" and clicks "Redeem key". Verification is OFFLINE.
3. The app stores the verified key and state with file mode 0600 and shows the
   honest entitlement. No server, no account, no credit card.
${note}
Bring-your-own-keys (BYOK) usage stays free forever. No monthly plan, no
prepaid credits. While the public free season is on, everything is open to
everyone; when it ends, BYOK is capped at 50 runs/day and the Owner License
lifts that cap.

OFFLINE + SHAREABLE (be honest about this): the key is self-contained HMAC.
Anyone who obtains it can use it on any device. There is no device binding,
activation server or revocation — treat it like cash, not like a password.
The signature prevents guessing, NOT redistribution.
`);
}

main();
