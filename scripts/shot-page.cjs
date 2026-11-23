// Renders a local HTML file in Electron and captures a full-page screenshot.
// Usage: electron shot-page.cjs <file.html> <out.png> [width] [height]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const [, , file, out, wArg, hArg] = process.argv;
  const w = parseInt(wArg || '1280', 10);
  const h = parseInt(hArg || '900', 10);
  const win = new BrowserWindow({ width: w, height: h, show: false, webPreferences: { offscreen: true } });
  await win.loadURL('file://' + path.resolve(file));
  await new Promise((r) => setTimeout(r, 900));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('PAGE_SHOT_SAVED', out);
  app.exit(0);
});
