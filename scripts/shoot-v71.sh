#!/bin/bash
# Surnia v7.1.0 — real Electron screenshots under Xvfb (no GUI needed).
set -u
cd /home/z/work/v7

SHOT_HOME=/tmp/surnia-shot-home
mkdir -p "$SHOT_HOME/.config/Surnia" shots
rm -f shots/*.png

settings() {
  python3 - "$1" "$2" <<'PYEOF'
import json, sys, os
d = "/tmp/surnia-shot-home/.config/Surnia/settings.json"
cfg = {}
if os.path.exists(d):
    try: cfg = json.load(open(d))
    except Exception: cfg = {}
cfg["theme"], cfg["language"] = sys.argv[1], sys.argv[2]
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() {
  local theme="$1" lang="$2" out="$3" js="$4"
  settings "$theme" "$lang"
  echo "── $out (theme=$theme lang=$lang)"
  HOME="$SHOT_HOME" KODEX_SHOT="$out" KODEX_SHOT_JS="$js" \
    timeout 90 xvfb-run -a --server-args="-screen 0 1600x1000x24" \
    ./node_modules/.bin/electron . --no-sandbox 2>/tmp/surnia-electron-err.log
  echo "   exit=$? $( [ -f "$out" ] && echo "size=$(stat -c%s "$out")" )"
}

# 1) Welcome screen — Soft theme, Arabic (default release look)
shot soft ar shots/app-welcome-soft-ar.png ""

# 2) Settings panel — English (isolation / budgets / proven-change controls)
shot soft en shots/app-settings-en.png "setTimeout(() => { const b = document.querySelector('[data-rail*=settings], [aria-label*=settings i], .rail-settings'); if (b) b.click(); }, 400);"

# 3) Title bar close-up proof of the version stamp
shot midnight ar shots/app-titlebar-v710.png ""

ls -la shots/
