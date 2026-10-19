#!/usr/bin/env python3
"""Generate PWA icon set for vocab-card (run once, outputs are committed)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
BG = (250, 248, 244, 255)      # cream, matches --bg
ACCENT = (201, 111, 74, 255)   # terracotta, matches --accent
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_icon(size: int, scale: float, path: str):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Full-bleed rounded square background (iOS squircles it anyway).
    rounded(d, [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BG)

    # A small stack of two cards behind the letter.
    card_w = int(size * 0.62 * scale)
    card_h = int(card_w * 1.25)
    cx = size // 2
    cy = size // 2
    card_r = int(card_w * 0.12)
    # Back card, slightly rotated look via offset.
    back_box = [cx - card_w // 2 + int(size * 0.03), cy - card_h // 2 - int(size * 0.045),
                cx - card_w // 2 + int(size * 0.03) + card_w, cy - card_h // 2 - int(size * 0.045) + card_h]
    rounded(d, back_box, card_r, fill=(232, 227, 218, 255))
    # Front card.
    front_box = [cx - card_w // 2 - int(size * 0.025), cy - card_h // 2 + int(size * 0.045),
                 cx - card_w // 2 - int(size * 0.025) + card_w, cy - card_h // 2 + int(size * 0.045) + card_h]
    rounded(d, front_box, card_r, fill=(255, 255, 255, 255))

    # The letter W centered in the front card.
    font_size = int(card_w * 0.62)
    font = ImageFont.truetype(FONT, font_size)
    bbox = d.textbbox((0, 0), 'W', font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    fx = (front_box[0] + front_box[2]) // 2
    fy = (front_box[1] + front_box[3]) // 2
    d.text((fx - tw / 2 - bbox[0], fy - th / 2 - bbox[1]), 'W', font=font, fill=ACCENT)

    img.save(path)


os.makedirs(os.path.join(OUT, 'icons'), exist_ok=True)
# Regular icons: content uses most of the canvas.
make_icon(192, 1.0, os.path.join(OUT, 'icons', 'icon-192.png'))
make_icon(512, 1.0, os.path.join(OUT, 'icons', 'icon-512.png'))
# Maskable icon: content shrunk into the 80% safe zone.
make_icon(512, 0.78, os.path.join(OUT, 'icons', 'icon-512-maskable.png'))
# Apple touch icon: 180x180, opaque background.
make_icon(180, 1.0, os.path.join(OUT, 'apple-touch-icon.png'))
print('icons written to', os.path.abspath(OUT))
