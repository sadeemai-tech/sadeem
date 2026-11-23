#!/bin/bash
# Surnia v7 — direct-test screenshot tour: every corner, EN + AR,
# including the NEW v7 surfaces (router card, MCP presets, skills,
# no message stripes, de-cramped title bar, ctx/cache chip).
set -u
cd /home/z/my-project/surnia
SHOT_HOME=/tmp/surnia-shot-home
rm -rf "$SHOT_HOME"
mkdir -p "$SHOT_HOME/.config/Surnia" shots

# demo workspace with real content
mkdir -p /tmp/demo-app/src
cat > /tmp/demo-app/package.json <<'EOF'
{ "name": "demo-app", "version": "1.0.0", "scripts": { "test": "node tests/run.mjs" } }
EOF
cat > /tmp/demo-app/src/app.ts <<'EOF'
export function calc(a: number, b: number) {
  const sum = a + b;
  return sum;
}
export class Greeter {
  greet(name: string) { return `hi ${name}`; }
}
EOF
cat > /tmp/demo-app/README.md <<'EOF'
# demo-app
Tiny fixture used by the Surnia screenshot tour.
EOF

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
    "usageLog": [
        {"date": "2026-11-05", "runs": 6, "tokens": 41000, "costUsd": 0.42},
        {"date": "2026-11-06", "runs": 9, "tokens": 68000, "costUsd": 0.71},
        {"date": "2026-11-07", "runs": 4, "tokens": 22000, "costUsd": 0.19},
        {"date": "2026-11-08", "runs": 7, "tokens": 51000, "costUsd": 0.55},
    ],
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
OPEN_RAIL="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3200);}const f=btns().find(b=>b.querySelector('ICONCLASS'));if(f){f.click();await sleep(1400);}})();"
OPEN_SETTINGS="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(3000);}const s=btns().find(b=>b.querySelector('svg path[d^=\"M12 3.4\"]'));if(s){s.click();await sleep(1400);}})();"
OPEN_SETTINGS_PANE="(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));const btns=()=>[...document.querySelectorAll('button')];let c=btns().find(b=>b.querySelector('.lucide-folder-open'));if(!c)c=btns().find(b=>(b.textContent||'').includes('demo'));if(c){c.click();await sleep(2800);}const s=btns().find(b=>b.querySelector('svg path[d^=\"M12 3.4\"]'));if(s){s.click();await sleep(1200);}const nav=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').includes('PANE_TEXT'));if(nav){nav.click();await sleep(1000);}})();"

rm -f shots/*.png
XVFB_LOG=/tmp/surnia-xvfb.log
pkill -f "Xvfb :99" 2>/dev/null
Xvfb :99 -screen 0 1600x1000x24 >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
sleep 1

# welcome (soft, both languages) — first impression + de-cramped title bar
shot soft ar      01-welcome-ar.png     ""            ""
shot soft en      02-welcome-en.png     ""            ""

# workspace + chat shell (NO message stripes — verify visually)
shot soft ar      03-workspace-ar.png   "$OPEN_WS"    /tmp/demo-app
shot soft en      04-workspace-en.png   "$OPEN_WS"    /tmp/demo-app

# v7 panels: skills + MCP (17 presets incl. Figma/Vercel/Linear/Cloudflare)
shot soft ar      05-skills-ar.png      "${OPEN_RAIL/ICONCLASS/.lucide-blocks}"      /tmp/demo-app
shot soft en      06-mcp-en.png         "${OPEN_RAIL/ICONCLASS/.lucide-server}"      /tmp/demo-app

# settings → Agent section (v7 router card + allowlist)
shot soft en      07-settings-agent-en.png "${OPEN_SETTINGS_PANE/PANE_TEXT/Agent}"   /tmp/demo-app
shot soft ar      08-settings-agent-ar.png "${OPEN_SETTINGS_PANE/PANE_TEXT/الوكيل}"  /tmp/demo-app

# settings → models + feedback pane
shot soft en      09-settings-models.png "${OPEN_SETTINGS_PANE/PANE_TEXT/Models}"    /tmp/demo-app
shot soft ar      10-settings-feedback-ar.png "${OPEN_SETTINGS_PANE/PANE_TEXT/الاقتراحات}"  /tmp/demo-app

# settings general
shot soft en      11-settings.png       "$OPEN_SETTINGS"  /tmp/demo-app

# dark themes for comparison
shot obsidian ar  12-dark-ar.png        "$OPEN_WS"    /tmp/demo-app
shot midnight en  13-midnight-en.png    "$OPEN_WS"    /tmp/demo-app

kill $XVFB_PID 2>/dev/null
ls -la shots/ | tail -16
