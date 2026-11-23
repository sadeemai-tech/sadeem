#!/bin/bash
# v10.3 settings deep-link shots (surnia:open-settings event → exact panes).
set -u
cd /home/z/my-project/sadeem
OUT=docs/ui-review
SHOT_HOME=/tmp/s103-home

shot() { # $1=out $2=section $3=extra-scroll-js(optional)
  echo "── $(basename "$1")"
  local JS="new Promise(res=>{window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'$2'}})); setTimeout(()=>res('opened'),1200);})"
  [ -n "${3:-}" ] && JS="$JS.then(r=>new Promise(res=>{$3 setTimeout(()=>res(r),600);}))"
  env HOME="$SHOT_HOME" DISPLAY=:99 KODEX_SHOT="$OUT/$1" KODEX_SHOT_JS="$JS" \
    timeout 110 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s103-err2.log
  echo "   exit=$? $( [ -f "$OUT/$1" ] && echo "size=$(stat -c%s "$OUT/$1")" )"
}

shot 40-settings-flat.png general ""
shot 41-settings-git.png git ""
shot 42-settings-shortcuts.png shortcuts ""
shot 43-settings-voice.png voice ""
shot 43b-settings-preview.png preview "const c=[...document.querySelectorAll('.set-content *')].find(x=>x.textContent&&/Custom dev-server command/.test(x.textContent)&&x.children.length===0); if(c)c.scrollIntoView({block:'center'});"
echo "SETTINGS-DONE"
