# SADEEM v11.3.0 — "Light-primary"

> سديم — وكيل البرمجة الذي يُثبت عمله. The coding agent that proves its work.

**v11.3.0 fixes what the user reported, on top of v11.2.0, with the honest agent core untouched** (Ed25519 proofs, false-done ledger, mutation gate, arena rollback — 159/159 tests pass).

---

## 1 · Palette law — lemon, black, white, grays, taupe. Nothing else.

User decree: only lemon green + black/white derivatives + taupe. Every foreign hue is gone:

- Iris/violet (`#6d5bd0`, `#6e56f8`, `#a89aef`…), cyan/teal (`#22d3ee`, `#74c6f5`, `#0b6e5f`…), terracotta/red (`#d0756a`, `#dc2626`, `#ff7080`…), amber/gold (`#ffd07a`, `#f4bd63`, `#b45309`…) — **all replaced** with same-lightness in-family tokens.
- Blue-tinted surfaces and blue-gray texts de-tinted to warm neutrals.
- **Monaco syntax themes rebuilt** in the family: lemon keywords, taupe strings/types, gray functions, bone/ink diffs. `src/lib/monaco.ts` + `EditorArea.tsx`.
- `--bad` is now bone-on-dark / ink-on-light (alarm via contrast + icons, not hue); `--ok` = lemon; `--warn` = taupe; `--info` = gray.
- The accent picker was REMOVED — one lemon accent for everyone. `data-accent` remaps are inert.
- Verified by an automated sweep: zero saturated colors outside lemon/taupe remain in `src/`.

## 2 · Theme — the DEVICE decides; light is primary

- Default theme is now **`follow`**: the app mirrors the OS light/dark nature (verified: on a bare device it resolves LIGHT).
- Theme order in Settings: **Follow device (default) · SADEEM Light (primary) · Dark · Deep · Carbon · High contrast**.
- Pre-v11.3 `soft` profiles migrate to `follow`; explicit light/dark picks are honored.
- Theme cards carry painted real-palette previews; labels updated in EN/AR.

## 3 · The stream rebuilt on THREE channels (the big fix)

The user saw thinking tags, `[stagnation guard]`, `[auto-compacted…]`, `[verify]`, `[critic]`… interleaved with the answer, and the same notices repeating mid-answer. Root cause: everything rode one `text_delta` channel. Now:

- **`text_delta`** — the model's answer ONLY. Clean markdown end to end.
- **`think_delta`** — reasoning streams into the dedicated Thinking block. No `<thinking>` tags ever touch the text (a legacy parser still renders old transcripts).
- **`sys_notice`** — 43 harness sites (verify, ui-quality, goal verifier, critic, claim audit, red→green, regression, fake-test gate, mutation gate, proof, stagnation guard, auto-compaction, failover, subagent progress, agency gate…) emit a dedicated event, rendered as quiet hairline chips (label + text), never inside the answer.
- **Anti-repetition**: every notice is deduped per run (`kind::text`) in the engine AND in the renderer — the stagnation guard and verifiers cannot repeat the same line into the stream anymore.
- Register-side coalescing buffers keep the channels separate at 33ms IPC cadence.

## 4 · Smooth, fluid motion

- Renderer delta flush moved from per-rAF bursts to a **steady 85 ms cadence** — the reveal reads like calm typing, not machine-gun bursts.
- Stream rows rise on a 420 ms `cubic-bezier(0.22,1,0.36,1)`; thinking dots wave at 1.8 s, the caret breathes at 1.5 s (was 1.05/1.1 s with hard `steps()`); everything honors reduced-motion.

## 5 · Context meters that tell the truth

The ring/bar showed the SESSION SUM of input tokens — it grew every turn and lied. Now:

- `lastTurnUsage` (the last completed turn's `inputTokens + cacheRead + cacheCreation`) IS the real context fill — each turn re-sends the whole transcript.
- Composer bar, status-bar ring + popover, and the ContextLens all derive from it (`src/lib/ctx.ts`). Session totals remain for cost/billing only.
- Verified: seeded 87,300 tokens of a 200,000 window → **44 %** everywhere (the old math said 64 %).

## 6 · Accounts: created on the WEBSITE (OpenCode-style activation)

Creating an account inside the app is GONE. Now:

1. App → Settings → Account → **Continue on the website** — mints a 6-char pair code and opens `<site>/auth.html#pair=…`.
2. The user creates the account (or signs in) on the site — password never touches the app.
3. **Open SADEEM** fires `sadeem://auth/callback?pair=…&email=…&name=…&plan=…`.
4. The app claims the `sadeem://` scheme (`open-url` on macOS, second-instance argv on Windows/Linux), validates the pair (15-minute TTL, one-time use), creates the website-origin account and opens the session.

- Local sign-in stays for device accounts; website accounts sign in via the site.
- **Website**: new `auth.html` (design-identical, EN/AR + RTL, `ar-auth.json`), client-side accounts (SHA-256, localStorage — honest: no server in this build).
- **Console page**: new "Your AI usage" panel — plan, per-day token bars (lemon = today), runs, cost. The app hands a usage snapshot in the deep link; the site stores it locally. No invented cloud.
- E2E tested in the real Electron main process: wrong pair rejected, right pair activates, session readable, pair replay blocked — **E2E_VERDICT: PASS**.

## 7 · AI core discipline (v11.3 prompt section)

New "Output discipline" block in the system prompt: prose and code never share a line (code only in fenced blocks); never print harness-style markers; each fact appears once (no loops); understand the WHOLE request before answering (all subtasks addressed); use the full tool belt and verify with tools instead of memory.

## 8 · Website (still design-identical, word-for-word)

- Competitor mentions removed everywhere (foot credits, changelog). Provider names (Anthropic/OpenAI/OpenRouter keys) remain as functional configuration facts.
- Download page: **one setup installer** (+ Linux "planned" card). Portable zip and source tarball cards removed; copy + FAQ updated in EN/AR.
- `sitemap.xml` includes `auth.html`.

## Screenshots (real, Xvfb 1680×1050)

| File | Shows |
| --- | --- |
| `01-home-follow-light.png` | follow → light on a bare device; light-primary home |
| `02-home-dark.png` | secondary dark theme, warm graphite + lemon |
| `03-stream-clean.png` | THINK band: notice chips + expanded Thinking block + CLEAN answer |
| `04-context-ring.png` | ring popover: 87300/200000 · 44 % (real last-turn fill) |
| `05-account-website-flow.png` | Account: "Continue on the website" activation card |
| `06-appearance-themes.png` | theme cards: Follow device (default) first, Light primary |
| `07-website-auth.png` | website auth.html |
| `08-website-pair.png` | website signup → pair panel |
| `09-website-usage.png` | console.html usage panel (bars, PRO, cost) |
| `10-app-pair-waiting.png` | app waiting state with pair code |

## Deliverables

- `sadeem-v11.3.0-src.tar.gz` — full source (build: `npm ci && npm run full`)
- `SADEEM-website.zip` — the website incl. `auth.html`, `usage.js`, cleaned download page
- `sadeem-v11.3.0-shots.zip` — the ten screenshots above

## Known limits (honest)

- The activation handshake is device-local (deep link + pair code); there is no hosted gateway in this build, so "usage on the website" syncs locally at activation time.
- `sadeem://` scheme registration is OS-dependent; the pair panel also shows a copyable deep link as fallback.
