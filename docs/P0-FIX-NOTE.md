# P0 FIX — kdx:cmd:run (post-audit, same session)

The audit's P0 #1 (unguarded shell execution) was fixed in `electron/ipc.ts`:

- `spawn(argv[0], argv.slice(1), { shell: false })` — no shell at all.
- `CMD_RUN_META` rejects shell metacharacters.
- Allow-list only: `npm/pnpm/yarn test…`, `node --test`, jest, vitest,
  pytest, cargo, go, dotnet. Arbitrary commands are refused.
- Minimal child `env` (PATH/SystemRoot/TEMP/HOME/LANG/NODE_ENV/CI) —
  no inherited API keys or tokens.
- `fsSvc.assertSafePath(cwd)` jails the working directory to allowed roots.
- Mandatory native approval dialog (`dialog.showMessageBoxSync`); denial is
  the default, and the pre-approval call returns `APPROVAL_REQUIRED`.
- `event.senderFrame.url` origin check (trusted `file:` or loopback only).
- Every approval is recorded via `auditAppend('term_allow', …)`.

Verification: `tsc --noEmit -p tsconfig.node.json` → pass.
`tests/v1113-audit.test.mjs` → 12/12 pass.

Still required before publishing (audit P0 #2): freeze all source edits, run
`npm run full`, `npm run dist:win`, `node scripts/publish-release.mjs`, then
re-upload artifacts and hashes to the host.
