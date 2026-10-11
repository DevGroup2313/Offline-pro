#!/usr/bin/env python3
"""Check an Inkwell.app's seal on Linux, without Apple's tools.

rcodesign's own verify command is marked unreliable by its authors, and it
stops at the empty certificate envelope that every ad-hoc seal carries. This
recomputes what macOS compares:
  - every Mach-O file (thin or universal): each page hash in its code
    directory, and its special slots (Info.plist, requirements, resources);
  - every _CodeSignature/CodeResources in the app: each sealed file's sha256,
    each sealed symbolic link's target, each nested program's code hash;
  - and that nothing in the app is left out of the seal.
Usage: verify_mac_app.py Inkwell.app      (exit status 0 when all is well)
"""
import hashlib
import os
import plistlib
import struct
import sys

CSMAGIC_EMBEDDED = 0xFADE0CC0
CSMAGIC_CD = 0xFADE0C02
CSMAGIC_REQS = 0xFADE0C01
LC_CODE_SIGNATURE = 0x1D
problems = []


def slices(data):
    magic = struct.unpack_from(">I", data, 0)[0]
    if magic in (0xCAFEBABE, 0xCAFEBABF):
        n = struct.unpack_from(">I", data, 4)[0]
        out = []
        for i in range(n):
            if magic == 0xCAFEBABE:
                _, _, off, size, _ = struct.unpack_from(">iiIII", data, 8 + i * 20)
            else:
                _, _, off, size, _, _ = struct.unpack_from(">iiQQII", data, 8 + i * 32)
            out.append((off, size))
        return out
    if struct.unpack_from("<I", data, 0)[0] in (0xFEEDFACF, 0xFEEDFACE):
        return [(0, len(data))]
    return []


def is_macho(path):
    try:
        with open(path, "rb") as f:
            head = f.read(4)
    except OSError:
        return False
    return head in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf")


def code_directory(sl):
    """(the CodeDirectory blob, the requirements blob) of one Mach-O slice"""
    magic, _, _, _, ncmds = struct.unpack_from("<IiiII", sl, 0)
    off = 32 if magic == 0xFEEDFACF else 28
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", sl, off)
        if cmd == LC_CODE_SIGNATURE:
            dataoff, datasize = struct.unpack_from("<II", sl, off + 8)
            sb = sl[dataoff:dataoff + datasize]
            m, length, count = struct.unpack_from(">III", sb, 0)
            if m != CSMAGIC_EMBEDDED:
                return None, None, dataoff
            cd = reqs = None
            best = None
            for i in range(count):
                typ, boff = struct.unpack_from(">II", sb, 12 + i * 8)
                bm, blen = struct.unpack_from(">II", sb, boff)
                blob = sb[boff:boff + blen]
                if bm == CSMAGIC_CD:
                    hash_type = blob[37]
                    if best is None or hash_type == 2:  # prefer the sha256 directory
                        cd, best = blob, hash_type
                elif bm == CSMAGIC_REQS:
                    reqs = blob
            return cd, reqs, dataoff
        off += size
    return None, None, None


def check_macho(path, bundle_info=None, bundle_res=None):
    """verify one Mach-O file; returns the cdhash of its (last) slice"""
    data = open(path, "rb").read()
    cdhash = None
    for off, size in slices(data):
        sl = data[off:off + size]
        cd, reqs, sigoff = code_directory(sl)
        if cd is None:
            problems.append("%s: not signed" % path)
            continue
        (_, length, version, flags, hash_off, _, n_special, n_code, code_limit, hash_size,
         hash_type, _, page_log) = struct.unpack_from(">IIIIIIIIIBBBB", cd, 0)
        algo = {1: hashlib.sha1, 2: hashlib.sha256}.get(hash_type)
        if algo is None:
            problems.append("%s: unknown hash type %d" % (path, hash_type))
            continue
        page = 1 << page_log if page_log else code_limit
        if code_limit != sigoff:
            problems.append("%s: the seal covers %d bytes, the signature starts at %d" % (path, code_limit, sigoff))
        for i in range(n_code):
            want = cd[hash_off + i * hash_size:hash_off + (i + 1) * hash_size]
            got = algo(sl[i * page:min((i + 1) * page, code_limit)]).digest()[:hash_size]
            if want != got:
                problems.append("%s: page %d does not match its hash" % (path, i))
                break
        if n_code * page < code_limit:
            problems.append("%s: pages are missing from the seal" % path)

        def special(slot):
            if slot > n_special:
                return None
            v = cd[hash_off - slot * hash_size:hash_off - (slot - 1) * hash_size]
            return None if v.strip(b"\0") == b"" else v
        if reqs is not None and special(2) not in (None, algo(reqs).digest()[:hash_size]):
            problems.append("%s: the requirements do not match their hash" % path)
        if bundle_info is not None:
            if special(1) != algo(open(bundle_info, "rb").read()).digest()[:hash_size]:
                problems.append("%s: Info.plist does not match the seal" % path)
            if special(3) != algo(open(bundle_res, "rb").read()).digest()[:hash_size]:
                problems.append("%s: CodeResources does not match the seal" % path)
        cdhash = hashlib.sha256(cd).digest()[:20] if hash_type == 2 else hashlib.sha1(cd).digest()
    return cdhash


