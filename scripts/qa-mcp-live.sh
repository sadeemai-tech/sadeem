#!/bin/bash
# SADEEM v11.11 — LIVE MCP PROOF (qa-mcp-live.sh)
# Proves MCP against a REAL server (scripts/mcp-proof-server.mjs, a genuine
# stdio JSON-RPC / Model Context Protocol server) in three phases:
#
#   PHASE 1 — raw protocol round trip: spawn the server, speak MCP JSON-RPC
#             directly (initialize → tools/list → tools/call echo/now) and
#             print every response. THE round-trip evidence, no app needed.
#   PHASE 2 — the app's REAL MCP client (electron/agent/mcp.ts, esbuild-bundled
#             with the same electron stub the test harness uses) does
#             mcpListTools + mcpCallTool against the same live server.
#   PHASE 3 — UI proof (unchanged from v10.3): seeds settings with the proof
#             server, opens the MCP panel in Electron and screenshots the
#             connected server card. Skipped honestly when no X display is
#             available (headless CI) — run with SADEEM_MCP_UI=1 to force.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT=docs/ui-review
SHOT_HOME=/tmp/s1111-mcp
PASS=0
FAIL=0

echo "repo root: $ROOT"
node --version

# ============================================================
# PHASE 1 — raw MCP JSON-RPC round trip against the real stdio server
# ============================================================
echo "── PHASE 1: raw MCP protocol round trip (scripts/mcp-proof-server.mjs)"
node "$ROOT/scripts/mcp-roundtrip-proof.mjs"
rc=$?
if [ "$rc" -eq 0 ]; then echo "   PHASE 1 PASS"; PASS=$((PASS+1)); else echo "   PHASE 1 FAIL (exit=$rc)"; FAIL=$((FAIL+1)); fi

# ============================================================
# PHASE 2 — the app's REAL MCP client round trip (same live server)
# ============================================================
echo "── PHASE 2: SADEEM MCP client (electron/agent/mcp.ts) round trip"
node "$ROOT/scripts/mcp-roundtrip-proof.mjs" --client
rc=$?
if [ "$rc" -eq 0 ]; then echo "   PHASE 2 PASS"; PASS=$((PASS+1)); else echo "   PHASE 2 FAIL (exit=$rc)"; FAIL=$((FAIL+1)); fi

# ============================================================
# PHASE 3 — UI proof (Electron MCP panel screenshot; needs an X display)
# ============================================================
if [ "${SADEEM_MCP_UI:-0}" != "1" ]; then
  HAVE_X=0
  for d in /tmp/.X11-unix/X*; do [ -e "$d" ] && HAVE_X=1; done
  if [ "$HAVE_X" -ne 1 ]; then
    echo "── PHASE 3: UI screenshot SKIP (no X display in this environment; phases 1-2 carry the round-trip proof). Set SADEEM_MCP_UI=1 + a running X server to capture docs/ui-review/51-mcp-live.png"
  else
    SADEEM_MCP_UI=1 "$0" --ui-only
  fi
elif [ "${1:-}" = "--ui-only" ] || [ "${SADEEM_MCP_UI:-}" = "1" ]; then
  rm -rf "$SHOT_HOME"; mkdir -p "$SHOT_HOME/.config/SADEEM"
  python3 - "$ROOT" <<'PYEOF'
import json, sys
root = sys.argv[1]
d = "/tmp/s1111-mcp/.config/SADEEM/settings.json"
cfg = {
    "schemaVersion": 4, "language": "en", "theme": "obsidian",
    "permissionMode": "default",
    "model": {"provider": "anthropic", "model": "claude-sonnet-5.5"},
    "providers": {}, "fontSize": 13, "terminalFontSize": 12,
    "autoApproveEdits": False, "checkpointsEnabled": True,
    "onboardingDone": True, "localOnly": False,
    "recentPaths": ["/tmp/s9-proj"],
    "mcpServers": [{
        "id": "proof", "name": "sadeem-proof-mcp",
        "command": "node",
        "args": [root + "/scripts/mcp-proof-server.mjs"],
        "enabled": True, "transport": "stdio", "timeoutMs": 10000
    }],
    "usageLog": [], "voice": {"asrProvider": "auto", "asrModel": ""},
    "ui": {"glassLevel": "off", "ambientGlow": False, "accent": "sage", "density": "comfortable"},
}
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
print("seeded mcp server")
PYEOF

  JS='new Promise(res=>{const b=[...document.querySelectorAll("nav button")].find(x=>(x.getAttribute("aria-label")||"")==="MCP tools"); if(b)b.click(); setTimeout(()=>res(1),1500);})'
  JS="$JS.then(r=>new Promise(res=>{ /* wait for the server card + tools to appear */ const t0=Date.now(); const poll=setInterval(()=>{const ok=/sadeem-proof-mcp/i.test(document.body.textContent||'')&&/echo/i.test(document.body.textContent||''); if(ok||Date.now()-t0>25000){clearInterval(poll);res(r);}},800); }))"
  JS="$JS.then(r=>new Promise(res=>{const c=[...document.querySelectorAll('*')].find(x=>x.textContent&&x.textContent.trim()==='now'&&x.children.length===0); if(c)c.scrollIntoView({block:'center'}); setTimeout(()=>res(r),500);}))"

  echo "── 51-mcp-live.png"
  env HOME="$SHOT_HOME" DISPLAY="${DISPLAY:-:99}" KODEX_SHOT="$ROOT/$OUT/51-mcp-live.png" KODEX_SHOT_JS="$JS" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s1111-mcp.log
  echo "   exit=$? size=$(stat -c%s "$ROOT/$OUT/51-mcp-live.png" 2>/dev/null || echo MISSING)"
  grep -i "mcp\|proof" /tmp/s1111-mcp.log | grep -v "^\[" | head -5
fi

echo "MCP-LIVE SUMMARY: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
