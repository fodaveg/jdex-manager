#!/usr/bin/env python3
"""Regenerates assets/hebra-icon.png, the icon Hebra paints for JDex Manager (`iconImage`
in hebra.json, see assets/README.md): a «JD» monogram, 128x128 RGBA, drawn 4x and
downsampled for clean edges. Needs Pillow and Arial Bold (macOS system font).

    python3 scripts/make-hebra-icon.py [--preview OUT.png]

`--preview` also writes the icon reduced to 16, 20 and 32 px on a dark and a light
background, to check that «JD» still reads at the size Hebra uses.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

SIZE = 128
SCALE = 4
RADIUS = 24
BORDER = 3
FILL = (0x1E, 0x3A, 0x5F, 255)
EDGE = (0x0B, 0x12, 0x20, 255)
INK = (255, 255, 255, 255)
TEXT = 'JD'
TEXT_WIDTH = 0.64  # share of the width the letters occupy
FONTS = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf',
]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets', 'hebra-icon.png')


def render() -> Image.Image:
    font_path = next((p for p in FONTS if os.path.exists(p)), None)
    if font_path is None:
        sys.exit('make-hebra-icon: no Arial Bold found in ' + ', '.join(FONTS))
    big = SIZE * SCALE
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    box = [0, 0, big - 1, big - 1]
    draw.rounded_rectangle(box, radius=RADIUS * SCALE, fill=EDGE)
    inset = BORDER * SCALE
    draw.rounded_rectangle(
        [inset, inset, big - 1 - inset, big - 1 - inset], radius=(RADIUS - BORDER) * SCALE, fill=FILL
    )
    size = 10
    while True:
        font = ImageFont.truetype(font_path, size)
        left, top, right, bottom = draw.textbbox((0, 0), TEXT, font=font)
        if right - left >= big * TEXT_WIDTH:
            break
        size += 2
    x = (big - (right - left)) / 2 - left
    y = (big - (bottom - top)) / 2 - top
    draw.text((x, y), TEXT, font=font, fill=INK)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def preview(icon: Image.Image, path: str) -> None:
    sizes = [16, 20, 32]
    zoom = 6
    backgrounds = [(0x1A, 0x1B, 0x26, 255), (255, 255, 255, 255)]
    cell = 32 * zoom + 20
    sheet = Image.new('RGBA', (cell * len(sizes), cell * 2), (0, 0, 0, 255))
    for row, bg in enumerate(backgrounds):
        for col, px in enumerate(sizes):
            tile = Image.new('RGBA', (cell, cell), bg)
            small = icon.resize((px, px), Image.LANCZOS)
            big = small.resize((px * zoom, px * zoom), Image.NEAREST)
            tile.alpha_composite(big, ((cell - px * zoom) // 2, (cell - px * zoom) // 2))
            sheet.paste(tile, (col * cell, row * cell))
    # Real size strip (no zoom) at the bottom-left of each tile would be unreadable; zoom is nearest-neighbour.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview')
    args = parser.parse_args()
    icon = render()
    icon.save(OUT, optimize=True)
    print(f'wrote {os.path.normpath(OUT)} ({os.path.getsize(OUT)} bytes)')
    if args.preview:
        preview(icon, args.preview)
        print(f'preview {args.preview}')
