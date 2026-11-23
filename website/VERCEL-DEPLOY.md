# SADEEM website → Vercel

## الحالة بصراحة (Honest status)
The site is **fully prepared** for Vercel, but it has **not been uploaded**. This environment has:
- no `vercel` CLI installed,
- no `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`,
- no stored login at `~/.vercel`.

Uploading needs either an interactive browser login or a token. I cannot perform either from here. Nothing is blocking on the code side.

## Method A — CLI (recommended, 3 commands)
```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0\website"
npx vercel login          # opens browser, sign in to Vercel
npx vercel link           # select/create project; ROOT DIRECTORY = website
npx vercel --prod         # deploy to production
```
If Vercel asks for the root directory, choose **`.` / `website`** (the folder containing `package.json`, `next.config.mjs`, `app/`). Do NOT choose the repository root — that is the Electron app.

## Method B — token (non-interactive, CI)
```powershell
$env:VERCEL_TOKEN = '<your-token>'
npx vercel --token $env:VERCEL_TOKEN --prod --yes --scope <your-team-or-user>
```
Get a token from https://vercel.com/account/tokens. Never commit it.

## Method C — Git import
Push `website/` as its own repository (or set Vercel's Root Directory to `website` in a monorepo), then Import Project in the Vercel dashboard. Build settings are already in `vercel.json`.

## What is already configured
- `vercel.json`: framework `nextjs`, `npm run build`, `cleanUrls`, and correct `text/yaml` for `/updates/latest.yml`.
- `next.config.mjs`: `outputFileTracingRoot` points at the repo root, so the extra `package-lock.json` warning is gone.
- `public/downloads/*` + `public/updates/latest.yml` are committed with **real** v11.12.0 hashes.
- `/auth` is emitted as `auth.html` by Next and works with the app's `sadeem://auth/callback` deep link.

## After deploying — required for the desktop app
1. Set the public site URL in the app via `SADEEM_SITE_URL` at build time if it is not `https://sadeem.app` (see `electron/services/authService.ts` → `websiteBaseUrl()`). Otherwise pair-code sign-in will open the wrong site.
2. Verify `/updates/latest.yml` returns YAML (not HTML) and that `/downloads/SADEEM-Setup-11.12.0.exe` downloads.
3. A code-signing certificate is still required to remove the Windows SmartScreen warning; the feed is HTTPS + SHA-512 signed by hash only.
4. Regenerate hashes after every rebuild: `node scripts/publish-release.mjs` (run from the repo root), then redeploy.
