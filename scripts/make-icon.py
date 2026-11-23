#!/usr/bin/env python3
"""Generate build/icon.ico (multi-size) + build/icon.png for Kodex.
Matte brand icon: sage rounded square + warm-charcoal K, no gradients."""
from PIL import Image, ImageDraw, ImageFont
import os

SAGE = (167, 192, 128, 255)      # --acc obsidian
INK = (35, 42, 46, 255)          # --bg obsidian
SIZES = [256, 128, 64, 48, 32, 16]

os.makedirs("/home/z/my-project/kodex/build", exist_ok=True)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, int(size * 0.22))
    rounded(d, [0, 0, size - 1, size - 1], radius, SAGE)
    # letter K centered, ~62% height
    font_size = int(size * 0.60)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), "K", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1] - size * 0.01
    d.text((x, y), "K", font=font, fill=INK)
    return img


frames = [make(s) for s in SIZES]
frames[0].save("/home/z/my-project/kodex/build/icon.ico", sizes=[(s, s) for s in SIZES])
frames[0].save("/home/z/my-project/kodex/build/icon.png")
print("icon.ico + icon.png written:", [os.path.getsize(f"/home/z/my-project/kodex/build/{n}") for n in ("icon.ico", "icon.png")])
