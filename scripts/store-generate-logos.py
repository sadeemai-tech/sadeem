#!/usr/bin/env python3
"""Generate the Microsoft Store (APPX) logo set from build/icon.png.

Sizes/filenames match exactly what electron-builder v26 AppxTarget expects in
build/appx/ (see AppxTarget.js: vendorAssetsForDefaultAssets, lockScreenTag,
defaultTileTag, splashScreenTag):

  StoreLogo.png          50 x 50    (package logo / Properties.Logo)
  Square44x44Logo.png    44 x 44    (taskbar / app list)
  Square150x150Logo.png 150 x 150   (medium tile)
  SmallTile.png          71 x 71    (small tile, uap:DefaultTile)
  LargeTile.png         310 x 310   (large tile, uap:DefaultTile)
  Wide310x150Logo.png   310 x 150   (wide tile, uap:DefaultTile)
  SplashScreen.png      620 x 300   (uap:SplashScreen)
  BadgeLogo.png           24 x 24   (uap:LockScreen, white on transparent)

Run:  python scripts/store-generate-logos.py
Then: npm run dist:store:assets  (copies these into build/appx/)
Requires Pillow only for REGENERATION; the generated PNGs are committed, so
the packaging machine does NOT need Python.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon.png"
OUT = ROOT / "build" / "store" / "logos"

INK = (35, 42, 46, 255)  # brand --bg obsidian; matches appx.backgroundColor


def square(size: int) -> Image.Image:
    return SOURCE_IMAGE.resize((size, size), Image.LANCZOS).convert("RGBA")


def canvas(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), INK)
    icon = SOURCE_IMAGE.resize((min(h, w), min(h, w)), Image.LANCZOS).convert("RGBA")
    img.alpha_composite(icon, ((w - icon.width) // 2, (h - icon.height) // 2))
    return img


def badge(size: int = 24) -> Image.Image:
    """Windows lock-screen badge: white shape on a fully transparent canvas."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, int(size * 0.22))
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius,
                        fill=(255, 255, 255, 255))
    return img


if not SOURCE.exists():
    raise SystemExit(f"missing source icon: {SOURCE}")

SOURCE_IMAGE = Image.open(SOURCE).convert("RGBA")
OUT.mkdir(parents=True, exist_ok=True)

assets = {
    "StoreLogo.png": square(50),
    "Square44x44Logo.png": square(44),
    "Square150x150Logo.png": square(150),
    "SmallTile.png": square(71),
    "LargeTile.png": square(310),
    "Wide310x150Logo.png": canvas(310, 150),
    "SplashScreen.png": canvas(620, 300),
    "BadgeLogo.png": badge(24),
}

for name, img in assets.items():
    img.save(OUT / name, "PNG")
    print(f"{name:24s} {img.width}x{img.height}")
