// ============================================================
// Surnia — post-build hardening for dist/index.html
// 1. CSP with an exact sha256 hash of the built entry JS.
//    Chromium hashes the PRECISE bytes '\n' + js + '\n' (Vite
//    writes the file with a leading/trailing newline), so the
//    hash must be computed over the same byte window — a hash
//    over the raw js alone NEVER matches and every load is
//    refused with console CSP violations (silent white screen).
// 2. data-kdx-boot watchdog: surfaces script errors, unhandled
//    rejections and a mount timeout as a readable Warm-Clay
//    error card instead of a blank window.
// 3. Removes the dev module script (/src/main.tsx) reference.
// Run: node scripts/post-build.mjs  (after `vite build`)
// ============================================================
import { promises as fs } from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const INDEX = path.join(DIST, 'index.html');

const CSP_META = (entryHash, bootHash) =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' '${entryHash}' '${bootHash}' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; frame-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'" />`;

const BOOT_SCRIPT = `
    <script data-kdx-boot>
(function(){
  "use strict";
  var shown = false;
  function show(kind, msg, extra){
    if (shown) return; shown = true;
    var d = document.createElement("div");
    d.setAttribute("data-kdx-boot-error","1");
    d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#1A2126;color:#DCD3C0;" +
      "font:14px/1.6 'Segoe UI',system-ui,sans-serif;padding:48px;overflow:auto";
    d.innerHTML = '<div style="max-width:860px;margin:0 auto">' +
      '<div style="font-size:22px;font-weight:700;color:#E69875;margin-bottom:10px">Surnia failed to start</div>' +
      '<div style="color:#B9C4BA;margin-bottom:18px">The interface could not initialize. Details below help diagnose the issue (also logged by the app):</div>' +
      '<pre style="white-space:pre-wrap;background:#1F272C;border:1px solid rgba(217,207,187,.12);border-radius:8px;padding:16px;color:#D7CFC3;font:12px/1.5 monospace"></pre>' +
      '<div style="margin-top:18px;color:#8FAF97">Report this text to support. Full log: Settings → Advanced → Open logs (%APPDATA%/Surnia/logs/main.log)</div></div>';
    document.body.appendChild(d);
    var pre = d.querySelector("pre");
    if (pre) pre.textContent = (kind + ": " + msg + (extra ? "\\n" + extra : "")).slice(0, 4000);
  }
  window.addEventListener("error", function(e){
    if (document.documentElement.dataset.appMounted === "1") return;
    show("script error", (e && e.message) || "unknown", e && e.filename ? e.filename + ":" + e.lineno : "");
  }, true);
  window.addEventListener("unhandledrejection", function(e){
    if (document.documentElement.dataset.appMounted === "1") return;
    var r = e && e.reason;
    show("unhandled rejection", r && (r.stack || r.message) ? (r.stack || r.message) : String(r));
  });
  var t = 0;
  var iv = setInterval(function(){
    t += 1;
    if (document.documentElement.dataset.appMounted === "1" || shown) { clearInterval(iv); return; }
    if (t === 3) show("boot timeout", "app bundle loaded but never mounted (root empty)");
  }, 1500);
})();
</script>`;

