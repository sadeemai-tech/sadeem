#!/bin/bash
# Surnia v2.3.0 screenshot runner — real Electron under Xvfb, KODEX_SHOT mode.
# Captures: welcome-AR (obsidian), auth-AR, plans-AR (free season), settings glass.
set -u
# Xvfb must be running: Xvfb :99 -screen 0 1680x1050x24 &  (xauth is absent in this sandbox)
cd /home/z/my-project/surnia
SHOT_HOME=/tmp/surnia-shot-home
mkdir -p "$SHOT_HOME/.config/Surnia" shots

seed() {
  python3 - "$1" "$2" <<'PYEOF'
import json, sys
theme, lang = sys.argv[1], sys.argv[2]
p = "/tmp/surnia-shot-home/.config/Surnia/settings.json"
try:
    cfg = json.load(open(p))
except Exception:
    cfg = {}
cfg.update({
    "theme": theme,
    "language": lang,
    "onboardingDone": True,
    "localOnly": True,
    "fontSize": 14,
    "terminalFontSize": 12,
    "recentPaths": [],
    "usageLog": [],
    "ui": {"glassLevel": "strong", "ambientGlow": True, "accent": "sage", "chatWidth": "cozy", "motionSpeed": 1},
})
json.dump(cfg, open(p, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() {
  local theme="$1" lang="$2" out="$3" js="$4"
  seed "$theme" "$lang"
  echo "── $out (theme=$theme lang=$lang)"
  HOME="$SHOT_HOME" KODEX_SHOT="/home/z/my-project/surnia/shots/$out" KODEX_SHOT_JS="$js" DISPLAY=:99 \
    timeout 90 ./node_modules/.bin/electron . --no-sandbox >/dev/null 2>/tmp/surnia-electron-err.log
  echo "   exit=$? $( [ -f "/home/z/my-project/surnia/shots/$out" ] && echo "size=$(stat -c%s "/home/z/my-project/surnia/shots/$out")" )"
}

# open plans screen: click the Crown button (5th titlebar button with lucide-crown svg)
OPEN_PLANS="const btns=[...document.querySelectorAll('button')];const c=btns.find(b=>b.querySelector('.lucide-crown'));if(c)c.click();"
rm -f shots/*.png
shot obsidian ar welcome-ar.png ""
shot light    en welcome-en.png ""
shot midnight ar plans-ar.png  "$OPEN_PLANS"
ls -la shots/
