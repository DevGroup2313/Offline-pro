"""Place the rendered icons (tools/icons/out) where each build takes them.

Android launcher sizes, the web app's icons, the iPhone and iPad icon (opaque),
the Mac .icns and launcher image, the Windows .ico and launcher image, and the
artwork master. Needs Pillow.
"""
import os
import shutil
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tools', 'icons', 'out')


def put(src, dst, opaque=False):
    im = Image.open(os.path.join(OUT, src))
    im = im.convert('RGB') if opaque else im.convert('RGBA')
    im.save(os.path.join(ROOT, dst))
    print(dst, im.size, im.mode)


for d in ('mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'):
    put('android_%s.png' % d, 'Inkwell-Android/app/src/main/res/mipmap-%s/ic_launcher.png' % d)
put('web_192.png', 'Inkwell-Web/icons/icon-192.png')
put('web_512.png', 'Inkwell-Web/icons/icon-512.png')
put('apple_touch_180.png', 'Inkwell-Web/icons/apple-touch-icon.png', opaque=True)
put('ios_1024.png', 'Inkwell-iOS/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png', opaque=True)
put('round_512.png', 'Inkwell-Mac/inkwell.png')
put('round_512.png', 'Inkwell-Windows/inkwell.png')
put('round_1024.png', 'artwork/inkwell-seal-1024.png')
# Windows: one .ico with every size, each drawn at its own size
sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [Image.open(os.path.join(OUT, 'ico_%d.png' % s)).convert('RGBA') for s in sizes]
imgs[-1].save(os.path.join(ROOT, 'Inkwell-Windows/inkwell.ico'), sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
print('Inkwell-Windows/inkwell.ico', sizes)
# Mac: the .icns from the 1024 master
Image.open(os.path.join(OUT, 'round_1024.png')).convert('RGBA').save(os.path.join(ROOT, 'Inkwell-Mac/inkwell.icns'))
print('Inkwell-Mac/inkwell.icns')
