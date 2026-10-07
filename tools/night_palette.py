"""Move Inkwell's night mode from walnut to the seal's midnight.

Only rules whose selector is a night-mode selector are touched. Inside them,
dark warm neutrals (walnut browns) and dark cool greys become the seal's
midnight blue-black at the same lightness. Light text colours (ivory and
champagne), shadows, and signal colours (red, green, blue accents) are kept.

usage: python tools/night_palette.py FILE [FILE ...]   (rewrites in place, prints a summary)
"""
import colorsys
import re
import sys

NIGHT = ("[data-theme=dark]", "[data-theme='dark']", 'cd-dark', 'cd-night', 'html.dark', 'body.dark')
RULE = re.compile(r'([^{}]*)\{([^{}]*)\}')
HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b')
RGBA = re.compile(r'rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*[\d.]+\s*)?\)')

MIDNIGHT_HUE = 212 / 360


def shift(r, g, b):
    """Return the midnight equivalent of a dark neutral, or None to keep it."""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    hue = h * 360
    if l >= 0.42 or l <= 0.005:
        return None                       # text, ivory, champagne, pure black: keep
    warm = 12 <= hue <= 66 and s <= 0.5
    grey = s <= 0.22 and (hue >= 180 and hue <= 250 or s <= 0.06)
    if not (warm or grey):
        return None                       # signal colours and blue accents: keep
    nl = l * 0.94
    ns = 0.34 if nl < 0.08 else 0.28 if nl < 0.2 else 0.22
    nr, ng, nb = colorsys.hls_to_rgb(MIDNIGHT_HUE, nl, ns)
    return round(nr * 255), round(ng * 255), round(nb * 255)


def fix_hex(m):
    v = m.group(1)
    if len(v) in (3, 4):
        v = ''.join(c * 2 for c in v)
    r, g, b = int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
    a = v[6:8] if len(v) == 8 else ''
    n = shift(r, g, b)
    if not n:
        return m.group(0)
    return '#%02x%02x%02x%s' % (n[0], n[1], n[2], a)


def fix_rgba(m):
    n = shift(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if not n:
        return m.group(0)
    a = m.group(4) or ''
    return ('rgba(%d,%d,%d%s)' if a else 'rgb(%d,%d,%d%s)') % (n[0], n[1], n[2], a)


def is_night(sel):
    if ';' in sel or '&&' in sel or 'function' in sel or 'return' in sel:
        return False
    return any(k in sel for k in NIGHT)


def run(path):
    src = open(path, encoding='utf-8').read()
    changed = [0, 0]

    def rule(m):
        sel, body = m.group(1), m.group(2)
        if not is_night(sel):
            return m.group(0)
        nb = RGBA.sub(fix_rgba, HEX.sub(fix_hex, body))
        if nb != body:
            changed[0] += 1
            changed[1] += sum(1 for a, b in zip(HEX.findall(body) + RGBA.findall(body), HEX.findall(nb) + RGBA.findall(nb)) if a != b)
        return sel + '{' + nb + '}'

    out = RULE.sub(rule, src)
    open(path, 'w', encoding='utf-8').write(out)
    print(f'{path}: {changed[0]} night rules recoloured, {changed[1]} colours moved to midnight')


if __name__ == '__main__':
    for p in sys.argv[1:]:
        run(p)
