# SADEEM v11.5.0 — packaging manifest

## What's in this drop
- sadeem-v11.5.0-source.zip — full source + prebuilt bundles (dist/, dist-electron/, dist-cli/). Run `npm install` once, then `npm run full` to rebuild.
- SADEEM-website-v12.zip — the complete website (works on any static host AND via double-click file:// — accounts, Arabic, pairing all function offline).

## Verify
1. Website: unzip → open index.html (or host it) → Create account → it works. Sign out happens in console.html; sign-in reuses the same store.
2. App: npm install && npm run full → npm start (electron .) — the auth gate, workspace, settings all use the black/white/lime law with the official logo.
3. Tests: npm test → 179/179.
