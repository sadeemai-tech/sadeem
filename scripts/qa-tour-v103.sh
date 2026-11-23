#!/bin/bash
# SADEEM v10.3 — UI QA screenshot tour → docs/ui-review/ (real app, real data).
# Proves the v10.3 features visually: flat 20-section settings, Git&Worktrees
# pane, Shortcuts pane, grouped slash palette, Library tabs
# (+ Repo Wiki), multi-runtime preview (REAL python server), token economy,
# and the voice live-test card.
set -u
cd /home/z/my-project/sadeem
OUT=docs/ui-review
mkdir -p "$OUT"
SHOT_HOME=/tmp/s103-home
rm -rf "$SHOT_HOME"
mkdir -p "$SHOT_HOME/.config/SADEEM"
PROJ=/tmp/s9-proj
PYPROJ=/tmp/s103-py
rm -rf "$PYPROJ"; mkdir -p "$PYPROJ" "$PROJ"

# ---------- seed: python demo project (real, runnable) ----------
cat > "$PYPROJ/app.py" <<'PYEOF'
# minimal demo server: serves this directory on port 8000 (multi-runtime preview demo)
import http.server, socketserver, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html'), 'w') as f:
    f.write('<!doctype html><html><head><meta charset="utf-8"><title>SADEEM Python Preview</title>'
            '<style>body{font-family:system-ui;background:#141413;color:#f4f2ed;display:grid;place-items:center;height:100vh;margin:0}'
            'main{text-align:center}h1{font-size:28px;margin:0 0 8px}p{color:#a9a49a}</style></head>'
            '<body><main><h1>Python server, live preview</h1>'
            '<p>Served by app.py through SADEEM v10.3 multi-runtime preview — no package.json needed.</p>'
            '</main></body></html>')
PORT = 8000
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
with socketserver.TCPServer(("127.0.0.1", PORT), H) as httpd:
    print(f"Serving on http://127.0.0.1:{PORT}")
    httpd.serve_forever()
PYEOF

# ---------- seed: settings ----------
seed() { # $1=theme $2=lang $3=onboard(1|0)
  python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
theme, lang, onboard = sys.argv[1], sys.argv[2], sys.argv[3]
d = "/tmp/s103-home/.config/SADEEM/settings.json"
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

# ---------- seed: library items + plugin (so Library files tab is populated) ----------
seed_extras() {
  python3 - <<'PYEOF'
import json, os, time
ud = "/tmp/s103-home/.config/SADEEM"
pdir = os.path.join(ud, "plugins", "sadeem.starter-web")
os.makedirs(pdir, exist_ok=True)
manifest = {
  "id": "sadeem.starter-web", "name": "Web Pack", "version": "1.0.0",
  "description": "Fetch MCP server + /research slash prompt.",
  "author": "SADEEM", "enabled": True, "installedAt": int(time.time() * 1000),
  "source": "builtin", "mcpServers": [], "prompts": [],
}
json.dump(manifest, open(os.path.join(pdir, "plugin.json"), "w"), indent=1)
libdir = os.path.join(ud, "artifacts")
os.makedirs(libdir, exist_ok=True)
now = int(time.time() * 1000)
items = []
for i, (name, kind, origin) in enumerate([("report-q4.pdf", "document", "make_document"), ("hero-banner.png", "image", "image_generate")]):
    p = os.path.join(libdir, name)
    open(p, "w").write("demo-bytes")
    items.append({"id": f"demo{i}", "kind": kind, "title": name, "path": p,
                  "createdAt": now - i * 3600_000, "size": 1024 * (i + 1), "origin": origin})
json.dump({"version": 1, "items": items}, open(os.path.join(ud, "library.json"), "w"), indent=1)
PYEOF
}

shot() { # $1=out $2=js
  echo "── $(basename "$1")"
  env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/$1" KODEX_SHOT_JS="$2" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s103-err.log
  echo "   exit=$? $( [ -f "$OUT/$1" ] && echo "size=$(stat -c%s "$OUT/$1")" )"
}

ENTER="new Promise(res=>{const eb=[...document.querySelectorAll('button')].find(b=>/Enter SADEEM/i.test(b.textContent||'')); if(eb){eb.click(); setTimeout(()=>res('entered'),1600);} else {res('already');}})"
RAIL() { echo "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='$1'); if(b)b.click(); setTimeout(()=>res(r),1100);}))"; }
SETG() { echo "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('button')].find(x=>x.className&&String(x.className).includes('set-nav-item')&&/($2)/.test(x.textContent||'')); if(b)b.click(); setTimeout(()=>res(r),900);}))"; }
seed obsidian en 1
seed_extras

# 40 — flat settings rail (20 Codex-style sections)
shot 40-settings-flat.png "$ENTER.then(r=>new Promise(res=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true})); setTimeout(()=>res(r),300);})).then(r=>new Promise(res=>{const btn=[...document.querySelectorAll('button')].find(b=>/Open settings|Settings/i.test((b.getAttribute('aria-label')||'')+' '+(b.title||''))); if(btn)btn.click(); setTimeout(()=>res(r),1200);}))"

# 41 — Git & Worktrees pane (guide + live list)
shot 41-settings-git.png "$(SETG '' 'Git &')"

# 42 — Keyboard shortcuts pane (same table as the overlay)
shot 42-settings-shortcuts.png "$(SETG '' 'Keyboard')"

# 43 — Voice pane with the live test card
shot 43-settings-voice.png "$(SETG '' 'Voice')"

# 44 — grouped slash palette (composer, '/' typed)
shot 44-slash-menu.png "$(RAIL Workspace).then(r=>new Promise(res=>{const ta=document.querySelector('textarea'); if(ta){const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/'); ta.dispatchEvent(new Event('input',{bubbles:true}));} setTimeout(()=>res(r),800);}))"

# 46 — Library files tab (seeded items, staggered grid)
shot 46-library-tabs.png "$(RAIL Library)"

# 47 — Library → Repo Wiki tab
shot 47-library-wiki.png "$(RAIL Library).then(r=>new Promise(res=>{const b=[...document.querySelectorAll('button[role=tab]')].find(x=>/Wiki/i.test(x.textContent||'')); if(b)b.click(); setTimeout(()=>res(r),1400);}))"

# 48 — Usage panel with the token-economy card
shot 48-usage-economy.png "$(RAIL Usage)"

# 49 — python workspace open + preview targets menu (python target visible)
shot 49-preview-python.png "$ENTER.then(r=>new Promise(res=>{const btn=[...document.querySelectorAll('button')].find(b=>/Open folder|open folder/i.test((b.getAttribute('aria-label')||'')+(b.title||'')+(b.textContent||''))); setTimeout(()=>res(r),400);})).then(r=>new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-workspace',{detail:{path:'/tmp/s103-py'}})); setTimeout(()=>res(r),1500);})).then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='Workspace'); if(b)b.click(); setTimeout(()=>res(r),1200);}))"

echo "TOUR-DONE"
