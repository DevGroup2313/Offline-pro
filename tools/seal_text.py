"""Set capital lettering on arcs as SVG outlines, for the Inkwell seal.

The seal's letters are drawn shapes, not live text, so they look the same on
every device (the Fire tablet has no Georgia). Coordinates are in the seal's
100 x 100 viewBox, centred on (50, 50).

usage: python arctext.py FONT.woff2 NAME_SIZE NAME_TRACK DATE_SIZE DATE_TRACK BAND_MID > out.json
"""
import json
import math
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

CX, CY = 50.0, 50.0


def num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def cap_height(font, gs, cmap):
    bp = BoundsPen(gs)
    gs[cmap[ord("H")]].draw(bp)
    return bp.bounds[3]


def set_arc(font, text, size, track_em, base_r, top):
    """top=True: reads clockwise over the top, letters point outward.
    top=False: reads left to right along the bottom, letters point inward."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    s = size / font["head"].unitsPerEm
    names = [cmap[ord(ch)] for ch in text]
    adv = [font["hmtx"][n][0] * s for n in names]
    track = track_em * size
    total = sum(adv) + track * (len(names) - 1)
    pen = SVGPathPen(gs, ntos=num)
    pos = -total / 2
    for name, a in zip(names, adv):
        mid = pos + a / 2
        phi = mid / base_r
        c, n = math.cos(phi), math.sin(phi)
        if top:
            px, py = CX + base_r * n, CY - base_r * c
            m = (s * c, s * n, s * n, -s * c, px - (a / 2) * c, py - (a / 2) * n)
        else:
            px, py = CX + base_r * n, CY + base_r * c
            m = (s * c, -s * n, -s * n, -s * c, px - (a / 2) * c, py + (a / 2) * n)
        gs[name].draw(TransformPen(pen, m))
        pos += a + track
    span = math.degrees(total / base_r)
    return pen.getCommands(), span


def main():
    path = sys.argv[1]
    name_size, name_track, date_size, date_track, band_mid = map(float, sys.argv[2:7])
    font = TTFont(path)
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    ch = cap_height(font, gs, cmap) / font["head"].unitsPerEm
    name_base = band_mid - ch * name_size / 2
    date_base = band_mid + ch * date_size / 2
    name_d, name_span = set_arc(font, "INKWELL", name_size, name_track, name_base, True)
    date_d, date_span = set_arc(font, "XXIII · SEPTEMBRIS · MMXXVI", date_size, date_track, date_base, False)
    json.dump({"name": name_d, "date": date_d, "nameSpan": round(name_span, 1), "dateSpan": round(date_span, 1),
               "capHeight": round(ch, 3), "nameBase": round(name_base, 2), "dateBase": round(date_base, 2)}, sys.stdout)


if __name__ == "__main__":
    main()
