# Release notes — v11.6.0 "Guest Pass + Prompt Library"

## Highlights
1. Guest pass: skip the auth gate for a device-level 7-day window; after it ends sign-in is mandatory (skip removed, notice shown, stale session rejected at boot).
2. Prompt Library (rail 13 + /prompts): save, search, re-insert recurring prompts; upsert-by-name; 200-item cap; device-local.
3. What's-New card shown once per version after the gate releases.
4. StatusBar syntax fixes (PROVIDER_PRESETS access + useEffect deps) — the v11.5.0 tree shipped these two broken lines.
5. Auth gate version string now derives from APP_VERSION.

## Upgrade notes
- No data migration needed. settings.json gains `lastSeenVersion`; guest state lives in new files `guest.json`/`session.json` (0600).
- Windows builds renamed to the 11.6.0 artifacts; same three shapes (Setup / portable / zip).
