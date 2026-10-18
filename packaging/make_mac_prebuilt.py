#!/usr/bin/env python3.12
"""Make the ready-made Inkwell.app zips for the Mac without GitHub Actions.

GitHub Actions has not started since 10 October ("startup_failure"), so the
Mac app cannot be built from Python on a Mac runner. This script takes the
last app that Actions did build (release mac-build-27, Inkwell 7.37) and
brings it up to the current version, on Linux:

  1. opens the release's disk image (7-Zip reads the HFS+ image);
  2. puts in the current page, rooms, vendor files and server.py
     (Contents/Resources; Contents/Frameworks links to them);
  3. puts in the current launcher, inkwell_app.py, compiled with Python
     3.12 like the app's own Python, in place of the 7.37 one inside the
     app's program file; every other entry of that file is copied as it is;
  4. sets the version in Info.plist;
  5. seals the whole app again with an ad-hoc signature (rcodesign), as the
     Actions build did with codesign --sign -;
  6. zips Inkwell.app with its symbolic links kept (zip -y), beside the
     READ ME.

Needs: python3.12 (the app's Python version: its bytecode must match),
7z (p7zip-full), rcodesign (cargo install apple-codesign) and zip.

Usage:
  python3.12 packaging/make_mac_prebuilt.py --dmg AppleSilicon=PATH.dmg \
      --dmg Intel=PATH.dmg --build 28 --out DIR
"""
import argparse
import marshal
import os
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import types
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RUNTIME_FETCHED_ONCE = ("transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm")
CHAT_LIMIT = 30 * 1024 * 1024
REPO = os.path.dirname(HERE)

# ---------------------------------------------------------------- the app's archive
# PyInstaller's CArchive, as its readers.py and writers.py define it
MAGIC = b"MEI\014\013\012\013\016"
COOKIE = "!8sIIII64s"
COOKIE_LEN = struct.calcsize(COOKIE)
ENTRY = "!IIIIBc"
ENTRY_LEN = struct.calcsize(ENTRY)
LC_SEGMENT_64, LC_SYMTAB, LC_CODE_SIGNATURE = 0x19, 0x2, 0x1D
CPU_ARM64 = 0x0100000C


def read_archive(data):
    end = data.rfind(MAGIC)
    if end < 0:
        raise SystemExit("no PyInstaller archive in the program file")
    _, alen, toff, tlen, pyvers, pylib = struct.unpack_from(COOKIE, data, end)
    start = end + COOKIE_LEN - alen
    toc, p = [], start + toff
    while p < start + toff + tlen:
        elen, off, clen, ulen, cflag, typ = struct.unpack_from(ENTRY, data, p)
        name = data[p + ENTRY_LEN:p + elen].rstrip(b"\0").decode("utf-8")
        toc.append((off, clen, ulen, cflag, typ.decode("ascii"), name))
        p += elen
    return start, end + COOKIE_LEN, pyvers, pylib.rstrip(b"\0"), toc


def serialize_toc(toc):
    out = []
    for off, clen, ulen, cflag, typ, name in toc:
        raw = name.encode("utf-8")
        nlen = len(raw) + 1
        if (ENTRY_LEN + nlen) % 16:
            nlen += 16 - (ENTRY_LEN + nlen) % 16
        out.append(struct.pack(ENTRY + "%ds" % nlen, ENTRY_LEN + nlen, off, clen, ulen,
                               cflag, typ.encode("ascii"), raw))
    return b"".join(out)


def _rename(code, filename):
    consts = tuple(_rename(c, filename) if isinstance(c, types.CodeType) else c for c in code.co_consts)
    return code.replace(co_filename=filename, co_consts=consts)


def compile_script(path, name):
    """The entry-point script as PyInstaller stores it: the marshalled code object,
    its file name the archive name plus .py"""
    with open(path, "rb") as f:
        source = f.read()
    code = compile(source, path, "exec", dont_inherit=True, optimize=0)
    return marshal.dumps(_rename(code, name + ".py"))


