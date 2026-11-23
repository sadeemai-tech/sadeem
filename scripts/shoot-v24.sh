#!/bin/bash
# Surnia v2.4.0 screenshot runner — real Electron under Xvfb, KODEX_SHOT mode.
# Captures: welcome-AR (glass v7 obsidian), welcome-en (light), plans-AR (free
# season), settings-appearance (glass groups + specular toggle), flows panel
# (rail 07) inside the demo workspace, chat shell with composer.
set -u
cd /home/z/my-project/surnia
SHOT_HOME=/tmp/surnia-shot-home
mkdir -p "$SHOT_HOME/.config/Surnia" shots

seed() {
  python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
theme, lang, recent = sys.argv[1], sys.argv[2], sys.argv[3]
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
    "recentPaths": [recent] if recent else [],
    "usageLog": [],
    "ui": {"glassLevel": "strong", "ambientGlow": True, "accent": "sage",
           "chatWidth": "cozy", "motionSpeed": 1, "specularEdges": True},
})
json.dump(cfg, open(p, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() {
  local theme="$1" lang="$2" out="$3" js="$4" recent="$5"
  seed "$theme" "$lang" "$recent"
  echo "── $out (theme=$theme lang=$lang)"
  HOME="$SHOT_HOME" KODEX_SHOT="/home/z/my-project/surnia/shots/$out" KODEX_SHOT_JS="$js" DISPLAY=:99 \
    timeout 90 ./node_modules/.bin/electron . --no-sandbox --disable-gpu >/dev/null 2>/tmp/surnia-electron-err.log
  echo "   exit=$? $( [ -f "/home/z/my-project/surnia/shots/$out" ] && echo "size=$(stat -c%s "/home/z/my-project/surnia/shots/$out")" )"
}

# ---- driver snippets ----
OPEN_PLANS="const btns=[...document.querySelectorAll('button')];const c=btns.find(b=>b.querySelector('.lucide-crown'));if(c)c.click();"
OPEN_SETTINGS="const btns=[...document.querySelectorAll('button')];const c=btns.find(b=>b.querySelector('.lucide-settings'));if(c)c.click();"
# open demo workspace from welcome recents, then click the flows rail item
OPEN_FLOWS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3500);}const f=btns().find(b=>b.querySelector('.lucide-workflow'));if(f){f.click();await sleep(900);}})();"
# open workspace + chat shell (default rail)
OPEN_WS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3500);}})();"

rm -f shots/*.png
shot obsidian ar  welcome-ar.png        ""            ""
shot light    en  welcome-en.png        ""            ""
shot midnight ar  plans-ar.png          "$OPEN_PLANS" ""
shot obsidian en  settings-appearance.png "$OPEN_SETTINGS" ""
shot obsidian ar  flows-ar.png          "$OPEN_FLOWS" "/tmp/demo-app"
shot obsidian en  chat-en.png           "$OPEN_WS"    "/tmp/demo-app"
ls -la shots/
