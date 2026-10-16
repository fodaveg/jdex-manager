# assets

`hebra-icon.png`: the icon Hebra paints for JDex Manager in Settings > Plugins and in its tab.
A «JD» monogram, 128x128 RGBA (slate blue #1E3A5F rounded square, radius 24, 3 px #0B1220 border,
white letters). `scripts/build-hebra.mjs` embeds it in `hebra.json` as `iconImage`
(`data:image/png;base64,...`) and fails the build unless it is a square PNG of 32 to 128 px and at
most 32 KiB; `icon` (`list`) stays as the fallback glyph.

Regenerate (Pillow; font: Arial Bold, `/System/Library/Fonts/Supplemental/Arial Bold.ttf` on macOS):

    python3 -I scripts/make-hebra-icon.py [--preview /tmp/preview.png]

`--preview` also writes the icon at 16, 20 and 32 px on dark and light backgrounds.

Current file: 5592 bytes, sha256 `f699463d90d76e859576f260800f7f0fadfef05ce249d6df2fba976da952e4ea`.
