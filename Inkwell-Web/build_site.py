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

# 7.41: the address people are sent (Inkwell-Web/SITE_URL.txt). Link previews
# (Messages, WhatsApp, Mail, social sites) need the picture's full address.
def site_url():
    try:
        with open(os.path.join(HERE, "SITE_URL.txt"), encoding="utf-8") as f:
            return f.read().strip().rstrip("/")
    except OSError:
        return ""


SHARE_DESC = "The writing desk that teaches as it corrects. Offline, private, on every device."


def share_tags(site):
    """The seal in every tab and in every shared link."""
    # 7.42: each icon link names its day and night form; the page swaps them
    # with its theme (inkTabIcon), so the tab shows the night seal in dark mode.
    # No "shortcut icon" link: with one, Chrome and Safari may keep favicon.ico
    # (the cream seal) over the swapped link.
    tags = ['<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png" data-ink-day="icons/favicon-32.png" data-ink-night="icons/favicon-32-night.png">',
            '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png" data-ink-day="icons/icon-192.png" data-ink-night="icons/icon-192-night.png">',
            '<meta name="description" content="%s">' % SHARE_DESC,
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="Inkwell">',
            '<meta property="og:title" content="Inkwell">',
            '<meta property="og:description" content="%s">' % SHARE_DESC,
            '<meta name="twitter:card" content="summary_large_image">',
            '<meta name="twitter:title" content="Inkwell">',
            '<meta name="twitter:description" content="%s">' % SHARE_DESC]
    if site:
        img = site + "/icons/inkwell-share.png"
        tags += ['<meta property="og:url" content="%s/">' % site,
                 '<meta property="og:image" content="%s">' % img,
                 '<meta property="og:image:type" content="image/png">',
                 '<meta property="og:image:width" content="1200">',
                 '<meta property="og:image:height" content="630">',
                 '<meta property="og:image:alt" content="The Inkwell seal: a pen in an inkwell, in brass and midnight blue, on cream wax.">',
                 '<meta name="twitter:image" content="%s">' % img]
    return "\n".join(tags) + "\n"


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
   Inkwell's own files are kept on the device, so the app opens offline.
   7.38: the page itself is asked of the site first (for up to 3.5 seconds),
   so a new version shows the first time Inkwell is opened online; with no
   network the kept copy opens at once. A file too large for an easy upload
   is kept in parts (SPLIT), and joined here when it is asked for whole.
   Requests to other sites (models, for instance) pass through untouched. */
const CACHE = 'inkwell-%(build)s';
const FILES = %(files)s;
const SPLIT = %(split)s;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('inkwell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function page(req) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(req.url, { signal: ctl.signal, cache: 'no-store', credentials: 'same-origin' });
    clearTimeout(t);
    if (r && r.ok) { const c = await caches.open(CACHE); await c.put('index.html', r.clone()); return r; }
  } catch (err) {}
  return (await caches.match('index.html')) || fetch(req);
}
async function joined(name, n, type) {
  const parts = [];
  for (let i = 1; i <= n; i++) {
    const u = name + '.part' + i;
    const r = (await caches.match(u)) || await fetch(u);
    if (!r || !r.ok) return new Response('missing ' + u, { status: 404 });
    parts.push(await r.arrayBuffer());
  }
  return new Response(new Blob(parts, { type: type }), { status: 200, headers: { 'Content-Type': type } });
}
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(page(req)); return; }
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (SPLIT[rel]) { e.respondWith(joined(rel, SPLIT[rel], rel.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')); return; }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
"""

# 7.38: no file of the site is larger than this, so every file can be put
# online by dragging it into a browser (GitHub takes 25 MiB at most per file
# that way; Netlify advises staying under 10 MB). A larger file is kept as
# name.part1, name.part2, ... with name.parts holding the number of parts; the
# page and the service worker join them again.
PART = 9 * 1024 * 1024


def split_large(out):
    split = {}
    for base, _dirs, names in os.walk(out):
        for n in names:
            path = os.path.join(base, n)
            size = os.path.getsize(path)
            if size <= PART:
                continue
            with open(path, "rb") as f:
                data = f.read()
            count = (size + PART - 1) // PART
            for i in range(count):
                with open("%s.part%d" % (path, i + 1), "wb") as g:
                    g.write(data[i * PART:(i + 1) * PART])
            with open(path + ".parts", "w") as g:
                g.write(str(count))
            os.remove(path)
            split[os.path.relpath(path, out).replace(os.sep, "/")] = count
    return split


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
        page = inject_head(f.read(), share_tags(site_url()) + HEAD_TAGS)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)

    shutil.copytree(os.path.join(assets, "vendor"), os.path.join(out, "vendor"))
    # 7.34: Transformers.js 4 for the writing model inside the window (only
    # the web app carries it; the apps use their own engines)
    tf4 = os.path.join(HERE, "tf4")
    if os.path.isdir(tf4):
        shutil.copytree(tf4, os.path.join(out, "vendor", "tf4"))
    shutil.copytree(os.path.join(HERE, "icons"), os.path.join(out, "icons"))
    shutil.copyfile(os.path.join(HERE, "favicon.ico"), os.path.join(out, "favicon.ico"))
    split = split_large(out)

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

    files = ["./", "index.html", "manifest.webmanifest", "favicon.ico"]
    # every file, in sub-folders too (vendor/csl holds the citation styles);
    # a folder in this list would make the whole offline install fail
    for folder in ("icons", "vendor"):
        for base, _dirs, names in os.walk(os.path.join(out, folder)):
            rel = os.path.relpath(base, out).replace(os.sep, "/")
            files += sorted(rel + "/" + n for n in names)
    digest = hashlib.sha256(page.encode("utf-8")).hexdigest()[:10]
    build = "%s-%s" % (version, digest)
    with open(os.path.join(out, "sw.js"), "w", encoding="utf-8") as f:
        f.write(SERVICE_WORKER % {"build": build, "files": json.dumps(files), "split": json.dumps(split)})

    # GitHub Pages and similar hosts must serve the files as they are.
    open(os.path.join(out, ".nojekyll"), "w").close()
    print("web app built in %s (build %s, %d files cached for offline use; kept in parts: %s)"
          % (out, build, len(files), ", ".join("%s (%d)" % kv for kv in sorted(split.items())) or "none"))


if __name__ == "__main__":
    main()
