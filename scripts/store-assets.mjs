#!/usr/bin/env node
// ============================================================
// SADEEM — stage Microsoft Store (APPX) assets for electron-builder.
//
// electron-builder v26 reads the `appx` asset directory from
// directories.buildResources (= build/), i.e. build/appx/. The committed,
// source-of-truth logos live in build/store/logos/ (inside this task's
// allowed tree). This script copies them to build/appx/ and validates the
// exact filenames + pixel sizes that AppxTarget.js expects.
//
// No Python / Pillow / ImageMagick needed on the packaging machine — the
// generated PNGs are already in the repo. To regenerate after an icon
// change: python scripts/store-generate-logos.py
// ============================================================
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'build', 'store', 'logos');
const DST = join(ROOT, 'build', 'appx');

// name -> [width, height]. Names must match AppxTarget.js exactly:
// "SmallTile" and "LargeTile" are the base names it looks for when
// generating the uap:DefaultTile macro (NOT Square71x71Logo/Square310x310Logo).
const REQUIRED = {
  'StoreLogo.png': [50, 50],
  'Square44x44Logo.png': [44, 44],
  'Square150x150Logo.png': [150, 150],
  'SmallTile.png': [71, 71],
  'LargeTile.png': [310, 310],
  'Wide310x150Logo.png': [310, 150],
  'SplashScreen.png': [620, 300],
  'BadgeLogo.png': [24, 24],
};

function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.subarray(1, 4).toString() !== 'PNG') {
    throw new Error(`not a PNG: ${file}`);
  }
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function fail(message) {
  console.error(`[store-assets] FAILED: ${message}`);
  process.exit(1);
}

if (!existsSync(SRC)) fail(`missing logo source directory: ${SRC}`);

for (const [name, [w, h]] of Object.entries(REQUIRED)) {
  const src = join(SRC, name);
  if (!existsSync(src)) fail(`missing required logo: ${src}`);
  const [aw, ah] = pngSize(src);
  if (aw !== w || ah !== h) {
    fail(`${name} is ${aw}x${ah}, expected ${w}x${h} (run: python scripts/store-generate-logos.py)`);
  }
}

mkdirSync(DST, { recursive: true });
for (const name of Object.keys(REQUIRED)) {
  copyFileSync(join(SRC, name), join(DST, name));
}
// Remove stale PNGs so electron-builder never packages an unexpected asset.
for (const f of readdirSync(DST)) {
  if (f.toLowerCase().endsWith('.png') && !(f in REQUIRED)) {
    unlinkSync(join(DST, f));
    console.log(`[store-assets] removed stale asset: ${f}`);
  }
}

const dist = join(ROOT, 'dist');
const distElectron = join(ROOT, 'dist-electron', 'electron', 'main.js');
if (!existsSync(dist) || !existsSync(distElectron)) {
  fail(`app build output missing. Run "npm run full" first (dist/ and dist-electron/electron/main.js).`);
}

console.log(`[store-assets] staged ${Object.keys(REQUIRED).length} logos into ${DST}`);
