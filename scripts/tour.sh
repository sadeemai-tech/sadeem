#!/bin/bash
# Kodex screenshot tour — captures every new screen (auth, onboarding
# steps, welcome hub, new-project wizard, clone dialog) with a real
# Electron window under Xvfb using capturePage (KODEX_SHOT mode).
set -u
cd /home/z/my-project/kodex

CFG=/tmp/kodex-shot-home/.config/Surnia/settings.json
mkdir -p shots /tmp/kodex-shot-home/.config/Kodex

seed() {
  # seed() lang onboardingDone localOnly
  python3 - "$1" "$2" "$3" <<'PYEOF'
import json, os, sys
d = "/tmp/kodex-shot-home/.config/Surnia/settings.json"
os.makedirs(os.path.dirname(d), exist_ok=True)
cfg = {
  "language": sys.argv[1],
  "theme": "obsidian",
  "onboardingDone": sys.argv[2] == "1",
  "localOnly": sys.argv[3] == "1",
  "recentPaths": [],
  "providers": {},
  "model": {"provider": "anthropic", "model": "claude-sonnet-4-5"},
}
json.dump(cfg, open(d, "w"), ensure_ascii=False, indent=2)
PYEOF
}

shot() {
  # shot() screen lang out
  local screen="$1" lang="$2" out="$3"
  case "$screen" in
    auth*) seed "$lang" 1 0 ;;
    onboard*) seed "$lang" 0 0 ;;
    *) seed "$lang" 1 1 ;;
  esac
  echo "── $out (screen=$screen lang=$lang)"
  HOME=/tmp/kodex-shot-home KODEX_SHOT="$out" KODEX_TOUR_SCREEN="$screen" \
    timeout 60 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/kodex-electron-err.log
  echo "   exit=$? $( [ -f "$out" ] && echo "size=$(stat -c%s "$out")" )"
}

rm -f shots/*.png

# xvfb-run needs xauth (not installed) → run Xvfb directly instead
XVFB_LOG=/tmp/kodex-xvfb.log
Xvfb :97 -screen 0 1600x1000x24 >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!
export DISPLAY=:97
sleep 1.5
trap 'kill $XVFB_PID 2>/dev/null || true' EXIT

# auth screens (EN + AR + signup)
shot auth        en shots/01-auth-in-en.png
shot auth-signup en shots/02-auth-up-en.png
shot auth        ar shots/03-auth-in-ar.png

# onboarding wizard steps
shot onboard-1 en shots/04-onboard-lang.png
shot onboard-2 en shots/05-onboard-theme.png
shot onboard-3 en shots/06-onboard-account.png
shot onboard-4 en shots/07-onboard-provider.png
shot onboard-5 en shots/08-onboard-trust.png
shot onboard-1 ar shots/09-onboard-lang-ar.png

# welcome hub + project creation
shot welcome     en shots/10-welcome-en.png
shot welcome     ar shots/11-welcome-ar.png
shot newproject  en shots/12-newproject-templates.png
shot newproject  ar shots/13-newproject-ar.png
shot clone       en shots/14-clone.png

ls -la shots/
