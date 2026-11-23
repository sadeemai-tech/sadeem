#!/bin/bash
# SADEEM v11.6 — QA harness: boot the app under Xvfb and screenshot states.
# Usage: qa-shot-v116.sh <out.png> <lang> [jsfile] [home-suffix]
set -u
APP=/home/z/my-project/work/sadeem-v113
OUT="$1"; LANG_="${2:-en}"; JSF="${3:-}"; HSUF="${4:-}"
SHOT_HOME="/tmp/sadeem-qa-home$HSUF"
mkdir -p "$SHOT_HOME/.config/SADEEM"
python3 - "$LANG_" "$HSUF" <<'PYEOF'
import json, sys, os
lang, hsuf = sys.argv[1], sys.argv[2]
cfg = {"theme": "obsidian", "language": lang, "onboardingDone": True,
       "fontSize": 14, "terminalFontSize": 12,
       "recentPaths": ["/tmp/demo-app"]}
json.dump(cfg, open(f"/tmp/sadeem-qa-home{hsuf}/.config/SADEEM/settings.json", "w"), ensure_ascii=False, indent=2)
PYEOF
if [ -n "$JSF" ]; then JSARG="$(cat "$JSF")"; else JSARG=""; fi
BASE="$(basename "$OUT")"
HOME="$SHOT_HOME" KODEX_SHOT="$APP/$OUT" \
  KODEX_SHOT_JS="$JSARG" KODEX_SHOT_RESULT="/tmp/qa-js-result.txt" DISPLAY=:99 \
  timeout 90 "$APP/node_modules/.bin/electron" . --no-sandbox --disable-gpu \
  >"/tmp/qa-stdout-$BASE.log" 2>"/tmp/qa-stderr-$BASE.log"
echo "exit=$? png=$(stat -c%s "$APP/$OUT" 2>/dev/null || echo none)"
