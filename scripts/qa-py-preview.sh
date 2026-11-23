#!/bin/bash
# v10.3 — python preview live proof: boot with recentPaths=[/tmp/s103-py]
# (auto-opens), open the preview, then the source menu → python target visible.
set -u
cd /home/z/my-project/work/sadeem-v119/sadeem
OUT=docs/ui-review
SHOT_HOME=/tmp/s103-pyhome
rm -rf "$SHOT_HOME"; mkdir -p "$SHOT_HOME/.config/SADEEM"

python3 - <<'PYEOF'
import json
d = "/tmp/s103-pyhome/.config/SADEEM/settings.json"
cfg = {
    "schemaVersion": 4, "language": "en", "theme": "obsidian",
    "permissionMode": "default", "model": {"provider": "anthropic", "model": "claude-sonnet-5.5"},
    "providers": {}, "fontSize": 13, "terminalFontSize": 12,
    "autoApproveEdits": False, "checkpointsEnabled": True,
    "onboardingDone": True, "localOnly": False,
    "recentPaths": ["/tmp/s103-py"], "mcpServers": [], "usageLog": [],
    "voice": {"asrProvider": "auto", "asrModel": ""},
    "ui": {"glassLevel": "off", "ambientGlow": False, "accent": "sage", "density": "comfortable"},
    "preview": {"autoDetect": True, "deviceFrame": False, "console": False, "autoRefresh": True, "zoom": 100},
}
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
print("seeded py home")
PYEOF

# open preview via Ctrl+Shift+V equivalent: use the store through the palette
JS='new Promise(res=>{const b=[...document.querySelectorAll("button")].find(x=>/^(Preview|Run dev servers)$/.test((x.textContent||'').trim()))||[...document.querySelectorAll("button")].find(x=>/Preview/i.test(x.textContent||'')&&/quick|qa|action/i.test(x.className||'')); if(b)b.click(); setTimeout(()=>res(1),1800);})'
JS="$JS.then(r=>new Promise(res=>{const src=[...document.querySelectorAll('button')].find(x=>{const t=(x.getAttribute('aria-label')||'')+' '+(x.textContent||''); return /preview source|served by|npm run|python|index.html/i.test(t)&&!/open file/i.test(t);}); if(src)src.click(); setTimeout(()=>res(r),1200);}))"

echo "── 49-preview-python.png"
env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/49-preview-python.png" KODEX_SHOT_JS="$JS" \
  timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s103-py.log
echo "   exit=$? size=$(stat -c%s "$OUT/49-preview-python.png" 2>/dev/null || echo MISSING)"
echo PY-DONE
