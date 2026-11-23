#!/bin/bash
# SADEEM v11.3.0 — real-screenshot QA harness (Xvfb :99)
# Usage: qa-shot-v113.sh <out.png> <theme> <lang> [jsfile]
set -u
APP=/home/z/my-project/work/sadeem-v113
OUT="$1"; THEME="${2:-follow}"; LANG_="${3:-en}"; JSF="${4:-}"
SHOT_HOME=/tmp/sadeem-qa-home
CFG="$SHOT_HOME/.config/SADEEM"
mkdir -p "$CFG" "$APP/shots"
python3 - "$THEME" "$LANG_" <<'PYEOF'
import json, sys
theme, lang = sys.argv[1], sys.argv[2]
cfg = {"theme": theme, "language": lang, "onboardingDone": True, "localOnly": True,
       "fontSize": 14, "terminalFontSize": 12,
       "recentPaths": ["/tmp/demo-app"], "usageLog": [
         {"date": "2026-11-11", "runs": 6, "tokens": 184320, "costUsd": 1.42},
         {"date": "2026-11-12", "runs": 11, "tokens": 421900, "costUsd": 3.11},
         {"date": "2026-11-13", "runs": 8, "tokens": 266400, "costUsd": 2.05}],
       "ui": {"glassLevel": "strong", "ambientGlow": True, "accent": "sage",
              "chatWidth": "cozy", "motionSpeed": 1, "specularEdges": True}}
json.dump(cfg, open("/tmp/sadeem-qa-home/.config/SADEEM/settings.json", "w"), ensure_ascii=False, indent=2)
PYEOF
if [ -n "$JSF" ]; then JSARG="$(cat "$JSF")"; else JSARG=""; fi
BASE="$(basename "$OUT")"
HOME="$SHOT_HOME" KODEX_SHOT="$APP/$OUT" \
  KODEX_SHOT_JS="$JSARG" DISPLAY=:99 \
  timeout 90 "$APP/node_modules/.bin/electron" . --no-sandbox --disable-gpu \
  >"/tmp/qa-stdout-$BASE.log" 2>"/tmp/qa-stderr-$BASE.log"
echo "exit=$? png=$(stat -c%s "$APP/$OUT" 2>/dev/null || echo none)"
