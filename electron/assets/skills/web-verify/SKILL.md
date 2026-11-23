---
name: Web Verify Loop
description: The mandatory browser-verification loop for any UI the agent builds — open it live, probe it at 3 widths, screenshot it, LOOK at the image, fix, repeat until it is genuinely clean.
---

# Web Verify Loop (see it before you say done)

Use after building or editing ANY user-facing web UI. A page you have not SEEN is not done.

## The loop (strict order)

1. **RUN IT LIVE** — `preview` tool: action "static" for plain HTML/dist folders,
   "dev_start" for package.json dev servers. Wait for the URL.
2. **PROBE IT** — `ui_quality_check` on the page (or the localhost URL). It loads the page
   offscreen at 390 / 820 / 1366 px and reports: horizontal overflow (with the offending
   elements), low-contrast text, tiny text, missing viewport/lang/title, missing alt,
   unlabelled buttons, console errors.
3. **FIX EVERY ISSUE** in the source — not by hiding symptoms — and re-run until the report
   says `RESULT: PASS`.
4. **LOOK AT IT** — `preview_screenshot` the URL and actually inspect the returned image:
   broken layouts, overlapping text, ugly defaults, empty states, RTL flips. Fix what looks
   wrong even if the probe passed, then re-shoot.
5. **CLICK THROUGH** — for interactive pages: forms submit, buttons respond, nav anchors
   scroll, no console errors. Use `http_request` to sanity-check API endpoints you wired.

## Arabic / RTL pages

Set `dir="rtl"` and `lang="ar"` on <html>, check mirrored spacing (padding-inline, not
padding-left), and verify Arabic text renders in a proper Arabic font stack — never tofu boxes.
Take the screenshot at 390px specifically: Arabic wraps differently and overflows more.

## When there is no browser (desktop/GUI apps)

pygame/tkinter/Qt/Electron apps cannot render in the web preview. Instead: run them
(run_background), verify via logs/tests, and use `screenshot` (with the user's permission)
to see the actual window. Deliver run instructions.
