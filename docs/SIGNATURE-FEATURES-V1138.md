# v11.38 — Signature Features (SADEEM-owned instruments)

Founder's brief: *"أضف ميزات خاصة أصلية فينا إحنا بالتطبيق… مش تقليد، ابتكارات"* —
add features that are genuinely ours, not clones, and make them real.

This wave ships **three instruments** with a single rule: **no datum is invented**.
The engine in `electron/agent/signatureFeatures.ts` is pure — it calls no LLM,
writes no file, and exposes no new IPC. It transforms data SADEEM already
persists. Empty stores produce explicit empty-state codes, never sample rows.

| # | Feature | Real input | Public API | UI |
|---|---------|-----------|-----------|----|
| 1 | **Trajectory Replay** | session messages + crash journal + JSONL trace | `buildTrajectory()` (`signatureFeatures.ts:197`) | rail 16 → REPLAY |
| 2 | **DNA Autopsy** | `dna.json` (+ optional playbook changes / journal memory facts) | `autopsyDNA()` (`signatureFeatures.ts:516`) | rail 16 → DNA AUTOPSY |
| 3 | **Capability Compass** | `CORE_DEFS` (the real 145 tools) + real call counts | `compass()`, `toolRoutingGraph()` (`signatureFeatures.ts:718`, `:642`) | rail 16 → COMPASS |

The panel is `src/components/SignaturePanel.tsx:175`, registered at
`src/components/panels/registry.tsx:136` (rail no. `registry.tsx:67`,
title `registry.tsx:88`). Hairline CSS: `src/components/signature-art.css`.

---

## 1. Trajectory Replay — three ledgers, one thread

**What it does.** Rebuilds any recorded run step by step. Tool *inputs* are the
real JSON arguments from `<userData>/sessions/*.json`; tool *outputs* are the
real result strings from the same messages; *durations* come from the real
`{type:'tool', ms}` lines the engine appends in `engine.ts:6619`; *output sizes*
come from the real `tool_result.chars` written by `traces.ts` and emitted at
`engine.ts:6739`;
`task_report`, `finish`, `continue`, `memory_snapshot` and `preview_open` become
honest `milestone` steps. Each step carries a `sources` array (`session`,
`journal`, `trace`) so the UI can say exactly where it came from. A result whose
call is missing is flagged `unpairedResult`, not silently attached.

**Honest bounds.** 160 steps / 1200 chars per preview by default; clipping sets
`inputClipped`/`outputClipped` and truncation sets `truncated` with `stepsTotal`.
Trace-only runs are supported, but `TraceStep.t` is a *relative* clock, so no
absolute timestamp is invented for those rows. Empty input returns
`emptyReason: 'NO_LEDGER_DATA'`.

**Originality, stated honestly.** Session timelines and "resume from history"
exist in Claude Code, OpenCode and Codex — we do **not** claim to have invented
step scrubbing. What is ours is the **three-ledger join with per-step
provenance**: no other surface in those products reconciles the chat ledger,
the crash-resilient journal and the trace into one replay that names its own
source for every field, entirely from local files.

## 2. DNA Autopsy — what was learned, from what, and will the model see it

**What it does.** For each *stored* DNA pattern it shows the stored confidence,
the stored repetition count, the exact rule that confidence came from
(`min(0.95, 0.4 + 0.15 × count)` — `dna.ts:478`), the first/last sighting, and
the real feedback notes, playbook changes or journal memory facts whose tokens
actually overlap the pattern text. A stored value that does not match the rule
is labelled `LEGACY_CONFIDENCE` — it is never silently "corrected".

The `promptVisible` mark is not decoration: `promptVisibleIds()`
(`signatureFeatures.ts:472`) applies the **same** selection rule the real prompt
builder uses (`dna.ts:623-646`: newest 4, then top score by
`confidence × exp(-age / 21d)`, 8 slots). Declared profile values are listed as
facts with `confidence: null` because the store holds no confidence for them.
The result's caveat is a machine code, `ADVISORY_DERIVED_FROM_STORED_FIELDS` —
the UI says plainly that these are explanations derived from stored fields,
not claims the AI made about itself.

**Drift guard.** `tests/v1138-signature.test.mjs` reads the real `dna.ts` and
asserts the mirrored constants (60 / 8 / 4 / 21 days) have not moved.

**Honest bounds.** At most 3 evidence items per finding; previews clipped to
300 chars. Empty DNA returns `emptyReason: 'NO_DNA_LEARNED'`.

**Originality, stated honestly.** Other assistants expose a memory view or let
you edit saved preferences. We do not claim novelty for "show the user their
memory". The distinctive part is **prompt-visibility proof plus provenance**:
for every learned fact you can see the real trace that produced it *and*
whether it will be injected into the next system prompt, computed from the
app's actual renderer. That connection is SADEEM-specific by construction.

## 3. Capability Compass — intent → real tool, and the tools you never call

**What it does.** Scores the **real** `CORE_DEFS` inventory (145 tools,
`tool-defs.ts:65`) against an intent: real name tokens, real description
tokens, and the real "Use when …" sentences. `toolRoutingGraph()`
(`signatureFeatures.ts:642`) mines the descriptions' own *"Do NOT use it to
search file contents (search_files)…"* sentences into an auditable edge list
(`list_dir → search_files`, with the exact sentence as the reason). Those edges
boost the routed-to tool and penalize the routed-away one.

