#!/usr/bin/env bash
# patch-nsis.sh — SADEEM no-wine build, part 1.
# electron-builder still runs the freshly-built NSIS installer under WINE on
# Linux to generate the uninstaller stub. This patch swaps that for the
# pure-JS UninstallerReader the same upstream code already uses on macOS
# Catalina. Handles both eb 26 branch shapes (WineVmManager / execWine).
# Idempotent. MUST be re-run after every fresh `npm install`.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js"
[[ -f "$TARGET" ]] || { echo "ERROR: $TARGET not found — npm install first." >&2; exit 1; }

python3 - "$TARGET" <<'PY'
import sys
p = sys.argv[1]
src = open(p, encoding='utf8').read()

repl = '''        else {
            // PATCHED (SADEEM): no wine on this Linux build host — use the pure-JS
            // UninstallerReader, the same path the macOS Catalina branch above uses.
            await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
        }'''

old_a = '''        else {
            const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
            await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
        }'''

old_b = '''        else {
            await (0, wine_1.execWine)(installerPath, null, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
        }'''

if old_a in src:
    open(p, 'w', encoding='utf8').write(src.replace(old_a, repl, 1))
    print('PATCHED: eb26 WineVmManager branch -> UninstallerReader.exec')
elif old_b in src:
    open(p, 'w', encoding='utf8').write(src.replace(old_b, repl, 1))
    print('PATCHED: eb26 execWine branch -> UninstallerReader.exec')
elif 'PATCHED (SADEEM)' in src:
    print('Already patched.')
else:
    print('WARNING: no known wine-uninstaller pattern found — inspect NsisTarget.js manually.', file=sys.stderr)
    sys.exit(1)
PY
echo "NSIS no-wine patch OK."
