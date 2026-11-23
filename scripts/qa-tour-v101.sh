#!/bin/bash
# SADEEM v10.1 — palette-verification screenshot tour (real app, real data).
set -u
cd /home/z/my-project/sadeem
OUT=docs/ui-review
mkdir -p "$OUT"
SHOT_HOME=/tmp/s101-home
mkdir -p "$SHOT_HOME"

seed() { # $1=theme $2=lang
  mkdir -p "$SHOT_HOME/.config/SADEEM"
  python3 - "$1" "$2" <<'PYEOF'
import json, sys
theme, lang = sys.argv[1], sys.argv[2]
d = "/tmp/s101-home/.config/SADEEM/settings.json"
cfg = {
    "schemaVersion": 4, "language": lang, "theme": theme,
    "permissionMode": "default", "model": {"provider": "anthropic", "model": "claude-sonnet-5.5"},
    "providers": {}, "fontSize": 13, "terminalFontSize": 12,
    "autoApproveEdits": False, "checkpointsEnabled": True,
    "onboardingDone": True, "localOnly": False,
    "recentPaths": ["/tmp/s9-proj"], "mcpServers": [], "usageLog": [],
    "ui": {"glassLevel": "off", "ambientGlow": False, "accent": "sage", "density": "comfortable"},
}
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() { # $1=out $2=theme $3=lang $4=js
  seed "$2" "$3"
  echo "── $(basename "$1") [$2/$3]"
  env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/$1" KODEX_SHOT_JS="$4" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s101-err.log
  echo "   exit=$? $( [ -f "$OUT/$1" ] && echo "size=$(stat -c%s "$OUT/$1")" )"
}

ENTER="new Promise(res=>{const eb=[...document.querySelectorAll('button')].find(b=>/Enter SADEEM/i.test(b.textContent||'')); if(eb){eb.click(); setTimeout(()=>res('entered'),1600);} else {res('already');}})"
RAIL() { echo "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='$1'); if(b)b.click(); setTimeout(()=>res(r),1000);}))"; }
SET() { echo "$ENTER.then(r=>new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'$1'}})); setTimeout(()=>res(r),1100);})).then(r=>new Promise(res=>{ $2 setTimeout(()=>res(r),900); }))"; }

shot 22-palette-home-dark.png obsidian en "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='Home'); if(b)b.click(); setTimeout(()=>res(r),900);}))"

shot 23-palette-workspace-dark.png obsidian en "$(RAIL Workspace)"

shot 24-palette-terminal-dark.png obsidian en "$(RAIL Workspace).then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='Toggle terminal'); if(b)b.click(); setTimeout(()=>res(r),1400);}))"

shot 25-palette-settings-models.png obsidian en "$(SET models '')"

shot 26-palette-agent-inventory.png obsidian en "$(SET agent '')"

shot 27-palette-light.png light en "$(RAIL Workspace)"

shot 28-palette-arabic.png obsidian ar "$(RAIL Workspace)"

# SCROLL PROOF on this build (numeric)
seed obsidian en
env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/29-scroll-proof-v101.png" KODEX_SHOT_RESULT=/tmp/scroll-v101.json \
  KODEX_SHOT_JS="$ENTER.then(r=>new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'models'}})); setTimeout(()=>res(r),1100);})).then(r=>new Promise(res=>{const c=document.querySelector('.set-content'); if(!c){res('NO .set-content');return;} const before={sh:c.scrollHeight,ch:c.clientHeight,st:c.scrollTop}; c.scrollTop=99999; setTimeout(()=>{const after={sh:c.scrollHeight,ch:c.clientHeight,st:c.scrollTop}; res(JSON.stringify({before,after,scrollable:before.sh>before.ch,moved:after.st>0}));},600);}))" \
  timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s101-err.log
echo "scroll-proof exit=$?"
echo "=== SCROLL PROOF RESULT ==="
cat /tmp/scroll-v101.json 2>/dev/null || echo "(missing)"