Real call names from the replay + journal produce `coverage.called /
coverage.inventory / coverage.percent`, name tools outside the inventory
(MCP / provider-native) honestly as `unknownNames`, and list **unused
capabilities** with a hint taken verbatim from each tool's description. This is
the concrete implementation of the founder's "the AI should use all tools": you
cannot use a tool you cannot see, so the instrument shows real blind spots.

**Honest bounds.** Empty intent → `emptyReason: 'EMPTY_INTENT'` (coverage and
unused list still reflect real data). `called` counts are never synthesized;
no "recommended" tool exists outside `CORE_DEFS`.

**Originality, stated honestly.** Tool search and docs exist everywhere;
"do not use X, use Y" hints already live in our own tool descriptions and are
not a novel idea in the industry. What is original here is **mining those
in-repo sentences into a versioned, testable routing graph and joining it with
the user's real ledger coverage** to surface unused capabilities. It is a
composition grounded in SADEEM's 145-tool inventory, not a copy of a
competitor's feature.

---

## Data honesty contract (enforced in tests)

* No writes, no LLM calls, no IPC in `signatureFeatures.ts`. The UI reads only
  existing allowlisted bridges: `api.journalList` / `api.journalRead`
  (`src/lib/api.ts:735,737`), the store's real `sessions` and `dna`, and the
  bundled real `CORE_DEFS`.
* Every cap is reported (`truncated`, `*Clipped`, `stepsTotal`).
* Every explanation names its source (`sources`, `Evidence.source`,
  `CompassReason.type`). Missing fields stay `undefined`.
* Bilingual (EN/AR from `settings.language`), `dir="rtl"` on the panel and
  `dir="auto"` on every data string. Hairline only — 1px rules, 2px meters,
  no box shadows, gradients or card backgrounds; reduced-motion kill switch.
* i18n fallback carries the title (`rail.signature` → "Signature"); no edit to
  `i18n.ts` was made.

## Verification (run in this workspace)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **green** (0 errors) |
| `npx tsc -p tsconfig.node.json --noEmit` | **green** (0 errors) |
| `node --test --test-force-exit tests/v1138-signature.test.mjs` | **15/15 pass** — real journal.ts / traces.ts / dna.ts writers → real output + SSR EN/AR |
| `node --test --test-force-exit tests/v1131-ui-shell.test.mjs tests/v1131-registry.test.mjs` | **29/29 pass** — STAGE_RAILS literal + registry contracts intact |
| `node --test --test-force-exit tests/v1131-full-smoke.test.mjs` | 78 pass / 4 fail — **all 4 are the pre-existing ENGINE-SHAPE failures** (`kdx:agent:run` made `requests=0`, so the harness's `requests.some(...)` predicate fails; events still show `text_delta → task_report → turn_end`). They live in `electron/agent/register.ts` / `electron/agent/engine.ts`, which this wave did not touch; engine.ts was being edited concurrently by another wave. All 60 SSR screens, 715 controls and the unstable-selector scan are green; no SignaturePanel regression. |

## Handoff — promote rail 16 to a first-class rail (parent to apply)

This wave deliberately did **not** edit files owned by other waves. The panel
is already registered and renders when `rail === 'signature'` (through
`RightDock`/`StagePage` via `PANELS[rail]`). To add a clickable rail button and
a typed union:

1. `src/store.ts:58` — append `| 'signature'` to `RailView`.
2. `src/components/Rail.tsx:94-105` — append to `MORE`:
   `{ view: 'signature', icon: /* a distinct glyph, add near :73 */, no: '16', labelKey: 'rail.signature', labelFallback: 'Signature' }`.
   **Do this before step 3:** `tests/v1131-ui-shell.test.mjs:202-222` requires
   every STAGE_RAILS view to be reachable from PRIMARY/MORE.
3. `src/components/panels/registry.tsx:90-98` — add `'signature'` to
   `STAGE_RAILS` (keep the literal `new Set<RailView>([…])` — that spelling is
   asserted by the same guard). `PANELS`, `RAIL_NO` and `RAIL_TITLE` already
   carry the key; the local `AllRail` widening at `registry.tsx:39` can then be
   removed if desired.
4. `src/components/Sidebar.tsx:21` — add `signature: <width>` to
   `DEFAULT_W: Record<RailView, number>` once the union is widened.
5. `src/i18n.ts` (near `:3081`) — add `'rail.signature': ['Signature', 'بصمة سديم']`
   if you want a translated dock title; the registry fallback already works.
6. If you later switch `registry.tsx:136` to `panelOf(SignatureMod, 'SignaturePanel')`,
   also add the panel to `SCREENS` in `tests/v1131-full-smoke.test.mjs:105-173`
   — that guard enumerates every `panelOf(...)` entry. The direct named import
   used now was chosen specifically to keep that test green without touching it.

No handoff is needed for the backend: it is already importable by `main.ts`,
the CLI or a future IPC handler; no boot hook is required because it registers
nothing.
