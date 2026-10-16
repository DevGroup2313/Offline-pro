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
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "packaging")
ASSETS = os.path.join(ROOT, "Inkwell-Android", "app", "src", "main", "assets")


def version():
    with open(os.path.join(ROOT, "Inkwell-Web", "VERSION.txt")) as f:
        return f.read().strip()


# build outputs and the fetched llama.cpp source never go into a package
SKIP = shutil.ignore_patterns(".gradle", "build", ".cxx", "llama.cpp", "local.properties")


def copy(src, dst):
    src = os.path.join(ROOT, src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.isdir(src):
        shutil.copytree(src, dst, ignore=SKIP)
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


def fire_kit(pkg):
    """The GitHub build kit. With --no-key the signing key stays out (for a
    PUBLIC repository: the workflow then takes the key from the repository's
    secrets, see build-apk.yml) and a .gitignore keeps a later local copy of
    signing/ out of the repository too."""
    common(pkg, "READ ME FIRST - FIRE TABLET.txt", ".github/workflows/main.yml", "build-apk.yml")
    names = ["app", "build.gradle", "settings.gradle", "gradle.properties"]
    if "--no-key" not in sys.argv:
        names.insert(1, "signing")
    for name in names:
        copy(os.path.join("Inkwell-Android", name), os.path.join(pkg, name))
    copy("artwork", os.path.join(pkg, "artwork"))
    with open(os.path.join(pkg, ".gitignore"), "w") as f:
        f.write("# build outputs and the fetched llama.cpp source\n.gradle/\nbuild/\napp/build/\napp/.cxx/\n"
                "app/src/main/cpp/llama.cpp/\nlocal.properties\n")
        if "--no-key" in sys.argv:
            f.write("# the signing key never goes into a public repository\nsigning/\n")


def fire(pkg):
    """7.40: the Fire package is the app itself. GitHub Actions has not
    started since 10 October, so the APK is built in the session
    (gradle assembleRelease, signed with the project's key) and INKWELL_APK
    names it; the package holds it, the READ ME and the licence."""
    apk = os.environ.get("INKWELL_APK")
    if not apk or not os.path.isfile(apk):
        sys.exit("INKWELL_APK must name the built APK (or use --kits for the GitHub build kit)")
    os.makedirs(pkg, exist_ok=True)
    shutil.copy2(apk, os.path.join(pkg, "Inkwell-%s-build1.apk" % version()))
    copy(os.path.join("packaging", "READ ME FIRST - FIRE TABLET.txt"), os.path.join(pkg, "READ ME FIRST - FIRE TABLET.txt"))
    copy("LICENCE.txt", os.path.join(pkg, "LICENCE.txt"))


def ios(pkg):
    common(pkg, "READ ME FIRST - IPHONE AND IPAD.txt", ".github/workflows/ios.yml", "build-ios.yml")
    for name in ("project.yml", "Sources", "Resources"):
        copy(os.path.join("Inkwell-iOS", name), os.path.join(pkg, name))
    shutil.copytree(ASSETS, os.path.join(pkg, "web"))
    copy("artwork", os.path.join(pkg, "artwork"))


def web(pkg):
    """7.38: the web app package is the finished web site, ready to put
    online by dragging it into a browser: nothing to build, no GitHub
    Actions, and no file larger than 9 MiB (build_site.py keeps a larger one
    in parts). Before 7.38 it was a kit that GitHub Actions had to build,
    with a 26.9 MB file no browser upload to GitHub accepts. The kit stays in
    this repository (Inkwell-Web, and .github/workflows/web.yml)."""
    # 7.39: the package's one folder IS the site, with index.html at its top,
    # so the folder made by unzipping is the folder to drag into Netlify.
    # (Before, the site sat in a folder inside it, and dragging the outer one
    # published a site with no front page.)
    subprocess.run([sys.executable, os.path.join(ROOT, "Inkwell-Web", "build_site.py"), ASSETS, pkg, version()], check=True)
    copy(os.path.join("packaging", "READ ME FIRST - WEB APP.txt"), os.path.join(pkg, "READ ME FIRST - WEB APP.txt"))
    copy("LICENCE.txt", os.path.join(pkg, "LICENCE.txt"))


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
    """7.40: the page, for the Inkwell already installed on Windows. The
    installed program opens the newest Inkwell.html it finds in its own
    folder (find_app_html, by the BUILD marker at the top of the page), so a
    folder holding the 7.40 page and its vendor files, dropped into
    %LOCALAPPDATA%\\Programs\\Inkwell, is 7.40. The 7.37 program serves vendor
    files by name only, so the files in vendor/csl are also placed at the
    top of vendor."""
    page = os.path.join(pkg, "Inkwell %s page" % version())
    copy(os.path.join(ASSETS, "Inkwell.html"), os.path.join(page, "Inkwell.html"))
    shutil.copytree(os.path.join(ASSETS, "vendor"), os.path.join(page, "vendor"))
    csl = os.path.join(page, "vendor", "csl")
    for name in sorted(os.listdir(csl)):
        if not os.path.exists(os.path.join(page, "vendor", name)):
            shutil.copy2(os.path.join(csl, name), os.path.join(page, "vendor", name))
    copy(os.path.join("packaging", "READ ME FIRST - WINDOWS.txt"), os.path.join(pkg, "READ ME FIRST - WINDOWS.txt"))
    copy("LICENCE.txt", os.path.join(pkg, "LICENCE.txt"))


def windows_kit(pkg):
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
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit("usage: make_packages.py <output-folder> [--kits] [--no-key]")
    out = os.path.abspath(args[0])
    os.makedirs(out, exist_ok=True)
    tag = "v" + version().replace(".", "p")
    # 7.40: the Macs get the ready-made apps from packaging/make_mac_prebuilt.py;
    # the GitHub build kits are made only on request (--kits)
    plan = (("Windows", windows), ("Fire_Tablet", fire), ("iPhone_iPad", ios), ("Web_App", web))
    if "--kits" in sys.argv:
        plan = (("Mac", mac), ("Mac_mini", mac_mini), ("Windows", windows_kit),
                ("Fire_Tablet", fire_kit), ("iPhone_iPad", ios), ("Web_App", web))
    for label, build in plan:
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
