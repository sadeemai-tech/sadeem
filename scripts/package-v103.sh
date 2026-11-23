#!/bin/bash
# SADEEM v10.3.0 — final packaging: source tar + SHA256 + delivery doc → download/
set -eu
cd /home/z/my-project/sadeem

DL=/home/z/my-project/download
mkdir -p "$DL"

# ---------- 1. source tarball (clean, correct paths) ----------
TAROUT=/home/z/my-project/download/sadeem-v10.3.0-FINAL.tar.gz
rm -f "$TAROUT"
tar --transform 's,^\./,sadeem/,' \
    --exclude='./node_modules' \
    --exclude='./release' \
    --exclude='./dist' \
    --exclude='./dist-cli' \
    --exclude='./dist-electron' \
    --exclude='./tests/.preview.bundle.mjs' \
    --exclude='./tests/.registry.bundle.mjs' \
    --exclude='./tests/.editEngine.bundle.mjs' \
    --exclude='./tests/.mutation.bundle.mjs' \
    --exclude='./tests/.proof.bundle.mjs' \
    --exclude='./tests/.testRecord.bundle.mjs' \
    --exclude='./tests/.mcpOAuth.bundle.mjs' \
    --exclude='./tests/.skillGate.bundle.mjs' \
    --exclude='./tests/.terminalGuard.bundle.mjs' \
    --exclude='./tests/.isolation.bundle.mjs' \
    --exclude='./tests/.browserService.bundle.mjs' \
    --exclude='./tests/.tools.bundle.mjs' \
    --exclude='./tests/.dap.bundle.mjs' \
    --exclude='./tests/.debugTools.bundle.mjs' \
    --exclude='./tests/.linediff.bundle.mjs' \
    -czf "$TAROUT" \
    --transform 's,^\./,sadeem/,' \
    .
echo "tar: $(du -sh "$TAROUT" | cut -f1) ($(tar tzf "$TAROUT" | wc -l) files)"

# ---------- 2. SHA256 ----------
cd "$DL"
sha256sum SADEEM-Setup-10.3.0.exe SADEEM-10.3.0-portable.exe SADEEM-10.3.0-win.zip sadeem-v10.3.0-FINAL.tar.gz > SHA256SUMS-sadeem-v10.3.txt
cat SHA256SUMS-sadeem-v10.3.txt
echo "PACK-DONE"
