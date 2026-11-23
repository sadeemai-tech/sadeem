// ============================================================
// v1131 — SETTINGS UI AUDIT REGRESSION SUITE
// ============================================================
// Every control owned by src/components/settings/ must be:
//   1. WIRED   — a real onClick/onChange to a real store action / IPC
//   2. HONEST  — correct default, no fake capability, no stale copy
//   3. BILINGUAL — EN + AR labels/help/aria, no mixed language
//   4. CURRENT — live feed / contact, no dead domains or stale prices
//
// This suite is intentionally source-level: it never renders React (no DOM),
// but it bundles the real bilingual registry so search behaviour is exercised
// for real. Run:
//   node --test --test-force-exit tests/v1131-ui-settings.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const SET = join(ROOT, 'src', 'components', 'settings');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-settings-'));
const src = (f) => readFileSync(join(SET, f), 'utf8');
const tsx = readdirSync(SET).filter((f) => f.endsWith('.tsx'));

// ------------------------------------------------------------
// 1 · UPDATE FEED — live Vercel URL, no dead domain anywhere
// ------------------------------------------------------------
const LIVE = 'https://sadeem-ai.com/updates/'; // v11.40 — official domain; preview retired
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('v1131: Updates placeholder, hint and validation copy use the LIVE feed (not sadeem.app)', () => {
  const updates = src('UpdatesSection.tsx');
  assert.match(updates, new RegExp(`const LIVE_UPDATE_FEED = '${esc(LIVE)}'`));
  assert.match(updates, /placeholder=\{LIVE_UPDATE_FEED\}/, 'input placeholder is the real feed');
  assert.match(updates, /set\.updates\.feed\.hint\.v1131/, 'honest hint uses the fresh bilingual key');
  assert.match(updates, /\$\{LIVE_UPDATE_FEED\}/, 'hint surfaces the effective official URL');
  assert.doesNotMatch(updates, /sadeem\.app/, 'undeployed host is gone from this pane');
  assert.doesNotMatch(updates, /surnia\.app/, 'legacy host is gone from this pane');
  // AR copy is present alongside the EN copy (no mixed/English-only validation).
  assert.match(updates, /leave empty for the official update feed/);
  assert.match(updates, /اترك الحقل فارغاً لخلاصة التحديثات الرسمية/);
});

test('v1131: renderer feed mirrors the main-process LIVE_UPDATE_FEED exactly', () => {
  const main = readFileSync(join(ROOT, 'electron', 'services', 'updateService.ts'), 'utf8');
  const site = readFileSync(join(ROOT, 'website', 'lib', 'site.ts'), 'utf8');
  assert.match(main, new RegExp(`LIVE_UPDATE_FEED = '${esc(LIVE)}'`));
  assert.match(site, new RegExp(`updateFeed: '${esc(LIVE)}'`));
  const updates = src('UpdatesSection.tsx');
  assert.ok(updates.includes(LIVE), 'renderer constant matches both sources of truth');
});

test('v1131: no dead/legacy domain survives in ANY owned settings file', () => {
  for (const f of [...tsx, 'registry.ts']) {
    const body = readFileSync(join(SET, f), 'utf8');
    assert.doesNotMatch(body, /https?:\/\/sadeem\.app/, `${f}: undeployed host`);
    assert.doesNotMatch(body, /surnia\.app/, `${f}: legacy host`);
  }
  const feedback = src('FeedbackSection.tsx');
  assert.match(feedback, /const TEAM_CONTACT = 'support@sadeem\.app'/, 'canonical support address');
  assert.doesNotMatch(feedback, /replace before launch/, 'not a placeholder comment any more');
});

