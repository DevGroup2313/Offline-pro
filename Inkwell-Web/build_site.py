#!/usr/bin/env python3
# INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
# No licence is granted. See LICENCE.txt.
#
# Builds the home-screen web app for iPhone and iPad (and any browser):
#   python3 build_site.py <assets-folder> <output-folder> [version]
# The assets folder is Inkwell-Android/app/src/main/assets, so the web app,
# the Fire app and the iPhone app all carry the same Inkwell.html.
# The output holds index.html (Inkwell.html with the home-screen tags), a
# manifest, the icons and a service worker that keeps everything for offline use.

import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

HEAD_TAGS = """<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Inkwell">
<meta name="theme-color" content="#1F4F68">
<script>/* Inkwell web app: keep the app on the device for offline use. */
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});}
</script>
"""

SERVICE_WORKER = """/* Inkwell web app service worker, build %(build)s.
   Inkwell's own files are kept on the device and served from there first, so
   the app opens offline. Requests to other sites (models, for instance) pass
   through untouched. */
const CACHE = 'inkwell-%(build)s';
const FILES = %(files)s;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('inkwell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
"""


def inject_head(html, tags):
    """Insert the tags just before the first closing head tag (any case)."""
    i = html.lower().find("</head>")
    return tags + html if i < 0 else html[:i] + tags + html[i:]


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: build_site.py <assets-folder> <output-folder> [version]")
    assets, out = sys.argv[1], sys.argv[2]
    version = sys.argv[3] if len(sys.argv) > 3 else "dev"

    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)

    with open(os.path.join(assets, "Inkwell.html"), encoding="utf-8") as f:
        page = inject_head(f.read(), HEAD_TAGS)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)

    shutil.copytree(os.path.join(assets, "vendor"), os.path.join(out, "vendor"))
    shutil.copytree(os.path.join(HERE, "icons"), os.path.join(out, "icons"))

    manifest = {
        "name": "Inkwell",
        "short_name": "Inkwell",
        "start_url": "./",
        "scope": "./",
        "display": "standalone",
        "background_color": "#E9EDF3",
        "theme_color": "#1F4F68",
        "icons": [
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        ],
    }
    with open(os.path.join(out, "manifest.webmanifest"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    files = ["./", "index.html", "manifest.webmanifest"]
    # every file, in sub-folders too (vendor/csl holds the citation styles);
    # a folder in this list would make the whole offline install fail
    for folder in ("icons", "vendor"):
        for base, _dirs, names in os.walk(os.path.join(out, folder)):
            rel = os.path.relpath(base, out).replace(os.sep, "/")
            files += sorted(rel + "/" + n for n in names)
    digest = hashlib.sha256(page.encode("utf-8")).hexdigest()[:10]
    build = "%s-%s" % (version, digest)
    with open(os.path.join(out, "sw.js"), "w", encoding="utf-8") as f:
        f.write(SERVICE_WORKER % {"build": build, "files": json.dumps(files)})

    # GitHub Pages and similar hosts must serve the files as they are.
    open(os.path.join(out, ".nojekyll"), "w").close()
    print("web app built in %s (build %s, %d files cached for offline use)" % (out, build, len(files)))


if __name__ == "__main__":
    main()