async function main() {
  let html = await fs.readFile(INDEX, 'utf8');

  // 0) ship the WebCraft design-system kit inside dist/ so the packaged app
  //    (asar) carries it: the agent's ui_quality flow reads it via
  //    <app>/dist/webcraft/design-system.css (same path dev uses).
  const kitSrc = path.join(ROOT, 'electron', 'assets', 'webcraft', 'design-system.css');
  try {
    const kit = await fs.readFile(kitSrc, 'utf8');
    await fs.mkdir(path.join(DIST, 'webcraft'), { recursive: true });
    await fs.writeFile(path.join(DIST, 'webcraft', 'design-system.css'), kit, 'utf8');
    console.log(`post-build: webcraft kit shipped (${kit.length} bytes → dist/webcraft/)`);
  } catch (err) {
    console.warn(`post-build: webcraft kit NOT shipped: ${err?.message ?? err}`);
  }

  // 1b) v5 — built-in SKILLS library → dist-electron/skills (lands in the
  // packaged asar; skills.ts builtinSkillsRoot() reads dist-electron/skills).
  try {
    const skillsSrc = path.join(ROOT, 'electron', 'assets', 'skills');
    const entries = await fs.readdir(skillsSrc, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      await fs.cp(path.join(skillsSrc, e.name), path.join(ROOT, 'dist-electron', 'skills', e.name), {
        recursive: true,
        force: true,
      });
      n++;
    }
    console.log(`post-build: built-in skills shipped (${n} → dist-electron/skills/)`);
  } catch (err) {
    console.warn(`post-build: built-in skills NOT shipped: ${err?.message ?? err}`);
  }

  // 1) locate the built entry script (stylesheets ship as 'self' files —
  // no css hashes: their presence would disable 'unsafe-inline' in style-src)
  const assets = await fs.readdir(path.join(DIST, 'assets')).catch(() => []);
  const entry = assets.find((f) => /^index-.*\.js$/.test(f));
  if (!entry) throw new Error('post-build: no dist/assets/index-*.js entry found');
  const cssAssets = assets.filter((f) => /^index-.*\.css$/.test(f));

  // 2) hash the EXACT byte window Chromium sees: '\n' + js + '\n'
  const js = await fs.readFile(path.join(DIST, 'assets', entry), 'utf8');
  const hashed = '\n' + js + '\n';
  const entryHash = 'sha256-' + crypto.createHash('sha256').update(hashed, 'utf8').digest('base64');
  // 2b) hash the inline boot watchdog EXACTLY as Chromium sees it — the raw
  // text between <script data-kdx-boot> and </script>. Without this hash the
  // watchdog is refused by our own CSP and boot errors render as a blank card.
  // NOTE: css hashes were dropped deliberately — under CSP L3 the presence of
  // any hash in style-src DISABLES 'unsafe-inline', breaking style attributes.
  const bootInline = BOOT_SCRIPT.match(/<script data-kdx-boot>([\s\S]*?)<\/script>/);
  if (!bootInline) throw new Error('post-build: cannot extract boot watchdog source');
  const bootHash = 'sha256-' + crypto.createHash('sha256').update(bootInline[1], 'utf8').digest('base64');

  // 2c) v11.18 — write the hashes into a SIDECAR that ships inside app.asar.
  // The packaged renderer CSP is set by main.ts reading dist/index.html; if
  // that read fails for any reason, it must still have the real hashes rather
  // than falling back to a strict policy that blocks the boot script.
  try {
    await fs.writeFile(
      path.join(DIST, 'csp-hashes.json'),
      JSON.stringify({ entryHash, bootHash }, null, 2),
      'utf8',
    );
    console.log(`post-build: CSP hashes sidecar written (${entryHash.slice(0, 18)}…)`);
  } catch (err) {
    console.warn(`post-build: CSP hashes sidecar NOT written: ${err?.message ?? err}`);
  }

  // 3) strip any previous CSP/boot injection, then re-inject cleanly
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/g, '');
  html = html.replace(/<script data-kdx-boot>[\s\S]*?<\/script>/g, '');

  // 4) inject CSP as the FIRST thing in <head>
  html = html.replace(
    /(<head[^>]*>)/i,
    (_m, headOpen) => headOpen + '\n    ' + CSP_META(entryHash, bootHash),
  );

  // 5) inject the watchdog right after CSP
  html = html.replace(
    /(<meta http-equiv="Content-Security-Policy"[\s\S]*?>)/,
    (_m, meta) => meta + '\n' + BOOT_SCRIPT,
  );

  // 6) belt & braces: keep the #boot fallback visible markup if the source omitted it
  if (!html.includes('id="boot"')) {
    html = html.replace(
      /<body[^>]*>/i,
      (m) =>
        m +
        '\n    <div id="boot"><div class="k">S</div><div class="bar"><i></i></div>' +
        '<div id="bootMsg" style="font-size:13px">Surnia</div></div>',
    );
  }

  await fs.writeFile(INDEX, html, 'utf8');
  console.log(`post-build: CSP ${entryHash.slice(0, 24)}… + boot ${bootHash.slice(0, 20)}… injected; entry ${entry}; boot watchdog OK`);
}

main().catch((err) => {
  console.error('post-build FAILED:', err?.message ?? err);
  process.exit(1);
});
