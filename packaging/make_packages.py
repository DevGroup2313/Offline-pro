#!/usr/bin/env python3
# INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
# No licence is granted. See LICENCE.txt.
#
# Makes the three self-contained download packages, one per kind of device:
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


def common(pkg, readme, workflow, workflow_name):
    copy(os.path.join("packaging", readme), os.path.join(pkg, readme))
    copy(workflow, os.path.join(pkg, ".github", "workflows", workflow_name))
    copy(workflow, os.path.join(pkg, "WORKFLOW %s (copy).txt" % workflow_name))
    copy("LICENCE.txt", os.path.join(pkg, "LICENCE.txt"))
    copy("INKWELL_HANDOFF_v7p29.txt", os.path.join(pkg, "INKWELL_HANDOFF_v7p29.txt"))


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
    for name in ("build_site.py", "VERSION.txt", "icons"):
        copy(os.path.join("Inkwell-Web", name), os.path.join(pkg, name))
    shutil.copytree(ASSETS, os.path.join(pkg, "web"))


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
    for label, build in (("Fire_Tablet", fire), ("iPhone_iPad", ios), ("Web_App", web)):
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
