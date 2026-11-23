#!/bin/bash
# QA runner: boots Surnia under Xvfb, injects a JS driver, captures a PNG and
# the renderer console (for numeric overlap reports). Usage:
#   qa-shot.sh <out.png> <theme> <lang> <jsfile> [recent]
set -u
cd /home/z/my-project/work/surnia
OUT="$1"; THEME="$2"; LANG_="$3"; JSF="${4:-}"; RECENT="${5:-/tmp/demo-app}"
SHOT_HOME=/tmp/surnia-qa-home
mkdir -p "$SHOT_HOME/.config/Surnia" shots
python3 - "$THEME" "$LANG_" "$RECENT" <<'PYEOF'
import json, sys
theme, lang, recent = sys.argv[1], sys.argv[2], sys.argv[3]
p = "/tmp/surnia-qa-home/.config/Surnia/settings.json"
cfg = {
    "theme": theme, "language": lang, "onboardingDone": True, "localOnly": True,
    "fontSize": 14, "terminalFontSize": 12,
    "recentPaths": [recent] if recent else [], "usageLog": [],
    "ui": {"glassLevel": "strong", "ambientGlow": True, "accent": "sage",
           "chatWidth": "cozy", "motionSpeed": 1, "specularEdges": True},
}
json.dump(cfg, open(p, "w"), ensure_ascii=False, indent=2)
PYEOF
HOME="$SHOT_HOME" KODEX_SHOT="/home/z/my-project/work/surnia/$OUT" \
  KODEX_SHOT_JS="$(cat "$JSF")" KODEX_SHOT_RESULT="/tmp/qa-report.json" DISPLAY=:99 \
  timeout 90 ./node_modules/.bin/electron . --no-sandbox --disable-gpu --enable-logging \
  >"/tmp/qa-stdout.log" 2>"/tmp/qa-stderr.log"
EC=$?
echo "exit=$EC png=$(stat -c%s "/home/z/my-project/work/surnia/$OUT" 2>/dev/null || echo none)"
grep -a "QA_REPORT" /tmp/qa-stderr.log | head -4
