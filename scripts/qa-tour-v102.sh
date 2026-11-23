#!/bin/bash
# SADEEM v10.2 — UI QA screenshot tour → docs/ui-review/ (real app, real data).
# Proves the v10.2 features visually: WorktreeChip, Library,
# Voice + Plugins settings, and the Codex-class before/after DiffView.
set -u
cd /home/z/my-project/sadeem
OUT=docs/ui-review
mkdir -p "$OUT"
SHOT_HOME=/tmp/s102-home
rm -rf "$SHOT_HOME"
mkdir -p "$SHOT_HOME/.config/SADEEM"
PROJ=/tmp/s9-proj
mkdir -p "$PROJ"

# ---------- seed: settings ----------
seed() { # $1=theme $2=lang $3=onboard(1|0)
  python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
theme, lang, onboard = sys.argv[1], sys.argv[2], sys.argv[3]
d = "/tmp/s102-home/.config/SADEEM/settings.json"
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

# ---------- seed: demo session with a REAL edit_file tool pair (diff view) ----------
seed_session() {
  python3 - <<'PYEOF'
import json, time, os
d = "/tmp/s102-home/.config/SADEEM/sessions"
os.makedirs(d, exist_ok=True)
now = int(time.time() * 1000)
old = """function total(items) {
  let sum = 0;
  for (const it of items) {
    sum = sum + it.price;
  }
  return sum;
}"""
new = """function total(items) {
  // tax + rounding moved into one pass
  let sum = 0;
  for (const it of items) {
    sum += it.price * (1 + it.taxRate);
  }
  return Math.round(sum * 100) / 100;
}"""
args = json.dumps({"path": "/tmp/s9-proj/src/cart.ts", "old_string": old, "new_string": new})
msgs = [
  {"id": "m1", "role": "user", "kind": "text", "content": "Fix the cart total to include per-item tax and round to cents.", "timestamp": now - 60000},
  {"id": "m2", "role": "assistant", "kind": "text", "content": "I'll update `total()` in src/cart.ts to apply each item's tax rate and round to cents.", "model": "anthropic/claude-sonnet-5.5", "timestamp": now - 50000},
  {"id": "m3", "role": "assistant", "kind": "tool_call", "toolName": "edit_file", "content": args, "toolCallId": "call_1", "timestamp": now - 40000},
  {"id": "m4", "role": "assistant", "kind": "tool_result", "toolName": "edit_file", "toolCallId": "call_1", "content": "Applied 1 replacement to /tmp/s9-proj/src/cart.ts", "resultOk": True, "timestamp": now - 39000},
  {"id": "m5", "role": "assistant", "kind": "text", "content": "Done — the total now includes per-item tax and rounds to cents.", "model": "anthropic/claude-sonnet-5.5", "timestamp": now - 30000},
]
sess = {
  "id": "demo-v102-diff", "title": "Cart tax fix (diff demo)",
  "createdAt": now - 70000, "updatedAt": now - 30000,
  "workspace": "/tmp/s9-proj", "model": "anthropic/claude-sonnet-5.5",
  "messageCount": len(msgs), "totalTokens": 312, "totalCostUsd": 0.0042,
  "messages": msgs, "todos": [],
}
json.dump(sess, open(os.path.join(d, "demo-v102-diff.json"), "w"), ensure_ascii=False, indent=1)
PYEOF
}

# ---------- seed: plugin installed + library items ----------
seed_extras() {
  python3 - <<'PYEOF'
import json, os, time
ud = "/tmp/s102-home/.config/SADEEM"
# plugin
pdir = os.path.join(ud, "plugins", "sadeem.starter-web")
os.makedirs(pdir, exist_ok=True)
manifest = {
  "id": "sadeem.starter-web", "name": "Web Pack", "version": "1.0.0",
  "description": "Fetch MCP server (npx @modelcontextprotocol/server-fetch) + /research slash prompt for deep web digests.",
  "author": "SADEEM", "enabled": True, "installedAt": int(time.time() * 1000),
  "source": "builtin",
  "mcpServers": [{"id": "fetch", "name": "fetch", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"], "enabled": True}],
  "prompts": [{"name": "research", "description": "Deep web research digest with sources", "prompt": "Research the topic thoroughly..."}],
}
json.dump(manifest, open(os.path.join(pdir, "plugin.json"), "w"), indent=1)
# library
libdir = os.path.join(ud, "artifacts")
os.makedirs(libdir, exist_ok=True)
now = int(time.time() * 1000)
files = [
  ("report-q4.pdf", "document", "make_document"),
  ("hero-banner.png", "image", "image_generate"),
  ("dataset-exports.csv", "download", "download_file"),
]
items = []
for i, (name, kind, origin) in enumerate(files):
    p = os.path.join(libdir, name)
    open(p, "w").write("demo-bytes")
    items.append({"id": f"demo{i}", "kind": kind, "title": name, "path": p,
                  "createdAt": now - i * 3600_000, "size": 1024 * (i + 1),
                  "origin": origin})
json.dump({"version": 1, "items": items}, open(os.path.join(ud, "library.json"), "w"), indent=1)
PYEOF
}

shot() { # $1=out $2=js
  echo "── $(basename "$1")"
  env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/$1" KODEX_SHOT_JS="$2" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s102-err.log
  echo "   exit=$? $( [ -f "$OUT/$1" ] && echo "size=$(stat -c%s "$OUT/$1")" )"
}

ENTER="new Promise(res=>{const eb=[...document.querySelectorAll('button')].find(b=>/Enter SADEEM/i.test(b.textContent||'')); if(eb){eb.click(); setTimeout(()=>res('entered'),1600);} else {res('already');}})"
RAIL() { echo "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='$1'); if(b)b.click(); setTimeout(()=>res(r),1100);}))"; }
seed obsidian en 1
seed_session
seed_extras

# 31 — workspace with the composer WorktreeChip (deck row)
shot 31-worktree-chip.png "$(RAIL Workspace)"

# 32 — worktree menu open (chip clicked)
shot 32-worktree-menu.png "$(RAIL Workspace).then(r=>new Promise(res=>{const c=document.querySelector('.wt-chip'); if(c)c.click(); setTimeout(()=>res(r),700);}))"

# 33 — Library rail view (real seeded items)
shot 33-library.png "$(RAIL Library)"

# 35 — chat diff view: open the seeded demo session, scroll the edit card into view
shot 35-diff-view.png "$ENTER.then(r=>new Promise(res=>{const b=[...document.querySelectorAll('nav button')].find(x=>(x.getAttribute('aria-label')||'')==='Sessions'); if(b)b.click(); setTimeout(()=>res(r),900);})).then(r=>new Promise(res=>{const s=[...document.querySelectorAll('button,div[role=button],.row,[class*=session]')].find(x=>/Cart tax fix/.test(x.textContent||'')); if(s)s.click(); setTimeout(()=>res(r),1200);})).then(r=>new Promise(res=>{const card=[...document.querySelectorAll('.tl2-card')].pop(); if(card)card.scrollIntoView({block:'center'}); setTimeout(()=>res(r),700);}))"

# 36 — settings general scrolled to the Voice section
shot 36-settings-voice.png "$ENTER.then(r=>new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'general'}})); setTimeout(()=>res(r),1100);})).then(r=>new Promise(res=>{const h=[...document.querySelectorAll('h2')].find(x=>/Voice input/i.test(x.textContent||'')); if(h)h.scrollIntoView({block:'start'}); setTimeout(()=>res(r),600);}))"

# 37 — settings integrations with the Plugins section
shot 37-settings-plugins.png "$ENTER.then(r=>new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'integrations'}})); setTimeout(()=>res(r),1100);})).then(r=>new Promise(res=>{const h=[...document.querySelectorAll('h2')].find(x=>/^Plugins/i.test(x.textContent||'')); if(h)h.scrollIntoView({block:'start'}); setTimeout(()=>res(r),600);}))"

echo "DONE — files:"
ls -la "$OUT" | rg "3[1-7]-"
