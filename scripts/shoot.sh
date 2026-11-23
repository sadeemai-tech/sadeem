#!/bin/bash
# Kodex screenshot runner — real Electron under Xvfb, KODEX_SHOT capture mode.
set -u
cd /home/z/my-project/kodex

shot() {
  local theme="$1" lang="$2" out="$3"
  python3 - "$theme" "$lang" <<'PYEOF'
import json, sys
d = "/tmp/kodex-shot-home/.config/Surnia/settings.json"
cfg = json.load(open(d))
cfg["theme"], cfg["language"] = sys.argv[1], sys.argv[2]
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
PYEOF
  echo "── $out (theme=$theme lang=$lang)"
  HOME=/tmp/kodex-shot-home KODEX_SHOT="$out" \
    timeout 60 xvfb-run -a --server-args="-screen 0 1600x1000x24" \
    ./node_modules/.bin/electron . --no-sandbox 2>/tmp/kodex-electron-err.log
  echo "   exit=$? $( [ -f "$out" ] && echo "size=$(stat -c%s "$out")" )"
}

mkdir -p shots
rm -f shots/*.png
shot obsidian ar  shots/main-ar.png
shot midnight ar  shots/ink.png
shot light    en  shots/paper.png
ls -la shots/
