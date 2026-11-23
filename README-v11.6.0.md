# SADEEM v11.6.0 — "Guest Pass + Prompt Library"

**Release date:** 2026-11-14 · **Codename:** `Guest Pass`

The auth gate is no longer a wall with one door. You can now SKIP it — on a
device-level 7-day guest pass — and when the pass runs out, sign-in becomes
mandatory again. On top of that: a real Prompt Library, a What's-New card,
and a cleaner account gate with a live countdown.

## 1 · Guest pass — skip sign-in, honestly time-limited (طلب المستخدم)

- **"Skip for now — 7-day guest pass"** on the auth gate (bilingual: `تخطي الآن — تمرير ضيف 7 أيام`).
- The clock is **device-level and starts at the FIRST skip** — re-skipping never extends it, deleting the app data resets it (stated honestly in the UI).
- The guest session **persists across restarts** (stored as a real session, `guest.json` + `session.json`, mode 0600).
- **After the window: sign-in is mandatory.** The expired pass is rejected at boot, the skip button disappears, and the gate shows *"The 7-day guest pass has ended — sign in or create an account to continue."*
- **Live countdown everywhere:** `GUEST · 7d` pill in the status bar (click → Settings → Account), guest profile card with days-left chip and an urgent warning at ≤ 2 days.
- Creating or signing into a real account (local or via the website pairing) consumes the pass immediately.

## 2 · Prompt Library (rail 13 — researched feature)

Claude Code has custom commands, Cursor has prompt files, OpenCode has
commands — SADEEM now has a first-class **Prompt Library**:

- Save any recurring prompt with a name (dedup by name → upsert).
- Search, one-click **Insert** into the composer, delete, refresh.
- Also reachable from the chat with **`/prompts`**.
- Device-local (`prompts.json`, mode 0600), capped at 200 items.

## 3 · What's New card (release readiness)

Once per version: after the gate releases, a bilingual card lists the
release highlights and stamps `lastSeenVersion` in settings — never nags twice.

## 4 · Fixes & polish

- **Fixed two syntax corruptions in StatusBar.tsx** (`PROVIDER_PRESETS[model…]` + the `useEffect` deps array) that shipped broken in the v11.5.0 tree.
- The auth gate now reads its version from the single `APP_VERSION` constant (no more hardcoded strings).
- Guest button, expired notice and countdown all obey the brand law: black / white / lime, Cairo (AR) + Inter (EN).

## Verification (all on this machine)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| unit tests | **159 pass / 0 fail** |
| fresh boot → gate with skip | ✔ shot 01 |
| click skip → guest session + What's-New | ✔ shot 02 |
| restart → guest restored, `GUEST · 7d` pill | ✔ DOM probe + shots 03/06 |
| prompt save → toast + 1 item | ✔ shot 05 |
| expired pass → gate holds, skip gone, notice shown | ✔ shot 07 |
| Arabic RTL gate | ✔ shot 08 |

## Packaging

- `SADEEM-Setup-11.6.0.exe` — NSIS installer (assisted, choose dir, desktop shortcut)
- `SADEEM-11.6.0-portable.exe` — single-file portable
- `SADEEM-11.6.0-win.zip` — unpacked portable folder
- exe carries the SADEEM icon + ProductVersion 11.6.0.0 (pure-JS resedit, no wine)

## Downloads & checksums

Everything lives in `download/` with `SHA256SUMS-sadeem-v11.6.0.txt`.
Compare the hash before you run anything.
