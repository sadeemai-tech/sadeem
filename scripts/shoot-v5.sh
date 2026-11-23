#!/bin/bash
# Surnia v5 — full screenshot tour: every corner, EN + AR, soft theme.
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
    "ui": {"glassLevel": "soft", "ambientGlow": True, "accent": "sage",
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

OPEN_WS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3500);}})();"
OPEN_RAIL="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3200);}const f=btns().find(b=>b.querySelector('ICONCLASS'));if(f){f.click();await sleep(1000);}})();"
OPEN_SETTINGS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3000);}const s=btns().find(b=>b.querySelector('svg path[d^=\"M12 3.4\"]'));if(s){s.click();await sleep(1400);}})();"
OPEN_DNA="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3200);}const f=btns().find(b=>b.querySelector('svg path[d^=\"M7.5 3c0 4.7\"]'));if(f){f.click();await sleep(1100);}})();"

rm -f shots/*.png
XVFB_LOG=/tmp/surnia-xvfb.log
Xvfb :99 -screen 0 1600x1000x24 >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 1

# welcome (soft, both languages)
shot soft ar      01-welcome-ar.png     ""            ""
shot soft en      02-welcome-en.png     ""            ""

# workspace + chat shell
shot soft ar      03-workspace-ar.png   "$OPEN_WS"    /tmp/demo-app
shot soft en      04-workspace-en.png   "$OPEN_WS"    /tmp/demo-app

# rail 08 skills / rail 09 artifacts
shot soft ar      05-skills-ar.png      "${OPEN_RAIL/ICONCLASS/.lucide-blocks}"     /tmp/demo-app
shot soft en      06-artifacts-en.png   "${OPEN_RAIL/ICONCLASS/.lucide-badge-check}" /tmp/demo-app

# flows + MCP rail (compare-ready)
shot soft ar      07-flows-ar.png       "${OPEN_RAIL/ICONCLASS/.lucide-workflow}"   /tmp/demo-app
shot soft en      08-mcp-en.png         "${OPEN_RAIL/ICONCLASS/.lucide-server}"     /tmp/demo-app

# settings (appearance) + DNA
shot soft en      09-settings.png       "$OPEN_SETTINGS"  /tmp/demo-app
shot soft en      10-dna-en.png         "$OPEN_DNA"      /tmp/demo-app

# dark themes for comparison
shot obsidian ar  11-dark-ar.png        "$OPEN_WS"    /tmp/demo-app
shot midnight en  12-midnight-en.png    "$OPEN_WS"    /tmp/demo-app

kill $XVFB_PID 2>/dev/null
ls -la shots/
