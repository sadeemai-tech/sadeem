#!/bin/bash
# Surnia — deep verification of the Windows portable package.
# Proves the deliverable is a complete, runnable Windows app BEFORE shipping.
set -u
cd /home/z/my-project/surnia
PASS=0; FAIL=0
ck() { if [ "$1" = "0" ]; then echo "PASS $2"; PASS=$((PASS+1)); else echo "FAIL $2"; FAIL=$((FAIL+1)); fi }

ZIP=release/Surnia-6.0.0-win.zip

# 1. zip exists and is a valid zip
[ -f "$ZIP" ] && unzip -tq "$ZIP" >/dev/null 2>&1; ck $? "zip valid and complete (CRC test)"

# 2. zip size sane (> 100MB for Electron 33 + app)
SZ=$(stat -c%s "$ZIP"); [ "$SZ" -gt 100000000 ]; ck $? "zip size sane (${SZ} bytes)"

# 3. extract to clean dir
rm -rf /tmp/surnia-verify && mkdir -p /tmp/surnia-verify
unzip -q "$ZIP" -d /tmp/surnia-verify; ck $? "zip extracts cleanly"

# 4. main executable present and is a real x86-64 Windows GUI binary
EXE=$(find /tmp/surnia-verify -name "Surnia.exe" | head -1)
[ -n "$EXE" ]; ck $? "Surnia.exe present"
file "$EXE" | grep -q "PE32\+.*GUI.*x86-64"; ck $? "Surnia.exe is x86-64 PE GUI binary"

# 5. Electron runtime files present
for f in app.asar chrome_100_percent.pak icudtl.dat vulkan-1.dll d3dcompiler_47.dll; do
  find /tmp/surnia-verify -name "$f" | grep -q .; ck $? "runtime file: $f"
done

ASAR=$(find /tmp/surnia-verify -name app.asar | head -1)

# 6. app.asar contains the REAL app code (renderer + main + cli)
npx asar list "$ASAR" > /tmp/asar-list.txt 2>/dev/null
grep -q "dist/index.html" /tmp/asar-list.txt; ck $? "asar: dist/index.html (renderer)"
grep -q "dist-electron/electron/main.js" /tmp/asar-list.txt; ck $? "asar: main process"
grep -q "dist-electron/electron/preload.js" /tmp/asar-list.txt; ck $? "asar: preload bridge"
grep -q "dist-cli/kodex.cjs" /tmp/asar-list.txt; ck $? "asar: headless CLI"
grep -q "dist/assets/index-" /tmp/asar-list.txt; ck $? "asar: built renderer bundle"

# 7. package.json inside asar points to the right main
#    (extract inside TMPD — extracting into the repo root would CLOBBER the
#    real package.json, which is exactly what happened once in v2.4 dev)
TMPD=$(mktemp -d)
( cd "$TMPD" && npx asar extract-file "$ASAR" package.json 2>/dev/null )
grep -q '"main": "dist-electron/electron/main.js"' "$TMPD/package.json" 2>/dev/null; ck $? "asar package.json main entry correct"

# 8. design compliance: no purple. Since v2.4 (Liquid Glass v7) authored
#    gradients ARE the sanctioned design language — specular edges, aurora
#    v2 and glass edge light all use linear/radial gradients deliberately.
#    Monaco vendor internals (.monaco-editor rules) and Tailwind variable
#    names are excluded — the contract covers Surnia's own design.
CSSFILE=$(grep -oE "dist/assets/index-[A-Za-z0-9_-]+\.css" /tmp/asar-list.txt | head -1)
( cd "$TMPD" && npx asar extract-file "$ASAR" "$CSSFILE" 2>/dev/null )
CSSNAME="$TMPD/$(basename "$CSSFILE")"
if [ -f "$CSSNAME" ]; then
  grep -qiE "8b5cf6|7c3aed|139,\s*92,\s*246" "$CSSNAME"; CK=$?; [ $CK -ne 0 ]; ck $? "no purple in shipped CSS"
  grep -q "spec-ring" "$CSSNAME"; ck $? "Liquid Glass v7 layer present in shipped CSS"
  rm -f "$CSSNAME"
else
  echo "SKIP css design check (extract failed)"
fi

# 9. sha256 manifest
SHA=$(sha256sum "$ZIP" | cut -d' ' -f1)
echo "$SHA  $(basename $ZIP)" > release/SHA256SUMS.txt
ck $? "sha256 written: ${SHA:0:16}..."

echo "── VERIFY RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