// ------------------------------------------------------------
// 2 · BILLING — honest free-season, no monthly UI / stale prices
// ------------------------------------------------------------
test('v1131: Billing has no monthly plan, checkout, coupon or Stripe key field', () => {
  const billing = src('BillingSection.tsx');
  assert.match(billing, /<FreeSeasonStatement \/>/, 'the one honest statement is rendered');
  assert.match(billing, /licenses\.example\.com\/verify/, 'neutral, current placeholder');
  // Only the rendered surface matters — the file header explains WHY the
  // monthly UI was removed, so strip comments before the negative checks.
  const rendered = billing
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(rendered, /placeholder=\{t\('settings\.billing\.stripe'/, 'no Stripe link box');
  assert.doesNotMatch(rendered, /\$\d+\s*\/\s*mo|per month|monthly subscription/i, 'no monthly price copy');
  assert.doesNotMatch(rendered, /licenseEndpoint.*surnia/, 'no legacy endpoint placeholder');
});

// ------------------------------------------------------------
// 3 · FAILOVER — default OFF, advertised honestly
// ------------------------------------------------------------
test('v1131: Agent defaults pin failover OFF and no settings control opts in', () => {
  const agent = src('AgentSection.tsx');
  assert.match(agent, /allowModelFailover:\s*false/, 'renderer reset/patch default is literal false');
  for (const f of tsx) {
    const body = src(f);
    assert.doesNotMatch(body, /allowModelFailover:\s*true/, `${f}: must never default ON in UI`);
  }
  assert.match(agent, /settings\.agent\.failover\.honest\.v1131/, 'honest OFF-by-default note is rendered');
  assert.match(agent, /automatic provider failover is OFF by default/i, 'EN statement is honest');
  assert.match(agent, /التبديل التلقائي بين المزوّدين مُعطَّل افتراضياً/, 'AR statement is honest');
});

// ------------------------------------------------------------
// 4 · NO STALE COPY — dynamic counts, current stack, real commands
// ------------------------------------------------------------
test('v1131: tool count, tech stack and preview commands cannot go stale', () => {
  const agent = src('AgentSection.tsx');
  assert.match(agent, /all \$\{toolInventory\.total\} tools/, 'count is derived from generated inventory');
  assert.doesNotMatch(agent, /134 tools/, 'stale count is gone');
  const adv = src('AdvancedSection.tsx');
  assert.match(adv, /const TECH_STACK = \['Electron', 'React', 'TypeScript'/, 'version-free stack');
  assert.doesNotMatch(adv, /Electron 33/, 'stale Electron version is gone');
  assert.doesNotMatch(agent, /Model router \(v7\)/, 'version tag removed from the router card');
  assert.doesNotMatch(adv, /claude-sonnet-4-5/, 'reset uses the canonical 5.5 default');
  assert.match(adv, /claude-sonnet-5\.5/, 'canonical default model');
  for (const f of ['AppearanceSection.tsx', 'TerminalSection.tsx']) {
    const body = src(f);
    assert.doesNotMatch(body, /kdx verify|kd run --watch/, `${f}: legacy CLI command gone`);
  }
});

// ------------------------------------------------------------
// 5 · BILINGUAL — no English-only control internals
// ------------------------------------------------------------
test('v1131: reusable controls localize their accessible names', () => {
  const c = src('controls.tsx');
  assert.match(c, /set\.ctl\.decrease\.v1131/, 'decrease has a fresh bilingual key');
  assert.match(c, /set\.ctl\.increase\.v1131/, 'increase has a fresh bilingual key');
  assert.match(c, /set\.ctl\.value\.v1131/, 'fallback value label has a fresh bilingual key');
  assert.match(c, /إنقاص/, 'AR decrease');
  assert.match(c, /زيادة/, 'AR increase');
  assert.doesNotMatch(c, /`decrease \$\{label\}`|`increase \$\{label\}`|aria-label=\{label \?\? 'value'\}/);
});

test('v1131: every registry entry is bilingual and uniquely identified', () => {
  const out = join(tmp, 'registry.cjs');
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, join(SET, 'registry.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`],
    { cwd: ROOT, stdio: 'pipe' },
  );
  const reg = require(out);
  const all = [
    ...reg.SETTINGS_REGISTRY,
    ...reg.V5_ENTRIES,
    ...reg.V6_ENTRIES,
    ...reg.V102_ENTRIES,
    ...reg.V103_ENTRIES,
    ...reg.V114_ENTRIES,
    ...reg.V1110_ENTRIES,
    ...reg.V1131_ENTRIES,
  ];
  const ids = all.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate setting ids');
  for (const e of all) {
    assert.ok(e.en && e.ar, `${e.id} has EN + AR`);
    assert.ok(!/[\u0600-\u06ff]/.test(e.en), `${e.id} EN label has no Arabic script`);
    assert.ok(/[\u0600-\u06ff]/.test(e.ar), `${e.id} AR label has Arabic script`);
  }
  // Search-only regression: the two previously invisible panes now resolve.
  assert.ok(reg.searchSettings('updates').some((e) => e.section === 'updates'));
  assert.ok(reg.searchSettings('remote').some((e) => e.section === 'remote'));
  assert.ok(reg.searchSettings('failover').some((e) => e.id === 'agent.failover'));
  // Stale entries must no longer be findable from Settings search.
  assert.equal(reg.searchSettings('12/mo').length, 0, 'stale $12/mo plan is not searchable');
  assert.equal(reg.searchSettings('Stripe secret').length, 0, 'removed Stripe key is not searchable');
  assert.equal(reg.searchSettings('accent tint').length, 0, 'removed accent control is not searchable');
});

// ------------------------------------------------------------
// 6 · WIRED — every control has a real handler
// ------------------------------------------------------------
test('v1131: all interactive controls in owned sections have a handler', () => {
  const simple = ['Toggle', 'Btn', 'button', 'input', 'select', 'textarea', 'IconBtn'];
  const windowed = ['Segmented', 'Slider', 'NumberInput', 'TextRow'];
  for (const f of tsx) {
    const body = src(f);
    for (const tag of simple) {
      const re = new RegExp(`<${tag}\\b([\\s\\S]*?)>`, 'g');
      for (const m of body.matchAll(re)) {
        assert.match(
          m[1],
          /\b(onClick|onChange|onFocus|onBlur|onKeyDown|onInput|onLoad)\s*=/,
          `${f}: <${tag}> without a handler`,
        );
      }
    }
    for (const tag of windowed) {
      const re = new RegExp(`<${tag}\\b`, 'g');
      for (const m of body.matchAll(re)) {
        const window = body.slice(m.index, m.index + 1400);
        assert.match(window, /onChange\s*=/, `${f}: <${tag}> without onChange`);
      }
    }
  }
});

// ------------------------------------------------------------
// 7 · GROUPING / DEFAULTS — reset targets match the documented values
// ------------------------------------------------------------
test('v1131: reset targets and safe defaults are internally consistent', () => {
  const agent = src('AgentSection.tsx');
  assert.match(agent, /maxTurns: 40/);
  assert.match(agent, /maxRetries: 2/);
  assert.match(agent, /autoCompact: true/);
  assert.match(agent, /autoVerify: true/);
  assert.match(agent, /allowDangerousCommands: false/);
  const preview = src('PreviewSection.tsx');
  assert.match(preview, /autoDetect: true/);
  assert.match(preview, /deviceFrame: false/);
  assert.match(preview, /console: false/);
  assert.match(preview, /autoRefresh: true/);
  assert.match(preview, /zoom: 100/);
  const appearance = src('AppearanceSection.tsx');
  assert.match(appearance, /glassLevel: 'medium'/);
  assert.match(appearance, /ambientGlow: true/);
  assert.match(appearance, /specularEdges: true/);
  assert.doesNotMatch(appearance, /accent: 'sage'/, 'dead accent value not reintroduced on reset');
  const terminal = src('TerminalSection.tsx');
  assert.match(terminal, /settings\.terminalGuard \?\? 'on'/, 'command guard defaults ON');
});
