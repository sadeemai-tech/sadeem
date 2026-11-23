#!/bin/bash
# تشخيص v9.0.0 الحالي: لقطات حقيقية + فحص سكرول برمجي (قبل إعادة التصميم)
set -u
cd /home/z/my-project/sadeem
OUT=/tmp/s9-diag
mkdir -p /tmp/s9-home $OUT

# JS: أدخل من الإعداد الأول إن ظهر، ثم نفّذ الإجراء المطلوب
enter_then() { # $1 = الجافاسكربت بعد الدخول (تُرجع Promise أو قيمة)
cat <<EOF
new Promise(res=>{
  const eb=[...document.querySelectorAll('button')].find(b=>/Enter Surnia/i.test(b.textContent||''));
  if(eb){ eb.click(); setTimeout(()=>res('entered'),1500); } else { res('already'); }
}).then(r=>new Promise(res=>{ ${1}; setTimeout(()=>res(r),900); }))
EOF
}

SETTINGS_JS="window.dispatchEvent(new CustomEvent('surnia:open-settings',{detail:{section:'MODELS_SEC'}}))"

run() { # $1=out  $2=js  $3=result(optional)
  local extra=""
  rm -rf /tmp/s9-home/.config
  [ -n "${3:-}" ] && extra="KODEX_SHOT_RESULT=$3"
  echo "── $(basename "$1")"
  env HOME=/tmp/s9-home DISPLAY=:99 KODEX_SHOT="$1" KODEX_SHOT_JS="$2" $extra \
    timeout 90 ./node_modules/.bin/electron . --no-sandbox 2>/tmp/s9-electron-err.log
  echo "   exit=$? $( [ -f "$1" ] && echo "size=$(stat -c%s "$1")" )"
}

# 1) الوضع الافتراضي
run $OUT/01-default.png ""

# 2) Settings → Models & Providers
run $OUT/02-settings-models.png "$(enter_then "$SETTINGS_JS")"

# 3) Settings → Account & Data
run $OUT/03-settings-account.png "$(enter_then "${SETTINGS_JS/MODELS_SEC/account}")"

# 4) Settings → Models + فحص سكرول
run $OUT/04-settings-scroll.png "$(enter_then "$SETTINGS_JS
return new Promise(res=>{ const c=document.querySelector('.set-content'); if(!c){res('NO .set-content');return;}
  const before={sh:c.scrollHeight,ch:c.clientHeight,st:c.scrollTop}; c.scrollTop=99999;
  setTimeout(()=>{const after={sh:c.scrollHeight,ch:c.clientHeight,st:c.scrollTop};
  res(JSON.stringify({before,after,scrollable:before.sh>before.ch,moved:after.st>0}));},500); })")" \
  $OUT/scroll-probe.json

echo "=== probe ==="; cat $OUT/scroll-probe.json 2>/dev/null; echo; ls -la $OUT/
