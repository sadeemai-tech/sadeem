#!/bin/bash
# SADEEM v10 — full UI QA screenshot tour → docs/ui-review/ (real app, real data).
set -u
cd /home/z/my-project/sadeem
OUT=docs/ui-review
mkdir -p "$OUT"
SHOT_HOME=/tmp/s10-home
mkdir -p "$SHOT_HOME"
PROJ=/tmp/s9-proj

seed() { # $1=theme $2=lang $3=onboard(1|0)
  mkdir -p "$SHOT_HOME/.config/SADEEM"
  python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
theme, lang, onboard = sys.argv[1], sys.argv[2], sys.argv[3]
d = "/tmp/s10-home/.config/SADEEM/settings.json"
cfg = {
    "schemaVersion": 4, "language": lang, "theme": theme,
    "permissionMode": "default", "model": {"provider": "anthropic", "model": "claude-sonnet-5.5"},
    "providers": {}, "fontSize": 13, "terminalFontSize": 12,
    "autoApproveEdits": False, "checkpointsEnabled": True,
    "onboardingDone": onboard == "1", "localOnly": False,
    "recentPaths": ["/tmp/s9-proj"], "mcpServers": [], "usageLog": [],
    "ui": {"glassLevel": "off", "ambientGlow": False, "accent": "sage", "density": "comfortable"},
}
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() { # $1=out $2=theme $3=lang $4=onboard $5=js
  seed "$2" "$3" "$4"
  echo "── $(basename "$1") [$2/$3]"
  env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/$1" KODEX_SHOT_JS="$5" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s10-err.log
  echo "   exit=$? $( [ -f "$OUT/$1" ] && echo "size=$(stat -c%s "$OUT/$1")" )"
}

ENTER="new Promise(res=>{const eb=[...document.querySelectorAll('button')].find(b=>/Enter SADEEM/i.test(b.textContent||'')); if(eb){eb.click(); setTimeout(()=>res('entered'),1600);} else {res('already');}})"

# 01 Onboarding (first run, fresh)
shot 01-onboarding.png obsidian en 0 ""

# 02 Home (dark) — enter then click the Home rail item
shot 02-home-dark.png obsidian en 1 "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='Home'); if(b)b.click(); setTimeout(()=>res(r),900);}))"

RAIL() { # $1=aria-label → returns JS to click rail item after enter
  echo "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='$1'); if(b)b.click(); setTimeout(()=>res(r),1000);}))"
}

# 03 Workspace (dark): explorer + editor + chat
shot 03-workspace-dark.png obsidian en 1 "$(RAIL Workspace)"

# 04 Terminal open under editor
shot 04-terminal-dark.png obsidian en 1 "$(RAIL Workspace).then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='Toggle terminal'); if(b)b.click(); setTimeout(()=>res(r),1400);}))"

SET() { # $1=section $2=extra-js → open settings at a group after enter
  echo "$ENTER.then(r=>new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'$1'}})); setTimeout(()=>res(r),1100);})).then(r=>new Promise(res=>{ $2 setTimeout(()=>res(r),900); }))"
}

# 05 Git (source control panel with the real dirty file)
shot 05-git-dark.png obsidian en 1 "$(RAIL 'Source control')"

# 07 Sessions
shot 07-sessions-dark.png obsidian en 1 "$(RAIL Sessions)"

# 08 MCP
shot 08-mcp-dark.png obsidian en 1 "$(RAIL 'MCP tools')"

# 09 Skills
shot 09-skills-dark.png obsidian en 1 "$(RAIL Skills)"

# 10 Usage
shot 10-usage-dark.png obsidian en 1 "$(RAIL Usage)"

# 11 Settings — General (full page)
shot 11-settings-general.png obsidian en 1 "$(SET general '')"

# 12 Settings — Models & Providers (THE previously-broken page)
shot 12-settings-models.png obsidian en 1 "$(SET models '')"

# 13 Settings — Models scrolled to BOTTOM (scroll-fix proof shot)
shot 13-settings-models-bottom.png obsidian en 1 "$(SET models "const c=document.querySelector('.set-content'); if(c){c.scrollTop=99999;}")"

# 14 Settings — Account & Data
shot 14-settings-account.png obsidian en 1 "$(SET account '')"

# 15 Command palette
shot 15-command-palette.png obsidian en 1 "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'').includes('Search or run a command')); if(b)b.click(); setTimeout(()=>res(r),900);}))"

# 16 Light theme — workspace
shot 16-workspace-light.png light en 1 "$(RAIL Workspace)"

# 17 Light theme — settings models
shot 17-settings-light.png light en 1 "$(SET models '')"

# 18 Arabic RTL — workspace
shot 18-workspace-ar.png obsidian ar 1 "$(RAIL Workspace)"

# 19 Arabic RTL — Home
shot 19-home-ar.png obsidian ar 1 "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='Home' || (x.getAttribute('aria-label')||'')==='الرئيسية'); if(b)b.click(); setTimeout(()=>res(r),900);}))"

# 20 Arabic RTL — settings models
shot 20-settings-ar.png obsidian ar 1 "$(SET models '')"

# 21 SCROLL PROOF (numeric, on Models — the page the user reported dead)
seed obsidian en 1
env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/21-scroll-proof.png" KODEX_SHOT_RESULT=/tmp/scroll-v10.json \
  KODEX_SHOT_JS="$ENTER.then(r=>new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'models'}})); setTimeout(()=>res(r),1100);})).then(r=>new Promise(res=>{const c=document.querySelector('.set-content'); if(!c){res('NO .set-content');return;} const before={sh:c.scrollHeight,ch:c.clientHeight,st:c.scrollTop}; c.scrollTop=99999; setTimeout(()=>{const after={sh:c.scrollHeight,ch:c.clientHeight,st:c.scrollTop}; res(JSON.stringify({before,after,scrollable:before.sh>before.ch,moved:after.st>0}));},600);}))" \
  timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s10-err.log
echo "scroll-proof exit=$?"
echo "=== SCROLL PROOF RESULT ==="
cat /tmp/scroll-v10.json 2>/dev/null || echo "(missing)"
echo

ls -la "$OUT"/ | head -30
