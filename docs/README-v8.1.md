# Surnia v8.1 — the honest changelog

This document describes what is actually in the tree right now. Every claim
below was checked against the source on disk; where the evidence is a comment
that documents an old defect (there is no git history in this checkout), that
is said explicitly. Nothing here is aspirational. If a feature was advertised
but is not in the code, it is listed in §3 or §4, not here.

A note on version tags: the in-code tags are inconsistent — `v8.1` (mutation,
proof, engine, fonts, status bar), `v8.2` (tool cards in MessageView), `v9`
(run journals), `A1`/`A6` (slash commands, OpenRouter catalog), `v7.3` (MCP
allow/deny + elicitation). This changelog describes what the files do today,
regardless of which tag their author left. Also note `package.json` still
says `"version": "7.2.0"` (package.json:4) and `APP_VERSION` is still
`'7.2.0'` (src/version.ts:3) — the release constants were not bumped.

---

## 1. What was broken and is now FIXED

### 1.1 False-Done metric excluded gate-caught rounds, and reset on every restart

**The defect.** Of all runs where the agent claims success, the False-Done
Rate is the share the proof gates overruled. The v7.1 code derived the claim
from the *post-gate* outcome, so a round that said "done" and was then
overruled by the gates vanished from both the numerator and the denominator
of the fraction. The fix comment records this exactly:
`electron/agent/engine.ts:2069-2073` ("a gate-caught round is counted AS a
false done … instead of silently leaving both numerator and denominator").

**The fix.** The prose claim is now frozen *before* any gate runs
(`engine.ts:2073` — regex over `result.finalText`, English and Arabic), and
recorded with that original claim after the gates vote
(`engine.ts:2295-2304`). `recordFalseDone` computes `falseDone` itself from
the pair (claimed success ∧ gate verdict failed/unproven) instead of trusting
the caller (`electron/agent/testRecord.ts:303-311`), and `falseDoneStats()`
puts every claimed run in the denominator
(`testRecord.ts:324-333`).

**The persistence defect.** The ledger was process-wide memory, so every app
restart silently reset the metric to 0%. Documented in the module header:
"instead of a per-process counter silently resetting to 0"
(`testRecord.ts:229-234`). Now `setFalseDoneStore(dir)` loads
`false-done.json` once, then appends and flushes (debounced 800 ms) on every
record (`testRecord.ts:244-301`). The engine points it at
`userData/metrics` before building each proof package
(`engine.ts:2233-2235`), and the dashboard IPC does the same on first call
(`electron/ipc.ts:476-484`). The metric is published as a `false_done` event
(`engine.ts:2305-2306`), consumed by the store (`src/store.ts:2485`), and the
status-bar chip and `/status` both surface it (see §2.3).

**Evidence that the new math works:** `tests/v81-heavy.test.mjs:349-370`
records claimed+failed, claimed+proven, unclaimed+failed, asserts
`claimed=2`, `falseDone=1`, `rate=0.5`, then round-trips the JSON file on
disk. This test passes (§5).

### 1.2 Mutation gate printed "FAILED — STRONG (small sample)" for a 100% kill

**The defect.** When the suite killed every mutation that ran, but the sample
was smaller than `minKills`, the old verdict branch called that failure. The
fix comment in the verdict ladder documents what was wrong: "Saying 'FAILED'
or 'add assertions' here would be dishonest: the tests killed everything that
ran" (`electron/agent/mutation.ts:517-521`).

**The fix.** The verdict set is now explicit
(`mutation.ts:72-80`): `killed-enough`, `survivors`, `boundary-survivors`,
`strong-small`, `weak`, `no-mutations`, `baseline-failed`, `skipped`. Each
report carries an `inconclusive` flag — "inconclusive = the gate makes NO
claim either way. Only 'survivors' is a FAIL"
(`mutation.ts:89-93`). The 100%-small-sample case returns
`strong-small` with "the claim stands" (`mutation.ts:521-525`); a thin sample
with kills below the threshold returns `weak`, not an accusation
(`mutation.ts:526-529`); a green baseline is mandatory before the gate judges
anything (`mutation.ts:391-398`). The engine never lets an inconclusive
verdict overrule the claim — it prints "INCONCLUSIVE (no overrule)" and
stops (`engine.ts:2186-2189`), and the legacy `mutation_check` event maps
everything except `killed-enough`/`survivors` to `honest: null`
(`engine.ts:2181`).

### 1.3 Boundary-flip equivalent mutants failed excellent suites (the clamp trap)

**The defect.** For an integer-domain clamp, `<` and `<=` are often
observably identical; a suite that kills everything else cannot kill that
mutant, and the gate treated it as weak tests. The fix documents the trap:
"the clamp-function trap: a suite can be excellent and still be unable to
distinguish `<` from `<=` over an integer domain" (`mutation.ts:509-511`).

**The fix.** Mutations now carry a severity: `MutationPlan.severity` is
`'hard' | 'boundary'` (`mutation.ts:55-60`); the boundary-flip operators
(`gt-flip`, `lt-flip`) are tagged `severity: 'boundary'`
(`mutation.ts:118-119`, `138`, `148`). In the verdict ladder, only *hard*
survivors produce the failing `survivors` verdict
(`mutation.ts:502-507`); boundary-only survivors produce
`boundary-survivors` with `inconclusive: true` and the honest explanation
(`mutation.ts:508-516`). A full kill with boundary survivors still passes as
`killed-enough`, with the survivors listed as a note
(`mutation.ts:496-500`). Demoted to `hard` stay the equality, logic,
boolean-return, arithmetic-assignment, condition-delete, numeric and
string operators (`mutation.ts:122-234`).

### 1.4 Survivors were printed but never returned to the agent

**The defect.** Survivor mutations were written into the report and the
transcript, but nothing sent them back as work. Nothing in the old pipeline
fed them to the model; the run just ended on a FAILED verdict.

**The fix.** When the verdict is `survivors` on the first round, the engine
takes up to 6 *hard* survivors
(`engine.ts:2196`), pushes one structured message into the same conversation
("These mutations were applied to the lines you just wrote and the suite
still PASSED with each of them…", `engine.ts:2198-2204`), re-runs
`agentLoop` with the normal tool surface and budget
(`engine.ts:2206-2214`, usage accumulated at 2215-2217), and re-runs the gate
on the fixed tree (`engine.ts:2218`). Two rounds maximum
(`engine.ts:2158`); if survivors persist after the fix round they are
reported honestly (`engine.ts:2221`).

### 1.5 Proof packages were HMAC-signed with a key nobody else could verify

**The defect.** v7.1 signed packages with HMAC-SHA256 using a local random
key. The module header records the consequence: "Nobody but the signer could
verify a package — a reviewer running `surnia verify` on another machine had
no key, so the 'signature' proved nothing to them"
(`electron/agent/proof.ts:4-7`).

**The fix.** Packages are now Ed25519-signed (format `version: 2`,
`proof.ts:82`, `275`): the private key is generated on first use and stored
0600 in userData (`proof.ts:156-173`); every package carries its own public
key + keyId inside `signature` (`proof.ts:76-78`, signing at
`proof.ts:293-303`). Verification needs no local secret
(`proof.ts:334-341`) and grades authenticity honestly: `release` (key equals
the shipped Surnia release key), `trusted` (key in a trust anchor), or
`embedded-only` — "internally consistent, NOT a known release key
(self-hosted install)", reported, never hidden
(`proof.ts:370-377`, wording at `proof.ts:422-428`). Trust anchors are the
`SURNUA_VERIFY_PUB` env var, `~/.surnia/known_keys`, and the shipped release
key (`proof.ts:186-251`). Legacy v1 `hmac-sha256` packages still verify when
the old key is provided (`proof.ts:379-384`). The CLI exposes the whole flow:
`surnia verify <proof.json> [--rerun] [--workspace dir] [--legacy-key hex]`
(`electron/agent/cli.ts:80-140`; the `--legacy-key` parse at
`cli.ts:92` and `124`). Ed25519 signatures are produced and verified in the
test suite (`tests/v71-proven.test.mjs:284-319`).

### 1.6 Arena merge dropped new files; rollback could nuke user work; keep criterion was a heuristic

**The defect(s).** Documented by the fix header
(`electron/services/arenaService.ts:372-384`):
1. `git ls-files --others` lists untracked *names*, not *content* — new files
   silently vanished from every merge.
2. The keep criterion was a test-exit heuristic that could keep worse merges.
3. Rollback was `git checkout -- . && git clean -fd`, which destroys the
   user's own uncommitted work in the main workspace.

**The fix.**
1. The patch is built with `git add -A . && git diff --cached HEAD --binary
   --full-index && git reset -q` — full content of new files, index restored,
   working tree untouched (`arenaService.ts:413-428`); arena scratch files
   are excluded via the worktree's own `info/exclude`
   (`arenaService.ts:387-411`).
2. The merged tree is re-scored with the *same* model-free scorer as the
   attempts (tests + mutations + lint + diff-fit; critic bonuses excluded
   from both sides), and kept only when it is at least as good as the best
   single attempt (`arenaService.ts:235-238`, `598-624`).
3. Rollback is a pre-merge snapshot: every dirty file is copied to a temp
   mirror before applying, and restore puts back exactly those files and
   removes only files the patch created
   (`arenaService.ts:465-471` comment, `479-509` snapshot,
   `511-549` restore).

**Per-attempt "apply to workspace":** a new `arenaApplyAttempt` applies one
done attempt's full patch to the main workspace, snapshot-first and
re-tested — on suite failure the workspace is restored
(`arenaService.ts:627-664`). Wired as IPC `kdx:arena:apply`
(`electron/ipc.ts:434-436`) and surfaced as an apply button per done attempt
in the Arena panel (`src/components/panels/ArenaPanel.tsx:6`,
`106`).

### 1.7 OAuth: state sent but never verified (CSRF), and AS-controlled `error` reflected unescaped (XSS)

**The defect.** Both documented in place: "v7.1 generated and sent `state`
but never compared it on the callback" (`electron/agent/mcpOAuth.ts:228-229`),
and "The authorization server controls the `error` param — reflecting it raw
was an XSS hole in v7.1 (fixed in v8.1)" (`mcpOAuth.ts:216-218`).

**The fix.** `verifyCallbackState(expected, received)` does a constant-time,
length-safe comparison (`mcpOAuth.ts:230-236`); the state is generated once
per flow and verified on the callback (`mcpOAuth.ts:277-280`, check at
`356`). A state mismatch renders a 400 page with a plain-text message and
resolves no code (`mcpOAuth.ts:358-359`, `367`, `371`); every reflected value
goes through `escapeHtml` (`mcpOAuth.ts:219-226`, applied at `361`). Tested:
`tests/v81-heavy.test.mjs:208-220` (constant-time matcher behavior + script
tag neutralization).

### 1.8 Fonts: `--font-app` pointed at families that were never shipped

**The defect.** Documented in the stylesheet: "v7 pointed `--font-app` at
'Geist'/'GeistMono' which were NEVER shipped, so every surface silently fell
back to system-ui" (`src/assets/glass-v7.css:90-93`). Whether the v7 tree
shipped those files cannot be re-checked here (no git history) — this
checkout does contain local `Geist-*.woff2` assets and `@font-face` rules for
them (`glass-v7.css:19-53`), and the boot splash in `index.html:18` still
names 'Geist' first, so partial Geist usage can remain on some surfaces.

**The fix.** The v8.1 stacks point at real installed families: Manrope
(body), Space Grotesk (display/caps), JetBrains Mono (code), with IBM Plex
Sans Arabic / Noto Kufi Arabic for Arabic text (`glass-v7.css:94-99`).
The families ship as npm font packages (`package.json:25-31`) and are
imported per weight in the renderer entry (`src/main.tsx:3-24`).

### 1.9 Untested heavy systems now have real behavior tests

`tests/v81-heavy.test.mjs` covers, with real fixtures and assertions (not
smoke tags): mutation verdict honesty including the clamp demo
(`tests/v81-heavy.test.mjs:51-168`), Ed25519 authenticity grading
(`:174-202`), OAuth state/escape hygiene (`:208-220`), skill-gate
quarantine/promotion lifecycle on disk (`:226-254`), the terminal-guard
block/allow/audit path (`:260-271`), isolation health structure with and
without Docker (`:277-287`), the browser state layer without a window
(`:293-299`), the tool registry including `best_of_n`, browser, image and
download plus the shell-danger core (`:305-318`), DAP/debugTools no-session
error paths (`:324-343`), and False-Done honesty + persistence
(`:349-370`). Current totals when run here: 141 tests, 138 pass, 3 fail —
the 3 failures are the pre-existing v5 built-in-skill forking tests
(`tests/v5-skills.test.mjs`), documented in §5.

---

## 2. What is NEW (verified in this tree)

### 2.1 Phase-banded stream (THINK / WORK / BUILD / RUN / PROVE)

The transcript is no longer a flat row list. `src/components/StreamTimeline.tsx`
classifies every message into a phase band — tool→phase map
(`StreamTimeline.tsx:32-74`), gate/proof rows→PROVE
(`:76-87`), deterministic band grouper (`:100-127`) — and renders each band
with a left time-rail, phase icon, phase word and a live scan bar on the
streaming band (`:148-183`). ChatPanel renders the transcript through the
band grouper instead of the flat list (`src/components/ChatPanel.tsx:1283-1327`),
keeping the existing MessageView cards inside the bands. Band chrome CSS
(`.band`, `.band-rail`, `.band-node`, `.band-scan`, reduced-motion guards)
lives in `src/styles.css:3233-3339`, and band labels are bilingual
(`src/i18n.ts:204` region; Arabic labels in `StreamTimeline.tsx:141-145`).

### 2.2 Five built-in slash commands: `/status` `/export` `/diff` `/rewind` `/share`

All five are handled in the store before a message reaches the engine
(`src/store.ts`):
- `/status` — model/mode/workspace/token/cost snapshot, plus verification
  budget and the persisted False-Done rate when present
  (`store.ts:1911-1940`).
- `/export` — session → Markdown under `<workspace>/.surnia/export/`,
  download fallback (`store.ts:1837-1853`).
- `/diff` — working tree + index diff in the diff viewer
  (`store.ts:1941-1967`). Note the limitation in §4: untracked files are
  not included.
- `/share` — self-contained dark/RTL-safe HTML report under
  `<workspace>/.surnia/share/`, download fallback
  (`store.ts:1968-1988`).
- `/rewind` — lists checkpoints inline and opens the click-to-restore
  chooser instead of blindly restoring the newest one
  (`store.ts:2041-2070`); the chooser is `src/components/RewindChooser.tsx`
  (mounted via DiffModal per its header note).

Honest caveats: the composer autocomplete menu lists only `/rewind` and
`/export` (`src/components/Composer.tsx:267`, `278`); `/status`, `/diff` and
`/share` work when typed but are not in the menu. They are listed in the
`/help` output (`store.ts:1660-1662`).

### 2.3 Status bar: False-Done chip + task progress

The status bar fetches the persisted honesty metric on mount and every 60 s
(`src/components/StatusBar.tsx:421-441`, IPC `kdx:metrics:honesty` at
`electron/ipc.ts:478-499`). The FD chip renders only when the ledger has
claimed runs — "no invented 0%" — warn tone when any run was overruled, ok
tone otherwise (`StatusBar.tsx:673-700`). The task-progress stamp shows
`TASKS <done>/<total>` with a 40 px micro-bar while a todo list is live
(`StatusBar.tsx:543-576`; todos come from engine todo events,
`StatusBar.tsx:325`).

### 2.4 Run journals (engine + CLI `surnia journals`)

`electron/agent/journal.ts` is a crash-resilient append-only journal: one
JSON line per event into `<userData>/journals/<date>/<sessionId>.jsonl`,
`writeFileSync` + append + 0600, never throws, torn lines skipped by readers
(`journal.ts:1-22`, `86-117`; bounded readers `:144-324`). The engine opens
the journal at run start, journals every tool outcome and every
auto-continue round, and closes it with a finish line
(`electron/agent/engine.ts:1105-1107`, `1721-1722`, `1748`,
`3360`, `3378`, `2059`). The CLI lists recent runs and replays one run's
events with exit-code coloring and an explicit "(no finish line — the run
was killed or crashed)" marker (`cli.ts:142-205`). The same data is exposed
to the renderer over `kdx:journal:list` / `kdx:journal:read`
(`electron/ipc.ts:518-527`, `electron/preload.ts:290-291`) — but no panel
consumes it yet (§4).

### 2.5 OpenRouter live catalog

`electron/services/openrouterCatalog.ts` fetches
`https://openrouter.ai/api/v1/models` with the configured key (12 s timeout,
10-minute per-key cache, `[]` on any failure so the static catalog stays the
fallback) and maps rows to picker-shaped models with free/vision flags
(`openrouterCatalog.ts:1-100`). Exposed as `kdx:models:openrouter`
(`electron/ipc.ts:298-306`, `electron/preload.ts:143-145`) and merged into
the ModelPicker as a live group when a key exists
(`src/components/ModelPicker.tsx:219`, `274-290`).

### 2.6 Richer tool cards

All in `src/components/MessageView.tsx`:
- Gate-row verdict chips: messages starting with a gate tag render a compact
  verdict pill (PASSED / KILLED x/y / FAILED / INCONCLUSIVE / ENFORCED / …)
  with the full detail collapsible behind it; INCONCLUSIVE maps to the warn
  tone, never to failure (`MessageView.tsx:885-985`, verdict mapping at
  `913-926`).
- Word-diff live preview for `edit_file`/`write_file`: first changed hunk,
  ≤8 rows, word-level LCS diff, capped inputs, "+N more lines" summary
  (`MessageView.tsx:990-1092`, mounted at `1924`, `2048`).
- `best_of_n` race card: parses the leaderboard (`★ label: N pts (status)`),
  merge verdict, attempt count and cost-if-stated, one chip per attempt,
  defensive parsing that degrades instead of throwing
  (`MessageView.tsx:1138-1330`, dispatch at `2246-2248`).

---

## 3. What was ALREADY THERE (record corrected)

These were advertised as missing or as new; they are in the tree and, per
in-code tags, mostly predate this round.

- **OpenRouter provider + static catalog** — `electron/agent/providers.ts`:
  provider entry `openrouter` (`providers.ts:275-298`, base URL
  `:79`, `MODEL_CATALOG` export `:154`), OpenAI-compatible streaming protocol
  shared with openai/ollama/gemini (`:931`), reasoning param
  (`:1020`), usage accounting (`:1042-1045`). The *live* catalog fetch is the
  new part (§2.5).
- **`image_generate` / `download_file` / `web_search` / browser tools** —
  `electron/agent/tools.ts`: `web_search` `:828`, `download_file` `:961`,
  `image_generate` `:1055`, `browser_navigate`/`browser_snapshot`/… `:773-822`
  (implemented in `electron/services/browserService.ts`). The registry test
  asserts they are real registered tools (`tests/v81-heavy.test.mjs:305-318`).
- **120 turns + 30–200 continuation rounds** — `engine.ts:89`
  (`DEFAULT_MAX_TURNS = 120`) and `engine.ts:1706-1718`
  (`maxContinueRounds ?? 30`, hard ceiling 200; fullAccess floor 60; deep
  effort doubles the step budget at `:1707`).
- **Agency gate (`hasUnappliedCode`)** — code drafted with zero tool calls is
  pushed to apply it (max 2 nudges): `engine.ts:114-120`,
  `engine.ts:3548-3572`.
- **Browser visibility layer + per-session tagging** — every navigate/
  screenshot/close pushes a live event with the owning `sessionId`
  (`browserService.ts:27-46`), windows are per-session keyed with a state
  accessor (`browserService.ts:309-344`), wired to `kdx:browser:event` /
  `kdx:browser:state` / `kdx:browser:close`
  (`electron/ipc.ts:257-269`, `electron/preload.ts:102`). Caveat: the
  renderer currently has no panel consuming these events/preload hooks —
  the plumbing is main-side + preload only (checked: no `onBrowserEvent` /
  `browserState` callers under `src/`).
- **Checkpoints** — `electron/services/checkpointService.ts` (v7.1:
  shadow-commit refs plus a bounded userData snapshot, header at
  `:1-15`); `/rewind` lists and restores them (§2.2).
- **Hooks** — Claude-Code-style PreToolUse/PostToolUse hooks from
  `.surnia/hooks.json` with a workspace trust marker
  (`electron/agent/hooks.ts:1-26`).
- **Steering** — queued messages can be injected at the next tool boundary
  (v2.1 semantics): `engine.ts:242-243`, `:563-575`, `:633`; renderer stamps
  them STEERED (`src/components/MessageView.tsx:2140`) and the store handles
  `steer_injected` (`src/store.ts:2294-2305`).
- **AGENTS.md** — `AGENTS.md` / `KODEX.md` / `MEMORY.md` are all read as
  workspace memory (`engine.ts:1152-1158`).
- **Compaction** — dense structured compaction prompt
  (`engine.ts:181-182`), threshold config (`:97`, `:788-789`).
- **MCP per-server allow/deny + elicitation wire path** — tagged v7.3 in the
  code, not v8.1. Allow/deny gate: `electron/agent/mcp.ts:1447-1512`
  (deny wins; empty allow = everything), enforced again at call time
  (`:1669-1676`), configured per server in shared types
  (`shared/types.ts:447-453`) and editable in the MCP panel
  (`src/components/panels/MCPPanel.tsx:634-665`, DENIED badges at
  `1131`, `1140`). Elicitation: the wire-level `elicitation/create`
  server→client request is routed to an approval event and answered with
  accept/decline/cancel (`mcp.ts:1027-1173`), with the decision IPC
  (`kdx:mcp:elicitDecision`, handler `mcp.ts:2539`). The renderer gap is in §4.
- **Proof Ribbon** — tagged v7.2 (`src/components/ProofRibbon.tsx:1-9`).
  It is honest by construction: state is driven only by real gate events,
  stays gray with no events, and is hidden entirely until the first gate
  event (`ProofRibbon.tsx:65-67`); the mutation chip shows the warn tone
  with full detail for inconclusive verdicts
  (`src/store.ts:941-957`).
- **Welcome screen redesign** — tagged v7.2
  (`src/components/Welcome.tsx:1-13`): hero composer that launches a real
  session, starter cards, visual recent-project cards, quick actions,
  capability stamps. There is no separately-named "cockpit" component; the
  redesign is what exists.

---

## 4. Known limitations

- **MCP elicitation auto-declines after 5 minutes.** The decision timeout is
  `ELICIT_DECISION_TIMEOUT_MS = 5 * 60_000` and a lapse answers the server
  with a conservative decline (`mcp.ts:1064`, `1152-1155`). The decision IPC
  is exposed end-to-end (`electron/preload.ts:247-248`,
  `src/lib/api.ts:438`, handler at `electron/agent/mcp.ts:2539`) but no
  approval card calls `mcpElicitDecision` yet — the renderer only stores the
  generic `approval_request` (`src/store.ts:2249-2272`); there is no
  elicitation-specific UI. Until that card is wired, the user cannot accept,
  and every elicitation ends in the timeout decline.
- **`/diff` excludes untracked files.** `gitService.diff()` runs
  `git diff --no-color` and `git diff --cached --no-color` only
  (`electron/services/gitService.ts:105-124`) — never-added files do not
  appear. (Arena patches do include untracked content via `git add -A`,
  §1.6.)
- **The best-of-n cost chip is hidden unless the tool output states a cost.**
  `costUsd` is parsed only when a money amount shares a line with "cost"
  (`MessageView.tsx:1155`, `1175-1186`).
- **The CLI's mutation-gate line is coarser than the engine's.** The CLI
  colorizer prints "FAILED — killed …" for every verdict that is not
  `killed-enough`/`no-mutations`/`baseline-failed`
  (`cli.ts:268-273`), so `boundary-survivors`/`strong-small`/`weak` print as
  FAILED in the terminal even though the engine event text and the detail
  string carried on the same line are honest ("INCONCLUSIVE … no overrule",
  `engine.ts:2188`; detail text in `mutation.ts:514`, `523`). Desktop UI is
  unaffected.
- **No "run-journeys" view exists.** The journals feature is engine + CLI +
  IPC (`kdx:journal:list`/`read`), but no sessions-panel or other UI consumes
  the IPC today (no callers of `journalList`/`journalRead` under `src/`).
- **The Windows build has not been run in this environment at doc time.**
  `npm run dist:win` exists in `package.json:21` (and `scripts/verify-win.sh`
  is present), but everything verified for this document was produced on
  Linux: typecheck and `npm test` only. No NSIS/zip artifact was built or
  executed here.
- **Release constants were not bumped.** `package.json:4` and
  `src/version.ts:3` still say 7.2.0 while the tree carries the v8.1 work.
- **3 pre-existing tests fail** — all in `tests/v5-skills.test.mjs`
  (built-in skill ship/parse, delete protection, fork-to-scope); see §5.
- **In-code version tags disagree** (v8.1 / v8.2 / v9 / A1 / A6 / v7.3), as
  noted in the header; treat file behavior, not tags, as the record.

---

## 5. How to verify

Run from the repo root. Everything below was executed for this document;
results are stated as measured.

1. **Tests — `npm test`.**
   Bundles the pure modules with esbuild and runs `node --test
   tests/*.test.mjs` (`package.json:22`). Measured here: **141 tests,
   138 pass, 3 fail**. The failures are the three pre-existing v5
   built-in-skill tests in `tests/v5-skills.test.mjs` (skill ship/parse,
   built-in delete protection, fork-to-editable-scope). The v8.1 heavy suite
   passes 14/14 — mutation verdicts (incl. the clamp demo), proof
   authenticity, OAuth hygiene, skill-gate lifecycle, terminal guard,
   isolation health, browser state layer, tool registry, DAP/debugTools
   no-session paths, False-Done honesty + persistence
   (`tests/v81-heavy.test.mjs`).
2. **Typecheck — both configs.**
   `npx tsc --noEmit -p tsconfig.json` (renderer) and
   `npx tsc --noEmit -p tsconfig.node.json` (main process) both exit 0 here
   (`package.json:16` runs the same pair as `npm run typecheck`).
3. **Cross-machine proof verification.**
   Build the CLI once (`npm run cli:build`, `package.json:17`), then on any
   machine holding only a `surnia-proof-*.json`:
   `node dist-cli/surnia.cjs verify surnia-proof-XXXX.json [--workspace dir]
   [--rerun]` — the package carries its own Ed25519 public key, so no key
   material is needed; authenticity is graded release/trusted/embedded-only
   and printed (`cli.ts:80-140`, `proof.ts:342-451`). For old v1 packages:
   `--legacy-key <hex>` (`cli.ts:92`, `124`). The `SURNUA_VERIFY_PUB`
   env var / `~/.surnia/known_keys` / shipped release key are the trust
   anchors (`proof.ts:186-251`); without any anchor the honest grade is
   `embedded-only` (`tests/v81-heavy.test.mjs:200-201`).
4. **The mutation-gate clamp demo.**
   `tests/v81-heavy.test.mjs:64-100` builds a three-test integer clamp
   (`n < lo`, `n > hi`), lets the gate flip the `<`/`>` operators, and
   asserts the verdict is `boundary-survivors` with `inconclusive: true` —
   the equivalent-mutant case is inconclusive, never a failure. The companion
   tests assert a hard survivor *does* fail (`:138-168`) and a 100% small
   sample is `strong-small` whose detail must not contain "FAILED"
   (`:102-136`, assertion at `:134`).

---

## الملخص بالعربية

**ما كان معطّلاً وأُصلح (القسم 1):**
- **مقياس الإنجاز الكاذب (False-Done):** كانت الجولات التي يوقظها المدقق
  تختفي من البسط والمقام معاً، والسجل يصفر مع كل إعادة تشغيل. الآن يُجمَّد
  ادعاء النموذج قبل المدققات (`engine.ts:2073`، `2299-2304`)، ويُحسب
  على القرص في `false-done.json` عبر `setFalseDoneStore`
  (`testRecord.ts:294-301`)، موصول في المحرك وفي لوحة الاستخدام
  (`ipc.ts:478-484`).
- **بوابة الطفرات:** قتل كامل على عيّنة صغيرة كان يُطبع "FAILED" خطأً؛ الآن
  `strong-small` و`boundary-survivors` و`weak` كلها «غير حاسمة» ولا تقلب
  الادعاء أبداً — فقط `survivors` فشل حقيقي (`mutation.ts:72-93`,
  `479-529`). طفرات الحدود (`<` ↔ `<=`) صارت منفصلة بـ`severity`
  (`mutation.ts:55-60`) — فخ الدالة clamp لم يعد يتهم الاختبارات الجيدة.
- **الناجون من الطفرات** يُعادون للوكيل الآن في جولة إصلاح واحدة ثم تُعاد
  البوابة (`engine.ts:2193-2218`).
- **حِزم الإثبات:** التوقيع صار Ed25519 والمفتاح العام يسافر *داخل* كل حزمة —
  أي جهاز يتحقق بلا مفاتيح (`proof.ts:293-303`, `342-390`)، والأصالة
  تُدرَّج بصدق release/trusted/embedded-only، مع `surnia verify` و
  `--legacy-key` للحزم القديمة (`cli.ts:80-140`).
- **الحلبة (Arena):** الدمج كان يُسقط الملفات الجديدة؛ الآن
  `git add -A + diff --cached --binary` (`arenaService.ts:413-428`)،
  ومعيار الإبقاء هو الدرجة الكاملة بلا نموذج (`:598-624`)، والتراجع
  استعادة ملف-بملف من لقطة قبلية بدل `git checkout -- .` الذي كان يقتل عمل
  المستخدم (`:465-549`)، وزر «تطبيق المحاولة» جديد (`:627-664`,
  `ipc.ts:436`).
- **OAuth:** حالة CSRF لم تكن تُدقق (`mcpOAuth.ts:230-236`) وخطأ الـAS كان
  ينعكس خاماً (XSS) — الآن تُدقق زمنياً-ثابتاً وتُهرَّب كل القيم
  (`:219-226`, `356-371`).
- **الخطوط:** كانت `--font-app` تشير إلى Geist غير موجودة فكان كل شيء
  system-ui؛ الآن Manrope + Space Grotesk + JetBrains Mono مُحمَّلة فعلاً
  (`glass-v7.css:90-99`, `main.tsx:3-24`).
- **اختبارات الأنظمة الثقيلة:** `tests/v81-heavy.test.mjs` يغطي 14 اختباراً
  حقيقياً لكل ما سبق.

**ما هو جديد (القسم 2):** بث مرحلي بأشرطة THINK/WORK/BUILD/RUN/PROVE
(`StreamTimeline.tsx`)، خمس أوامر مدمجة `/status /export /diff /rewind
/share` (`store.ts:1837-2070`)، شريط حالة بشريحة False-Done وتقدّم المهام
(`StatusBar.tsx`)، سجلات تشغيل مقاومة للانهيار مع `surnia journals`
(`journal.ts`, `cli.ts:142-205`)، كتالوج OpenRouter حي
(`openrouterCatalog.ts`)، وبطاقات أدوات أغنى (رقاقة حكم، معاينة word-diff،
بطاقة best_of_n) في `MessageView.tsx`.

**تصحيح سجل:** بوابة السماح/المنع لـMCP ومسار الاستقصاء (elicitation)
من v7.3 لا من هذه الجولة (`mcp.ts:1027`, `1447`)، وشريط الإثبات وواجهة
الترحيب من v7.2 (`ProofRibbon.tsx:1`, `Welcome.tsx:1-13`)، وOpenRouter
والأدوات الأربع و120 دورة و30–200 جولة استكمال وبوابة الوكالة ونقاط
التفتيش والخطافات والتوجيه وAGENTS.md والضغط كانت كلها موجودة أصلاً.

**حدود صادقة (القسم 4):** قرارات الاستقصاء تُرفض تلقائياً بعد 5 دقائق لأن
بطاقة الموافقة لم تُوصَل بـ`mcpElicitDecision` بعد؛ `/diff` يتجاهل الملفات
غير المتتبعة؛ شريحة تكلفة best_of_n تظهر فقط إن ذكر الإخراج تكلفة؛ سطر
الطفرات في الـCLI لا يزال يطبع FAILED للحالات غير الحاسمة؛ لا توجد واجهة
«رحلات التشغيل» — السجلات عبر الـCLI والـIPC فقط؛ بناء ويندوز لم يُجرَّب في
هذه البيئة حتى تاريخ هذا المستند؛ ورقم الإصدار في `package.json` و
`version.ts` ما زال 7.2.0.

**كيف تتحقق (القسم 5):** `npm test` → 141 اختباراً، 138 ناجحاً، 3 فاشلة
(اختبارات مهارات v5 القديمة)؛ `npx tsc --noEmit` للإعدادين → صفر أخطاء؛
`surnia verify` على أي جهاز بلا مفاتيح؛ واختبار clamp في
`v81-heavy.test.mjs:64-100` يثبت سلوك «غير حاسمة» للحدود.
