#!/usr/bin/env python3
# INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
# No licence is granted. See LICENCE.txt.
#
# Makes the download packages, one per kind of device. Mac is an install
# package (run its installer); Windows, Fire tablet, iPhone/iPad and the web
# app are build packages (put them on GitHub, which builds the app; for
# Windows, the installer GitHub builds is also published as a release):
#   python3 packaging/make_packages.py <output-folder>
# Each zip holds one folder whose CONTENTS become a new GitHub repository: the
# project, its workflow (in .github, plus a .txt copy for when the uploader
# skips hidden folders), the READ ME, the licence and the handoff notes.
# The workflows are the same files this repository builds with, unchanged:
# they find their project wherever it sits.

import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "packaging")
ASSETS = os.path.join(ROOT, "Inkwell-Android", "app", "src", "main", "assets")


def version():
    with open(os.path.join(ROOT, "Inkwell-Web", "VERSION.txt")) as f:
        return f.read().strip()


def copy(src, dst):
    src = os.path.join(ROOT, src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.isdir(src):
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


def common(pkg, readme, workflow, workflow_name, src_dir="packaging"):
    copy(os.path.join(src_dir, readme), os.path.join(pkg, readme))
    copy(workflow, os.path.join(pkg, ".github", "workflows", workflow_name))
    copy(workflow, os.path.join(pkg, "WORKFLOW %s (copy).txt" % workflow_name))
    copy("LICENCE.txt", os.path.join(pkg, "LICENCE.txt"))
    for name in sorted(os.listdir(ROOT)):
        if name.startswith("INKWELL_HANDOFF_") and name.endswith(".txt"):
            copy(name, os.path.join(pkg, name))


def fire(pkg):
    common(pkg, "READ ME FIRST - FIRE TABLET.txt", ".github/workflows/main.yml", "build-apk.yml")
    for name in ("app", "signing", "build.gradle", "settings.gradle", "gradle.properties"):
        copy(os.path.join("Inkwell-Android", name), os.path.join(pkg, name))
    copy("artwork", os.path.join(pkg, "artwork"))


def ios(pkg):
    common(pkg, "READ ME FIRST - IPHONE AND IPAD.txt", ".github/workflows/ios.yml", "build-ios.yml")
    for name in ("project.yml", "Sources", "Resources"):
        copy(os.path.join("Inkwell-iOS", name), os.path.join(pkg, name))
    shutil.copytree(ASSETS, os.path.join(pkg, "web"))
    copy("artwork", os.path.join(pkg, "artwork"))


def web(pkg):
    common(pkg, "READ ME FIRST - WEB APP.txt", ".github/workflows/web.yml", "build-web.yml")
    for name in ("build_site.py", "VERSION.txt", "icons", "tf4"):
        copy(os.path.join("Inkwell-Web", name), os.path.join(pkg, name))
    shutil.copytree(ASSETS, os.path.join(pkg, "web"))


def desktop_page(pkg):
    """The page and the files the desktop installers copy, plus the standalone
    Scriba and Fontes, the licence and the handoff notes."""
    copy(os.path.join(ASSETS, "Inkwell.html"), os.path.join(pkg, "Inkwell.html"))
    shutil.copytree(os.path.join(ASSETS, "vendor"), os.path.join(pkg, "vendor"))
    for name in ("scriba_v729.html", "fontes_v729.html", "LICENCE.txt"):
        copy(name, os.path.join(pkg, name))
    for name in sorted(os.listdir(ROOT)):
        if name.startswith("INKWELL_HANDOFF_") and name.endswith(".txt"):
            copy(name, os.path.join(pkg, name))


def mac(pkg):
    """Mac 7.34: a ready-made app built on GitHub (PyInstaller; no Python
    needed on the Mac), delivered as a .dmg in the "Inkwell for Mac" release.
    The package holds the READ ME, everything GitHub needs to build the app,
    and the older Python installer in its own folder."""
    common(pkg, "READ ME FIRST (Mac).txt", ".github/workflows/mac.yml", "build-mac.yml", src_dir="Inkwell-Mac")
    shutil.copytree(os.path.join(ROOT, "Inkwell-Mac"), os.path.join(pkg, "Inkwell-Mac"))
    shutil.copytree(ASSETS, os.path.join(pkg, "web"))
    for name in ("scriba_v729.html", "fontes_v729.html"):
        copy(name, os.path.join(pkg, name))
    legacy = os.path.join(pkg, "Build on this Mac (Python)")
    shutil.copytree(os.path.join(ROOT, "Inkwell-Mac"), legacy)
    desktop_page(legacy)


def mac_mini(pkg):
    """Mac mini (Apple Silicon): the Mac package with its own READ ME and,
    when INKWELL_MAC_DMG names the Apple Silicon disk image GitHub built,
    the ready-made app itself."""
    mac(pkg)
    copy(os.path.join("packaging", "READ ME FIRST - MAC MINI.txt"), os.path.join(pkg, "READ ME FIRST - MAC MINI.txt"))
    dmg = os.environ.get("INKWELL_MAC_DMG")
    if dmg and os.path.isfile(dmg):
        shutil.copy2(dmg, os.path.join(pkg, os.path.basename(dmg)))


def windows(pkg):
    """Windows 7.32: a standalone program built on GitHub (PyInstaller and
    Inno Setup, no Python needed on the computer). The package holds the READ
    ME (how to get and run the installer) and everything GitHub needs to build
    it: the workflow, the launcher sources and the web app."""
    common(pkg, "READ ME WINDOWS.txt", ".github/workflows/windows.yml", "build-windows.yml", src_dir="Inkwell-Windows")
    win = os.path.join(pkg, "Inkwell-Windows")
    for name in ("inkwell_app.py", "server.py", "inkwell.png", "inkwell.ico", "build"):
        copy(os.path.join("Inkwell-Windows", name), os.path.join(win, name))
    shutil.copytree(ASSETS, os.path.join(pkg, "web"))
    for name in ("scriba_v729.html", "fontes_v729.html"):
        copy(name, os.path.join(pkg, name))


def zip_folder(folder, zip_path):
    base = os.path.dirname(folder)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, dirnames, filenames in os.walk(folder):
            dirnames.sort()
            for name in sorted(filenames):
                full = os.path.join(dirpath, name)
                z.write(full, os.path.relpath(full, base))


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: make_packages.py <output-folder>")
    out = os.path.abspath(sys.argv[1])
    os.makedirs(out, exist_ok=True)
    tag = "v" + version().replace(".", "p")
    for label, build in (("Mac", mac), ("Mac_mini", mac_mini), ("Windows", windows),
                         ("Fire_Tablet", fire), ("iPhone_iPad", ios), ("Web_App", web)):
        name = "Inkwell_%s_%s" % (label, tag)
        folder = os.path.join(out, name)
        if os.path.exists(folder):
            shutil.rmtree(folder)
        build(folder)
        zip_path = folder + ".zip"
        zip_folder(folder, zip_path)
        print("%s  %.1f MB" % (zip_path, os.path.getsize(zip_path) / 1e6))


if __name__ == "__main__":
    main()
