#!/bin/bash
# SADEEM v11 — after-fix verification tour (real app, real clicks, honest shots).
set -u
cd /home/z/my-project/sadeem
OUT=docs/ui-review/v11
mkdir -p "$OUT"
SHOT_HOME=/tmp/s11v-home
rm -rf "$SHOT_HOME"; mkdir -p "$SHOT_HOME/.config/SADEEM"
PROJ=/tmp/s9-proj
rm -rf "$PROJ"; mkdir -p "$PROJ"
cd "$PROJ" && git init -q 2>/dev/null; echo "# demo" > README.md; git add -A && git -c user.email=d@d -c user.name=d commit -qm init 2>/dev/null; cd /home/z/my-project/sadeem

seed() {
  python3 - "$1" <<'PYEOF'
import json, sys
lang = sys.argv[1]
d = "/tmp/s11v-home/.config/SADEEM/settings.json"
cfg = {
    "schemaVersion": 4, "language": lang, "theme": "obsidian",
    "permissionMode": "default", "model": {"provider": "anthropic", "model": "claude-sonnet-5.5"},
    "providers": {}, "fontSize": 13, "terminalFontSize": 12,
    "autoApproveEdits": False, "checkpointsEnabled": True,
    "onboardingDone": True, "localOnly": False,
    "recentPaths": ["/tmp/s9-proj"], "mcpServers": [], "usageLog": [],
    "voice": {"asrProvider": "auto", "asrModel": ""},
    "ui": {"glassLevel": "off", "ambientGlow": False, "accent": "sage", "density": "comfortable"},
}
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() {
  echo "── $(basename "$1")"
  env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/$1" KODEX_SHOT_JS="$2" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/dev/null | tail -1
  echo "   $( [ -f "$OUT/$1" ] && stat -c%s "$OUT/$1" )"
}

# enter + settle, THEN click (boot-safe delays learned from baseline)
GOIN="new Promise(res=>{const eb=[...document.querySelectorAll('button')].find(b=>/Enter SADEEM/i.test(b.textContent||'')); if(eb){eb.click();} setTimeout(()=>res('ok'),1900);})"
RAIL() { echo "$GOIN.then(r=>new Promise(res=>setTimeout(()=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='$1'); if(b)b.click(); setTimeout(()=>res(r),1500);},700)));"; }
SETG() { echo "$GOIN.then(r=>new Promise(res=>setTimeout(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Settings'); if(b)b.click(); setTimeout(()=>{const it=[...document.querySelectorAll('button')].find(x=>x.className&&String(x.className).includes('set-nav-item')&&/$2/.test(x.textContent||'')); if(it)it.click(); setTimeout(()=>res(r),1200);},1600);},1200)));"; }

seed en

# 01 home — numbering + quick actions tiles (templates/scheduled visible)
shot 01-home.png "new Promise(res=>setTimeout(()=>res('home'),2100))"
# 02 settings general BELOW THE TITLEBAR (window controls visible top-right)
shot 02-settings-general.png "$(SETG '' 'General')"
# 03 settings rail scrolled bottom — single-line 21 items
shot 03-settings-updates.png "$(SETG '' 'Updates')"
# 04 settings account — real create/sign-in card
shot 04-settings-account.png "$(SETG '' 'Account')"
# 06 Flows center-stage
shot 06-flows-stage.png "$(RAIL Flows)"
# 07 Source control center-stage
shot 07-git-stage.png "$(RAIL Source control)"
# 08 MCP center-stage
shot 08-mcp-stage.png "$(RAIL MCP tools)"
# 09 Library center-stage
shot 09-library-stage.png "$(RAIL Library)"
# 10 Sessions (Scheduled tab lives here)
shot 10-sessions.png "$(RAIL Sessions)"
echo "V11-TOUR-DONE"
