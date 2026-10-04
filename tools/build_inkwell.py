#!/usr/bin/env python3
# INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
# No licence is granted. See LICENCE.txt.
#
# Builds Inkwell.html from its sources:
#   src/inkwell.html        the main page, with @@TABULA_B64@@, @@SCRIBA_B64@@
#                           and @@FONTES_B64@@ where the rooms go
#   src/rooms/*.html        Tabula, Scriba and Fontes, each a whole page
#   src/lib/*.js            scripts shared by the page and its model worker
# The rooms are embedded base64-encoded, as before. The result is written to
# every place that carries Inkwell (the Android assets, which the iOS app and
# the web app also take, and the top-level standalone copies).
#   python3 tools/build_inkwell.py          build
#   python3 tools/build_inkwell.py --check  fail if the built files are stale

import base64
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
ROOMS = ("tabula", "scriba", "fontes")


def read(path):
    with open(path, "rb") as f:
        return f.read()


def build():
    page = read(os.path.join(SRC, "inkwell.html")).decode("utf-8")
    rooms = {}
    for room in ROOMS:
        raw = read(os.path.join(SRC, "rooms", room + ".html"))
        rooms[room] = raw
        marker = "@@%s_B64@@" % room.upper()
        if page.count(marker) != 1:
            sys.exit("src/inkwell.html must hold %s exactly once" % marker)
        page = page.replace(marker, base64.b64encode(raw).decode("ascii"))
    # 7.32: shared scripts (the grammar model's decoder and the safety filter)
    # are written once in src/lib and placed in the page where it names them
    for name in ("gector_core", "gec_filter"):
        marker = "@@LIB_%s@@" % name.upper()
        if page.count(marker) != 1:
            sys.exit("src/inkwell.html must hold %s exactly once" % marker)
        page = page.replace(marker, read(os.path.join(SRC, "lib", name + ".js")).decode("utf-8"))
    outputs = {
        os.path.join("Inkwell-Android", "app", "src", "main", "assets", "Inkwell.html"): page.encode("utf-8"),
        "Inkwell.html": page.encode("utf-8"),
        "scriba_v729.html": rooms["scriba"],
        "fontes_v729.html": rooms["fontes"],
    }
    return outputs


def main():
    outputs = build()
    stale = []
    for rel, data in outputs.items():
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path) or read(path) != data:
            stale.append(rel)
    if "--check" in sys.argv:
        if stale:
            sys.exit("stale, run tools/build_inkwell.py: " + ", ".join(stale))
        print("all built files are up to date")
        return
    for rel in stale:
        with open(os.path.join(ROOT, rel), "wb") as f:
            f.write(outputs[rel])
    print("written: " + (", ".join(stale) if stale else "nothing (already up to date)"))


if __name__ == "__main__":
    main()
