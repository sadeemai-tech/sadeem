#!/usr/bin/env bash
# patch-rcedit.sh — SADEEM no-wine build, part 2.
# electron-builder 26 runs rcedit-x64.exe under WINE on Linux to stamp PE
# resources (icon + version strings). This patch swaps that branch for the
# pure-JS `resedit` package (same PE edits, zero wine). Idempotent; re-run
# after every fresh `npm install`. Part 1 (NSIS UninstallerReader) is
# scripts/patch-nsis.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="node_modules/app-builder-lib/out/winPackager.js"
[[ -f "$TARGET" ]] || { echo "ERROR: $TARGET not found — npm install first." >&2; exit 1; }

python3 - "$TARGET" <<'PY'
import sys
p = sys.argv[1]
src = open(p, encoding='utf8').read()

old = '''        else if (this.info.framework.name === "electron") {
            const vendorPath = await (0, windowsSignToolManager_1.getSignVendorPath)();
            await (0, wine_1.execWine)(path.join(vendorPath, "rcedit-ia32.exe"), path.join(vendorPath, "rcedit-x64.exe"), args);
        }'''

new = '''        else if (this.info.framework.name === "electron") {
            // PATCHED (SADEEM): no wine on this Linux build host — apply the same
            // PE resource edits with the pure-JS resedit package instead of
            // running rcedit-x64.exe under wine.
            const resedit = require("resedit");
            const fsx = require("fs/promises");
            const buffer = await fsx.readFile(file);
            const exe = resedit.NtExecutable.from(buffer);
            const res = resedit.NtExecutableResource.from(exe);
            const iconPath2 = await this.getIconPath();
            if (iconPath2 != null) {
                const iconFile = resedit.Data.IconFile.from(await fsx.readFile(iconPath2));
                resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 101, 1033, iconFile.icons.map((item) => item.data));
            }
            const viList = resedit.Resource.VersionInfo.fromEntries(res.entries);
            const vi = viList[0];
            const verParts = (appInfo.shortVersion || appInfo.buildVersion).split(".").map((s) => parseInt(s, 10) || 0);
            while (verParts.length < 4) verParts.push(0);
            vi.setFileVersion(verParts[0], verParts[1], verParts[2], verParts[3], 1033);
            vi.setProductVersion(verParts[0], verParts[1], verParts[2], verParts[3], 1033);
            const stringValues = {};
            for (let ai = 0; ai < args.length; ) {
                if (args[ai] === "--set-version-string" && args[ai + 1]) {
                    if (args[ai + 2]) stringValues[args[ai + 1]] = args[ai + 2];
                    ai += 3;
                } else {
                    ai += 1;
                }
            }
            vi.setStringValues({ lang: 1033, codepage: 1200 }, stringValues);
            vi.outputToResourceEntries(res.entries);
            res.outputResource(exe);
            await fsx.writeFile(file, Buffer.from(exe.generate()));
        }'''

if old in src:
    open(p, 'w', encoding='utf8').write(src.replace(old, new, 1))
    print('PATCHED: wine rcedit -> resedit (pure JS)')
elif 'PATCHED (SADEEM)' in src:
    print('Already patched.')
else:
    print('WARNING: wine branch pattern not found — inspect winPackager.js manually.', file=sys.stderr)
    sys.exit(1)
PY
echo "rcedit no-wine patch OK."