def patch_program(exe, script, name="inkwell_app"):
    """Replace the entry-point script in a thin Mach-O PyInstaller program; the
    old signature is removed (rcodesign signs it again afterwards)"""
    data = open(exe, "rb").read()
    magic, cputype, _, _, ncmds, sizeofcmds, _, _ = struct.unpack_from("<IiiIIIII", data, 0)
    if magic != 0xFEEDFACF:
        raise SystemExit("%s: not a thin 64-bit Mach-O program" % exe)
    cmds, off = [], 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", data, off)
        cmds.append((off, cmd, size))
        off += size
    start, aend, pyvers, pylib, toc = read_archive(data)
    if pyvers != sys.version_info[0] * 100 + sys.version_info[1]:
        raise SystemExit("the app's Python is %d.%d; run this script with that version"
                         % (pyvers // 100, pyvers % 100))
    sig = [c for c in cmds if c[1] == LC_CODE_SIGNATURE]
    sigoff = struct.unpack_from("<I", data, sig[0][0] + 8)[0] if sig else len(data)
    if aend > sigoff or data[aend:sigoff].strip(b"\0"):
        raise SystemExit("unexpected data between the archive and the signature")
    body, newtoc, found = bytearray(), [], False
    for off, clen, ulen, cflag, typ, ename in toc:
        if ename == name and typ == "s":
            raw = compile_script(script, name)
            blob = zlib.compress(raw, 9) if cflag else raw
            ulen, clen, found = len(raw), len(blob), True
        else:
            blob = data[start + off:start + off + clen]
        newtoc.append((len(body), clen, ulen, cflag, typ, ename))
        body += blob
    if not found:
        raise SystemExit("no entry-point script %r in the archive" % name)
    tocdata = serialize_toc(newtoc)
    toff = len(body)
    body += tocdata
    body += struct.pack(COOKIE, MAGIC, toff + len(tocdata) + COOKIE_LEN, toff, len(tocdata), pyvers, pylib)
    new = bytearray(data[:start]) + body
    if sig:
        so, _, ss = sig[0]
        if so + ss != 32 + sizeofcmds:
            raise SystemExit("the signature's load command is not the last one")
        new[so:so + ss] = b"\0" * ss
        struct.pack_into("<II", new, 16, ncmds - 1, sizeofcmds - ss)
    # PyInstaller's fix_exe_for_code_signing: the string table and __LINKEDIT
    # reach the end of the file, so the archive lies inside the signed image
    size = len(new)
    for off, cmd, _ in cmds:
        if cmd == LC_SYMTAB:
            stroff = struct.unpack_from("<I", new, off + 16)[0]
            struct.pack_into("<I", new, off + 20, size - stroff)
        elif cmd == LC_SEGMENT_64 and new[off + 8:off + 24].rstrip(b"\0") == b"__LINKEDIT":
            vmaddr, _, fileoff, _ = struct.unpack_from("<QQQQ", new, off + 24)
            page = 0x4000 if cputype == CPU_ARM64 else 0x1000
            filesize = size - fileoff
            struct.pack_into("<QQQQ", new, off + 24, vmaddr, -(-filesize // page) * page, fileoff, filesize)
    with open(exe, "wb") as f:
        f.write(new)
    return {"arch": "arm64" if cputype == CPU_ARM64 else "x86_64", "entries": len(toc), "size": size}


# ---------------------------------------------------------------- the app
def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        raise SystemExit("%s failed:\n%s%s" % (cmd[0], r.stdout[-2000:], r.stderr[-2000:]))
    return r.stdout


def version_of_page(page):
    m = re.search(r"const BUILD='([0-9.]+)", open(page, encoding="utf-8").read())
    if not m:
        raise SystemExit("no BUILD in %s" % page)
    return m.group(1)


def replace_tree(src, dst):
    if os.path.lexists(dst):
        shutil.rmtree(dst) if os.path.isdir(dst) and not os.path.islink(dst) else os.remove(dst)
    shutil.copytree(src, dst)


def prune_llama(app):
    """7.40: the Actions build copied every program of the llama.cpp release
    into Contents/Frameworks/bin/darwin, and each library three times under
    its three names. PyInstaller then set llama-server's search path to
    @loader_path/../.., so llama-server loads its libraries from the top of
    Contents/Frameworks: nothing else in bin/darwin is ever used. Only
    llama-server stays there, and the top-level libraries that only the
    removed programs needed go too. Every link left pointing at a removed
    file is removed. check_links() then proves every library still loads."""
    fw = os.path.join(app, "Contents", "Frameworks")
    res = os.path.join(app, "Contents", "Resources")
    bindir = os.path.join(fw, "bin", "darwin")
    removed = 0
    for name in os.listdir(bindir):
        if name != "llama-server":
            os.remove(os.path.join(bindir, name))
            removed += 1
    for name in os.listdir(fw):
        if re.match(r"^libllama-.*-impl\.dylib$", name) and name != "libllama-server-impl.dylib":
            os.remove(os.path.join(fw, name))
            removed += 1
    for root in (res, fw):
        for d, dirs, files in os.walk(root):
            for name in files + dirs:
                q = os.path.join(d, name)
                if os.path.islink(q) and not os.path.exists(q):
                    os.remove(q)
                    removed += 1
    return removed


def check_links(app):
    """Every library each Mach-O file in the app names by @rpath,
    @loader_path or @executable_path must exist where dyld would look."""
    from macholib.MachO import MachO
    from macholib.mach_o import LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_RPATH
    contents = os.path.join(app, "Contents")
    exe_dir = os.path.join(contents, "MacOS")
    missing = []
    for d, _, files in os.walk(contents):
        for name in files:
            p = os.path.join(d, name)
            if os.path.islink(p):
                continue
            with open(p, "rb") as f:
                head = f.read(4)
            if head not in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"):
                continue
            real_dir = os.path.dirname(os.path.realpath(p))
            for h in MachO(p).headers:
                deps, rpaths = [], []
                for lc, cmd, data in h.commands:
                    if lc.cmd in (LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB):
                        deps.append((data.rstrip(b"\0").decode(), lc.cmd == LC_LOAD_WEAK_DYLIB))
                    elif lc.cmd == LC_RPATH:
                        rpaths.append(data.rstrip(b"\0").decode())
                def expand(x):
                    return x.replace("@loader_path", real_dir).replace("@executable_path", exe_dir)
                for dep, weak in deps:
                    if dep.startswith("/usr/lib/") or dep.startswith("/System/"):
                        continue
                    if dep.startswith("@rpath/"):
                        cands = [os.path.join(expand(r), dep[7:]) for r in rpaths]
                    elif dep.startswith("@"):
                        cands = [expand(dep)]
                    else:
                        cands = [dep]
                    if not any(os.path.exists(c) for c in cands) and not weak:
                        missing.append("%s needs %s" % (os.path.relpath(p, contents), dep))
    return sorted(set(missing))


def make_one(label, dmg, build, out, work):
    web = os.path.join(REPO, "Inkwell-Android", "app", "src", "main", "assets")
    page = os.path.join(web, "Inkwell.html")
    version = version_of_page(page)
    if version_of_page(os.path.join(REPO, "Inkwell.html")) != version:
        raise SystemExit("Inkwell.html and the Android copy differ: run tools/build_inkwell.py")
    x = os.path.join(work, label)
    shutil.rmtree(x, ignore_errors=True)
    os.makedirs(x)
    run(["7z", "x", "-y", "-o" + x, dmg])
    app = os.path.join(x, "Inkwell.app")
    if not os.path.isdir(app):
        raise SystemExit("%s: no Inkwell.app in the disk image" % dmg)
    res = os.path.join(app, "Contents", "Resources")
    fw = os.path.join(app, "Contents", "Frameworks")
    # the files the app carries, as the Actions build gathers them (mac.yml)
    shutil.copyfile(page, os.path.join(res, "Inkwell.html"))
    replace_tree(os.path.join(web, "vendor"), os.path.join(res, "vendor"))
    # 7.41: the in-page model runtime stays out of the Mac app, so the zip fits
    # a chat download (30 MB). The page fetches these once, when an in-page
    # model first runs (it downloads itself then too), checks each against its
    # SHA-256 and keeps it (INK_VENDOR_PIN in src/inkwell.html).
    for name in RUNTIME_FETCHED_ONCE:
        os.remove(os.path.join(res, "vendor", name))
    # the current seal, not 7.37's icon
    for name in ("inkwell.icns", "inkwell.png"):
        shutil.copyfile(os.path.join(REPO, "Inkwell-Mac", name), os.path.join(res, name))
    for n in ("scriba_v729.html", "fontes_v729.html"):
        if os.path.exists(os.path.join(REPO, n)):
            shutil.copyfile(os.path.join(REPO, n), os.path.join(res, n))
    shutil.copyfile(os.path.join(REPO, "Inkwell-Mac", "server.py"), os.path.join(res, "server.py"))
    for n in ("Inkwell.html", "vendor", "server.py", "scriba_v729.html", "fontes_v729.html"):
        link = os.path.join(fw, n)
        if os.path.lexists(link) and not (os.path.islink(link) and os.readlink(link) == "../Resources/" + n):
            raise SystemExit("Contents/Frameworks/%s is not the expected link to Resources" % n)
    launcher = os.path.join(REPO, "Inkwell-Mac", "inkwell_app.py")
    lb = re.search(r'^LAUNCHER_BUILD = "([0-9.]+)"', open(launcher, encoding="utf-8").read(), re.M)
    if not lb or lb.group(1) != version:
        raise SystemExit("LAUNCHER_BUILD in inkwell_app.py is not %s" % version)
    program = os.path.join(app, "Contents", "MacOS", "Inkwell")
    info = patch_program(program, launcher)
    info["pruned"] = prune_llama(app)
    missing = check_links(app)
    if missing:
        raise SystemExit("libraries missing after pruning:\n  " + "\n  ".join(missing[:20]))
    # read it back: the launcher inside is the one just compiled
    data = open(program, "rb").read()
    start, _, _, _, toc = read_archive(data)
    e = [t for t in toc if t[5] == "inkwell_app"][0]
    blob = data[start + e[0]:start + e[0] + e[1]]
    code = marshal.loads(zlib.decompress(blob) if e[3] else blob)
    if version not in code.co_consts:
        raise SystemExit("the launcher inside the app does not carry %s" % version)
    pl = os.path.join(app, "Contents", "Info.plist")
    with open(pl, "rb") as f:
        plist = plistlib.load(f)
    plist["CFBundleShortVersionString"] = version
    plist["CFBundleVersion"] = str(build)
    with open(pl, "wb") as f:
        plistlib.dump(plist, f, fmt=plistlib.FMT_XML)
    # the old seal no longer matches the files: seal the whole app again
    shutil.rmtree(os.path.join(app, "Contents", "_CodeSignature"), ignore_errors=True)
    run(["rcodesign", "sign", app])
    # rcodesign's own verify stops at the empty envelope of an ad-hoc seal (its
    # authors mark it unreliable), so the seal is recomputed here instead
    sys.path.insert(0, HERE)
    import verify_mac_app
    verify_mac_app.problems.clear()
    if verify_mac_app.main(app):
        raise SystemExit("the new seal does not match the app")
    # the zip: Inkwell.app (symbolic links kept) and the READ ME
    name = "Inkwell-%s-Mac-%s" % (version, label)
    stage = os.path.join(work, name)
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    os.rename(app, os.path.join(stage, "Inkwell.app"))
    readme = os.path.join(HERE, "READ ME FIRST - MAC APP.txt")
    shutil.copyfile(readme, os.path.join(stage, "READ ME FIRST.txt"))
    z = os.path.abspath(os.path.join(out, name + ".zip"))
    if os.path.exists(z):
        os.remove(z)
    run(["zip", "-qry9", "-X", z, name], cwd=work)
    if os.path.getsize(z) >= CHAT_LIMIT and shutil.which("7z"):
        # 7.44: over the limit by a little, the ordinary files are packed
        # again with 7-Zip's stronger deflate; the symbolic links go in first,
        # stored by zip exactly as before (the Python framework needs them)
        os.remove(z)
        links, files = [], []
        for dirpath, dirnames, filenames in os.walk(os.path.join(work, name)):
            for n in dirnames + filenames:
                p = os.path.join(dirpath, n)
                rel = os.path.relpath(p, work)
                if os.path.islink(p):
                    links.append(rel)
                elif os.path.isfile(p):
                    files.append(rel)
        lst = os.path.join(work, name + ".files")
        with open(lst, "w") as f:
            f.write("\n".join(files) + "\n")
        subprocess.run(["zip", "-qy9", "-X", z, "-@"], cwd=work, input="\n".join(links).encode(), check=True)
        run(["7z", "a", "-tzip", "-mx=9", "-mfb=258", "-mpass=15", z, "@" + lst], cwd=work)
        os.remove(lst)
    if os.path.getsize(z) >= CHAT_LIMIT:
        raise SystemExit("%s is %.1f MiB, over the chat's 30 MiB limit" % (z, os.path.getsize(z) / 1048576))
    info.update({"zip": z, "version": version, "build": build})
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dmg", action="append", required=True, help="LABEL=PATH, e.g. Intel=Inkwell-7.37-Mac-Intel.dmg")
    ap.add_argument("--build", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", default=None)
    a = ap.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("run with Python 3.12, the version inside the app")
    for tool in ("7z", "rcodesign", "zip"):
        if not shutil.which(tool):
            raise SystemExit("%s is needed" % tool)
    os.makedirs(a.out, exist_ok=True)
    work = a.work or os.path.join(a.out, "_work")
    for item in a.dmg:
        label, dmg = item.split("=", 1)
        print(make_one(label, dmg, a.build, a.out, work))
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
