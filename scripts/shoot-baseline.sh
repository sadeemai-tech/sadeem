#!/bin/bash
# Surnia v5 baseline + tour screenshot runner (Xvfb + KODEX_SHOT mode).
set -u
cd /home/z/my-project/surnia
SHOT_HOME=/tmp/surnia-shot-home
mkdir -p "$SHOT_HOME/.config/Surnia" shots

# tiny demo workspace so the workspace shell has real files
if [ ! -d /tmp/demo-app ]; then
  mkdir -p /tmp/demo-app/src /tmp/demo-app/docs
  cat > /tmp/demo-app/index.html <<'EOF'
<!doctype html><html><head><meta charset="utf-8"><title>Demo</title></head>
<body style="font-family:sans-serif;padding:2rem"><h1>Demo App</h1><p>Hello from the demo workspace.</p></body></html>
EOF
  cat > /tmp/demo-app/src/app.js <<'EOF'
console.log('demo');
EOF
  cat > /tmp/demo-app/docs/readme.md <<'EOF'
# Demo app
A tiny workspace used for screenshots.
EOF
fi

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
OPEN_SETTINGS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3000);}const s=btns().find(b=>b.querySelector('.lucide-settings'));if(s){s.click();await sleep(800);}})();"
OPEN_WS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3500);}})();"
OPEN_FLOWS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3000);}const f=btns().find(b=>b.querySelector('.lucide-workflow'));if(f){f.click();await sleep(900);}})();"
OPEN_DNA="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3000);}const f=btns().find(b=>b.querySelector('.lucide-brain')||b.querySelector('.lucide-sparkles'));if(f){f.click();await sleep(900);}})();"

rm -f shots/*.png
XVFB_LOG=/tmp/surnia-xvfb.log
Xvfb :99 -screen 0 1600x1000x24 >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 1

shot soft ar      00-welcome-ar.png    ""          ""
shot light    en  01-welcome-en.png    ""          ""
shot soft ar      02-ws-ar.png         "$OPEN_WS"     /tmp/demo-app
shot soft en      03-ws-chat-en.png    "$OPEN_WS"     /tmp/demo-app
shot soft en      04-settings.png      "$OPEN_SETTINGS" /tmp/demo-app
shot soft ar      05-flows-ar.png      "$OPEN_FLOWS"  /tmp/demo-app
shot soft en      06-dna-en.png        "$OPEN_DNA"    /tmp/demo-app

kill $XVFB_PID 2>/dev/null
ls -la shots/
