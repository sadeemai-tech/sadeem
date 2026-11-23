#!/bin/bash
# v7 second pass — MCP panel + scrolled Agent settings (router card) + dark agent
set -u
cd /home/z/my-project/surnia
SHOT_HOME=/tmp/surnia-shot-home
mkdir -p "$SHOT_HOME/.config/Surnia" shots

seed() {
  python3 - "$1" "$2" <<'PYEOF'
import json, sys
theme, lang = sys.argv[1], sys.argv[2]
p = "/tmp/surnia-shot-home/.config/Surnia/settings.json"
try: cfg = json.load(open(p))
except Exception: cfg = {}
cfg.update({"theme": theme, "language": lang, "onboardingDone": True, "localOnly": True,
  "fontSize": 14, "terminalFontSize": 12, "recentPaths": ["/tmp/demo-app"],
  "ui": {"glassLevel": "soft", "ambientGlow": True, "accent": "sage", "chatWidth": "cozy", "motionSpeed": 1, "specularEdges": True}})
json.dump(cfg, open(p, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() {
  local theme="$1" lang="$2" out="$3" js="$4"
  seed "$theme" "$lang"
  echo "── $out"
  HOME="$SHOT_HOME" KODEX_SHOT="/home/z/my-project/surnia/shots/$out" KODEX_SHOT_JS="$js" DISPLAY=:99 \
    timeout 90 ./node_modules/.bin/electron . --no-sandbox --disable-gpu >/dev/null 2>/tmp/surnia-electron-err.log
  echo "   exit=$? $( [ -f "/home/z/my-project/surnia/shots/$out" ] && echo "size=$(stat -c%s "/home/z/my-project/surnia/shots/$out")" )"
}

OPEN_WS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3200);}})();"
OPEN_MCP="${OPEN_WS}(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='04'&&(x.textContent||'').includes('04'));const m=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('MCP'));if(m){m.click();await sleep(1500);}})();"
OPEN_AGENT_SCROLL="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(2800);}const s=btns().find(b=>b.querySelector('svg path[d^=\"M12 3.4\"]'));if(s){s.click();await sleep(1200);}const nav=[...document.querySelectorAll('button')].filter(b=>(b.textContent||'').replace(/\d/g,'').trim()==='Agent').pop();if(nav){nav.click();await sleep(900);}const pane=[...document.querySelectorAll('.set-scroll')].pop();if(pane){pane.scrollTop=pane.scrollHeight*0.55;}await sleep(700);})();"

pkill -f "Xvfb :99" 2>/dev/null
Xvfb :99 -screen 0 1600x1000x24 >/tmp/surnia-xvfb.log 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 1

shot soft en 14-mcp-panel-en.png "$OPEN_MCP"
shot soft ar 15-mcp-panel-ar.png "$OPEN_MCP"
shot soft en 16-agent-router-en.png "$OPEN_AGENT_SCROLL"
shot soft ar 17-agent-router-ar.png "$OPEN_AGENT_SCROLL"

kill $XVFB_PID 2>/dev/null
ls -la shots/ | tail -6
