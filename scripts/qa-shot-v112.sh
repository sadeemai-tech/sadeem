#!/bin/bash
set -u
cd /home/z/my-project/sadeem
OUT="$1"; THEME="$2"; LANG_="$3"; JSF="${4:-}"
SHOT_HOME=/tmp/sadeem-qa-home
CFG="$SHOT_HOME/.config/SADEEM"
mkdir -p "$CFG" shots
python3 - "$THEME" "$LANG_" <<'PYEOF'
import json, sys
theme, lang = sys.argv[1], sys.argv[2]
cfg = {"theme": theme, "language": lang, "onboardingDone": True, "localOnly": True,
       "fontSize": 14, "terminalFontSize": 12,
       "recentPaths": ["/tmp/demo-app"], "usageLog": [],
       "ui": {"glassLevel": "strong", "ambientGlow": True, "accent": "sage",
              "chatWidth": "cozy", "motionSpeed": 1, "specularEdges": True}}
json.dump(cfg, open("/tmp/sadeem-qa-home/.config/SADEEM/settings.json", "w"), ensure_ascii=False, indent=2)
PYEOF
if [ -n "$JSF" ]; then JSARG="$(cat "$JSF")"; else JSARG=""; fi
HOME="$SHOT_HOME" KODEX_SHOT="/home/z/my-project/sadeem/$OUT" \
  KODEX_SHOT_JS="$JSARG" DISPLAY=:99 \
  timeout 90 ./node_modules/.bin/electron . --no-sandbox --disable-gpu \
  >/tmp/qa-stdout.log 2>/tmp/qa-stderr.log
echo "exit=$? png=$(stat -c%s "/home/z/my-project/sadeem/$OUT" 2>/dev/null || echo none)"