def bundle_main(root):
    """the main program of a bundle whose contents start at root"""
    for info in (os.path.join(root, "Info.plist"), os.path.join(root, "Resources", "Info.plist")):
        if os.path.exists(info):
            exe = plistlib.load(open(info, "rb")).get("CFBundleExecutable")
            for cand in (os.path.join(root, "MacOS", exe or ""), os.path.join(root, exe or "")):
                if exe and os.path.isfile(cand):
                    return cand, info
    return None, None


def check_resources(root):
    """root holds _CodeSignature/CodeResources; its paths are relative to root"""
    res = os.path.join(root, "_CodeSignature", "CodeResources")
    sealed = plistlib.load(open(res, "rb")).get("files2", {})
    seen = set()
    for rel, v in sealed.items():
        p = os.path.join(root, rel)
        seen.add(rel)
        if isinstance(v, dict) and "symlink" in v:
            if not os.path.islink(p) or os.readlink(p) != v["symlink"]:
                problems.append("%s: the link is not the sealed one" % p)
        elif isinstance(v, dict) and "cdhash" in v:
            target = p
            if os.path.isdir(p):
                main, _ = bundle_main(os.path.join(p, "Versions", "Current")) if os.path.isdir(os.path.join(p, "Versions")) else bundle_main(os.path.join(p, "Contents"))
                target = main
            if not target or check_macho(target) != v["cdhash"]:
                problems.append("%s: the nested program's code hash is not the sealed one" % p)
        else:
            want = v.get("hash2") if isinstance(v, dict) else None
            if want is None or not os.path.isfile(p) or hashlib.sha256(open(p, "rb").read()).digest() != want:
                problems.append("%s: the file is not the sealed one" % p)
    return seen, len(sealed)


def main(app):
    contents = os.path.join(app, "Contents")
    exe, info = bundle_main(contents)
    res = os.path.join(contents, "_CodeSignature", "CodeResources")
    check_macho(exe, info, res)
    seen, n = check_resources(contents)
    # every file in the app is sealed, or belongs to a nested bundle, or is the seal itself
    nested = sorted({k for k in seen if k.endswith(".framework") or k.endswith(".app")})
    unsealed = []
    for d, dirs, files in os.walk(contents):
        for name in files + [x for x in dirs if os.path.islink(os.path.join(d, x))]:
            rel = os.path.relpath(os.path.join(d, name), contents)
            if rel in seen or rel.startswith("_CodeSignature/") or rel in ("Info.plist", "MacOS/" + os.path.basename(exe)):
                continue
            if any(rel.startswith(nb + "/") for nb in nested):
                continue
            unsealed.append(rel)
    if unsealed:
        problems.append("left out of the seal: %s" % ", ".join(unsealed[:10]))
    # nested frameworks carry their own seal
    machos = 0
    for nb in nested:
        base = os.path.join(contents, nb)
        vroot = os.path.join(base, "Versions", "Current")
        root = os.path.realpath(vroot) if os.path.isdir(vroot) else os.path.join(base, "Contents")
        if os.path.exists(os.path.join(root, "_CodeSignature", "CodeResources")):
            m, i = bundle_main(root)
            if m:
                check_macho(m, i, os.path.join(root, "_CodeSignature", "CodeResources"))
            check_resources(root)
    for d, _, files in os.walk(contents):
        for name in files:
            p = os.path.join(d, name)
            if not os.path.islink(p) and is_macho(p):
                machos += 1
                check_macho(p) if p != exe else None
    print("sealed entries: %d; program files checked: %d; nested bundles: %s" % (n, machos, ", ".join(nested) or "none"))
    for p in problems[:40]:
        print("PROBLEM:", p)
    print("seal OK" if not problems else "%d problem(s)" % len(problems))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
