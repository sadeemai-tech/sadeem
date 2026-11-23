#!/bin/bash
# SADEEM v11 baseline tour — capture the CURRENT state of every surface the
# user reported problems with, BEFORE any fix. Honest "before" evidence.
set -u
cd /home/z/my-project/sadeem
OUT=docs/ui-review/v11-baseline
mkdir -p "$OUT"
SHOT_HOME=/tmp/s11-home
rm -rf "$SHOT_HOME"
mkdir -p "$SHOT_HOME/.config/SADEEM"
PROJ=/tmp/s9-proj
rm -rf "$PROJ"; mkdir -p "$PROJ"
cd "$PROJ" && git init -q 2>/dev/null; echo "# demo" > README.md; git add -A && git -c user.email=d@d -c user.name=d commit -qm init 2>/dev/null; cd /home/z/my-project/sadeem

seed() {
  python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
theme, lang, onboard = sys.argv[1], sys.argv[2], sys.argv[3]
d = "/tmp/s11-home/.config/SADEEM/settings.json"
cfg = {
    "schemaVersion": 4, "language": lang, "theme": theme,
    "permissionMode": "default", "model": {"provider": "anthropic", "model": "claude-sonnet-5.5"},
    "providers": {}, "fontSize": 13, "terminalFontSize": 12,
    "autoApproveEdits": False, "checkpointsEnabled": True,
    "onboardingDone": onboard == "1", "localOnly": False,
    "recentPaths": ["/tmp/s9-proj"], "mcpServers": [], "usageLog": [],
    "voice": {"asrProvider": "auto", "asrModel": ""},
    "ui": {"glassLevel": "off", "ambientGlow": False, "accent": "sage", "density": "comfortable"},
}
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() { # $1=out $2=js
  echo "── $(basename "$1")"
  env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/$1" KODEX_SHOT_JS="$2" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s11-err.log
  echo "   exit=$? $( [ -f "$OUT/$1" ] && echo "size=$(stat -c%s "$OUT/$1")" )"
}

ENTER="new Promise(res=>{const eb=[...document.querySelectorAll('button')].find(b=>/Enter SADEEM/i.test(b.textContent||'')); if(eb){eb.click(); setTimeout(()=>res('entered'),1800);} else {res('already');}})"
RAIL() { echo "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='$1'); if(b)b.click(); setTimeout(()=>res(r),1300);}))"; }
SETG() { echo "$ENTER.then(r=>new Promise(res=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true})); setTimeout(()=>res(r),700);})).then(r=>new Promise(res=>{const b=[...document.querySelectorAll('button')].find(x=>x.className&&String(x.className).includes('set-nav-item')&&/$2/.test(x.textContent||'')); if(b)b.click(); setTimeout(()=>res(r),1000);}))"; }

seed obsidian en 1

# 01 — home as the app opens (titlebar visible?)
shot 01-home.png "new Promise(res=>setTimeout(()=>res('home'),2000))"

# 02 — settings General (the complained-about page)
shot 02-settings-general.png $(SETG '' 'General')"

# 03 — settings scrolled to bottom of rail (rail scroll problem)
shot 03-settings-rail-bottom.png $(SETG '' 'Advanced')"

# 05 — Source control / Git
shot 05-git.png "$(RAIL Source)"

# 06 — Flows
shot 06-flows.png "$(RAIL Flows)"

# 07 — Schedule
shot 07-schedule.png "$(RAIL Schedule)"

# 08 — Account/Billing settings pane
shot 08-account.png $(SETG '' 'Account')"

# 09 — Workspace (worktree)
shot 09-workspace.png "$(RAIL Workspace)"

# 10 — MCP panel
shot 10-mcp.png "$(RAIL MCP)"

echo "BASELINE-DONE"
