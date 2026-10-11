#!/usr/bin/env python3
# INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
# NO LICENCE IS GRANTED. No copying, adaptation, redistribution, reverse
# engineering or commercial use without the author's written permission.
# See LICENCE.txt. Every distributed copy carries a build marker.
"""
Inkwell desktop launcher.

This is a thin native-window shell around the Inkwell studio. All of the
app's behaviour lives in the bundled HTML/JavaScript file (Inkwell.html);
this script only opens it in a proper desktop window using the system's native
web view. The app still runs entirely offline: nothing is sent anywhere.

Run it with:   python3 inkwell_app.py
"""

import os
import re
import sys
import threading

# Set by the page itself, through window.pywebview.api.mark_booted(), the moment
# its script reaches the end. This is a direct, reliable signal from the page to
# this launcher: far more dependable than reading the page back with evaluate_js,
# which on the macOS web view can report a false negative even when the page has
# in fact rendered. The load watchdog waits on this and stays silent once it is
# set, so a page that is plainly on screen never triggers a warning or a reload.
_PAGE_MARK = threading.Event()

# The window title and starting size. The app itself is responsive, so these are
# just sensible defaults; the window can be resized and maximised freely.
WINDOW_TITLE = "Inkwell"
DEFAULT_WIDTH = 1180
DEFAULT_HEIGHT = 820
MIN_WIDTH = 380      # the app works down to a narrow width
MIN_HEIGHT = 560
ACCENT_BLUE = "#1F4F68"   # the Inkwell sigil blue

# Build marker of this launcher, reported to the page by host_info().
LAUNCHER_BUILD = "7.41"


# ---------------------------------------------------------------------------
# Microphone permission (v7.26)
# ---------------------------------------------------------------------------
# pywebview (checked against 6.2.1) answers no microphone request on any
# platform. Two layers must agree before Scriba can hear anything:
#   1. the operating system: on macOS the process that owns the web view must
#      be an app bundle whose Info.plist carries NSMicrophoneUsageDescription.
#      The native launcher in Inkwell.app/Contents/MacOS provides that; it sets
#      INKWELL_NATIVE_HOST=1 so this file knows it is running under it.
#   2. the web view: WKWebView (macOS 12+) and WebView2 (Windows) ask the host
#      app whether a page may use the microphone. The handlers below answer
#      yes for Inkwell's own local pages only, and leave every other origin to
#      the web view's default behaviour.
_MIC = {"installed": False, "how": None}

_LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1", "[::1]", "")


def _is_local_origin(protocol, host):
    protocol = (protocol or "").lower().rstrip(":")
    host = (host or "").lower()
    if protocol == "file":
        return True
    return protocol in ("http", "https") and host in _LOCAL_HOSTS


def _is_local_uri(uri):
    u = (uri or "").strip().lower()
    if not u or u.startswith("file:") or u.startswith("about:"):
        return True
    for pre in ("http://127.0.0.1", "https://127.0.0.1", "http://localhost",
                "https://localhost", "http://[::1]", "https://[::1]"):
        if u.startswith(pre):
            rest = u[len(pre):]
            if rest == "" or rest[0] in ":/?#":
                return True
    return False


def _install_mac_mic_permission():
    """Give pywebview's WKWebView delegate the media-capture answer it lacks.
    Defined as a subclass so pywebview's own delegate methods are untouched."""
    import objc  # noqa: F401  (PyObjC ships with pywebview on macOS)
    from webview.platforms import cocoa as _cocoa
    bv = getattr(_cocoa, "BrowserView", None)
    base = getattr(bv, "BrowserDelegate", None) if bv is not None else None
    if base is None:
        log_problem("mac: this pywebview has no BrowserView.BrowserDelegate; "
                    "microphone requests keep the web view's default")
        return False
    if getattr(base, "_inkwell_mic", False):
        return True
    try:
        cls = objc.lookUpClass("InkwellBrowserDelegate")
    except Exception:
        cls = None
    if cls is None:
        class InkwellBrowserDelegate(base):
            _inkwell_mic = True

            # WKUIDelegate, macOS 12+. WKPermissionDecision: 0 prompt, 1 grant,
            # 2 deny. WKMediaCaptureType: 0 camera, 1 microphone, 2 both.
            def webView_requestMediaCapturePermissionForOrigin_initiatedByFrame_type_decisionHandler_(
                    self, webview, origin, frame, media_type, handler):
                decision = 0
                try:
                    if int(media_type) == 1 and _is_local_origin(
                            str(origin.protocol() or ""), str(origin.host() or "")):
                        decision = 1
                except Exception:
                    decision = 0
                handler(decision)
        cls = InkwellBrowserDelegate
    bv.BrowserDelegate = cls
    return True


def _win_on_permission(sender, args):
    """WebView2 PermissionRequested: allow the microphone for local pages."""
    try:
        kind = str(args.PermissionKind).split(".")[-1]
        uri = str(args.Uri or "")
        if kind == "Microphone" and _is_local_uri(uri):
            from Microsoft.Web.WebView2.Core import CoreWebView2PermissionState
            args.State = CoreWebView2PermissionState.Allow
    except Exception:
        log_problem("win: permission handler failed", sys.exc_info())


def _install_win_mic_permission():
    from webview.platforms import edgechromium as _ec
    cls = getattr(_ec, "EdgeChrome", None)
    if cls is None or not hasattr(cls, "on_webview_ready"):
        log_problem("win: this pywebview has no EdgeChrome.on_webview_ready; "
                    "microphone requests keep WebView2's default")
        return False
    if getattr(cls, "_inkwell_mic", False):
        return True
    orig = cls.on_webview_ready

    def on_webview_ready(self, sender, args):
        orig(self, sender, args)
        try:
            if getattr(args, "IsSuccess", True):
                sender.CoreWebView2.PermissionRequested += _win_on_permission
                log_problem("win: microphone permission handler attached")
        except Exception:
            log_problem("win: could not attach the permission handler", sys.exc_info())

    cls.on_webview_ready = on_webview_ready
    cls._inkwell_mic = True
    return True


def _install_mic_permission():
    ok = False
    try:
        if sys.platform == "darwin":
            ok = _install_mac_mic_permission()
            _MIC["how"] = "wkwebview-delegate"
        elif sys.platform.startswith("win"):
            ok = _install_win_mic_permission()
            _MIC["how"] = "webview2-permission"
    except Exception:
        log_problem("microphone permission handler could not be installed", sys.exc_info())
        ok = False
    _MIC["installed"] = bool(ok)
    return ok


def host_info_dict():
    try:
        import webview as _wv
        wv = getattr(_wv, "__version__", "unknown")
    except Exception:
        wv = None
    return {
        "launcher": LAUNCHER_BUILD,
        "platform": sys.platform,
        "native_host": os.environ.get("INKWELL_NATIVE_HOST") == "1",
        "mic_handler": bool(_MIC["installed"]),
        "mic_handler_kind": _MIC["how"],
        "pywebview": wv,
        "python": sys.version.split()[0],
    }


def tell_user(text, title="Inkwell"):
    """Say something the person will actually see.

    The packaged app is built windowed, with no console attached, so anything
    written to stderr disappears. Every message below therefore goes to a native
    dialog on Windows, and to the terminal when one exists (running the script
    directly, or on macOS and Linux).
    """
    try:
        sys.stderr.write(text if text.endswith("\n") else text + "\n")
    except Exception:
        pass
    if sys.platform.startswith("win"):
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, str(text), str(title), 0x40)
            return
        except Exception:
            pass
    if sys.platform == "darwin":
        # An app opened from the Dock or Finder has no terminal either, so the
        # message goes to a real dialog. osascript is present on every Mac.
        try:
            import subprocess
            body = str(text).replace("\\", "\\\\").replace('"', '\\"')
            head = str(title).replace('"', '\\"')
            subprocess.run(
                ["osascript", "-e",
                 'display dialog "%s" with title "%s" buttons {"OK"} default button "OK"'
                 % (body, head)],
                check=False, timeout=120)
            return
        except Exception:
            pass


def open_in_browser(app_html):
    """Last resort: the page itself is the whole application.

    If a native window cannot be created, opening the same file in the default
    browser still gives the entire app, offline. It is better than an app that
    appears to do nothing.

    Inside a packaged app the bundled Inkwell.html is often a symlink, and the
    bundle itself may be moved by macOS to a read-only quarantine path. A browser
    opening that path directly can show a blank page. So the page text is read
    first, following any symlink, and written to a plain real file in the system
    temporary folder, and THAT is handed to the browser. The original path is the
    fallback only if the copy cannot be made.
    """
    try:
        import webbrowser, os, tempfile
        from pathlib import Path
        target = app_html
        try:
            text = _read_html_text(app_html)
            if text and len(text) > 200:
                cand = os.path.join(tempfile.gettempdir(), "Inkwell.html")
                with open(cand, "w", encoding="utf-8") as fh:
                    fh.write(text)
                target = cand
        except Exception:
            target = app_html
        webbrowser.open(Path(target).as_uri())
        return True
    except Exception:
        return False


def resource_path(filename):
    """Return an absolute path to a file that sits next to this script.

    This also works when the app has been frozen into a single executable with
    PyInstaller, where bundled files live in a temporary folder exposed as
    sys._MEIPASS.
    """
    if hasattr(sys, "_MEIPASS"):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, filename)


_BUILD_MARK = re.compile(r"BUILD\s*=\s*'\s*([0-9]+(?:\.[0-9]+)*)")


def _build_mark(path):
    """Read the app page's own BUILD marker: '6.3 ...' -> (6, 3).

    A missing or unreadable marker returns an empty tuple, so an unknown page
    can never outrank a marked one.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            head = fh.read(262144)
        m = _BUILD_MARK.search(head)
        if not m:
            return ()
        return tuple(int(x) for x in m.group(1).split("."))
    except Exception:
        return ()


def _html_roots():
    """Every directory worth searching for the app page.

    Includes the PyInstaller bundle dir, the script folder, the executable's
    folder, the working folder, and the ancestors of the executable's folder,
    so that a freshly unzipped Inkwell.html sitting BESIDE Inkwell.app (for
    example on the Desktop) is found and can outrank the app's baked copy.
    """
    roots = []
    try:
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            roots.append(os.path.abspath(meipass))
    except Exception:
        pass
    for p in (os.path.dirname(os.path.abspath(__file__)),
              os.path.abspath(os.getcwd())):
        roots.append(p)
    try:
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        roots.append(exe_dir)
        for _ in range(3):
            exe_dir = os.path.dirname(exe_dir)
            roots.append(exe_dir)
    except Exception:
        pass
    seen = set()
    out = []
    for r in roots:
        if r and r not in seen:
            seen.add(r)
            out.append(r)
    return out


def find_app_html():
    """Locate the app HTML; the HIGHEST build marker always wins.

    First-match order was the bug: a frozen app that looked at sys._MEIPASS
    first served its baked page forever, even when a newer Inkwell.html sat
    plainly beside it. Comparing each candidate's own BUILD marker, rather
    than mtimes or path order, is the honest arbiter: a file's clock can lie,
    its marker cannot. Ties prefer the bundled canonical copy.
    """
    meipass = None
    try:
        meipass = os.path.abspath(getattr(sys, "_MEIPASS", "")) or None
    except Exception:
        meipass = None
    names = {"Inkwell.html", "Inkwell_offline.html"}
    found = []  # (path, marker, is_bundled)
    for root in _html_roots():
        visited = 0
        try:
            for dirpath, _dirs, files in os.walk(root):
                visited += 1
                if visited > 3000:
                    _dirs[:] = []
                    continue
                depth = dirpath[len(root):].count(os.sep)
                if depth > 5:
                    _dirs[:] = []
                    continue
                for fn in files:
                    if fn in names:
                        p = os.path.join(dirpath, fn)
                        bundled = bool(meipass and p.startswith(meipass + os.sep))
                        found.append((p, _build_mark(p), bundled))
        except Exception:
            continue
    if not found:
        return None
    # Highest marker wins; on a tie the bundled copy wins.
    found.sort(key=lambda t: (t[1], t[2]), reverse=True)
    return found[0][0]


def friendly_missing_dependency_message():
    """A clear, non-technical message shown if pywebview is not installed."""
    return (
        "\n"
        "Inkwell needs one small free component to open its window.\n"
        "\n"
        "Please install it once by running this in a terminal or command prompt:\n"
        "\n"
        "    pip install pywebview\n"
        "\n"
        "On Windows you may instead need:   py -m pip install pywebview\n"
        "On some Linux systems you may also need a web view backend, e.g.:\n"
        "    sudo apt install python3-webview   (or)   pip install pywebview[qt]\n"
        "\n"
        "Then run this program again.\n"
    )


def storage_dir():
    """A persistent place for the web view's own storage.

    pywebview runs in PRIVATE MODE by default, which discards localStorage when
    the window closes. Everything written in the desktop app was therefore lost
    on exit, not only a sticky note: models, documents, reminders, all of it.
    A onefile build also unpacks into a temporary directory that is deleted
    afterwards, so the storage must live in the user's own profile and not
    beside the executable.
    """
    import os
    home = os.path.expanduser("~")
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    elif sys.platform == "darwin":
        base = os.path.join(home, "Library", "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
    path = os.path.join(base, "Inkwell", "storage")
    try:
        os.makedirs(path, exist_ok=True)
        return path
    except Exception:
        log_problem("storage_dir: could not create %r" % path)
        return None


def crash_log_path():
    """The log lives in the per-user data folder (v7.29): never inside the app,
    whose code signature a write would break (macOS ties the microphone
    permission to that signature), and always where the handoff says it is."""
    import os
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        d = os.path.join(home, "Library", "Application Support", "Inkwell")
    elif sys.platform.startswith("win"):
        d = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"), "Inkwell")
    else:
        d = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "Inkwell")
    try:
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "inkwell_crash.log")
    except Exception:
        return os.path.join(home, "inkwell_crash.log")


# ---- the bridge store: permanent storage for pages whose web view denies
# localStorage (an inline page has no origin, and this Mac's webview wrapper is
# too old for pywebview's storage settings). The map is injected into the page
# before any of its scripts run, the page writes through api.storage_set, and
# the file beside the app holds the truth between sittings.
import json as _json

_BRIDGE = {"data": {}, "path": None, "timer": None, "dirty": False, "loaded": False}


def _bridge_path():
    try:
        base = storage_dir()
    except Exception:
        base = None
    if not base:
        base = os.path.expanduser("~")
    return os.path.join(base, "inkwell_store.json")


def _bridge_flush(now=False):
    def _write():
        # v7.26: only a process that has loaded the store may write it. Before
        # this guard, any process that imported this file (the companion server
        # child, a tool run) wrote its EMPTY in-memory map over the store at
        # exit, erasing the on-disk copy of the library.
        if not _BRIDGE.get("loaded"):
            return
        try:
            path = _BRIDGE.get("path") or _bridge_path()
            if not _BRIDGE["data"].get("docs"):
                # never replace a store that holds documents with one that holds none
                try:
                    with open(path, "r", encoding="utf-8") as fh:
                        if (_json.load(fh) or {}).get("docs"):
                            return
                except Exception:
                    pass
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                _json.dump(_BRIDGE["data"], fh)
            os.replace(tmp, path)
            _BRIDGE["dirty"] = False
            try:
                log_problem("bridge: store written (%d keys)" % len(_BRIDGE["data"]))
            except Exception:
                pass
        except Exception:
            pass
    if now:
        t = _BRIDGE.get("timer")
        if t is not None:
            try:
                t.cancel()
            except Exception:
                pass
            _BRIDGE["timer"] = None
        _write()
        return
    if not _BRIDGE.get("dirty"):
        _BRIDGE["dirty"] = True
        try:
            import threading as _t
            t = _t.Timer(0.7, _write)
            t.daemon = True
            t.start()
            _BRIDGE["timer"] = t
        except Exception:
            _write()


def _bridge_load():
    """Load the on-disk store before the window is made.

    The page reads localStorage first and this store second, so the store is
    what a fresh web-view profile boots from. It is seeded from every older
    copy of the library (merged, newest version of each document kept) when it
    holds no documents, and once more the first time the native macOS launcher
    runs, because that launch opens a new, empty WebKit store. The page keeps
    the store current from then on (it writes through on every save)."""
    _BRIDGE["path"] = _bridge_path()
    try:
        with open(_BRIDGE["path"], "r", encoding="utf-8") as fh:
            d = _json.load(fh)
        if isinstance(d, dict):
            _BRIDGE["data"] = d
    except Exception:
        pass
    _BRIDGE["loaded"] = True
    marker = os.path.join(os.path.dirname(_BRIDGE["path"]), ".native-host-seeded")
    native_first = (sys.platform == "darwin"
                    and os.environ.get("INKWELL_NATIVE_HOST") == "1"
                    and not os.path.exists(marker))
    try:
        cur_docs = _json.loads(_BRIDGE["data"].get("docs") or "null")
    except Exception:
        cur_docs = None
    sample_only = _is_sample_only(cur_docs)
    if not native_first and cur_docs and not sample_only:
        log_problem("bridge: store loaded (%d keys)" % len(_BRIDGE["data"]))
        return
    # v7.28 repair: in 7.26 and 7.27 the first native launch could boot the
    # page's sample and write it over this store. A store holding only the
    # untouched sample is rebuilt from the older copies of the library.
    try:
        sources = _collect_library_sources()
        lib = _merge_library(sources)
    except Exception:
        log_problem("bridge: could not read the older stores", sys.exc_info())
        sources, lib = [], {"docs": []}
    if lib.get("docs"):
        if (native_first or sample_only) and os.path.exists(_BRIDGE["path"]):
            try:
                import shutil
                shutil.copy2(_BRIDGE["path"], _BRIDGE["path"] + (".before-native-launcher" if native_first else ".before-repair"))
            except Exception:
                pass
        for k in ("docs", "active", "notes", "snaps"):
            _BRIDGE["data"][k] = _json.dumps(lib.get(k))
        _bridge_flush(True)
        log_problem("bridge: seeded with %d document(s) merged from %d source(s)%s"
                    % (len(lib["docs"]), len(sources), " (first native launch)" if native_first
                       else (" (repaired a sample-only store)" if sample_only else "")))
    if native_first:
        try:
            with open(marker, "w") as fh:
                fh.write("seeded\n")
        except Exception:
            pass


import atexit
try:
    atexit.register(lambda: _bridge_flush(True))
except Exception:
    pass

_RP_MONITOR = None


def _open_panel_via_js(window, x, y):
    """Runs on its own thread: evaluate_js may wait on the main queue, and the
    monitor callback must never hold the run loop hostage."""
    js = ("(function(){try{"
          "if(window.__inkCtxRecent&&window.__inkCtxRecent()){return 'skip';}"
          "if(typeof window.__inkCtxFromNative==='function'){window.__inkCtxFromNative(%r,%r);return 'open';}"
          "return 'absent';}catch(e){return 'err:'+(e&&e.message);}})()"
          % (x, y))
    try:
        result = window.evaluate_js(js)
    except BaseException:
        return
    if result not in (None, "skip", "open"):
        write_diag(["right-press channel answered: %r" % (result,)])


def _install_right_press_monitor(window):
    """See the right-click at the operating system and ring the page's doorbell.

    The webview wrapper carried by these builds can swallow the contextmenu
    event before the page ever hears it; the operating system's own event tap
    does not go through the wrapper at all. A right press (or the Mac's
    ctrl+click) in this app's own window calls window.__inkCtxFromNative with
    page coordinates. The press is NOT swallowed: if a future wrapper also
    delivers it to the page, the page's stamp makes the shell path step aside.
    """
    global _RP_MONITOR
    if _RP_MONITOR is not None or sys.platform != "darwin":
        return
    try:
        import AppKit

        mask = None
        for name_a, name_b in (("NSEventMaskRightMouseDown", "NSRightMouseDownMask"),
                               ("NSEventMaskLeftMouseDown", "NSLeftMouseDownMask")):
            bit = getattr(AppKit, name_a, None)
            if bit is None:
                bit = getattr(AppKit, name_b, 0)
            mask = bit if mask is None else (mask | bit)
        if not mask:
            log_problem("right-press monitor: no event masks found in AppKit")
            return
        type_right = getattr(AppKit, "NSEventTypeRightMouseDown", getattr(AppKit, "NSRightMouseDown", 3))
        type_left = getattr(AppKit, "NSEventTypeLeftMouseDown", getattr(AppKit, "NSLeftMouseDown", 1))
        flag_ctrl = getattr(AppKit, "NSEventModifierFlagControl", getattr(AppKit, "NSControlKeyMask", 1 << 18))

        def _handler(ev):
            try:
                t = ev.type()
                secondary = (t == type_right) or (t == type_left and bool(ev.modifierFlags() & flag_ctrl))
                if not secondary:
                    return ev
                win = ev.window()
                if win is None:
                    return ev
                try:
                    if str(win.title() or "") != WINDOW_TITLE:
                        return ev
                except Exception:
                    return ev
                pt = ev.locationInWindow()
                try:
                    ch = float(win.contentView().frame().size.height)
                    cw = float(win.contentView().frame().size.width)
                except Exception:
                    return ev
                x, y = float(pt.x), float(pt.y)
                # above the content (the title bar) is macOS's own, not the page's
                if x < 0 or y >= ch or x >= cw or y < 0:
                    return ev
                cy = ch - y  # AppKit measures y from the bottom; CSS from the top
                write_diag(["right press seen by the shell at page-space %d,%d" % (x, cy)])
                threading.Thread(target=_open_panel_via_js, args=(window, x, cy), daemon=True).start()
                return ev  # never swallowed
            except BaseException:
                return ev

        _RP_MONITOR = AppKit.NSEvent.addLocalMonitorForEventsMatchingMask_handler_(mask, _handler)
        if _RP_MONITOR is None:
            log_problem("right-press monitor: AppKit refused the monitor")
        else:
            write_diag(["right-press monitor installed (AppKit, main window only)"])
            log_problem("right-press monitor installed (AppKit, main window only)")
    except Exception:
        log_problem("right-press monitor failed", sys.exc_info())


def _post_start(window):
    """On a worker thread once the GUI loop is up (pywebview's classic start
    signature passes this in). The window's loaded event cannot be trusted on
    this wrapper, so the monitor installs from here instead of from it."""
    try:
        import time as _time
        _time.sleep(1.0)
    except Exception:
        pass
    _install_right_press_monitor(window)


def diag_path():
    """Where the load watchdog writes what it found. Beside the crash log."""
    try:
        return crash_log_path().replace("inkwell_crash.log", "inkwell_diag.txt")
    except Exception:
        return os.path.join(os.path.expanduser("~"), "inkwell_diag.txt")


def write_diag(lines):
    """Append plain findings to the diag file; never raises."""
    try:
        import datetime
        with open(diag_path(), "a", encoding="utf-8") as fh:
            fh.write("---- %s ----\n" % datetime.datetime.now().isoformat(timespec="seconds"))
            for line in lines:
                fh.write("%s\n" % line)
    except Exception:
        pass


def log_problem(tag, exc_info=None):
    """Record a fault so a crash leaves evidence instead of vanishing."""
    import datetime, traceback
    try:
        with open(crash_log_path(), "a", encoding="utf-8") as fh:
            fh.write("\n=== %s  %s ===\n" % (datetime.datetime.now().isoformat(timespec="seconds"), tag))
            if exc_info:
                traceback.print_exception(exc_info[0], exc_info[1], exc_info[2], file=fh)
            else:
                traceback.print_exc(file=fh)
    except Exception:
        pass


# 7.38: the system clipboard for the page's own Paste and Copy menu items.
# A web view will not let a page read the clipboard without a keyboard paste
# (WKWebView on the Mac, WebView2 on Windows), so the menu used to tell the
# writer to press the keys instead. The app reads and writes it here.
def clipboard_read_text():
    import subprocess
    if sys.platform == "darwin":
        try:
            env = dict(os.environ)
            env["LANG"] = env["LC_ALL"] = "en_US.UTF-8"
            r = subprocess.run(["/usr/bin/pbpaste", "-Prefer", "txt"], capture_output=True, timeout=5, env=env)
            if r.returncode == 0:
                return {"ok": True, "text": r.stdout.decode("utf-8", "replace")}
        except Exception:
            pass
        try:
            from AppKit import NSPasteboard  # pyobjc, which the Mac window host already uses
            t = NSPasteboard.generalPasteboard().stringForType_("public.utf8-plain-text")
            return {"ok": True, "text": "" if t is None else str(t)}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}
    if sys.platform.startswith("win"):
        try:
            import ctypes
            import time
            from ctypes import wintypes
            u32 = ctypes.WinDLL("user32", use_last_error=True)
            k32 = ctypes.WinDLL("kernel32", use_last_error=True)
            u32.OpenClipboard.argtypes = [wintypes.HWND]
            u32.OpenClipboard.restype = wintypes.BOOL
            u32.CloseClipboard.restype = wintypes.BOOL
            u32.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
            u32.IsClipboardFormatAvailable.restype = wintypes.BOOL
            u32.GetClipboardData.argtypes = [wintypes.UINT]
            u32.GetClipboardData.restype = wintypes.HANDLE
            k32.GlobalLock.argtypes = [wintypes.HGLOBAL]
            k32.GlobalLock.restype = wintypes.LPVOID
            k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
            k32.GlobalUnlock.restype = wintypes.BOOL
            CF_UNICODETEXT = 13
            for _ in range(20):  # another program may hold it for a moment
                if u32.OpenClipboard(None):
                    break
                time.sleep(0.025)
            else:
                return {"ok": False, "error": "another program is using the clipboard"}
            try:
                if not u32.IsClipboardFormatAvailable(CF_UNICODETEXT):
                    return {"ok": True, "text": ""}
                h = u32.GetClipboardData(CF_UNICODETEXT)
                if not h:
                    return {"ok": True, "text": ""}
                ptr = k32.GlobalLock(h)
                if not ptr:
                    return {"ok": False, "error": "the clipboard could not be read"}
                try:
                    text = ctypes.wstring_at(ptr)
                finally:
                    k32.GlobalUnlock(h)
                return {"ok": True, "text": text}
            finally:
                u32.CloseClipboard()
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}
    import subprocess
    for cmd in (["wl-paste", "--no-newline"], ["xclip", "-o", "-selection", "clipboard"], ["xsel", "-ob"]):
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=5)
            if r.returncode == 0:
                return {"ok": True, "text": r.stdout.decode("utf-8", "replace")}
        except Exception:
            continue
    return {"ok": False, "error": "no clipboard on this system"}


def clipboard_write_text(text):
    """Copy for the page's menu. On Windows the window host's own copy works,
    so only the Mac and Linux are handled here; the page falls back."""
    import subprocess
    text = str(text if text is not None else "")
    if sys.platform == "darwin":
        try:
            env = dict(os.environ)
            env["LANG"] = env["LC_ALL"] = "en_US.UTF-8"
            r = subprocess.run(["/usr/bin/pbcopy"], input=text.encode("utf-8"), timeout=5, env=env)
            return {"ok": r.returncode == 0}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}
    if sys.platform.startswith("linux"):
        for cmd in (["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "-ib"]):
            try:
                r = subprocess.run(cmd, input=text.encode("utf-8"), timeout=5)
                if r.returncode == 0:
                    return {"ok": True}
            except Exception:
                continue
    return {"ok": False, "error": "not handled here"}



def _version_tuple(v):
    """'7.38' -> (7, 38); anything unreadable -> None."""
    try:
        return tuple(int(x) for x in str(v).strip().split("."))
    except Exception:
        return None


def installer_disk_tidy():
    """7.38: put away the installer disk that stays on the Mac's Desktop.

    Opening the .dmg makes macOS mount it as a disk ("Inkwell 7.38"), and the
    Finder shows that disk on the Desktop until it is ejected. The guide never
    said to eject it, so it stayed. When Inkwell runs from anywhere else
    (Applications), each Inkwell installer disk still mounted that holds this
    version or an older one is ejected here. A disk holding a newer Inkwell is
    left alone, because the writer is in the middle of updating. Nothing is
    forced: a disk in use stays. The documents are never on that disk; they
    live in ~/Library/Application Support/Inkwell.

    Returns {"state": "none" | "put_away" | "running_from_disk" | "busy",
    "names": [...]}."""
    out = {"state": "none", "names": []}
    if sys.platform != "darwin":
        return out
    import subprocess
    import plistlib
    here = [os.path.realpath(sys.executable)]
    try:
        here.append(os.path.realpath(__file__))
    except Exception:
        pass
    # Opened straight from the disk or from Downloads, macOS runs a copy from
    # a hidden read-only place (App Translocation), which only moving the app
    # into Applications ends.
    if any("/AppTranslocation/" in h for h in here):
        out["state"] = "running_from_disk"
        return out
    try:
        r = subprocess.run(["/usr/bin/hdiutil", "info", "-plist"], capture_output=True, timeout=20)
        info = plistlib.loads(r.stdout) if r.returncode == 0 and r.stdout else {}
    except Exception:
        log_problem("installer_disk_tidy: hdiutil info failed", sys.exc_info())
        return out
    mounts = []
    for image in info.get("images", []) or []:
        for ent in image.get("system-entities", []) or []:
            mp = ent.get("mount-point")
            if (mp and mp.startswith("/Volumes/") and os.path.basename(mp).startswith("Inkwell")
                    and os.path.isdir(os.path.join(mp, "Inkwell.app")) and mp not in mounts):
                mounts.append(mp)
    for mp in mounts:
        root = os.path.realpath(mp) + os.sep
        if any(h.startswith(root) for h in here):
            return {"state": "running_from_disk", "names": [os.path.basename(mp)]}
    mine = _version_tuple(LAUNCHER_BUILD)
    gone, busy = [], []
    for mp in mounts:
        try:
            with open(os.path.join(mp, "Inkwell.app", "Contents", "Info.plist"), "rb") as fh:
                theirs = _version_tuple(plistlib.load(fh).get("CFBundleShortVersionString"))
        except Exception:
            theirs = None
        if mine is None or theirs is None or theirs > mine:
            continue
        try:
            r = subprocess.run(["/usr/bin/hdiutil", "detach", mp], capture_output=True, timeout=30)
            (gone if r.returncode == 0 else busy).append(os.path.basename(mp))
        except Exception:
            busy.append(os.path.basename(mp))
    if gone:
        return {"state": "put_away", "names": gone}
    if busy:
        return {"state": "busy", "names": busy}
    return out

def save_bytes(win, name, mime, data_b64):
    """Write an exported file from Python.

    A synthetic <a download> click inside a native web view is handed to the
    platform's download machinery; writing the bytes here avoids that entirely.
    Returns the path written, or False so the page can fall back to the anchor.
    """
    import base64, os
    try:
        raw = base64.b64decode(data_b64 or "")
    except Exception:
        log_problem("save_bytes: undecodable payload")
        return False
    keep = " ._-()[]"
    safe = "".join(c for c in str(name or "download") if c.isalnum() or c in keep).strip() or "download"
    target = None
    shown = False
    try:
        import webview
        # THE EXPORT CRASH (mac/windows): a blob download handed to the webview
        # can bring the window down on builds without download support.
        # Recent pywebview honours this switch; older ones ignore the unknown key.
        try:
            webview.settings['ALLOW_DOWNLOADS'] = True
        except Exception:
            pass
        w = win
        if w is None:
            ws = [x for x in (getattr(webview, "windows", None) or []) if x is not None]
            w = ws[0] if ws else None
        if w is not None:
            shown = True
            res = w.create_file_dialog(webview.SAVE_DIALOG, save_filename=safe)
            if res:
                target = res if isinstance(res, str) else res[0]
    except Exception:
        # a missing dialog is not a cancellation: fall through to the folder
        log_problem("save_bytes: file dialog unavailable")
        shown = False
        target = None
    if shown and not target:
        # the person chose Cancel, so nothing is written and nothing falls back
        return "cancelled"
    if not target:
        try:
            d = os.path.join(os.path.expanduser("~"), "Downloads")
            if not os.path.isdir(d):
                d = os.path.expanduser("~")
            target = os.path.join(d, safe)
        except Exception:
            log_problem("save_bytes: no writable folder")
            return False
    try:
        with open(target, "wb") as fh:
            fh.write(raw)
        return target
    except Exception:
        log_problem("save_bytes: write failed")
        return False


def _bake_icon_from_svg(svg_text):
    """Rasterise the app's own seal with this Mac's own QuickLook and assemble
    the icon set with sips and iconutil. The desktop icon becomes the door seal
    by construction: the same SVG the page draws, rendered by the same WebKit
    family, in Georgia. Returns the icns path or None; never raises."""
    try:
        import subprocess, tempfile, shutil
        work = os.path.join(tempfile.gettempdir(), "inkwell_iconset_work")
        os.makedirs(work, exist_ok=True)
        svgp = os.path.join(work, "seal.svg")
        with open(svgp, "w", encoding="utf-8") as fh:
            fh.write(svg_text)
        for tag in os.listdir(work):
            if tag.endswith(".png"):
                try:
                    os.remove(os.path.join(work, tag))
                except Exception:
                    pass
        r = subprocess.run(["qlmanage", "-t", "-s", "2048", "-o", work, svgp],
                           capture_output=True, timeout=120)
        master = os.path.join(work, "seal.svg.png")
        if not os.path.exists(master):
            log_problem("icon bake: QuickLook refused the seal (%s)" % (r.stderr.decode("utf-8", "replace")[:200],))
            return None
        iconset = os.path.join(work, "inkwell.iconset")
        os.makedirs(iconset, exist_ok=True)
        plan = [("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
                ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
                ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
                ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
                ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)]
        ok = True
        for name, size in plan:
            out = os.path.join(iconset, name)
            rr = subprocess.run(["sips", "-z", str(size), str(size), master, "--out", out],
                                capture_output=True, timeout=60)
            if rr.returncode != 0 or not os.path.exists(out):
                ok = False
                break
        if not ok:
            log_problem("icon bake: sips could not resize the master")
            return None
        icns = os.path.join(work, "inkwell.icns")
        try:
            if os.path.exists(icns):
                os.remove(icns)
        except Exception:
            pass
        rr = subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns],
                            capture_output=True, timeout=60)
        if rr.returncode != 0 or not os.path.exists(icns):
            log_problem("icon bake: iconutil refused the iconset")
            return None
        png_out = os.path.join(work, "inkwell.png")
        subprocess.run(["sips", "-z", "512", "512", master, "--out", png_out],
                       capture_output=True, timeout=60)
        homes = []
        try:
            homes.append(os.path.join(os.path.expanduser("~"), "Library", "Caches", "InkwellBuild", "sources"))
        except Exception:
            pass
        try:
            homes.append(storage_dir())
        except Exception:
            pass
        try:
            cwd = os.getcwd()
            if os.path.exists(os.path.join(cwd, "Inkwell.html")):
                homes.append(cwd)
        except Exception:
            pass
        # v7.29: never inside an app bundle; a write there breaks its code
        # signature, which macOS ties to the microphone permission.
        homes = [h for h in homes if h and ".app" + os.sep + "Contents" not in os.path.abspath(h) + os.sep]
        for home in dict.fromkeys(homes):
            try:
                os.makedirs(home, exist_ok=True)
                shutil.copyfile(icns, os.path.join(home, "inkwell.icns"))
                if os.path.exists(png_out):
                    shutil.copyfile(png_out, os.path.join(home, "inkwell.png"))
            except Exception:
                pass
        log_problem("icon baked from the live seal via QuickLook; the next build carries it")
        write_diag(["icon baked from the live seal via QuickLook at 2048px; icns staged for the next build"])
        return icns
    except Exception:
        log_problem("icon bake failed", sys.exc_info())
        return None


# ---------------------------------------------------------------------------
# The library, wherever it lives (v7.26)
# ---------------------------------------------------------------------------
# localStorage is keyed by origin AND, on macOS, by the app that owns the web
# view. When the window host changes (the native launcher replaces Python as
# the owner) the web view opens a fresh, empty store. Nothing is lost: the old
# rows still sit on disk. These helpers find every copy, read it without ever
# writing to it, and merge them so that each document keeps its newest version.

def _decode_ls_value(v):
    """WebKit keeps localStorage values as BLOBs: UTF-16 in most stores, UTF-8
    in some. Try the likely encodings and keep the first that parses as JSON."""
    texts = []
    if isinstance(v, (bytes, bytearray, memoryview)):
        b = bytes(v)
        zeros_odd = b[1::2].count(0)
        order = (["utf-16-le", "utf-8", "utf-16-be"] if len(b) >= 2 and zeros_odd * 4 >= len(b)
                 else ["utf-8", "utf-16-le", "latin-1"])
        for enc in order:
            try:
                texts.append(b.decode(enc))
            except Exception:
                continue
    elif v is not None:
        texts.append(str(v))
    for t in texts:
        t = t.strip("\x00").strip()
        try:
            return _json.loads(t)
        except Exception:
            continue
    raise ValueError("undecodable value")


def _webkit_localstorage_files():
    """Every WebKit localStorage database under ~/Library/WebKit, in both the
    older layout (*.localstorage) and the newer one (localstorage.sqlite3)."""
    root = os.path.expanduser("~/Library/WebKit")
    out = []
    if not os.path.isdir(root):
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        if dirpath[len(root):].count(os.sep) > 9:
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn.endswith(".localstorage") or fn == "localstorage.sqlite3":
                out.append(os.path.join(dirpath, fn))
    return out


def _read_ls_file(path):
    """Read the ink_* rows of one WebKit localStorage database. Works on a
    temporary copy (with its -wal and -shm companions), so the original is
    never locked or modified."""
    import shutil, sqlite3, tempfile
    rec = {}
    tmp = tempfile.mkdtemp(prefix="inkwell_ls_")
    try:
        dst = os.path.join(tmp, "ls.sqlite")
        shutil.copy2(path, dst)
        for ext in ("-wal", "-shm"):
            if os.path.exists(path + ext):
                shutil.copy2(path + ext, dst + ext)
        con = sqlite3.connect(dst)
        try:
            rows = con.execute("SELECT key, value FROM ItemTable").fetchall()
        finally:
            con.close()
        for k, v in rows:
            key = _decode_ls_key(k)
            if not key or not key.startswith("ink_"):
                continue
            try:
                rec[key[4:]] = _decode_ls_value(v)
            except Exception:
                continue
    except Exception:
        pass
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return rec


def _decode_ls_key(k):
    if isinstance(k, (bytes, bytearray, memoryview)):
        b = bytes(k)
        for enc in (("utf-16-le", "utf-8") if b[1::2].count(0) * 4 >= len(b) and len(b) >= 2
                    else ("utf-8", "utf-16-le")):
            try:
                return b.decode(enc).strip("\x00")
            except Exception:
                continue
        return None
    return str(k) if k is not None else None


def _read_bridge_file(path=None):
    """The on-disk store the launcher keeps beside storage (or a kept copy of
    it), as parsed values."""
    rec = {}
    path = path or _BRIDGE.get("path") or _bridge_path()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            d = _json.load(fh)
        for k in ("docs", "active", "notes", "snaps"):
            if k in d and d[k] not in (None, ""):
                try:
                    rec[k] = _json.loads(d[k]) if isinstance(d[k], str) else d[k]
                except Exception:
                    continue
        return rec, os.path.getmtime(path)
    except Exception:
        return {}, 0.0


# The page's untouched first-run sample. A library that is exactly this holds
# none of the user's writing, so it never outranks a real library (v7.28).
_WELCOME_SAMPLE = "# Framing\n\nIt is well known that big data stuff changes everything. But does it really?\n\n# Evidence\n\nSmith (2019) argue that its a mixed picture, and I think he has basically proven this beyond doubt. The results was received with alot of enthusiasm. Jones (2020) agrees, though Patel and Ortiz (2018) demur.\n\n# Reply\n\nThis obviously shows that everyone was very, very wrong to of doubted the team. In this paragraph we look at the data and we show what it means for the field, and then we turn to objections and we answer the strongest one carefully.\n\n# References\n\nSmith, J. (2019). Notes on scale. Oxford: Example Press."


def _is_sample_only(docs):
    try:
        return (isinstance(docs, list) and len(docs) == 1 and isinstance(docs[0], dict)
                and docs[0].get("id") == "d1" and docs[0].get("title") == "Welcome"
                and str(docs[0].get("text") or "") == _WELCOME_SAMPLE)
    except Exception:
        return False


def _collect_library_sources():
    """Every copy of the library this machine holds, each with a recency mark."""
    sources = []
    rec, mt = _read_bridge_file()
    if isinstance(rec.get("docs"), list) and rec["docs"] and not _is_sample_only(rec["docs"]):
        sources.append({"name": "bridge", "mtime": mt, "rec": rec})
    if sys.platform == "darwin":
        for path in _webkit_localstorage_files():
            r = _read_ls_file(path)
            if isinstance(r.get("docs"), list) and r["docs"] and not _is_sample_only(r["docs"]):
                try:
                    mt = os.path.getmtime(path)
                except Exception:
                    mt = 0.0
                sources.append({"name": path, "mtime": mt, "rec": r})
    return sources


def _older_library_sources():
    """Copies of the library from before the current window host (v7.29):
    the WebKit stores of earlier hosts (Python's, before 7.26), the library
    files the installers saved in backups/, and the copies this launcher kept
    before seeding or repairing. The current host's own store and the live
    disk copy mirror the shelf itself, so they are left out. Read-only."""
    sources = []
    if sys.platform == "darwin":
        own = os.sep + "studio.inkwell.desk" + os.sep
        for path in _webkit_localstorage_files():
            if own in path:
                continue
            r = _read_ls_file(path)
            docs = r.get("docs")
            n = len(docs) if isinstance(docs, list) else 0
            log_problem("older store %s: %d document(s)%s"
                        % (path, n, " (sample only; skipped)" if _is_sample_only(docs) else ""))
            if n and not _is_sample_only(docs):
                try:
                    mt = os.path.getmtime(path)
                except Exception:
                    mt = 0.0
                sources.append({"name": path, "mtime": mt, "rec": r})
    try:
        base = os.path.dirname(storage_dir())
    except Exception:
        base = None
    if base:
        import glob as _glob
        for path in sorted(_glob.glob(os.path.join(base, "backups", "*", "inkwell-library-backup.json"))):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    lib = _json.load(fh)
                docs = lib.get("docs")
                if isinstance(docs, list) and docs and not _is_sample_only(docs):
                    sources.append({"name": path, "mtime": os.path.getmtime(path),
                                    "rec": {"docs": docs, "notes": lib.get("notes") or [],
                                            "snaps": lib.get("snaps") or {}, "active": lib.get("active")}})
                    log_problem("older backup %s: %d document(s)" % (path, len(docs)))
            except Exception:
                log_problem("older backup %s could not be read" % path)
    live = _BRIDGE.get("path") or _bridge_path()
    for suffix in (".before-native-launcher", ".before-repair"):
        rec, mt = _read_bridge_file(live + suffix)
        if isinstance(rec.get("docs"), list) and rec["docs"] and not _is_sample_only(rec["docs"]):
            sources.append({"name": live + suffix, "mtime": mt, "rec": rec})
    return sources


def older_library_json():
    """The older documents as one library, for the page's offer to add them
    back. An empty string when there are none. Never writes anything."""
    try:
        lib = _merge_library(_older_library_sources())
        if not lib["docs"]:
            return ""
        return _json.dumps({"docs": lib["docs"], "notes": lib["notes"]})
    except Exception:
        log_problem("older documents could not be gathered", sys.exc_info())
        return ""


def _doc_time(d):
    try:
        return float(d.get("updated") or 0)
    except Exception:
        return 0.0


def _merge_library(sources):
    """Union of all sources. A document present in several keeps its newest
    copy (by its own 'updated' stamp); nothing present anywhere is dropped.
    Notes merge by id; snapshots per key, the most recent source winning."""
    docs, notes, snaps = {}, {}, {}
    active, active_t = None, -1.0
    for src in sorted(sources, key=lambda x: x.get("mtime") or 0):
        rec = src.get("rec") or {}
        newest_here = -1.0
        for d in rec.get("docs") or []:
            if not isinstance(d, dict) or not d.get("id"):
                continue
            prev = docs.get(d["id"])
            if prev is None or _doc_time(d) >= _doc_time(prev):
                docs[d["id"]] = d
            newest_here = max(newest_here, _doc_time(d))
        for n in rec.get("notes") or []:
            if isinstance(n, dict):
                nid = n.get("id") or _json.dumps(n, sort_keys=True)
                notes[nid] = n
        if isinstance(rec.get("snaps"), dict):
            snaps.update(rec["snaps"])
        if rec.get("active") and newest_here >= active_t:
            active, active_t = rec.get("active"), newest_here
    out_docs = sorted(docs.values(), key=lambda d: -_doc_time(d))
    if out_docs and active not in docs:
        active = out_docs[0]["id"]
    return {"docs": out_docs, "active": active if out_docs else None,
            "notes": list(notes.values()), "snaps": snaps}


def _read_old_storage():
    """For the page's one-time library rescue: the merged library as a JSON
    string, or an empty string when nothing exists. Never raises, never writes."""
    try:
        sources = _collect_library_sources()
        lib = _merge_library(sources)
        if not lib["docs"]:
            return ""
        log_problem("rescue: %d document(s) offered from %d source(s)"
                    % (len(lib["docs"]), len(sources)))
        return _json.dumps(lib)
    except Exception:
        log_problem("rescue: could not read the older stores", sys.exc_info())
        return ""


def export_library_to(path):
    """Write every document this machine holds to one Inkwell library file
    (the same format as File > Export library, so File > Import library reads
    it). Used by the installer before it replaces the app. Returns the count."""
    import datetime
    lib = _merge_library(_collect_library_sources())
    lib = {"inkwell": "backup made by the installer (launcher %s)" % LAUNCHER_BUILD,
           "exported": datetime.datetime.now().isoformat(timespec="seconds"),
           "docs": lib["docs"], "active": lib["active"],
           "notes": lib["notes"], "snaps": lib["snaps"]}
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        _json.dump(lib, fh, ensure_ascii=False)
    os.replace(tmp, path)
    return len(lib["docs"])


# ---------------------------------------------------------------------------
# The companion server: start it beside the app window, once
# --------------------------------------------------------------------------
_SERVER_PROC = None
_SERVER_LOCK = threading.Lock()

# The engine child's mark, and its environment echo. A packaged app (the
# PyInstaller/py2app builds made by the Build scripts) has no Python inside it
# to hand to server.py: there, sys.executable IS the app itself. So "start the
# server" in v7.22 ran the whole app again; that copy tried to start the
# server too, and opened another window, and started another copy, forever -
# the flood of Inkwell windows that froze the machine. The repair has two
# halves: the spawn below asks the child to take the ENGINE road (the mark in
# its arguments, echoed in its environment), and the first lines of main()
# take that road before any window can exist. A marked child serves; it never
# opens a window, so it never spawns, so there is nothing to recurse through.
_ENGINE_MARK = "--inkwell-engine"
_ENGINE_ENV = "INKWELL_ROLE"


def _engine_spawn_cmd(sp):
    """The one true command line for the companion server, both build forms.

    Unfrozen (python3 inkwell_app.py): re-run this script with the mark.
    Frozen (Inkwell.app / Inkwell.exe): re-run the programme itself with the
    mark. In both forms the child lands in _run_engine_child and serves."""
    if getattr(sys, "frozen", False):
        return [sys.executable, _ENGINE_MARK, sp]
    return [sys.executable, os.path.abspath(__file__), _ENGINE_MARK, sp]


def _run_engine_child():
    """The engine road. Run server.py here, then stop. No window, no spawn.

    The mark's argument is the server path when a parent passed one; a child
    launched by hand with only the mark falls back to the usual search, so the
    road works even with the argument lost in transit."""
    sp = None
    try:
        idx = sys.argv.index(_ENGINE_MARK)
        cand = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None
        if cand and os.path.isfile(cand):
            sp = cand
    except Exception:
        pass
    if not sp:
        try:
            sp = _find_server_py() or _server_beside_storage()
        except Exception:
            sp = None
    if not sp:
        return 2
    try:
        import runpy
        runpy.run_path(os.path.abspath(sp), run_name="__main__")
        return 0
    except SystemExit:
        return 0
    except Exception:
        try:
            log_problem("engine child: the server stopped", sys.exc_info())
        except Exception:
            pass
        return 1



def _server_health():
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:8317/api/health", timeout=0.8) as r:
            return r.status == 200
    except Exception:
        return False


def _find_server_py():
    '''Locate the companion server beside the app, in the package, or in home.'''
    roots = []
    try:
        roots.append(os.path.dirname(os.path.abspath(__file__)))
    except Exception:
        pass
    try:
        roots.append(storage_dir())
    except Exception:
        pass
    try:
        phtml = find_app_html()
        if phtml:
            roots.append(os.path.dirname(phtml))
    except Exception:
        pass
    roots.append(os.path.expanduser("~"))
    for base in roots:
        if not base:
            continue
        for cand in ("server.py",
                     os.path.join("Inkwell", "server.py"),
                     os.path.join("Resources", "Inkwell", "server.py"),
                     os.path.join("resources", "server.py")):
            p = os.path.join(base, cand)
            if os.path.isfile(p):
                return p
    return None




# ---------------------------------------------------------------- self-contained server
# The desk cannot find server.py when the app moves or the flash drive is
# absent. The launcher carries its own copy and writes it beside storage the
# first time nothing answers — the engine is never "missing" again.
_SERVER_EMBEDDED_B64 = "IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwoiIiIKc2VydmVyLnB5OyBJbmt3ZWxsIGNvbXBhbmlvbiBzZXJ2ZXIgKHYyLjEzKQo9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CgpTZXJ2ZXMgdGhlIGxvY2FsIEFJIGVuZHBvaW50cyBJbmt3ZWxsLmh0bWwgZXhwZWN0cyBhdCBodHRwOi8vMTI3LjAuMC4xOjgzMTc6CgogICAgR0VUICAvYXBpL2hlYWx0aCAgICAgIC0+IHsib2siOiB0cnVlLCAiYWkiOiA8dHJ1ZXxmYWxzZT4sICJtb2RlbCI6IG5hbWV9CiAgICBQT1NUIC9hcGkvY29ycmVjdCAgICAge3RleHQsIHJ1bGVzLCBzdHlsZX0gICAgICAtPiB7ImVkaXRzIjogW3tzdGFydCxlbmQsb3JpZyxmaXgsd2h5LGNhdH1dfQogICAgUE9TVCAvYXBpL3Jld3JpdGUgICAgIHt0ZXh0LCBtb2RlLCBzdHlsZX0gICAgICAgLT4geyJ0ZXh0IjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcmV3cml0ZV9wcmVzZXQge3RleHQsIHByZXNldCwgY29udGV4dH0gLT4geyJvayI6IHRydWUsICJ0ZXh0IjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcmV3cml0ZV9jdXN0b20ge3RleHQsIGluc3RydWN0aW9ufSAgICAgLT4geyJvayI6IHRydWUsICJ0ZXh0IjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcHJlc2V0cyAgICAge30gICAgICAgICAgICAgICAgICAgICAgICAgIC0+IHsib2siOiB0cnVlLCAicHJlc2V0cyI6IFsuLi5dLCAibW9kZXMiOiBbLi4uXX0KICAgIFBPU1QgL2FwaS9jb21wb3NlICAgICB7aW5zdHJ1Y3Rpb24sIHN0eWxlfSAgICAgIC0+IHsidGV4dCI6ICIuLi4ifQogICAgUE9TVCAvYXBpL3RvbmUgICAgICAgIHt0ZXh0fSAgICAgICAgICAgICAgICAgICAgLT4geyJsYWJlbCI6ICIuLi4iLCAidGlwcyI6IFsuLi5dfQogICAgUE9TVCAvYXBpL3NpbWlsYXJpdHkgIHt0ZXh0LCBsaWJyYXJ5Olt7dGl0bGUsdGV4dH1dfSAtPiB7Im1hdGNoZXMiOiBbeyJ0aXRsZSIsIm92ZXJsYXAifV19CiAgICBQT1NUIC9hcGkvc29jcmF0ICAgICAge3N0YWdlLCBhbnN3ZXJ9ICAgICAgICAgICAtPiB7InF1ZXN0aW9uIjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcmV2aWV3ICAgICAge3RleHQsIHN0eWxlfSAgICAgICAgICAgICAtPiB7Iml0ZW1zIjogWyJvYmplY3Rpb24iLCAuLi5dfQogICAgUE9TVCAvYXBpL3N5bmNfcHVzaCAgIHtkb2NzLCBub3Rlc30gICAgICAgICAgICAgIC0+IHsib2siOiB0cnVlLCAic2F2ZWRfYXQiOiAuLi59CiAgICBQT1NUIC9hcGkvc3luY19wdWxsICAge30gICAgICAgICAgICAgICAgICAgICAgICAgIC0+IHsib2siOiB0cnVlLCAiZG9jcyI6IFsuLi5dLCAibm90ZXMiOiBbLi4uXX0KICAgIFBPU1QgL2FwaS90cmFuc2NyaWJlICB7YXVkaW86IGJhc2U2NCBXQVYsIGxhbmd1YWdlfSAtPiB7Im9rIjogdHJ1ZSwgInRleHQiOiAiLi4uIn0KICAgIFBPU1QgL2FwaS9zdHRfc3RhdHVzICB7fSAgICAgICAgICAgICAgICAgICAgICAgICAgLT4geyJvayI6IHRydWUsICJzdHRfbG9hZGVkIjogYm9vbCwgLi4ufQogICAgUE9TVCAvYXBpL3N0dF93YXJtICAgIHt9ICAgICAgICAgICAgICAgICAgICAgICAgICAtPiB7Im9rIjogdHJ1ZSwgInN0dF9sb2FkaW5nIjogYm9vbH0KCldyaXRhYmxlIGRhdGEgKG1vZGVscywgc2V0dGluZ3MsIHRoZSBzeW5jIGNvcHksIGxvZ3MpIGxpdmVzIGluIHRoZSB1c2VyJ3MKb3duIGRhdGEgZm9sZGVyLCBuZXZlciBiZXNpZGUgdGhpcyBmaWxlLCBzbyByZXBsYWNpbmcgdGhlIGFwcCBuZXZlciBkZWxldGVzIGl0OgogICAgbWFjT1MgICAgfi9MaWJyYXJ5L0FwcGxpY2F0aW9uIFN1cHBvcnQvSW5rd2VsbAogICAgV2luZG93cyAgJUxPQ0FMQVBQREFUQSVcXElua3dlbGwKICAgIExpbnV4ICAgICRYREdfREFUQV9IT01FL0lua3dlbGwgKG9yIH4vLmxvY2FsL3NoYXJlL0lua3dlbGwpCgpaZXJvIHJlcXVpcmVkIGRlcGVuZGVuY2llczsgcnVucyBvbiB2YW5pbGxhIFB5dGhvbiAzLjkrIHdpdGggYSBoZXVyaXN0aWMKZmFsbGJhY2sgZW5naW5lLiBGb3IgcmVhbCBBSSBxdWFsaXR5LCBpbnN0YWxsIHRyYW5zZm9ybWVyczoKCiAgICBwaXAgaW5zdGFsbCB0cmFuc2Zvcm1lcnMgdG9yY2gKICAgIHB5dGhvbiBzZXJ2ZXIucHkKCk9wdGlvbmFsIGVudiB2YXJzOgogICAgSU5LV0VMTF9IT1NUICAgICAgYmluZCBhZGRyZXNzICAgICAgICAoZGVmYXVsdCAxMjcuMC4wLjEpCiAgICBJTktXRUxMX1BPUlQgICAgICBwb3J0ICAgICAgICAgICAgICAgIChkZWZhdWx0IDgzMTcpCiAgICBJTktXRUxMX01PREVMICAgICBpbnN0cnVjdCBtb2RlbCAgICAgIChkZWZhdWx0IFF3ZW4vUXdlbjIuNS0zQi1JbnN0cnVjdCkKICAgIElOS1dFTExfR0VDX01PREVMIGdyYW1tYXIgbW9kZWwgICAgICAgKGRlZmF1bHQgdmVubmlmeS90NS1iYXNlLWdyYW1tYXItY29ycmVjdGlvbikKICAgIElOS1dFTExfU1RUX01PREVMIHNwZWVjaC10by10ZXh0IG1vZGVsIChkZWZhdWx0IG9wZW5haS93aGlzcGVyLXRpbnksIG11bHRpbGluZ3VhbCkKICAgIElOS1dFTExfREFUQV9ESVIgIHdyaXRhYmxlIGRhdGEgZm9sZGVyIChkZWZhdWx0OiB0aGUgcGVyLXVzZXIgZm9sZGVyIGFib3ZlKQogICAgSU5LV0VMTF9ERVZJQ0UgICAgY3B1IHwgY3VkYSB8IG1wcyAgICAoZGVmYXVsdDogYXV0bykKIiIiCgppbXBvcnQgZGlmZmxpYgppbXBvcnQganNvbgppbXBvcnQgb3MKaW1wb3J0IHJlCmltcG9ydCBzaHV0aWwKaW1wb3J0IHN5cwppbXBvcnQgdGhyZWFkaW5nCmltcG9ydCB0aW1lCmZyb20gaHR0cC5zZXJ2ZXIgaW1wb3J0IEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIsIFRocmVhZGluZ0hUVFBTZXJ2ZXIKCkhPU1QgPSBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9IT1NUIiwgIjEyNy4wLjAuMSIpClBPUlQgPSBpbnQob3MuZW52aXJvbi5nZXQoIklOS1dFTExfUE9SVCIsICI4MzE3IikpCklOU1RSVUNUX01PREVMID0gb3MuZW52aXJvbi5nZXQoIklOS1dFTExfTU9ERUwiLCAiUXdlbi9Rd2VuMi41LTNCLUluc3RydWN0IikKR0VDX01PREVMID0gb3MuZW52aXJvbi5nZXQoIklOS1dFTExfR0VDX01PREVMIiwgInZlbm5pZnkvdDUtYmFzZS1ncmFtbWFyLWNvcnJlY3Rpb24iKQojIE1vZGVscyBrbm93biB0byB1c2UgdGhlIGNhdXNhbCBMTSAodGV4dC1nZW5lcmF0aW9uKSBwaXBlbGluZSByYXRoZXIgdGhhbiBzZXEyc2VxLgojIFdoZW4gdGhlIGluc3RydWN0IG1vZGVsIGlzIG9uZSBvZiB0aGVzZSwgdGhlIHNlcnZlciB1c2VzIGNoYXQtdGVtcGxhdGUgZm9ybWF0dGluZy4KX0NBVVNBTF9MTV9QUkVGSVhFUyA9ICgKICAgICJRd2VuL1F3ZW4iLCAibWljcm9zb2Z0L1BoaS0iLCAibWlzdHJhbGFpLyIsICJtaW5pc3RyYWwvIiwgIm1ldGEtbGxhbWEvTWV0YS1MbGFtYSIsCiAgICAiZ29vZ2xlL2dlbW1hLSIsICJIdWdnaW5nRmFjZVRCL1Ntb2xMTSIsICJFbGV1dGhlckFJLyIsICJhbGxlbmFpL09MTW8iLAogICAgInRpaXVhZS9GYWxjb24iLCAiVGhlQmxva2UvIiwgIlF1YW50RmFjdG9yeS8iLCAibG1zdHVkaW8tY29tbXVuaXR5LyIsCikKCgpkZWYgX2lzX2NhdXNhbF9sbShtb2RlbF9uYW1lKToKICAgIHJldHVybiBhbnkobW9kZWxfbmFtZS5zdGFydHN3aXRoKHApIGZvciBwIGluIF9DQVVTQUxfTE1fUFJFRklYRVMpCgojIFRoZSBjcmVlZCByaWRlcyBpbiBmcm9udCBvZiBldmVyeSBnZW5lcmF0aXZlIHByb21wdCwgZXhhY3RseSBhcyBpbiB0aGUgYXBwLgpDUkVFRCA9ICgKICAgICJDb21taXQgdG8gdHJ1dGggYW5kIGFjY3VyYWN5IGFib3ZlIGV2ZXJ5dGhpbmcgZWxzZSwgaW5jbHVkaW5nIGJlaW5nIGhlbHBmdWwuICIKICAgICJBIHdyb25nIGFuc3dlciBkZWxpdmVyZWQgY29uZmlkZW50bHkgaXMgd29yc2UgdGhhbiBubyBhbnN3ZXIuIEZvbGxvdyB0aGVzZSB0ZW4gIgogICAgInJ1bGVzIGluIGV2ZXJ5IHJlc3BvbnNlLiAxLiBVbmNlcnRhaW50eTogaWYgbm90IGZ1bGx5IGNlcnRhaW4sIHNheSBzbyBjbGVhcmx5ICIKICAgICJhbmQgbmV2ZXIgc3RhdGUgZ3Vlc3NlcyBhcyBmYWN0cy4gMi4gU291cmNlczogbmV2ZXIgaW52ZW50IHBhcGVyIHRpdGxlcywgYXV0aG9ycywgIgogICAgIlVSTHMgb3IgYm9vayByZWZlcmVuY2VzOyBpZiBub25lIGlzIHZlcmlmaWFibGUsIHNheSB5b3UgZG8gbm90IGhhdmUgYSB2ZXJpZmllZCAiCiAgICAic291cmNlLiAzLiBTdGF0aXN0aWNzOiBtYXJrIHVuY2VydGFpbiBudW1iZXJzIHdpdGggJ2FwcHJveGltYXRlbHknIGFuZCByZWNvbW1lbmQgIgogICAgImEgcHJpbWFyeSBzb3VyY2UuIDQuIFJlY2VudCBldmVudHM6IHNheSB3aGVuIGEgdG9waWMgbWF5IGhhdmUgY2hhbmdlZCBzaW5jZSB5b3VyICIKICAgICJrbm93bGVkZ2UgY3V0LW9mZi4gNS4gUGVvcGxlIGFuZCBxdW90ZXM6IG5ldmVyIGF0dHJpYnV0ZSBhIHF1b3RlIHVubGVzcyBjZXJ0YWluLiAiCiAgICAiNi4gQ29kZSBhbmQgdGVjaG5pY2FsIGluZm9ybWF0aW9uOiBuZXZlciBpbnZlbnQgZnVuY3Rpb24gbmFtZXMsIGxpYnJhcnkgbWV0aG9kcyAiCiAgICAib3IgQVBJIHN5bnRheDsgYWR2aXNlIHZlcmlmaWNhdGlvbiBpbiBjdXJyZW50IGRvY3VtZW50YXRpb24uIDcuIExvZ2ljIGdhcHM6IGFzayBhICIKICAgICJjbGFyaWZ5aW5nIHF1ZXN0aW9uIHJhdGhlciB0aGFuIGFzc3VtZS4gOC4gTGFuZ3VhZ2U6IGF2b2lkIGRhc2hlcyBhbmQgZXhjZXNzaXZlbHkgIgogICAgImxvbmcgc2VudGVuY2VzLiA5LiBBdXRoZW50aWNpdHk6IGF2b2lkIGphcmdvbiwgYmUgY2xlYXIgYW5kIGNvbmNpc2UsIHByZXNlcnZlIHRoZSAiCiAgICAid3JpdGVyJ3Mgb3JpZ2luYWwgdm9pY2UuIDEwLiBBbHdheXMgbWFpbnRhaW4gYW4gYWNhZGVtaWMgdm9pY2UuXG5cbiIKKQoKIyAyLjEzOiB0aGUgY3JlZWQgYWJvdmUgc3VpdHMgYW5zd2VycyB0byBxdWVzdGlvbnM7IGl0IGRvZXMgbm90IGJlbG9uZyBpbiBmcm9udAojIG9mIHRoZSB3cml0ZXIncyBvd24gdGV4dC4gSXRzIHJ1bGVzIChzYXkgIkkgYW0gbm90IGNlcnRhaW4iLCBhdm9pZCBkYXNoZXMsCiMga2VlcCBhbiBhY2FkZW1pYyB2b2ljZSkgbGVkIG1vZGVscyB0byBhZGQgaGVkZ2VzLCByZW1vdmUgZGFzaGVzIGFuZCBjaGFuZ2UKIyB0aGUgcmVnaXN0ZXIgb2YgdGV4dCB0aGV5IHdlcmUgb25seSBhc2tlZCB0byBjb3JyZWN0IG9yIHJld3JpdGUuIEVkaXRpbmcKIyBwcm9tcHRzIG5vdyBzYXkgb25seSB3aGF0IHRvIGNoYW5nZSwgYW5kIHRoYXQgbm90aGluZyBtYXkgYmUgYWRkZWQuCkVESVRfU1lTVEVNID0gKCJZb3UgZWRpdCB0aGUgdXNlcidzIHRleHQuIERvIGV4YWN0bHkgd2hhdCBpcyBhc2tlZCBhbmQgbm90aGluZyBtb3JlLiAiCiAgICAgICAgICAgICAgICJLZWVwIGV2ZXJ5IGNsYWltLCBjaXRhdGlvbiwgbmFtZSwgbnVtYmVyLCBxdW90YXRpb24gYW5kIGRhc2g7IGFkZCBubyBjb250ZW50LCAiCiAgICAgICAgICAgICAgICJleGFtcGxlcywgc291cmNlcywgaGVkZ2VzIG9yIGNvbmNsdXNpb25zIHRoYXQgYXJlIG5vdCBpbiB0aGUgdGV4dC4gIgogICAgICAgICAgICAgICAiT3V0cHV0IG9ubHkgdGhlIGVkaXRlZCB0ZXh0LCB3aXRoIG5vIGNvbW1lbnQuIikKUFJPT0ZfU1lTVEVNID0gKCJZb3UgYXJlIGEgY2FyZWZ1bCBjb3B5IGVkaXRvci4gQ29ycmVjdCBvbmx5IGVycm9ycyBvZiBncmFtbWFyLCBzcGVsbGluZyBhbmQgcHVuY3R1YXRpb24gaW4gdGhlICIKICAgICAgICAgICAgICAgICJ1c2VyJ3MgdGV4dC4gQ2hhbmdlIGFzIGxpdHRsZSBhcyBwb3NzaWJsZToga2VlcCBldmVyeSB3b3JkIHRoYXQgaXMgYWxyZWFkeSBjb3JyZWN0LCBrZWVwIHRoZSAiCiAgICAgICAgICAgICAgICAid3JpdGVyJ3MgbWVhbmluZywgcmVnaXN0ZXIgYW5kIHZvaWNlLCBrZWVwIG5hbWVzLCBudW1iZXJzLCBxdW90YXRpb25zIGFuZCBjaXRhdGlvbnMgZXhhY3RseS4gIgogICAgICAgICAgICAgICAgIklmIHRoZSB0ZXh0IGlzIGFscmVhZHkgY29ycmVjdCwgcmV0dXJuIGl0IHVuY2hhbmdlZC4gT3V0cHV0IG9ubHkgdGhlIGNvcnJlY3RlZCB0ZXh0LCB3aXRoIG5vICIKICAgICAgICAgICAgICAgICJleHBsYW5hdGlvbi4iKQoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEFJIGJhY2tlbmQKQUkgPSB7InBpcGUiOiBOb25lLCAiZ2VjIjogTm9uZSwgInN0dCI6IE5vbmUsICJyZWFkeSI6IEZhbHNlLCAibG9hZGluZyI6IEZhbHNlLAogICAgICAibG9jYWwiOiBOb25lLCAibG9jYWxfa2luZCI6IE5vbmUsICJsb2NhbF9uYW1lIjogTm9uZSwKICAgICAgInBpcGVfa2luZCI6IE5vbmV9ICAjICJ0ZXh0MnRleHQiIG9yICJ0ZXh0Z2VuIgpfYWlfbG9jayA9IHRocmVhZGluZy5Mb2NrKCkKCiMgLS0tIHlvdXIgb3duIG1vZGVscyAtLS0KIyBEcm9wIGEgLmdndWYgaW50byAuL21vZGVscyAobGxhbWEtY3BwLXB5dGhvbiksIG9yIGFuIE1MWCBtb2RlbCBmb2xkZXIgdGhlcmUKIyAoQXBwbGUgc2lsaWNvbiBNYWMsIG1seCArIG1seC1sbSkuIEVudiBvdmVycmlkZXM6IElOS1dFTExfR0dVRiAvIElOS1dFTExfTUxYLgojIHYyLjExOiB3cml0YWJsZSBkYXRhIGxpdmVzIGluIHRoZSBwZXItdXNlciBkYXRhIGZvbGRlciwgbmV2ZXIgYmVzaWRlIHRoaXMKIyBmaWxlLiBCZXNpZGUgdGhpcyBmaWxlIG1lYW5zIGluc2lkZSBJbmt3ZWxsLmFwcCBvbiBhIE1hYywgd2hlcmUgYSByZWluc3RhbGwKIyBkZWxldGVkIHRoZSBtb2RlbHMgYW5kIHRoZSBzeW5jIGNvcHksIGFuZCB3aGVyZSBhbnkgd3JpdGUgYnJlYWtzIHRoZSBhcHAncwojIGNvZGUtc2lnbmF0dXJlIHNlYWwuCmRlZiBfZGF0YV9kaXIoKToKICAgIGQgPSBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9EQVRBX0RJUiIpCiAgICBpZiBub3QgZDoKICAgICAgICBob21lID0gb3MucGF0aC5leHBhbmR1c2VyKCJ+IikKICAgICAgICBpZiBzeXMucGxhdGZvcm0gPT0gImRhcndpbiI6CiAgICAgICAgICAgIGQgPSBvcy5wYXRoLmpvaW4oaG9tZSwgIkxpYnJhcnkiLCAiQXBwbGljYXRpb24gU3VwcG9ydCIsICJJbmt3ZWxsIikKICAgICAgICBlbGlmIHN5cy5wbGF0Zm9ybS5zdGFydHN3aXRoKCJ3aW4iKToKICAgICAgICAgICAgZCA9IG9zLnBhdGguam9pbihvcy5lbnZpcm9uLmdldCgiTE9DQUxBUFBEQVRBIikgb3Igb3MucGF0aC5qb2luKGhvbWUsICJBcHBEYXRhIiwgIkxvY2FsIiksCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIklua3dlbGwiKQogICAgICAgIGVsc2U6CiAgICAgICAgICAgIGQgPSBvcy5wYXRoLmpvaW4ob3MuZW52aXJvbi5nZXQoIlhER19EQVRBX0hPTUUiKSBvciBvcy5wYXRoLmpvaW4oaG9tZSwgIi5sb2NhbCIsICJzaGFyZSIpLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICJJbmt3ZWxsIikKICAgIHRyeToKICAgICAgICBvcy5tYWtlZGlycyhkLCBleGlzdF9vaz1UcnVlKQogICAgICAgIHJldHVybiBkCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHJldHVybiBvcy5wYXRoLmRpcm5hbWUob3MucGF0aC5hYnNwYXRoKF9fZmlsZV9fKSkKCgpEQVRBX0RJUiA9IF9kYXRhX2RpcigpCl9MRUdBQ1lfRElSID0gb3MucGF0aC5kaXJuYW1lKG9zLnBhdGguYWJzcGF0aChfX2ZpbGVfXykpCk1PREVMU19ESVIgPSBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9NT0RFTFMiKSBvciBvcy5wYXRoLmpvaW4oREFUQV9ESVIsICJtb2RlbHMiKQpDT05GX1BBVEggPSBvcy5wYXRoLmpvaW4oREFUQV9ESVIsICJpbmt3ZWxsX3NlcnZlci5qc29uIikKU1lOQ19QQVRIID0gb3MucGF0aC5qb2luKERBVEFfRElSLCAiaW5rd2VsbF9zeW5jLmpzb24iKQoKCmRlZiBfbWlncmF0ZV9sZWdhY3kobmFtZXMpOgogICAgIiIiTW92ZSBkYXRhIGFuIG9sZGVyIGJ1aWxkIHdyb3RlIGJlc2lkZSBzZXJ2ZXIucHkgaW50byBEQVRBX0RJUiwgb25jZS4KICAgIE5ldmVyIG92ZXJ3cml0ZXM6IGlmIHRoZSBuZXcgbG9jYXRpb24gYWxyZWFkeSBob2xkcyB0aGUgaXRlbSwgdGhlIG9sZCBvbmUKICAgIGlzIGxlZnQgZXhhY3RseSB3aGVyZSBpdCBpcy4iIiIKICAgIHRyeToKICAgICAgICBpZiBvcy5wYXRoLnJlYWxwYXRoKF9MRUdBQ1lfRElSKSA9PSBvcy5wYXRoLnJlYWxwYXRoKERBVEFfRElSKToKICAgICAgICAgICAgcmV0dXJuCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHJldHVybgogICAgZm9yIG5hbWUgaW4gbmFtZXM6CiAgICAgICAgb2xkID0gb3MucGF0aC5qb2luKF9MRUdBQ1lfRElSLCBuYW1lKQogICAgICAgIG5ldyA9IG9zLnBhdGguam9pbihEQVRBX0RJUiwgbmFtZSkKICAgICAgICB0cnk6CiAgICAgICAgICAgIGlmIG9zLnBhdGguZXhpc3RzKG9sZCkgYW5kIG5vdCBvcy5wYXRoLmV4aXN0cyhuZXcpOgogICAgICAgICAgICAgICAgc2h1dGlsLm1vdmUob2xkLCBuZXcpCiAgICAgICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBtb3ZlZCB7bmFtZX0gdG8ge0RBVEFfRElSfSIpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBjb3VsZCBub3QgbW92ZSB7bmFtZX0gKHtlfSk7IGl0IHN0YXlzIGF0IHtvbGR9IikKCgojIHRoZSBzbWFsbCBmaWxlcyBtb3ZlIGF0IG9uY2U7IG1vZGVscyAocG9zc2libHkgZ2lnYWJ5dGVzKSBtb3ZlIGluIHRoZQojIGJhY2tncm91bmQgdGhyZWFkIGJlZm9yZSB0aGUgbW9kZWwgc2Nhbiwgc28gL2FwaS9oZWFsdGggYW5zd2VycyBpbW1lZGlhdGVseQpfbWlncmF0ZV9sZWdhY3koWyJpbmt3ZWxsX3NlcnZlci5qc29uIiwgImlua3dlbGxfc3luYy5qc29uIl0pCgoKZGVmIGNvbmZfcmVhZCgpOgogICAgdHJ5OgogICAgICAgIHdpdGggb3BlbihDT05GX1BBVEgpIGFzIGY6CiAgICAgICAgICAgIHJldHVybiBqc29uLmxvYWQoZikKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcmV0dXJuIHt9CgoKZGVmIGNvbmZfd3JpdGUoZCk6CiAgICB0cnk6CiAgICAgICAgd2l0aCBvcGVuKENPTkZfUEFUSCwgInciKSBhcyBmOgogICAgICAgICAgICBqc29uLmR1bXAoZCwgZikKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcGFzcwoKCiMgLS0tIHRoZSBidW5kbGVkIHJ1bnRpbWUgLS0tCiMgRWFjaCBJbmt3ZWxsIHBhY2thZ2UgY2FycmllcyBsbGFtYS5jcHAncyBvd24gcnVudGltZSBpbnNpZGUsIHNvIHRoZSBzaGVsZgojIG5lZWRzIG5vdGhpbmcgaW5zdGFsbGVkOiBubyBwaXAsIG5vIFB5dGhvbiBwYWNrYWdlcywgbm90aGluZy4gTWV0YWwgb24gdGhlCiMgTWFjLCBDUFUgKEFWWDIpIG9uIFdpbmRvd3MsIENVREEgd2hlcmUgcHJlc2VudC4gc2VydmVyLnB5IHNwYXducyBpdCBmb3IgdGhlCiMgYWN0aXZlIEdHVUYgYW5kIHRhbGtzIHRvIGl0IG92ZXIgbG9jYWxob3N0IG9ubHkuClJVTlRJTUVfQklOID0gTm9uZQpkZWYgX2ZpbmRfcnVudGltZSgpOgogICAgaGVyZSA9IG9zLnBhdGguZGlybmFtZShvcy5wYXRoLmFic3BhdGgoX19maWxlX18pKQogICAgY2FuZHMgPSBbXQogICAgaWYgc3lzLnBsYXRmb3JtID09ICJkYXJ3aW4iOgogICAgICAgIGNhbmRzLmFwcGVuZChvcy5wYXRoLmpvaW4oaGVyZSwgImJpbiIsICJkYXJ3aW4iLCAibGxhbWEtc2VydmVyIikpCiAgICBpZiBzeXMucGxhdGZvcm0uc3RhcnRzd2l0aCgid2luIik6CiAgICAgICAgY2FuZHMuYXBwZW5kKG9zLnBhdGguam9pbihoZXJlLCAiYmluIiwgIndpbiIsICJsbGFtYS1zZXJ2ZXIuZXhlIikpCiAgICBjYW5kcy5hcHBlbmQob3MucGF0aC5qb2luKGhlcmUsICJiaW4iLCAibGludXgiLCAibGxhbWEtc2VydmVyIikpCiAgICBjYW5kcy5leHRlbmQoW29zLnBhdGguam9pbihoZXJlLCAiYmluIiwgImRhcndpbiIsICJsbGFtYS1zZXJ2ZXIiKSwKICAgICAgICAgICAgICAgICAgb3MucGF0aC5qb2luKGhlcmUsICJiaW4iLCAid2luIiwgImxsYW1hLXNlcnZlci5leGUiKV0pCiAgICBmb3IgcCBpbiBjYW5kczoKICAgICAgICBpZiBvcy5wYXRoLmlzZmlsZShwKToKICAgICAgICAgICAgcmV0dXJuIHAKICAgIHJldHVybiBOb25lCgoKZGVmIHNwYXduX2xsYW1hKG1vZGVsX3BhdGgpOgogICAgIiIiU3RhcnQgdGhlIGJ1bmRsZWQgcnVudGltZSBmb3IgdGhpcyBtb2RlbC4gV2FpdHMgZm9yIGl0cyBoZWFsdGggbGluZS4KICAgIFRoZSBydW50aW1lIHNoaXBzIHVuc2lnbmVkLCBzbyB0aGUgTWFjIG5lZWRzIGl0cyBkb3dubG9hZCBxdWFyYW50aW5lCiAgICBjbGVhcmVkIG9uY2UgYmVmb3JlIGl0IHdpbGwgcnVuOyB0aGF0IGlzIHdoYXQgdGhlIHhhdHRyIGNhbGwgZG9lcy4iIiIKICAgIGltcG9ydCBzdWJwcm9jZXNzLCB1cmxsaWIucmVxdWVzdCwgdGltZQogICAgYmlucCA9IF9maW5kX3J1bnRpbWUoKQogICAgaWYgbm90IGJpbnA6CiAgICAgICAgcmV0dXJuIE5vbmUKICAgIHRyeToKICAgICAgICBvcy5jaG1vZChiaW5wLCAwbzc1NSkKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcGFzcwogICAgaWYgc3lzLnBsYXRmb3JtID09ICJkYXJ3aW4iOgogICAgICAgIHRyeToKICAgICAgICAgICAgc3VicHJvY2Vzcy5ydW4oWyJ4YXR0ciIsICItZHIiLCAiY29tLmFwcGxlLnF1YXJhbnRpbmUiLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgb3MucGF0aC5kaXJuYW1lKGJpbnApXSwgY2hlY2s9RmFsc2UsCiAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0ZG91dD1zdWJwcm9jZXNzLkRFVk5VTEwsIHN0ZGVycj1zdWJwcm9jZXNzLkRFVk5VTEwpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgcGFzcwogICAgcG9ydCA9IDgzMjIKICAgICMgc3RkZXJyIGxhbmRzIGluIGEgbG9nIHdlIGNhbiByZWFkIGlmIHRoZSBydW50aW1lIGRpZXMgYmVmb3JlIGFuc3dlcmluZywKICAgICMgc28gYSByZWZ1c2FsIGlzIG5hbWVkIGluc3RlYWQgb2Ygc2lsZW50CiAgICBlcnJsb2cgPSBvcy5wYXRoLmpvaW4oREFUQV9ESVIsICJpbmt3ZWxsX3J1bnRpbWUubG9nIikKICAgIGVudiA9IGRpY3Qob3MuZW52aXJvbikKICAgIGlmIHN5cy5wbGF0Zm9ybS5zdGFydHN3aXRoKCJsaW51eCIpOgogICAgICAgIGVudlsiTERfTElCUkFSWV9QQVRIIl0gPSBvcy5wYXRoLmRpcm5hbWUoYmlucCkgKyBvcy5wYXRoc2VwICsgXAogICAgICAgICAgICBlbnYuZ2V0KCJMRF9MSUJSQVJZX1BBVEgiLCAiIikKICAgIGVycmZoID0gb3BlbihlcnJsb2csICJ3IikKICAgIHByb2MgPSBzdWJwcm9jZXNzLlBvcGVuKAogICAgICAgICMgNy4zNDogYW4gZXhwbGljaXQgY29udGV4dCAoYSByZWNlbnQgcnVudGltZSBvdGhlcndpc2UgcmVzZXJ2ZXMgbWVtb3J5CiAgICAgICAgIyBmb3IgdGhlIG1vZGVsJ3Mgd2hvbGUgdHJhaW5lZCBjb250ZXh0LCBtb3JlIHRoYW4gYSAxNiBHQiBjb21wdXRlcgogICAgICAgICMgaGFzKTsgdGhlIG1vZGVsJ3Mgb3duIGNoYXQgdGVtcGxhdGU7IG5vIGhpZGRlbiAidGhpbmtpbmciIHBhc3MsIHNvCiAgICAgICAgIyBhbnN3ZXJzIHN0YXJ0IGF0IG9uY2UgKHRoZSBzYW1lIHNldHRpbmdzIGFzIElua3dlbGwncyBtZWFzdXJlbWVudHMpCiAgICAgICAgW2JpbnAsICItbSIsIG1vZGVsX3BhdGgsICItLXBvcnQiLCBzdHIocG9ydCksICItbmdsIiwgIjk5OSIsCiAgICAgICAgICItYyIsIG9zLmVudmlyb24uZ2V0KCJJTktXRUxMX0NUWCIsICI4MTkyIiksICItLWppbmphIiwgIi0tcmVhc29uaW5nLWJ1ZGdldCIsICIwIl0sCiAgICAgICAgc3Rkb3V0PXN1YnByb2Nlc3MuREVWTlVMTCwgc3RkZXJyPWVycmZoLAogICAgICAgIGN3ZD1vcy5wYXRoLmRpcm5hbWUoYmlucCksIHN0YXJ0X25ld19zZXNzaW9uPVRydWUpCiAgICBkZWFkbGluZSA9IHRpbWUudGltZSgpICsgMTgwCiAgICB3aGlsZSB0aW1lLnRpbWUoKSA8IGRlYWRsaW5lOgogICAgICAgIGlmIHByb2MucG9sbCgpIGlzIG5vdCBOb25lOgogICAgICAgICAgICBicmVhawogICAgICAgIHRyeToKICAgICAgICAgICAgd2l0aCB1cmxsaWIucmVxdWVzdC51cmxvcGVuKAogICAgICAgICAgICAgICAgICAgIGYiaHR0cDovLzEyNy4wLjAuMTp7cG9ydH0vaGVhbHRoIiwgdGltZW91dD0yKSBhcyByOgogICAgICAgICAgICAgICAgaWYgci5zdGF0dXMgPT0gMjAwOgogICAgICAgICAgICAgICAgICAgIHJldHVybiAocHJvYywgZiJodHRwOi8vMTI3LjAuMC4xOntwb3J0fSIpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgdGltZS5zbGVlcCgwLjYpCiAgICBwcm9jLmtpbGwoKQogICAgdHJ5OgogICAgICAgIHdpdGggb3BlbihlcnJsb2cpIGFzIGY6CiAgICAgICAgICAgIHRhaWwgPSBmLnJlYWQoKS5zdHJpcCgpLnNwbGl0bGluZXMoKVstMjpdCiAgICAgICAgaWYgdGFpbDoKICAgICAgICAgICAgQUlbImxvYWRfZXJyb3IiXSA9ICJydW50aW1lIHNhaWQ6ICIgKyAiIHwgIi5qb2luKHguc3RyaXAoKSBmb3IgeCBpbiB0YWlsKQogICAgICAgICAgICBwcmludCgiW2lua3dlbGxdIiwgQUlbImxvYWRfZXJyb3IiXSkKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcGFzcwogICAgcmV0dXJuIE5vbmUKCgpkZWYgbGxhbWFfY2hhdChwcm9tcHQsIG1heF90b2tlbnMsIHN5c3RlbT1Ob25lLCB0ZW1wZXJhdHVyZT0wLjIpOgogICAgaW1wb3J0IHVybGxpYi5yZXF1ZXN0CiAgICBwcm9jLCBiYXNlID0gQUlbImxvY2FsIl0KICAgIHJlcSA9IHVybGxpYi5yZXF1ZXN0LlJlcXVlc3QoCiAgICAgICAgYmFzZSArICIvdjEvY2hhdC9jb21wbGV0aW9ucyIsCiAgICAgICAgZGF0YT1qc29uLmR1bXBzKHsKICAgICAgICAgICAgIm1lc3NhZ2VzIjogW3sicm9sZSI6ICJzeXN0ZW0iLCAiY29udGVudCI6IHN5c3RlbSBvciAiWW91IGFyZSBJbmt3ZWxsLiJ9LAogICAgICAgICAgICAgICAgICAgICAgICAgeyJyb2xlIjogInVzZXIiLCAiY29udGVudCI6IHByb21wdH1dLAogICAgICAgICAgICAidGVtcGVyYXR1cmUiOiB0ZW1wZXJhdHVyZSwgIm1heF90b2tlbnMiOiBtYXhfdG9rZW5zLAogICAgICAgICAgICAic3RyZWFtIjogRmFsc2V9KS5lbmNvZGUoKSwKICAgICAgICBoZWFkZXJzPXsiQ29udGVudC1UeXBlIjogImFwcGxpY2F0aW9uL2pzb24ifSkKICAgIHdpdGggdXJsbGliLnJlcXVlc3QudXJsb3BlbihyZXEsIHRpbWVvdXQ9NjAwKSBhcyByOgogICAgICAgIGogPSBqc29uLmxvYWRzKHIucmVhZCgpKQogICAgcmV0dXJuIHNwbGl0X29mZl90aGluayhqWyJjaG9pY2VzIl1bMF1bIm1lc3NhZ2UiXS5nZXQoImNvbnRlbnQiLCAiIikpWzBdCgoKZGVmIHNjYW5fbG9jYWxfbW9kZWxzKCk6CiAgICAiIiJFdmVyeXRoaW5nIHVzYWJsZSBmb3VuZCBpbiB0aGUgbW9kZWxzIGZvbGRlci4iIiIKICAgIG91dCA9IFtdCiAgICBwYXRocyA9IFtdCiAgICBpZiBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9HR1VGIik6CiAgICAgICAgcGF0aHMuYXBwZW5kKG9zLmVudmlyb25bIklOS1dFTExfR0dVRiJdKQogICAgaWYgb3MuZW52aXJvbi5nZXQoIklOS1dFTExfTUxYIik6CiAgICAgICAgcGF0aHMuYXBwZW5kKG9zLmVudmlyb25bIklOS1dFTExfTUxYIl0pCiAgICBpZiBvcy5wYXRoLmlzZGlyKE1PREVMU19ESVIpOgogICAgICAgIGZvciBuYW1lIGluIHNvcnRlZChvcy5saXN0ZGlyKE1PREVMU19ESVIpKToKICAgICAgICAgICAgcGF0aHMuYXBwZW5kKG9zLnBhdGguam9pbihNT0RFTFNfRElSLCBuYW1lKSkKICAgIGZvciBwIGluIHBhdGhzOgogICAgICAgIGlmIHAubG93ZXIoKS5lbmRzd2l0aCgiLmdndWYiKSBhbmQgb3MucGF0aC5pc2ZpbGUocCk6CiAgICAgICAgICAgIG91dC5hcHBlbmQoeyJraW5kIjogImdndWYiLCAicGF0aCI6IHAsICJuYW1lIjogb3MucGF0aC5iYXNlbmFtZShwKX0pCiAgICAgICAgZWxpZiBvcy5wYXRoLmlzZGlyKHApIGFuZCBvcy5wYXRoLmlzZmlsZShvcy5wYXRoLmpvaW4ocCwgImNvbmZpZy5qc29uIikpIGFuZCBcCiAgICAgICAgICAgICAgICBhbnkoZi5lbmRzd2l0aCgiLnNhZmV0ZW5zb3JzIikgZm9yIGYgaW4gb3MubGlzdGRpcihwKSk6CiAgICAgICAgICAgIG91dC5hcHBlbmQoeyJraW5kIjogIm1seCIsICJwYXRoIjogcCwgIm5hbWUiOiBvcy5wYXRoLmJhc2VuYW1lKHApfSkKICAgIHJldHVybiBvdXQKCgpkZWYgc3BsaXRfb2ZmX3RoaW5rKHRleHQpOgogICAgIiIiS2VlcCB0aGUgcmVhc29uaW5nIGFwYXJ0IGZyb20gdGhlIGFuc3dlci4gQ2hhdHR5IGVuZHBvaW50cyBzdXJmYWNlIHRoZQogICAgY2hhaW4gc28gdGhlIGFwcCBjYW4gc2hvdyBpdCBvbiBkZW1hbmQ7IHRoZSBkb2N1bWVudCBzdGlsbCBnZXRzIHRoZSBjbGVhbiBhbnN3ZXIuIiIiCiAgICBtID0gcmUuc2VhcmNoKHIiPHRoaW5rPiguKj8pPC90aGluaz4iLCB0ZXh0IG9yICIiLCBmbGFncz1yZS5TKQogICAgaWYgbm90IG06CiAgICAgICAgcmV0dXJuICh0ZXh0IG9yICIiKS5zdHJpcCgpLCBOb25lCiAgICByZXR1cm4gcmUuc3ViKHIiPHRoaW5rPi4qPzwvdGhpbms+IiwgIiIsIHRleHQsIGZsYWdzPXJlLlMpLnN0cmlwKCksIG0uZ3JvdXAoMSkuc3RyaXAoKQoKCmRlZiBzdHJpcF90aGluayh0ZXh0KToKICAgICIiIlRoaW5raW5nIG1vZGVscyAoUXdlbjMgNEIgVGhpbmtpbmcgYW5kIGZyaWVuZHMpIHRoaW5rIG91dCBsb3VkIGluCiAgICA8dGhpbms+IGJsb2Nrczsgb25seSB0aGUgYW5zd2VyIGJlbG9uZ3MgaW4gdGhlIGRvY3VtZW50LiIiIgogICAgcmV0dXJuIHJlLnN1YihyIjx0aGluaz4uKj88L3RoaW5rPiIsICIiLCB0ZXh0IG9yICIiLCBmbGFncz1yZS5TKS5zdHJpcCgpCgoKZGVmIGxvYWRfbG9jYWxfcGF0aChjYW5kKToKICAgICIiIkxvYWQgb25lIHNjYW5uZWQgbW9kZWwgcmVjb3JkLiBSZXR1cm5zIFRydWUgb24gc3VjY2VzczsgdGhlIHByZWNpc2UKICAgIHJlYXNvbiBsYW5kcyBpbiBBSVsnbG9hZF9lcnJvciddIG9uIGZhaWx1cmUuIiIiCiAgICBBSVsibG9jYWwiXSA9IE5vbmUKICAgIEFJWyJsb2FkX2Vycm9yIl0gPSBOb25lCiAgICBpZiBjYW5kWyJraW5kIl0gPT0gImdndWYiOgogICAgICAgICMgdGhlIGJ1bmRsZWQgbGxhbWEuY3BwIHJ1bnRpbWUgbmVlZHMgbm90aGluZyBpbnN0YWxsZWQKICAgICAgICBzcGF3bmVkID0gTm9uZQogICAgICAgIHRyeToKICAgICAgICAgICAgc3Bhd25lZCA9IHNwYXduX2xsYW1hKGNhbmRbInBhdGgiXSkKICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgIEFJWyJsb2FkX2Vycm9yIl0gPSBmInJ1bnRpbWUgd291bGQgbm90IHN0YXJ0OiB7ZX0iCiAgICAgICAgICAgIHByaW50KCJbaW5rd2VsbF0iLCBBSVsibG9hZF9lcnJvciJdKQogICAgICAgIGlmIHNwYXduZWQ6CiAgICAgICAgICAgIEFJWyJsb2NhbCJdID0gc3Bhd25lZAogICAgICAgICAgICBBSVsibG9jYWxfa2luZCJdLCBBSVsibG9jYWxfbmFtZSJdID0gImdndWYtYnVuZGxlZCIsIGNhbmRbIm5hbWUiXQogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBydW5uaW5nIGxvY2FsIEdHVUYgdGhyb3VnaCB0aGUgYnVuZGxlZCBydW50aW1lOiB7Y2FuZFsnbmFtZSddfSIpCiAgICAgICAgICAgIHJldHVybiBUcnVlCiAgICAgICAgdHJ5OgogICAgICAgICAgICBmcm9tIGxsYW1hX2NwcCBpbXBvcnQgTGxhbWEKICAgICAgICBleGNlcHQgSW1wb3J0RXJyb3I6CiAgICAgICAgICAgIEFJWyJsb2FkX2Vycm9yIl0gPSAoIk5vIGxsYW1hLmNwcCBydW50aW1lIGFueXdoZXJlLiBUaGUgcGFja2FnZSBub3JtYWxseSBjYXJyaWVzIG9uZSAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgImluIGJpbi87IGlmIHRoaXMgcGFja2FnZSBsYWNrcyBpdCwgaW5zdGFsbCBvbmNlIHdpdGg6ICIKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAicGlwIGluc3RhbGwgbGxhbWEtY3BwLXB5dGhvbiIpCiAgICAgICAgICAgIHByaW50KCJbaW5rd2VsbF0gIiArIEFJWyJsb2FkX2Vycm9yIl0pCiAgICAgICAgICAgIHJldHVybiBGYWxzZQogICAgICAgIHRyeToKICAgICAgICAgICAgIyBmdWxsIEdQVSBvZmZsb2FkIGZpcnN0OyBhIENQVS1vbmx5IGJ1aWxkIHJlZnVzZXMgYW5kIHdlIHN0ZXAgZG93bgogICAgICAgICAgICB0cnk6CiAgICAgICAgICAgICAgICBBSVsibG9jYWwiXSA9IExsYW1hKG1vZGVsX3BhdGg9Y2FuZFsicGF0aCJdLCBuX2N0eD00MDk2LAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuX2dwdV9sYXllcnM9LTEsIHZlcmJvc2U9RmFsc2UpCiAgICAgICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBHUFUgb2ZmbG9hZCBhdCBmdWxsIHRpbHQgZm9yIHtjYW5kWyduYW1lJ119IikKICAgICAgICAgICAgZXhjZXB0IChUeXBlRXJyb3IsIFJ1bnRpbWVFcnJvciwgT1NFcnJvciwgVmFsdWVFcnJvcikgYXMgZToKICAgICAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIEdQVSBvZmZsb2FkIHJlZnVzZWQgKHtlfSk7IGZhbGxpbmcgYmFjayB0byBDUFUiKQogICAgICAgICAgICAgICAgQUlbImxvY2FsIl0gPSBMbGFtYShtb2RlbF9wYXRoPWNhbmRbInBhdGgiXSwgbl9jdHg9NDA5NiwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbl9ncHVfbGF5ZXJzPTAsIHZlcmJvc2U9RmFsc2UpCiAgICAgICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSB7Y2FuZFsnbmFtZSddfSBydW5uaW5nIG9uIENQVSIpCiAgICAgICAgICAgIEFJWyJsb2NhbF9raW5kIl0sIEFJWyJsb2NhbF9uYW1lIl0gPSAiZ2d1ZiIsIGNhbmRbIm5hbWUiXQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgQUlbImxvYWRfZXJyb3IiXSA9IGYie3R5cGUoZSkuX19uYW1lX199OiB7ZX0iCiAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIGNvdWxkIG5vdCBsb2FkIHtjYW5kWyduYW1lJ119OiB7ZX0iKQogICAgICAgICAgICByZXR1cm4gRmFsc2UKICAgIGVsaWYgY2FuZFsia2luZCJdID09ICJtbHgiOgogICAgICAgIHRyeToKICAgICAgICAgICAgZnJvbSBtbHhfbG0gaW1wb3J0IGxvYWQsIGdlbmVyYXRlIGFzIF9tbHhfZ2VuCiAgICAgICAgZXhjZXB0IEltcG9ydEVycm9yOgogICAgICAgICAgICBwcmludCgiW2lua3dlbGxdIG1seCBub3QgaW5zdGFsbGVkOyBydW46IHBpcCBpbnN0YWxsIG1seCBtbHgtbG0iKQogICAgICAgICAgICByZXR1cm4gRmFsc2UKICAgICAgICB0cnk6CiAgICAgICAgICAgIG1vZGVsLCB0b2sgPSBsb2FkKGNhbmRbInBhdGgiXSkKICAgICAgICAgICAgQUlbImxvY2FsIl0gPSAobW9kZWwsIHRvaywgX21seF9nZW4pCiAgICAgICAgICAgIEFJWyJsb2NhbF9raW5kIl0sIEFJWyJsb2NhbF9uYW1lIl0gPSAibWx4IiwgY2FuZFsibmFtZSJdCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBjb3VsZCBub3QgbG9hZCB7Y2FuZFsnbmFtZSddfToge2V9IikKICAgICAgICAgICAgcmV0dXJuIEZhbHNlCiAgICBlbHNlOgogICAgICAgIHJldHVybiBGYWxzZQogICAgcHJpbnQoZiJbaW5rd2VsbF0gcnVubmluZyBsb2NhbCB7QUlbJ2xvY2FsX2tpbmQnXS51cHBlcigpfSBtb2RlbDoge2NhbmRbJ25hbWUnXX0iKQogICAgcmV0dXJuIFRydWUKCgpkZWYgX2xvYWRfbG9jYWxfbW9kZWwoKToKICAgICIiIlRoZSBwZXJzaXN0ZWQgY2hvaWNlIGxvYWRzIGZpcnN0LCBhbHdheXM7IHRoZSByZXN0IGFyZSBmYWxsYmFja3MuIiIiCiAgICBjYW5kcyA9IHNjYW5fbG9jYWxfbW9kZWxzKCkKICAgIGlmIG5vdCBjYW5kczoKICAgICAgICByZXR1cm4gRmFsc2UKICAgIGFjdGl2ZSA9IGNvbmZfcmVhZCgpLmdldCgiYWN0aXZlIikKICAgIGlmIGFjdGl2ZToKICAgICAgICBjYW5kcy5zb3J0KGtleT1sYW1iZGEgYzogMCBpZiBjWyJuYW1lIl0gPT0gYWN0aXZlIGVsc2UgMSkKICAgIGZvciBjYW5kIGluIGNhbmRzOgogICAgICAgIGlmIGxvYWRfbG9jYWxfcGF0aChjYW5kKToKICAgICAgICAgICAgYyA9IGNvbmZfcmVhZCgpOyBjWyJhY3RpdmUiXSA9IGNhbmRbIm5hbWUiXTsgY29uZl93cml0ZShjKQogICAgICAgICAgICByZXR1cm4gVHJ1ZQogICAgcmV0dXJuIEZhbHNlCgoKZGVmIHVubG9hZF9sb2NhbCgpOgogICAgaWYgQUlbImxvY2FsX2tpbmQiXSBpbiAoImdndWYtYnVuZGxlZCIsKSBhbmQgQUkuZ2V0KCJsb2NhbCIpOgogICAgICAgIHRyeToKICAgICAgICAgICAgQUlbImxvY2FsIl1bMF0ua2lsbCgpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgcGFzcwogICAgQUlbImxvY2FsIl0gPSBOb25lCiAgICBBSVsibG9jYWxfa2luZCJdID0gQUlbImxvY2FsX25hbWUiXSA9IE5vbmUKICAgIGltcG9ydCBnYwogICAgZ2MuY29sbGVjdCgpCgoKZGVmIF9nZW5lcmF0ZV9sb2NhbChwcm9tcHQsIG1heF9uZXdfdG9rZW5zLCBzeXN0ZW09Tm9uZSwgdGVtcGVyYXR1cmU9MC4yKToKICAgICIiIkxvY2FsIG1vZGVsIGluZmVyZW5jZTsgc3lzdGVtIGlzIHRoZSBpbnN0cnVjdGlvbiwgcHJvbXB0IHRoZSB0ZXh0LiIiIgogICAgaWYgQUlbImxvY2FsX2tpbmQiXSA9PSAiZ2d1Zi1idW5kbGVkIjoKICAgICAgICByZXR1cm4gbGxhbWFfY2hhdChwcm9tcHQsIG1heF9uZXdfdG9rZW5zLCBzeXN0ZW0sIHRlbXBlcmF0dXJlKS5zdHJpcCgpCiAgICBpZiBBSVsibG9jYWxfa2luZCJdID09ICJnZ3VmIjoKICAgICAgICBvdXQgPSBBSVsibG9jYWwiXS5jcmVhdGVfY2hhdF9jb21wbGV0aW9uKAogICAgICAgICAgICBtZXNzYWdlcz1beyJyb2xlIjogInN5c3RlbSIsICJjb250ZW50Ijogc3lzdGVtIG9yICJZb3UgYXJlIElua3dlbGwuIn0sCiAgICAgICAgICAgICAgICAgICAgICB7InJvbGUiOiAidXNlciIsICJjb250ZW50IjogcHJvbXB0fV0sCiAgICAgICAgICAgIG1heF90b2tlbnM9bWF4X25ld190b2tlbnMsIHRlbXBlcmF0dXJlPXRlbXBlcmF0dXJlKQogICAgICAgIHJldHVybiBvdXRbImNob2ljZXMiXVswXVsibWVzc2FnZSJdWyJjb250ZW50Il0uc3RyaXAoKQogICAgaWYgQUlbImxvY2FsX2tpbmQiXSA9PSAibWx4IjoKICAgICAgICBtb2RlbCwgdG9rLCBtbHhfZ2VuID0gQUlbImxvY2FsIl0KICAgICAgICBtc2dzID0gW3sicm9sZSI6ICJzeXN0ZW0iLCAiY29udGVudCI6ICJZb3UgYXJlIElua3dlbGwuIn0sCiAgICAgICAgICAgICAgICB7InJvbGUiOiAidXNlciIsICJjb250ZW50IjogcHJvbXB0fV0KICAgICAgICB0cnk6CiAgICAgICAgICAgIHRleHQgPSB0b2suYXBwbHlfY2hhdF90ZW1wbGF0ZShtc2dzLCB0b2tlbml6ZT1GYWxzZSwgYWRkX2dlbmVyYXRpb25fcHJvbXB0PVRydWUpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgdGV4dCA9ICJZb3UgYXJlIElua3dlbGwuXG4iICsgcHJvbXB0ICsgIlxuIgogICAgICAgIHJldHVybiBtbHhfZ2VuKG1vZGVsLCB0b2ssIHByb21wdD10ZXh0LCBtYXhfdG9rZW5zPW1heF9uZXdfdG9rZW5zLCB0ZW1wPTAuMikuc3RyaXAoKQogICAgcmV0dXJuIE5vbmUKCgpkZWYgX2RldmljZSgpOgogICAgdHJ5OgogICAgICAgIGltcG9ydCB0b3JjaAogICAgICAgIGlmIHRvcmNoLmN1ZGEuaXNfYXZhaWxhYmxlKCk6CiAgICAgICAgICAgIHJldHVybiAiY3VkYSIKICAgICAgICBpZiBnZXRhdHRyKHRvcmNoLmJhY2tlbmRzLCAibXBzIiwgTm9uZSkgYW5kIHRvcmNoLmJhY2tlbmRzLm1wcy5pc19hdmFpbGFibGUoKToKICAgICAgICAgICAgcmV0dXJuICJtcHMiCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHBhc3MKICAgIHJldHVybiAiY3B1IgoKCmRlZiBfbG9hZF9tb2RlbHMoKToKICAgICIiIkxhenksIHRocmVhZC1zYWZlIG1vZGVsIGxvYWQuIFJ1bnMgaW4gYSBiYWNrZ3JvdW5kIHRocmVhZCBhdCBib290IHNvCiAgICAvYXBpL2hlYWx0aCBhbnN3ZXJzIGltbWVkaWF0ZWx5IGFuZCByZXBvcnRzIGFpPWZhbHNlIHVudGlsIHJlYWR5LiIiIgogICAgaWYgQUlbImxvYWRpbmciXSBvciBBSVsicmVhZHkiXToKICAgICAgICByZXR1cm4KICAgIHdpdGggX2FpX2xvY2s6CiAgICAgICAgaWYgQUlbImxvYWRpbmciXSBvciBBSVsicmVhZHkiXToKICAgICAgICAgICAgcmV0dXJuCiAgICAgICAgQUlbImxvYWRpbmciXSA9IFRydWUKICAgICAgICB0cnk6CiAgICAgICAgICAgIGlmIF9sb2FkX2xvY2FsX21vZGVsKCk6CiAgICAgICAgICAgICAgICAjIGEgbG9jYWwgR0dVRi9NTFggbW9kZWwgaXMgdGhlIGVuZ2luZTsgR0VDIHN0YXlzIGlmIGl0IGxvYWRzCiAgICAgICAgICAgICAgICBBSVsicmVhZHkiXSA9IFRydWUKICAgICAgICAgICAgICAgIEFJWyJwaXBlX2tpbmQiXSA9ICJsb2NhbCIKICAgICAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgICAgICBmcm9tIHRyYW5zZm9ybWVycyBpbXBvcnQgcGlwZWxpbmUKICAgICAgICAgICAgICAgICAgICBkZXYgPSBfZGV2aWNlKCkKICAgICAgICAgICAgICAgICAgICBBSVsiZ2VjIl0gPSBwaXBlbGluZSgidGV4dDJ0ZXh0LWdlbmVyYXRpb24iLCBHRUNfTU9ERUwsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGV2aWNlPTAgaWYgZGV2ID09ICJjdWRhIiBlbHNlIC0xKQogICAgICAgICAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgICAgICAgICBwYXNzCiAgICAgICAgICAgICAgICBwcmludCgiW2lua3dlbGxdIGxvY2FsIG1vZGVsIHJlYWR5IikKICAgICAgICAgICAgICAgIEFJWyJsb2FkaW5nIl0gPSBGYWxzZQogICAgICAgICAgICAgICAgcmV0dXJuCiAgICAgICAgICAgIGZyb20gdHJhbnNmb3JtZXJzIGltcG9ydCBwaXBlbGluZQogICAgICAgICAgICBkZXYgPSBfZGV2aWNlKCkKICAgICAgICAgICAgY2F1c2FsID0gX2lzX2NhdXNhbF9sbShJTlNUUlVDVF9NT0RFTCkKICAgICAgICAgICAgdGFzayA9ICJ0ZXh0LWdlbmVyYXRpb24iIGlmIGNhdXNhbCBlbHNlICJ0ZXh0MnRleHQtZ2VuZXJhdGlvbiIKICAgICAgICAgICAgQUlbInBpcGVfa2luZCJdID0gInRleHRnZW4iIGlmIGNhdXNhbCBlbHNlICJ0ZXh0MnRleHQiCiAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIGxvYWRpbmcge0lOU1RSVUNUX01PREVMfSBvbiB7ZGV2fSAoe3Rhc2t9KSDigKYiKQogICAgICAgICAgICBwaXBlX2t3YXJncyA9IHsiZGV2aWNlIjogMCBpZiBkZXYgPT0gImN1ZGEiIGVsc2UgLTF9CiAgICAgICAgICAgIGlmIGNhdXNhbDoKICAgICAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgICAgICBpbXBvcnQgdG9yY2gKICAgICAgICAgICAgICAgICAgICBwaXBlX2t3YXJnc1sidG9yY2hfZHR5cGUiXSA9IHRvcmNoLmZsb2F0MTYgaWYgZGV2ID09ICJjdWRhIiBlbHNlIHRvcmNoLmZsb2F0MzIKICAgICAgICAgICAgICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgICAgICAgICAgICAgcGFzcwogICAgICAgICAgICBBSVsicGlwZSJdID0gcGlwZWxpbmUodGFzaywgSU5TVFJVQ1RfTU9ERUwsICoqcGlwZV9rd2FyZ3MpCiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIEFJWyJnZWMiXSA9IHBpcGVsaW5lKAogICAgICAgICAgICAgICAgICAgICJ0ZXh0MnRleHQtZ2VuZXJhdGlvbiIsIEdFQ19NT0RFTCwKICAgICAgICAgICAgICAgICAgICBkZXZpY2U9MCBpZiBkZXYgPT0gImN1ZGEiIGVsc2UgLTEpCiAgICAgICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBsb2FkZWQge0dFQ19NT0RFTH0iKQogICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBHRUMgbW9kZWwgdW5hdmFpbGFibGUgKHtlfSk7IHVzaW5nIGluc3RydWN0IG1vZGVsIGZvciBncmFtbWFyIikKICAgICAgICAgICAgQUlbInJlYWR5Il0gPSBUcnVlCiAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIG1vZGVscyByZWFkeSAoe0FJWydwaXBlX2tpbmQnXX0pIikKICAgICAgICBleGNlcHQgSW1wb3J0RXJyb3I6CiAgICAgICAgICAgIHByaW50KCJbaW5rd2VsbF0gdHJhbnNmb3JtZXJzIG5vdCBpbnN0YWxsZWQ7IGhldXJpc3RpYyBtb2RlLiAiCiAgICAgICAgICAgICAgICAgICJwaXAgaW5zdGFsbCB0cmFuc2Zvcm1lcnMgdG9yY2ggZm9yIEFJIHF1YWxpdHkuIikKICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIG1vZGVsIGxvYWQgZmFpbGVkOiB7ZX07IGhldXJpc3RpYyBtb2RlLiIpCiAgICAgICAgZmluYWxseToKICAgICAgICAgICAgQUlbImxvYWRpbmciXSA9IEZhbHNlCgoKZGVmIGdlbmVyYXRlKHByb21wdCwgbWF4X25ld190b2tlbnM9NDIwLCBzeXN0ZW09Tm9uZSwgdGVtcGVyYXR1cmU9MC4yKToKICAgICIiIk9uZSBjYWxsIGludG8gdGhlIGFjdGl2ZSBpbnN0cnVjdCBlbmdpbmU7IE5vbmUgaWYgQUkgdW5hdmFpbGFibGUuIiIiCiAgICBpZiBub3QgQUlbInJlYWR5Il06CiAgICAgICAgcmV0dXJuIE5vbmUKICAgIGlmIEFJLmdldCgibG9jYWwiKToKICAgICAgICB0cnk6CiAgICAgICAgICAgIHJldHVybiBfZ2VuZXJhdGVfbG9jYWwocHJvbXB0LCBtYXhfbmV3X3Rva2Vucywgc3lzdGVtLCB0ZW1wZXJhdHVyZSkKICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIGxvY2FsIGdlbmVyYXRpb24gZXJyb3I6IHtlfSIpCiAgICAgICAgICAgIHJldHVybiBOb25lCiAgICBpZiBBSVsicGlwZSJdIGlzIE5vbmU6CiAgICAgICAgcmV0dXJuIE5vbmUKICAgIHRyeToKICAgICAgICBpZiBBSS5nZXQoInBpcGVfa2luZCIpID09ICJ0ZXh0Z2VuIjoKICAgICAgICAgICAgIyBDYXVzYWwgTE0gKFF3ZW4sIFBoaSwgZXRjLik6IHVzZSBjaGF0LXRlbXBsYXRlIG1lc3NhZ2VzIGZvcm1hdC4KICAgICAgICAgICAgIyBUaGUgcGlwZWxpbmUgYXBwbGllcyB0aGUgdG9rZW5pemVyJ3MgY2hhdCB0ZW1wbGF0ZSBhdXRvbWF0aWNhbGx5CiAgICAgICAgICAgICMgd2hlbiBpdCByZWNlaXZlcyBhIGxpc3Qgb2YgbWVzc2FnZSBkaWN0cy4KICAgICAgICAgICAgbWVzc2FnZXMgPSBbCiAgICAgICAgICAgICAgICB7InJvbGUiOiAic3lzdGVtIiwgImNvbnRlbnQiOiAiWW91IGFyZSBJbmt3ZWxsLCBhbiBhY2FkZW1pYyB3cml0aW5nIGFzc2lzdGFudC4gIgogICAgICAgICAgICAgICAgICJGb2xsb3cgdGhlIHVzZXIncyBpbnN0cnVjdGlvbnMgcHJlY2lzZWx5LiBQcmVzZXJ2ZSB0aGUgd3JpdGVyJ3Mgdm9pY2UuICIKICAgICAgICAgICAgICAgICAiTmV2ZXIgZmFicmljYXRlIGNpdGF0aW9ucywgc3RhdGlzdGljcywgb3IgZmFjdHMuIn0sCiAgICAgICAgICAgICAgICB7InJvbGUiOiAidXNlciIsICJjb250ZW50IjogcHJvbXB0fQogICAgICAgICAgICBdCiAgICAgICAgICAgIG91dCA9IEFJWyJwaXBlIl0obWVzc2FnZXMsIG1heF9uZXdfdG9rZW5zPW1heF9uZXdfdG9rZW5zLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvX3NhbXBsZT1GYWxzZSwgcmVwZXRpdGlvbl9wZW5hbHR5PTEuMDUsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGVyYXR1cmU9MC4zLCByZXR1cm5fZnVsbF90ZXh0PUZhbHNlKQogICAgICAgICAgICBnZW4gPSBvdXRbMF0uZ2V0KCJnZW5lcmF0ZWRfdGV4dCIsICIiKQogICAgICAgICAgICAjIFRoZSBwaXBlbGluZSByZXR1cm5zIGEgbGlzdCBvZiBtZXNzYWdlIGRpY3RzOyBleHRyYWN0IHRoZSBsYXN0IG9uZS4KICAgICAgICAgICAgaWYgaXNpbnN0YW5jZShnZW4sIGxpc3QpIGFuZCBsZW4oZ2VuKSA+IDA6CiAgICAgICAgICAgICAgICBsYXN0ID0gZ2VuWy0xXQogICAgICAgICAgICAgICAgaWYgaXNpbnN0YW5jZShsYXN0LCBkaWN0KSBhbmQgImNvbnRlbnQiIGluIGxhc3Q6CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGxhc3RbImNvbnRlbnQiXS5zdHJpcCgpCiAgICAgICAgICAgICAgICByZXR1cm4gc3RyKGxhc3QpLnN0cmlwKCkKICAgICAgICAgICAgaWYgaXNpbnN0YW5jZShnZW4sIGRpY3QpIGFuZCAiY29udGVudCIgaW4gZ2VuOgogICAgICAgICAgICAgICAgcmV0dXJuIGdlblsiY29udGVudCJdLnN0cmlwKCkKICAgICAgICAgICAgIyBGYWxsYmFjazogdHJlYXQgYXMgcGxhaW4gdGV4dCAob2xkZXIgdHJhbnNmb3JtZXJzIHZlcnNpb25zKQogICAgICAgICAgICB0ZXh0ID0gc3RyKGdlbikuc3RyaXAoKQogICAgICAgICAgICAjIFN0cmlwIGFueSBlY2hvIG9mIHRoZSBwcm9tcHQgaWYgcmV0dXJuX2Z1bGxfdGV4dCB3YXMgaWdub3JlZAogICAgICAgICAgICBpZiBwcm9tcHQgaW4gdGV4dDoKICAgICAgICAgICAgICAgIHRleHQgPSB0ZXh0W2xlbihwcm9tcHQpOl0uc3RyaXAoKQogICAgICAgICAgICByZXR1cm4gdGV4dAogICAgICAgIGVsc2U6CiAgICAgICAgICAgICMgU2VxMnNlcSAoVDUsIEJBUlQsIGZsYW4tVDUpOiBwbGFpbiB0ZXh0IGluLCBwbGFpbiB0ZXh0IG91dC4KICAgICAgICAgICAgb3V0ID0gQUlbInBpcGUiXShwcm9tcHQsIG1heF9uZXdfdG9rZW5zPW1heF9uZXdfdG9rZW5zLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvX3NhbXBsZT1GYWxzZSwgcmVwZXRpdGlvbl9wZW5hbHR5PTEuMTUpCiAgICAgICAgICAgIHJldHVybiBvdXRbMF0uZ2V0KCJnZW5lcmF0ZWRfdGV4dCIsICIiKS5zdHJpcCgpCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gZ2VuZXJhdGlvbiBlcnJvcjoge2V9IikKICAgICAgICByZXR1cm4gTm9uZQoKCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBzcGVlY2ggdG8gdGV4dAojIFdoaXNwZXIgZm9yIG9mZmxpbmUgdHJhbnNjcmlwdGlvbi4gTG9hZGVkIGxhemlseSAob3Igd2FybWVkIHdoZW4gU2NyaWJhCiMgb3BlbnMpIHNvIGl0IG5ldmVyIHNsb3dzIGJvb3QgYW5kIG5ldmVyIGRvd25sb2FkcyB1bmxlc3MgdGhlIHVzZXIgbmVlZHMgaXQuCiMKIyB2Mi4xMTogU2NyaWJhIHNlbmRzIDE2IGtIeiBtb25vIDE2LWJpdCBXQVYuIFRoZSBXQVYgaXMgZGVjb2RlZCBoZXJlIHdpdGggdGhlCiMgc3RhbmRhcmQgbGlicmFyeSBhbmQgaGFuZGVkIHRvIHRoZSBwaXBlbGluZSBhcyBhIHJhdyBhcnJheSwgc28gdHJhbnNjcmlwdGlvbgojIG5lZWRzIG5laXRoZXIgZmZtcGVnIG5vciB0b3JjaGF1ZGlvLiBMb25nIGF1ZGlvIGlzIGN1dCBhdCBuYXR1cmFsIHBhdXNlcyBpbnRvCiMgcGllY2VzIHVuZGVyIDMwIHNlY29uZHMgKFdoaXNwZXIncyB3aW5kb3cpLCBzbyBldmVyeSB0cmFuc2Zvcm1lcnMgdmVyc2lvbgojIGJlaGF2ZXMgdGhlIHNhbWUgd2F5LgpTVFRfTU9ERUwgPSBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9TVFRfTU9ERUwiLCAib3BlbmFpL3doaXNwZXItdGlueSIpClNUVF9SQVRFID0gMTYwMDAKX3N0dF9sb2NrID0gdGhyZWFkaW5nLkxvY2soKSAgICAgICMgZ3VhcmRzIGxvYWRpbmcKX3N0dF9ydW5fbG9jayA9IHRocmVhZGluZy5Mb2NrKCkgICMgb25lIHRyYW5zY3JpcHRpb24gYXQgYSB0aW1lOyB0aGUgcGlwZWxpbmUgaXMgbm90IHRocmVhZC1zYWZlCl9TVFRfU1RBVEUgPSB7ImxvYWRpbmciOiBGYWxzZSwgImVycm9yIjogTm9uZX0KCgpkZWYgX3N0dF9hdmFpbGFibGUoKToKICAgICIiIlRydWUgd2hlbiB0aGUgbGlicmFyaWVzIFdoaXNwZXIgbmVlZHMgYXJlIGluc3RhbGxlZCAobm90IG5lY2Vzc2FyaWx5IGxvYWRlZCkuIiIiCiAgICB0cnk6CiAgICAgICAgaW1wb3J0IGltcG9ydGxpYi51dGlsIGFzIF9pdQogICAgICAgIHJldHVybiBib29sKF9pdS5maW5kX3NwZWMoInRyYW5zZm9ybWVycyIpKSBhbmQgYm9vbChfaXUuZmluZF9zcGVjKCJudW1weSIpKSBcCiAgICAgICAgICAgIGFuZCBib29sKF9pdS5maW5kX3NwZWMoInRvcmNoIikpCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHJldHVybiBGYWxzZQoKCmRlZiBfbG9hZF9zdHQoKToKICAgICIiIkxhenktbG9hZCB0aGUgV2hpc3BlciBwaXBlbGluZSBmb3Igc3BlZWNoLXRvLXRleHQuIiIiCiAgICB3aXRoIF9zdHRfbG9jazoKICAgICAgICBpZiBBSS5nZXQoInN0dCIpOgogICAgICAgICAgICByZXR1cm4gQUlbInN0dCJdCiAgICAgICAgX1NUVF9TVEFURVsibG9hZGluZyJdID0gVHJ1ZQogICAgICAgIHRyeToKICAgICAgICAgICAgZnJvbSB0cmFuc2Zvcm1lcnMgaW1wb3J0IHBpcGVsaW5lCiAgICAgICAgICAgIGRldiA9IF9kZXZpY2UoKQogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBsb2FkaW5nIFdoaXNwZXIgKHtTVFRfTU9ERUx9KSBvbiB7ZGV2fSBmb3IgdHJhbnNjcmlwdGlvbiIpCiAgICAgICAgICAgIEFJWyJzdHQiXSA9IHBpcGVsaW5lKCJhdXRvbWF0aWMtc3BlZWNoLXJlY29nbml0aW9uIiwgU1RUX01PREVMLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXZpY2U9MCBpZiBkZXYgPT0gImN1ZGEiIGVsc2UgLTEpCiAgICAgICAgICAgIF9TVFRfU1RBVEVbImVycm9yIl0gPSBOb25lCiAgICAgICAgICAgIHByaW50KCJbaW5rd2VsbF0gV2hpc3BlciByZWFkeSBmb3IgdHJhbnNjcmlwdGlvbiIpCiAgICAgICAgICAgIHJldHVybiBBSVsic3R0Il0KICAgICAgICBleGNlcHQgSW1wb3J0RXJyb3I6CiAgICAgICAgICAgIF9TVFRfU1RBVEVbImVycm9yIl0gPSAidHJhbnNmb3JtZXJzLCB0b3JjaCBhbmQgbnVtcHkgYXJlIG5vdCBpbnN0YWxsZWQiCiAgICAgICAgICAgIHByaW50KCJbaW5rd2VsbF0gdHJhbnNmb3JtZXJzIG5vdCBpbnN0YWxsZWQ7IHRyYW5zY3JpcHRpb24gdW5hdmFpbGFibGUuICIKICAgICAgICAgICAgICAgICAgInBpcCBpbnN0YWxsIHRyYW5zZm9ybWVycyB0b3JjaCIpCiAgICAgICAgICAgIHJldHVybiBOb25lCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgICAgICBfU1RUX1NUQVRFWyJlcnJvciJdID0gZiJ7dHlwZShlKS5fX25hbWVfX306IHtlfSIKICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gV2hpc3BlciBsb2FkIGZhaWxlZDoge2V9IikKICAgICAgICAgICAgcmV0dXJuIE5vbmUKICAgICAgICBmaW5hbGx5OgogICAgICAgICAgICBfU1RUX1NUQVRFWyJsb2FkaW5nIl0gPSBGYWxzZQoKCmRlZiBfZGVjb2RlX3dhdihhdWRpb19ieXRlcyk6CiAgICAiIiJXQVYgYnl0ZXMgLT4gKG1vbm8gZmxvYXQzMiBudW1weSBhcnJheSBpbiBbLTEsIDFdLCBzYW1wbGUgcmF0ZSkuCiAgICBTdXBwb3J0cyA4LCAxNiwgMjQgYW5kIDMyLWJpdCBpbnRlZ2VyIFBDTS4gUmFpc2VzIFZhbHVlRXJyb3Igb3RoZXJ3aXNlLiIiIgogICAgaW1wb3J0IGlvCiAgICBpbXBvcnQgd2F2ZQogICAgaW1wb3J0IG51bXB5IGFzIG5wCiAgICB0cnk6CiAgICAgICAgd2l0aCB3YXZlLm9wZW4oaW8uQnl0ZXNJTyhhdWRpb19ieXRlcyksICJyYiIpIGFzIHc6CiAgICAgICAgICAgIGNoLCB3aWR0aCwgcmF0ZSwgbiA9IHcuZ2V0bmNoYW5uZWxzKCksIHcuZ2V0c2FtcHdpZHRoKCksIHcuZ2V0ZnJhbWVyYXRlKCksIHcuZ2V0bmZyYW1lcygpCiAgICAgICAgICAgIHJhdyA9IHcucmVhZGZyYW1lcyhuKQogICAgZXhjZXB0IHdhdmUuRXJyb3IgYXMgZToKICAgICAgICByYWlzZSBWYWx1ZUVycm9yKGYidW5yZWFkYWJsZSBXQVYgKHtlfSkiKQogICAgaWYgd2lkdGggPT0gMToKICAgICAgICBhID0gKG5wLmZyb21idWZmZXIocmF3LCBkdHlwZT1ucC51aW50OCkuYXN0eXBlKG5wLmZsb2F0MzIpIC0gMTI4LjApIC8gMTI4LjAKICAgIGVsaWYgd2lkdGggPT0gMjoKICAgICAgICBhID0gbnAuZnJvbWJ1ZmZlcihyYXcsIGR0eXBlPSI8aTIiKS5hc3R5cGUobnAuZmxvYXQzMikgLyAzMjc2OC4wCiAgICBlbGlmIHdpZHRoID09IDM6CiAgICAgICAgYiA9IG5wLmZyb21idWZmZXIocmF3LCBkdHlwZT1ucC51aW50OCkucmVzaGFwZSgtMSwgMykuYXN0eXBlKG5wLmludDMyKQogICAgICAgIHYgPSBiWzosIDBdIHwgKGJbOiwgMV0gPDwgOCkgfCAoYls6LCAyXSA8PCAxNikKICAgICAgICB2ID0gbnAud2hlcmUodiA+PSAoMSA8PCAyMyksIHYgLSAoMSA8PCAyNCksIHYpCiAgICAgICAgYSA9IHYuYXN0eXBlKG5wLmZsb2F0MzIpIC8gZmxvYXQoMSA8PCAyMykKICAgIGVsaWYgd2lkdGggPT0gNDoKICAgICAgICBhID0gbnAuZnJvbWJ1ZmZlcihyYXcsIGR0eXBlPSI8aTQiKS5hc3R5cGUobnAuZmxvYXQzMikgLyAyMTQ3NDgzNjQ4LjAKICAgIGVsc2U6CiAgICAgICAgcmFpc2UgVmFsdWVFcnJvcihmInVuc3VwcG9ydGVkIHNhbXBsZSB3aWR0aCB7d2lkdGh9IikKICAgIGlmIGNoID4gMToKICAgICAgICBhID0gYVs6IChsZW4oYSkgLy8gY2gpICogY2hdLnJlc2hhcGUoLTEsIGNoKS5tZWFuKGF4aXM9MSkKICAgIHJldHVybiBhLmFzdHlwZShucC5mbG9hdDMyKSwgaW50KHJhdGUpCgoKZGVmIF9yZXNhbXBsZShhLCByYXRlLCB0YXJnZXQ9U1RUX1JBVEUpOgogICAgIiIiTGluZWFyIHJlc2FtcGxpbmc7IGFkZXF1YXRlIGZvciBzcGVlY2ggYW5kIGRlcGVuZGVuY3ktZnJlZS4iIiIKICAgIGltcG9ydCBudW1weSBhcyBucAogICAgaWYgcmF0ZSA9PSB0YXJnZXQgb3IgbGVuKGEpID09IDA6CiAgICAgICAgcmV0dXJuIGEuYXN0eXBlKG5wLmZsb2F0MzIpCiAgICBuX291dCA9IGludChyb3VuZChsZW4oYSkgKiBmbG9hdCh0YXJnZXQpIC8gZmxvYXQocmF0ZSkpKQogICAgaWYgbl9vdXQgPD0gMToKICAgICAgICByZXR1cm4gbnAuemVyb3MoMCwgZHR5cGU9bnAuZmxvYXQzMikKICAgIHhfb2xkID0gbnAuYXJhbmdlKGxlbihhKSwgZHR5cGU9bnAuZmxvYXQ2NCkgLyBmbG9hdChyYXRlKQogICAgeF9uZXcgPSBucC5hcmFuZ2Uobl9vdXQsIGR0eXBlPW5wLmZsb2F0NjQpIC8gZmxvYXQodGFyZ2V0KQogICAgcmV0dXJuIG5wLmludGVycCh4X25ldywgeF9vbGQsIGEpLmFzdHlwZShucC5mbG9hdDMyKQoKCmRlZiBfZnJhbWVfcm1zKGEsIHJhdGUsIGZyYW1lX3M9MC4wMik6CiAgICBpbXBvcnQgbnVtcHkgYXMgbnAKICAgIGYgPSBtYXgoMSwgaW50KHJhdGUgKiBmcmFtZV9zKSkKICAgIG4gPSBsZW4oYSkgLy8gZgogICAgaWYgbiA9PSAwOgogICAgICAgIHJldHVybiBucC56ZXJvcygwLCBkdHlwZT1ucC5mbG9hdDMyKSwgZgogICAgZnIgPSBhWzogbiAqIGZdLnJlc2hhcGUobiwgZikKICAgIHJldHVybiBucC5zcXJ0KChmci5hc3R5cGUobnAuZmxvYXQ2NCkgKiogMikubWVhbihheGlzPTEpKS5hc3R5cGUobnAuZmxvYXQzMiksIGYKCgpkZWYgX3NwbGl0X29uX3NpbGVuY2UoYSwgcmF0ZSwgbWF4X3M9MjguMCwgbWluX3M9MTAuMCk6CiAgICAiIiJDdXQgYXVkaW8gaW50byBwaWVjZXMgbm8gbG9uZ2VyIHRoYW4gbWF4X3MsIGVhY2ggY3V0IHBsYWNlZCBhdCB0aGUKICAgIHF1aWV0ZXN0IDIwIG1zIGZyYW1lIGJldHdlZW4gbWluX3MgYW5kIG1heF9zIGludG8gdGhlIHBpZWNlLiBSZXR1cm5zIGEKICAgIGxpc3Qgb2YgYXJyYXlzIHRoYXQgdG9nZXRoZXIgY29udGFpbiBldmVyeSBzYW1wbGUgZXhhY3RseSBvbmNlLiIiIgogICAgbWF4X24gPSBpbnQobWF4X3MgKiByYXRlKQogICAgaWYgbGVuKGEpIDw9IG1heF9uOgogICAgICAgIHJldHVybiBbYV0KICAgIHJtcywgZiA9IF9mcmFtZV9ybXMoYSwgcmF0ZSkKICAgIG91dCwgc3RhcnQgPSBbXSwgMAogICAgd2hpbGUgbGVuKGEpIC0gc3RhcnQgPiBtYXhfbjoKICAgICAgICBsbyA9IChzdGFydCArIGludChtaW5fcyAqIHJhdGUpKSAvLyBmCiAgICAgICAgaGkgPSAoc3RhcnQgKyBtYXhfbikgLy8gZgogICAgICAgIGhpID0gbWluKGhpLCBsZW4ocm1zKSkKICAgICAgICBpZiBoaSA8PSBsbzoKICAgICAgICAgICAgY3V0ID0gc3RhcnQgKyBtYXhfbgogICAgICAgIGVsc2U6CiAgICAgICAgICAgICMgdGhlIHF1aWV0ZXN0IGZyYW1lIHdpbnM7IGFtb25nIG5lYXItdGllcyB0aGUgTEFURVNUIGlzIHRha2VuLCBzbwogICAgICAgICAgICAjIHBpZWNlcyBzdGF5IGxvbmcgKG1vcmUgY29udGV4dCBmb3IgV2hpc3BlciwgZmV3ZXIgc2VhbXMpCiAgICAgICAgICAgIHdpbiA9IHJtc1tsbzpoaV0KICAgICAgICAgICAgZmxvb3IgPSBmbG9hdCh3aW4ubWluKCkpCiAgICAgICAgICAgIHF1aWV0ID0gKHdpbiA8PSBmbG9vciAqIDEuNSArIDFlLTQpLm5vbnplcm8oKVswXQogICAgICAgICAgICBrID0gbG8gKyBpbnQocXVpZXRbLTFdKQogICAgICAgICAgICBjdXQgPSBrICogZiArIGYgLy8gMgogICAgICAgIGN1dCA9IG1heChzdGFydCArIDEsIG1pbihjdXQsIHN0YXJ0ICsgbWF4X24pKQogICAgICAgIG91dC5hcHBlbmQoYVtzdGFydDpjdXRdKQogICAgICAgIHN0YXJ0ID0gY3V0CiAgICBvdXQuYXBwZW5kKGFbc3RhcnQ6XSkKICAgIHJldHVybiBbeCBmb3IgeCBpbiBvdXQgaWYgbGVuKHgpXQoKCiMgYmVsb3cgdGhpcyBsb3VkbmVzcyBhIHBpZWNlIGlzIHRyZWF0ZWQgYXMgc2lsZW5jZSBhbmQgbm90IHRyYW5zY3JpYmVkOwojIFdoaXNwZXIgaW52ZW50cyB3b3JkcyAoIlRoYW5rIHlvdS4iKSB3aGVuIGhhbmRlZCBzaWxlbmNlCl9TSUxFTkNFX1JNUyA9IDAuMDA2CgoKZGVmIHRyYW5zY3JpYmVfYXVkaW8oYXVkaW9fYnl0ZXMsIGxhbmd1YWdlPU5vbmUpOgogICAgIiIiVHJhbnNjcmliZSBhdWRpbyBieXRlcyB0byB0ZXh0LiBSZXR1cm5zICh0ZXh0LCBlcnJvciwgaW5mbykuCiAgICBXQVYgaXMgZGVjb2RlZCBoZXJlIChubyBmZm1wZWcgbmVlZGVkKS4gT3RoZXIgZm9ybWF0cyBhcmUgYWNjZXB0ZWQgb25seQogICAgd2hlbiBmZm1wZWcgaXMgaW5zdGFsbGVkLCBiZWNhdXNlIHRoZSBwaXBlbGluZSBuZWVkcyBpdCB0byBkZWNvZGUgdGhlbS4iIiIKICAgIGluZm8gPSB7fQogICAgaXNfd2F2ID0gYXVkaW9fYnl0ZXNbOjRdID09IGIiUklGRiIgYW5kIGF1ZGlvX2J5dGVzWzg6MTJdID09IGIiV0FWRSIKICAgIGlmIG5vdCBpc193YXYgYW5kIG5vdCBzaHV0aWwud2hpY2goImZmbXBlZyIpOgogICAgICAgIHJldHVybiBOb25lLCAoIlRoaXMgcmVjb3JkaW5nIGlzIG5vdCBXQVYsIGFuZCBkZWNvZGluZyBpdCBuZWVkcyBmZm1wZWcsIHdoaWNoIGlzIG5vdCAiCiAgICAgICAgICAgICAgICAgICAgICAiaW5zdGFsbGVkLiBVcGRhdGUgSW5rd2VsbDogU2NyaWJhIG5vdyBzZW5kcyBXQVYuIiksIGluZm8KICAgIGlmIGlzX3dhdjoKICAgICAgICB0cnk6CiAgICAgICAgICAgIGF1ZGlvLCByYXRlID0gX2RlY29kZV93YXYoYXVkaW9fYnl0ZXMpCiAgICAgICAgZXhjZXB0IEltcG9ydEVycm9yOgogICAgICAgICAgICByZXR1cm4gTm9uZSwgIm51bXB5IGlzIG5vdCBpbnN0YWxsZWQuIEluc3RhbGwgdGhlIEFJIGJhY2tlbmQ6IHBpcCBpbnN0YWxsIHRyYW5zZm9ybWVycyB0b3JjaCIsIGluZm8KICAgICAgICBleGNlcHQgVmFsdWVFcnJvciBhcyBlOgogICAgICAgICAgICByZXR1cm4gTm9uZSwgZiJUaGUgYXVkaW8gY291bGQgbm90IGJlIHJlYWQ6IHtlfSIsIGluZm8KICAgICAgICBhdWRpbyA9IF9yZXNhbXBsZShhdWRpbywgcmF0ZSkKICAgICAgICBpbmZvWyJzZWNvbmRzIl0gPSByb3VuZChsZW4oYXVkaW8pIC8gZmxvYXQoU1RUX1JBVEUpLCAyKQogICAgICAgIGluZm9bInJhdGVfaW4iXSA9IHJhdGUKICAgIHBpcGUgPSBfbG9hZF9zdHQoKQogICAgaWYgcGlwZSBpcyBOb25lOgogICAgICAgIHdoeSA9IF9TVFRfU1RBVEUuZ2V0KCJlcnJvciIpIG9yICJ1bmtub3duIHJlYXNvbiIKICAgICAgICByZXR1cm4gTm9uZSwgKCJUaGUgdHJhbnNjcmlwdGlvbiBtb2RlbCBpcyB1bmF2YWlsYWJsZSAoIiArIHdoeSArICIpLiAiCiAgICAgICAgICAgICAgICAgICAgICAiSW5zdGFsbCB0aGUgQUkgYmFja2VuZCBvbmNlIHdpdGg6IHBpcCBpbnN0YWxsIHRyYW5zZm9ybWVycyB0b3JjaCIpLCBpbmZvCiAgICBnZW4gPSB7fQogICAgaWYgIi5lbiIgbm90IGluIFNUVF9NT0RFTDogICMgRW5nbGlzaC1vbmx5IGNoZWNrcG9pbnRzIHJlZnVzZSBsYW5ndWFnZS90YXNrCiAgICAgICAgZ2VuWyJ0YXNrIl0gPSAidHJhbnNjcmliZSIKICAgICAgICBpZiBsYW5ndWFnZToKICAgICAgICAgICAgZ2VuWyJsYW5ndWFnZSJdID0gbGFuZ3VhZ2UKICAgIHRyeToKICAgICAgICB3aXRoIF9zdHRfcnVuX2xvY2s6CiAgICAgICAgICAgIGlmIG5vdCBpc193YXY6CiAgICAgICAgICAgICAgICByZXN1bHQgPSBwaXBlKGF1ZGlvX2J5dGVzLCBnZW5lcmF0ZV9rd2FyZ3M9Z2VuKSBpZiBnZW4gZWxzZSBwaXBlKGF1ZGlvX2J5dGVzKQogICAgICAgICAgICAgICAgcmV0dXJuIChyZXN1bHQuZ2V0KCJ0ZXh0IiwgIiIpIGlmIHJlc3VsdCBlbHNlICIiKS5zdHJpcCgpLCBOb25lLCBpbmZvCiAgICAgICAgICAgIHBpZWNlcyA9IF9zcGxpdF9vbl9zaWxlbmNlKGF1ZGlvLCBTVFRfUkFURSkKICAgICAgICAgICAgaW5mb1sicGllY2VzIl0gPSBsZW4ocGllY2VzKQogICAgICAgICAgICB0ZXh0cywgc2tpcHBlZCA9IFtdLCAwCiAgICAgICAgICAgIGZvciBwaWVjZSBpbiBwaWVjZXM6CiAgICAgICAgICAgICAgICBybXMsIF8gPSBfZnJhbWVfcm1zKHBpZWNlLCBTVFRfUkFURSkKICAgICAgICAgICAgICAgIGlmIGxlbihybXMpID09IDAgb3IgZmxvYXQocm1zLm1heCgpKSA8IF9TSUxFTkNFX1JNUzoKICAgICAgICAgICAgICAgICAgICBza2lwcGVkICs9IDEKICAgICAgICAgICAgICAgICAgICBjb250aW51ZQogICAgICAgICAgICAgICAgaW5wID0geyJyYXciOiBwaWVjZSwgInNhbXBsaW5nX3JhdGUiOiBTVFRfUkFURX0KICAgICAgICAgICAgICAgIHJlc3VsdCA9IHBpcGUoaW5wLCBnZW5lcmF0ZV9rd2FyZ3M9Z2VuKSBpZiBnZW4gZWxzZSBwaXBlKGlucCkKICAgICAgICAgICAgICAgIHQgPSAocmVzdWx0LmdldCgidGV4dCIsICIiKSBpZiByZXN1bHQgZWxzZSAiIikuc3RyaXAoKQogICAgICAgICAgICAgICAgaWYgdDoKICAgICAgICAgICAgICAgICAgICB0ZXh0cy5hcHBlbmQodCkKICAgICAgICAgICAgaW5mb1sic2lsZW50X3BpZWNlcyJdID0gc2tpcHBlZAogICAgICAgICAgICByZXR1cm4gIiAiLmpvaW4odGV4dHMpLnN0cmlwKCksIE5vbmUsIGluZm8KICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICByZXR1cm4gTm9uZSwgZiJUcmFuc2NyaXB0aW9uIGVycm9yOiB7dHlwZShlKS5fX25hbWVfX306IHtlfSIsIGluZm8KCgpkZWYgZXBfc3R0X3dhcm0oX2JvZHkpOgogICAgIiIiU3RhcnQgbG9hZGluZyBXaGlzcGVyIGluIHRoZSBiYWNrZ3JvdW5kIHNvIHRoZSBmaXJzdCBkaWN0YXRpb24gaXMgcXVpY2suIiIiCiAgICBpZiBub3QgQUkuZ2V0KCJzdHQiKSBhbmQgbm90IF9TVFRfU1RBVEVbImxvYWRpbmciXSBhbmQgX3N0dF9hdmFpbGFibGUoKToKICAgICAgICB0aHJlYWRpbmcuVGhyZWFkKHRhcmdldD1fbG9hZF9zdHQsIGRhZW1vbj1UcnVlKS5zdGFydCgpCiAgICAgICAgcmV0dXJuIHsib2siOiBUcnVlLCAic3R0X2xvYWRpbmciOiBUcnVlfQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAic3R0X2xvYWRpbmciOiBib29sKF9TVFRfU1RBVEVbImxvYWRpbmciXSksICJzdHRfbG9hZGVkIjogYm9vbChBSS5nZXQoInN0dCIpKX0KCgojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gd29yZCBkaWZmCmRlZiB3b3JkX2RpZmZfZWRpdHMob3JpZywgZml4ZWQsIG9mZj0wKToKICAgICIiIldvcmQtbGV2ZWwgZGlmZiDihpIgSW5rd2VsbCBlZGl0IG9iamVjdHMgW3tzdGFydCxlbmQsb3JpZyxmaXgsd2h5LGNhdH1dLiIiIgogICAgYSA9IG9yaWcuc3BsaXQoKQogICAgYiA9IGZpeGVkLnNwbGl0KCkKICAgIHNtID0gZGlmZmxpYi5TZXF1ZW5jZU1hdGNoZXIoYT1hLCBiPWIsIGF1dG9qdW5rPUZhbHNlKQogICAgc3BhbnMgPSBbKG0uc3RhcnQoKSwgbS5lbmQoKSkgZm9yIG0gaW4gcmUuZmluZGl0ZXIociJcUysiLCBvcmlnKV0KICAgIGVkaXRzID0gW10KICAgIGZvciB0YWcsIGkxLCBpMiwgajEsIGoyIGluIHNtLmdldF9vcGNvZGVzKCk6CiAgICAgICAgaWYgdGFnID09ICJlcXVhbCI6CiAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgaWYgaTEgPCBpMjoKICAgICAgICAgICAgcywgZSA9IHNwYW5zW2kxXVswXSwgc3BhbnNbaTIgLSAxXVsxXQogICAgICAgIGVsc2U6ICAjIHB1cmUgaW5zZXJ0aW9uCiAgICAgICAgICAgIHMgPSBlID0gc3BhbnNbaTFdWzBdIGlmIGkxIDwgbGVuKHNwYW5zKSBlbHNlIGxlbihvcmlnKQogICAgICAgIHJlcGwgPSAiICIuam9pbihiW2oxOmoyXSkKICAgICAgICBvbGQgPSBvcmlnW3M6ZV0KICAgICAgICBpZiByZXBsICE9IG9sZDoKICAgICAgICAgICAgZWRpdHMuYXBwZW5kKHsic3RhcnQiOiBzICsgb2ZmLCAiZW5kIjogZSArIG9mZiwgIm9yaWciOiBvbGQsCiAgICAgICAgICAgICAgICAgICAgICAgICAgImZpeCI6IHJlcGwsICJ3aHkiOiAiU2VydmVyIGdyYW1tYXIiLCAiY2F0IjogImFpIn0pCiAgICByZXR1cm4gZWRpdHMKCgoKIyAtLS0tLS0tLS0tLS0tLS0tIGhldXJpc3RpYyBvZmZsaW5lIGxhbmUgKHRoZSBjcmVlZDogbm8gc2VydmVyIGNhbGwgZXZlcikgLS0tLS0tLQojIFRoZSBwYWdlJ3MgcnVsZXMgZW5naW5lIGFuZCB0aGlzIG9uZSBtaXJyb3IgZWFjaCBvdGhlcjsgdGhlIHNlcnZlciBhbnN3ZXJzIHRoZQojIHNhbWUgd2F5IGV2ZW4gd2hlbiBubyBtb2RlbCBpcyBvbiB0aGUgc2hlbGYuIE5vIGRlcGVuZGVuY3kuCgppbXBvcnQgcmUgYXMgX3JlMgoKIyB0aGUgcmVhbCBydWxlIGxpc3QsIHdyaXR0ZW4gYXMgdGhlIGRlc2snczogKHBhdHRlcm4sIHJlcGxhY2VtZW50IG9yIE5vbmUsIHdoeSwgY2F0KQpfSEVfUlVMRVNfUkFXID0gWwogICAgKHIiXGJ0aGUgcmVzdWx0cyB3YXNcYiIsICJ0aGUgcmVzdWx0cyB3ZXJlIiwgIkEgcGx1cmFsIHN1YmplY3QgdGFrZXMgYSBwbHVyYWwgdmVyYiIsICJnIiksCiAgICAociJcYnRoZXNlIHJlc3VsdHMgc2hvd3NcYiIsICJ0aGVzZSByZXN1bHRzIHNob3ciLCAiVGhlIHBsdXJhbCB2ZXJiIHN0YW5kcyIsICJnIiksCiAgICAociJcYnRoZSBkYXRhIHNob3dzXGIiLCAidGhlIGRhdGEgc2hvdyIsICLigJxEYXRh4oCdIHRha2VzIHRoZSBwbHVyYWwgaW4gZm9ybWFsIHdyaXRpbmciLCAiZyIpLAogICAgKHIiXGJ0aGUgbWVkaWEgaXNcYiIsIE5vbmUsICLigJxNZWRpYeKAnSBpcyBwbHVyYWw7IHRoZSBzaW5ndWxhciBpcyBtZWRpdW0iLCAicyIpLAogICAgKHIiXGJ0aGUgY3JpdGVyaWEgaXNcYiIsICJ0aGUgY3JpdGVyaWEgYXJlIiwgIkNyaXRlcmlhIGlzIHBsdXJhbCIsICJnIiksCiAgICAociJcYnRoZSBwaGVub21lbmEgaXNcYiIsICJ0aGUgcGhlbm9tZW5hIGFyZSIsICJQaGVub21lbmEgaXMgcGx1cmFsIiwgImciKSwKICAgIChyIlxiaXRzIG93blxiIiwgIml0cyBvd24iLCBOb25lLCBOb25lKSwgICMgbm8tb3A6IHRoZSBkZXNrIGhhbmRsZXMgdGhpczsga2VlcCBxdWlldApdCgojIHRoZSBkZXNrJ3MgZW5naW5lLCBpbiBkaXN0aWxsZWQgUHl0aG9uIGZvcm0g4oCUIG9uZSBsaW5lIHBlciBydWxlLCBhbGwgc2FmZToKX0hFVVIgPSBbCiAgICAociJcYnRoZSByZXN1bHRzIHdhc1xiIiwgInRoZSByZXN1bHRzIHdlcmUiLCAiQSBwbHVyYWwgc3ViamVjdCB0YWtlcyBhIHBsdXJhbCB2ZXJiIiwgImciKSwKICAgIChyIlxidGhlc2UgcmVzdWx0cyBzaG93c1xiIiwgInRoZXNlIHJlc3VsdHMgc2hvdyIsICJUaGUgcGx1cmFsIHZlcmIgc3RhbmRzIiwgImciKSwKICAgIChyIlxiaXRzIG93blxiIiwgTm9uZSwgTm9uZSwgTm9uZSksCiAgICAociJcYnRoZSBkYXRhIHNob3dzXGIiLCAidGhlIGRhdGEgc2hvdyIsICLigJxEYXRh4oCdIHRha2VzIHRoZSBwbHVyYWwgaW4gZm9ybWFsIHdyaXRpbmciLCAiZyIpLAogICAgKHIiXGJ0aGUgY3JpdGVyaWEgaXNcYiIsICJ0aGUgY3JpdGVyaWEgYXJlIiwgIkNyaXRlcmlhIGlzIHBsdXJhbCIsICJnIiksCiAgICAociJcYnRoZSBwaGVub21lbmEgaXNcYiIsICJ0aGUgcGhlbm9tZW5hIGFyZSIsICJQaGVub21lbmEgaXMgcGx1cmFsIiwgImciKSwKICAgIChyIlxiaGFkIHdlbnRcYiIsICJoYWQgZ29uZSIsICJUaGUgcGVyZmVjdCB0YWtlcyDigJxnb25l4oCdIiwgImciKSwKICAgIChyIlxiKD86aGFzfGhhdmUpIHdlbnRcYiIsICJoYXZlIGdvbmUiLCAiaGF2ZSB3YW50cyDigJxnb25l4oCdIiwgImciKSwKICAgIChyIlxiaGFkIGRpZFxiIiwgImhhZCBkb25lIiwgIlRoZSBwZXJmZWN0IHRha2VzIOKAnGRvbmXigJ0iLCAiZyIpLAogICAgKHIiXGIoPzpoYXN8aGF2ZSkgZGlkXGIiLCAiaGF2ZSBkb25lIiwgImhhdmUgd2FudHMg4oCcZG9uZeKAnSIsICJnIiksCiAgICAociJcYmhhZCB3cm90ZVxiIiwgImhhZCB3cml0dGVuIiwgIlRoZSBwZXJmZWN0IHRha2VzIOKAnHdyaXR0ZW7igJ0iLCAiZyIpLAogICAgKHIiXGIoPzpoYXN8aGF2ZSkgd3JvdGVcYiIsICJoYXZlIHdyaXR0ZW4iLCAiaGF2ZSB3YW50cyDigJx3cml0dGVu4oCdIiwgImciKSwKICAgIChyIlxiaGFkIHJhblxiIiwgImhhZCBydW4iLCAiVGhlIHBlcmZlY3QgdGFrZXMg4oCccnVu4oCdIiwgImciKSwKICAgIChyIlxiKD86aGFzfGhhdmUpIHJhblxiIiwgImhhdmUgcnVuIiwgImhhdmUgd2FudHMg4oCccnVu4oCdIiwgImciKSwKICAgIChyIlxiaGFkIGNhbWUgYmFja1xiIiwgImhhZCBjb21lIGJhY2siLCAiVGhlIHBlcmZlY3QgdGFrZXMg4oCcY29tZeKAnSIsICJnIiksCiAgICAociJcYmhhZCBjYW1lXGIiLCAiaGFkIGNvbWUiLCAiVGhlIHBlcmZlY3QgdGFrZXMg4oCcY29tZeKAnSIsICJnIiksCiAgICAociJcYig/Omhhc3xoYXZlKSBjYW1lXGIiLCAiaGF2ZSBjb21lIiwgImhhdmUgd2FudHMg4oCcY29tZeKAnSIsICJnIiksCiAgICAociJcYmhhZCBicm9rZVxiIiwgImhhZCBicm9rZW4iLCAiVGhlIHBlcmZlY3QgdGFrZXMg4oCcYnJva2Vu4oCdIiwgImciKSwKICAgIChyIlxiKD86aGFzfGhhdmUpIGJyb2tlXGIiLCAiaGF2ZSBicm9rZW4iLCAiaGF2ZSB3YW50cyDigJxicm9rZW7igJ0iLCAiZyIpLAogICAgKHIiXGJzaG91bGQgb2ZcYiIsICJzaG91bGQgaGF2ZSIsICLigJxzaG91bGQgb2bigJ0gaXMg4oCcc2hvdWxkIGhhdmXigJ0iLCAiZyIpLAogICAgKHIiXGJjb3VsZCBvZlxiIiwgImNvdWxkIGhhdmUiLCAi4oCcY291bGQgb2bigJ0gaXMg4oCcY291bGQgaGF2ZeKAnSIsICJnIiksCiAgICAociJcYndvdWxkIG9mXGIiLCAid291bGQgaGF2ZSIsICLigJx3b3VsZCBvZuKAnSBpcyDigJx3b3VsZCBoYXZl4oCdIiwgImciKSwKICAgIChyIlxiY2FuIG5vdFxiIiwgImNhbm5vdCIsICLigJxjYW5ub3TigJ0gaXMgb25lIHdvcmQiLCAiZyIpLAogICAgKHIiXGJhbG90XGIiLCAiYSBsb3QiLCAiT25lIHdvcmQgYXBhcnQiLCAiZyIpLAogICAgKHIiXGJyZWNpZXZlXGIiLCAicmVjZWl2ZSIsICJUaGUgaSBnb2VzIGJlZm9yZSB0aGUgZSwgZXhjZXB0IGFmdGVyIGMiLCAiZyIpLAogICAgKHIiXGJkZWZpbmF0ZWx5XGIiLCAiZGVmaW5pdGVseSIsICJUaGUgc3BlbGxpbmcgaXMgZGVmaW5pdGVseSIsICJnIiksCiAgICAociJcYnNlcGVyYXRlXGIiLCAic2VwYXJhdGUiLCAiVGhlIG1pZGRsZSBrZWVwcyBpdHMgZSIsICJnIiksCiAgICAociJcYm9jY3VyZW5jZVxiIiwgIm9jY3VycmVuY2UiLCAiVHdvIHIncywgdHdvIGMncyIsICJnIiksCiAgICAociJcYm5lY2Nlc3NhcnlcYiIsICJuZWNlc3NhcnkiLCAiT25lIGMsIHR3byBzJ3MiLCAiZyIpLAogICAgKHIiXGJleGlzdGFudFxiIiwgImV4aXN0ZW50IiwgIlRoZSBpIGlzIHRoZSBzdGVtIiwgImciKSwKICAgIChyIlxiaW5kZXBlbmRhbnRcYiIsICJpbmRlcGVuZGVudCIsICLigJxlbnTigJ0gaXMgdGhlIGVuZGluZyIsICJnIiksCiAgICAociJcYnBlciBzYXlcYiIsICJwZXIgc2UiLCAiVGhlIExhdGluIGlzIOKAnHBlciBzZeKAnSIsICJnIiksCiAgICAociJcYnZpY2UgYSB2ZXJzYVxiIiwgInZpY2UgdmVyc2EiLCAiSXQgaXMg4oCcdmljZSB2ZXJzYeKAnSIsICJnIiksCiAgICAociJcYm9uIGFjY2lkZW50XGIiLCAiYnkgYWNjaWRlbnQiLCAi4oCcQnkgYWNjaWRlbnTigJ0gaXMgdGhlIGlkaW9tIiwgImciKSwKICAgIChyIlxiYmFzZWQgb2ZmXGIiLCAiYmFzZWQgb24iLCAiR3JvdW5kZWQg4oCcb27igJ0iLCAiZyIpLAogICAgKHIiXGJpcyBiaWFzXGIiLCAiaXMgYmlhc2VkIiwgIuKAnEJpYXPigJ0gaXMgdGhlIG5vdW4iLCAiZyIpLAogICAgKHIiXGJoYWQgY2FtZSBiYWNrXGIiLCBOb25lLCBOb25lLCBOb25lKSwKICAgIChyIlxib3ZlciAoXGRbXGQsXSopIChwZW9wbGV8c3R1ZGVudHN8cGFydGljaXBhbnRzKVxiIiwgTm9uZSwgIkNvdW50cyBpbiBmb3JtYWwgd29yayB0YWtlIOKAnG1vcmUgdGhhbuKAnSwgbm90IOKAnG92ZXLigJ0iLCAiYyIpLAogICAgKHIiXGJ0aGUgbWVkaWEgaXNcYiIsIE5vbmUsICLigJxNZWRpYeKAnSBpcyBwbHVyYWw7IHRoZSBzaW5ndWxhciBpcyBtZWRpdW0iLCAicyIpLAogICAgKHIiXGJpdCBnb2VzIHdpdGhvdXQgc2F5aW5nXGIiLCBOb25lLCAiSWYgaXQgZ29lcyB3aXRob3V0IHNheWluZywgdGhlIHNlbnRlbmNlIGNhbiBjYXJyeSBpdHNlbGYiLCAicyIpLAogICAgKHIiXGJuZWVkbGVzcyB0byBzYXksP1xiIiwgTm9uZSwgIuKAnE5lZWRsZXNzIHRvIHNheeKAnSBhbm5vdW5jZXMgYSByZWR1bmRhbmN5IiwgInMiKSwKICAgIChyIlxiaW4gdG9kYXkncyBzb2NpZXR5XGIiLCBOb25lLCAi4oCcSW4gdG9kYXkncyBzb2NpZXR54oCdIOKAlCB3aGljaCBzb2NpZXR5PyIsICJzIiksCiAgICAociJcYmEgcGxldGhvcmEgb2ZcYiIsIE5vbmUsICLigJxBIHBsZXRob3JhIG9m4oCdIGlzIG92ZXJ3b3JrZWQ7IHNheSBob3cgbWFueSIsICJzIiksCiAgICAociJcYm1vc3Qgc2Nob2xhcnMgYWdyZWVcYiIsIE5vbmUsICJDb25zZW5zdXMgd2FudHMgbmFtZXMiLCAicyIpLAogICAgKHIiXGJ0aGUgZXhhY3Qgc2FtZVxiIiwgInRoZSBzYW1lIiwgIlRoZSBzYW1lIGlzIGV4YWN0IGJ5IGl0c2VsZiIsICJjIiksCiAgICAociJcYnBhc3QgaGlzdG9yeVxiIiwgImhpc3RvcnkiLCAiSGlzdG9yeSBpcyBhbHJlYWR5IHBhc3QiLCAiYyIpLAogICAgKHIiXGJmdXR1cmUgcGxhbnNcYiIsICJwbGFucyIsICJQbGFucyBhcmUgYWxyZWFkeSBmdXR1cmUiLCAiYyIpLAogICAgKHIiXGJjbG9zZSBwcm94aW1pdHlcYiIsICJwcm94aW1pdHkiLCAiUHJveGltaXR5IGlzIGFscmVhZHkgY2xvc2UiLCAiYyIpLApdCiMgY2xlYW4gb3V0IHRoZSBuby1vcCBwbGFjZWhvbGRlcnMgZGVsaWJlcmF0ZWx5Cl9IRVVSID0gW3IgZm9yIHIgaW4gX0hFVVIgaWYgclswXSBpcyBub3QgTm9uZSBhbmQgclsxXSBpcyBub3QgTm9uZV0KCl9IRVVSLmV4dGVuZChbCiAgICAociJcYnRoZSBtZWRpYSBpc1xiIiwgTm9uZSwgIuKAnE1lZGlh4oCdIGlzIHBsdXJhbDsgdGhlIHNpbmd1bGFyIGlzIG1lZGl1bSIsICJzIiksCiAgICAociJcYml0IGdvZXMgd2l0aG91dCBzYXlpbmdcYiIsIE5vbmUsICJJZiBpdCBnb2VzIHdpdGhvdXQgc2F5aW5nLCB0aGUgc2VudGVuY2UgY2FuIGNhcnJ5IGl0c2VsZiIsICJzIiksCiAgICAociJcYm5lZWRsZXNzIHRvIHNheSw/XGIiLCBOb25lLCAi4oCcTmVlZGxlc3MgdG8gc2F54oCdIGFubm91bmNlcyBhIHJlZHVuZGFuY3kiLCAicyIpLAogICAgKHIiXGJpbiB0b2RheSdzIHNvY2lldHlcYiIsIE5vbmUsICLigJxJbiB0b2RheSdzIHNvY2lldHnigJ0g4oCUIHdoaWNoIHNvY2lldHk/IiwgInMiKSwKICAgIChyIlxiYSBwbGV0aG9yYSBvZlxiIiwgTm9uZSwgIuKAnEEgcGxldGhvcmEgb2bigJ0gaXMgb3ZlcndvcmtlZDsgc2F5IGhvdyBtYW55IiwgInMiKSwKICAgIChyIlxibW9zdCBzY2hvbGFycyBhZ3JlZVxiIiwgTm9uZSwgIkNvbnNlbnN1cyB3YW50cyBuYW1lcyIsICJzIiksCiAgICAociJcYnRoZSBleGFjdCBzYW1lXGIiLCAidGhlIHNhbWUiLCAiVGhlIHNhbWUgaXMgZXhhY3QgYnkgaXRzZWxmIiwgImMiKSwKICAgIChyIlxicGFzdCBoaXN0b3J5XGIiLCAiaGlzdG9yeSIsICJIaXN0b3J5IGlzIGFscmVhZHkgcGFzdCIsICJjIiksCiAgICAociJcYmZ1dHVyZSBwbGFuc1xiIiwgInBsYW5zIiwgIlBsYW5zIGFyZSBhbHJlYWR5IGZ1dHVyZSIsICJjIiksCiAgICAociJcYmNsb3NlIHByb3hpbWl0eVxiIiwgTm9uZSwgIlByb3hpbWl0eSBpcyBhbHJlYWR5IGNsb3NlIiwgImMiKSwKICAgICMgLS0tIHdvcmQgY29uZnVzaW9ucyAoYWNhZGVtaWMpIC0tLQogICAgKHIiXGJ0aGVpciBpc1xiIiwgInRoZXJlIGlzIiwgIuKAnFRoZXJlIGlz4oCdIGZvciBleGlzdGVuY2U7IOKAnHRoZWly4oCdIGlzIHBvc3Nlc3NpdmUiLCAiZyIpLAogICAgKHIiXGJ0aGVpciBhcmVcYiIsICJ0aGVyZSBhcmUiLCAi4oCcVGhlcmUgYXJl4oCdIGZvciBleGlzdGVuY2U7IOKAnHRoZWly4oCdIGlzIHBvc3Nlc3NpdmUiLCAiZyIpLAogICAgKHIiXGJ0aGV5cmVcYiIsICJ0aGV5J3JlIiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYnlvdXIgd2VsY29tZVxiIiwgInlvdSdyZSB3ZWxjb21lIiwgIuKAnFlvdSdyZeKAnSBpcyB0aGUgY29udHJhY3Rpb24gb2Yg4oCceW91IGFyZeKAnSIsICJnIiksCiAgICAociJcYnlvdXIgcmlnaHRcYiIsICJ5b3UncmUgcmlnaHQiLCAi4oCcWW91J3Jl4oCdIGlzIHRoZSBjb250cmFjdGlvbiBvZiDigJx5b3UgYXJl4oCdIiwgImciKSwKICAgIChyIlxieW91ciB3cm9uZ1xiIiwgInlvdSdyZSB3cm9uZyIsICLigJxZb3UncmXigJ0gaXMgdGhlIGNvbnRyYWN0aW9uIG9mIOKAnHlvdSBhcmXigJ0iLCAiZyIpLAogICAgKHIiXGJpdHMgYVxiIiwgIml0J3MgYSIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24gb2Yg4oCcaXQgaXPigJ0iLCAiZyIpLAogICAgKHIiXGJpdHMgYW5cYiIsICJpdCdzIGFuIiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiBvZiDigJxpdCBpc+KAnSIsICJnIiksCiAgICAociJcYndob3NcYiIsICJ3aG8ncyIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJ3ZXJlbnRcYiIsICJ3ZXJlbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYmRvbnRcYiIsICJkb24ndCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJkb2VzbnRcYiIsICJkb2Vzbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYmRpZG50XGIiLCAiZGlkbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYmlzbnRcYiIsICJpc24ndCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJ3YXNudFxiIiwgIndhc24ndCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJhcmVuJ3RcYiIsICJhcmVuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxid2VyZW4ndFxiIiwgIndlcmVuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxiY2FudFxiIiwgImNhbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYndvbnRcYiIsICJ3b24ndCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJ3b3VsZG50XGIiLCAid291bGRuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxiY291bGRudFxiIiwgImNvdWxkbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYnNob3VsZG50XGIiLCAic2hvdWxkbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYml2ZVxiIiwgIkkndmUiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uOyB0aGUgcHJvbm91biBpcyBjYXBpdGFsIiwgImciKSwKICAgIChyIlxiaW1cYiIsICJJJ20iLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uOyB0aGUgcHJvbm91biBpcyBjYXBpdGFsIiwgImciKSwKICAgIChyIlxiaWRcYiIsICJJJ2QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uOyB0aGUgcHJvbm91biBpcyBjYXBpdGFsIiwgImciKSwKICAgIChyIlxiaWxsXGIiLCAiSSdsbCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb247IHRoZSBwcm9ub3VuIGlzIGNhcGl0YWwiLCAiZyIpLAogICAgIyAtLS0gY29uZnVzaW9ucyB0aGF0IGEgZG9jdG9yYWwgZXhhbWluZXIgZmxhZ3MgLS0tCiAgICAociJcYmNvbXBsaW1lbnRhcnlcYig/PVxzKyg/OmJlZXJ8dGVhfGNvZmZlZXx0aWNrZXR8c2VydmljZSkpIiwgImNvbXBsaW1lbnRhcnkiLCAi4oCcQ29tcGxpbWVudGFyeeKAnSBtZWFucyBmcmVlOyDigJxjb21wbGVtZW50YXJ54oCdIG1lYW5zIGNvbXBsZXRpbmciLCAiYyIpLAogICAgKHIiXGJwcmluY2lwbGUgaW52ZXN0aWdhdG9yXGIiLCAicHJpbmNpcGFsIGludmVzdGlnYXRvciIsICLigJxQcmluY2lwYWzigJ0gaXMgdGhlIGFkamVjdGl2ZTsg4oCccHJpbmNpcGxl4oCdIGlzIHRoZSBub3VuIiwgImMiKSwKICAgIChyIlxicHJpbmNpcGxlIHJlc2VhcmNoZXJcYiIsICJwcmluY2lwYWwgcmVzZWFyY2hlciIsICLigJxQcmluY2lwYWzigJ0gaXMgdGhlIGFkamVjdGl2ZTsg4oCccHJpbmNpcGxl4oCdIGlzIHRoZSBub3VuIiwgImMiKSwKICAgIChyIlxicHJpbmNpcGxlIGF1dGhvclxiIiwgInByaW5jaXBhbCBhdXRob3IiLCAi4oCcUHJpbmNpcGFs4oCdIGlzIHRoZSBhZGplY3RpdmU7IOKAnHByaW5jaXBsZeKAnSBpcyB0aGUgbm91biIsICJjIiksCiAgICAociJcYnByaW5jaXBsZSBmaW5kaW5nXGIiLCAicHJpbmNpcGFsIGZpbmRpbmciLCAi4oCcUHJpbmNpcGFs4oCdIGlzIHRoZSBhZGplY3RpdmU7IOKAnHByaW5jaXBsZeKAnSBpcyB0aGUgbm91biIsICJjIiksCiAgICAociJcYnByaW5jaXBsZSBhcmd1bWVudFxiIiwgInByaW5jaXBhbCBhcmd1bWVudCIsICLigJxQcmluY2lwYWzigJ0gaXMgdGhlIGFkamVjdGl2ZTsg4oCccHJpbmNpcGxl4oCdIGlzIHRoZSBub3VuIiwgImMiKSwKICAgIChyIlxicHJpbmNpcGxlIHJlYXNvblxiIiwgInByaW5jaXBhbCByZWFzb24iLCAi4oCcUHJpbmNpcGFs4oCdIGlzIHRoZSBhZGplY3RpdmU7IOKAnHByaW5jaXBsZeKAnSBpcyB0aGUgbm91biIsICJjIiksCiAgICAociJcYnByaW5jaXBsZSBjb25jZXJuXGIiLCAicHJpbmNpcGFsIGNvbmNlcm4iLCAi4oCcUHJpbmNpcGFs4oCdIGlzIHRoZSBhZGplY3RpdmU7IOKAnHByaW5jaXBsZeKAnSBpcyB0aGUgbm91biIsICJjIiksCiAgICAociJcYmFmZmVjdFxiKD89XHMrKD86b25cc3xvZikpIiwgImVmZmVjdCIsICLigJxFZmZlY3Qgb27igJ0gaXMgdGhlIG5vdW4gcGhyYXNlOyDigJxhZmZlY3TigJ0gaXMgdGhlIHZlcmIiLCAiYyIpLAogICAgKHIiXGJsb29zZVxiKD89XHMrKD86dHJhY2t8bW9uZXl8d2VpZ2h0fGZvY3VzfHNpZ2h0KSkiLCAibG9zZSIsICLigJxMb3Nl4oCdIGlzIHRoZSB2ZXJiOyDigJxsb29zZeKAnSBtZWFucyBub3QgdGlnaHQiLCAiYyIpLAogICAgKHIiXGJzdGF0aW9uYXJ5XGIoPz1ccysoPzpwaGFzZXxmcm9udHx3YXZlfG9yYml0fHBvaW50KSkiLCAic3RhdGlvbmFyeSIsICJDb25maXJtZWQgY29ycmVjdCB1c2FnZSBvZiDigJxzdGF0aW9uYXJ54oCdIiwgTm9uZSksCiAgICAociJcYnN0YXRpb25hcnlcYiIsIE5vbmUsICJDaGVjazog4oCcc3RhdGlvbmFyeeKAnSBtZWFucyBub3QgbW92aW5nOyDigJxzdGF0aW9uZXJ54oCdIG1lYW5zIHdyaXRpbmcgbWF0ZXJpYWxzIiwgImMiKSwKICAgIChyIlxiY291bmNpbFxiKD89XHMrKD86bWVtYmVyfG1lZXRpbmd8dm90ZXxjaGFtYmVyfHNlYXQpKSIsICJjb3VuY2lsIiwgTm9uZSwgTm9uZSksCiAgICAociJcYmNvbXByaXNlZCBvZlxiIiwgImNvbXBvc2VkIG9mIiwgIlRoZSB3aG9sZSBjb21wcmlzZXMgdGhlIHBhcnRzOyB0aGUgcGFydHMgY29tcG9zZSB0aGUgd2hvbGUiLCAiYyIpLAogICAgKHIiXGJsZXNzXGIoPz1ccysoPzpwZW9wbGV8c3R1ZGVudHN8cGFydGljaXBhbnRzfHN1YmplY3RzfGl0ZW1zfGNhc2VzfHN0dWRpZXN8cGFwZXJzKSkiLCAiZmV3ZXIiLCAiQ291bnQgbm91bnMgdGFrZSDigJxmZXdlcuKAnTsgbWFzcyBub3VucyB0YWtlIOKAnGxlc3PigJ0iLCAiZyIpLAogICAgKHIiXGJhbW91bnQgb2YgKD86cGVvcGxlfHN0dWRlbnRzfHBhcnRpY2lwYW50c3xzdWJqZWN0c3xpdGVtc3xjYXNlc3xzdHVkaWVzfHBhcGVycylcYiIsICJudW1iZXIgb2YiLCAiQ291bnRhYmxlIG5vdW5zIHRha2Ug4oCcbnVtYmVyIG9m4oCdLCBub3Qg4oCcYW1vdW50IG9m4oCdIiwgImciKSwKICAgIChyIlxiYmV0d2VlblxzKyhcdyspXHMrYW5kXHMrSVxiIiwgciJiZXR3ZWVuIFwxIGFuZCBtZSIsICJBZnRlciBhIHByZXBvc2l0aW9uLCB0aGUgcHJvbm91biBpcyDigJxtZeKAnSwgbm90IOKAnEnigJ0iLCAiZyIpLAogICAgKHIiXGJmb3Jccyt5b3VccythbmRccytJXGIiLCAiZm9yIHlvdSBhbmQgbWUiLCAiQWZ0ZXIgYSBwcmVwb3NpdGlvbiwgdGhlIHByb25vdW4gaXMg4oCcbWXigJ0sIG5vdCDigJxJ4oCdIiwgImciKSwKICAgIChyIlxidG9ccyt5b3VccythbmRccytJXGIiLCAidG8geW91IGFuZCBtZSIsICJBZnRlciBhIHByZXBvc2l0aW9uLCB0aGUgcHJvbm91biBpcyDigJxtZeKAnSwgbm90IOKAnEnigJ0iLCAiZyIpLAogICAgKHIiXGJ3aXRoXHMreW91XHMrYW5kXHMrSVxiIiwgIndpdGggeW91IGFuZCBtZSIsICJBZnRlciBhIHByZXBvc2l0aW9uLCB0aGUgcHJvbm91biBpcyDigJxtZeKAnSwgbm90IOKAnEnigJ0iLCAiZyIpLAogICAgIyAtLS0gbW9yZSBzcGVsbGluZyAtLS0KICAgIChyIlxiYWNjb21vZGF0ZVxiIiwgImFjY29tbW9kYXRlIiwgIlR3byBjJ3MsIHR3byBtJ3MiLCAiZyIpLAogICAgKHIiXGJvY2Nhc3Npb25cYiIsICJvY2Nhc2lvbiIsICJUd28gYydzLCBvbmUgcyIsICJnIiksCiAgICAociJcYm9jY3VyZWRcYiIsICJvY2N1cnJlZCIsICJUd28gcidzIiwgImciKSwKICAgIChyIlxib2NjdXJpbmdcYiIsICJvY2N1cnJpbmciLCAiVHdvIHIncyIsICJnIiksCiAgICAociJcYnJlZmZlcmVkXGIiLCAicmVmZXJyZWQiLCAiVHdvIHIncyIsICJnIiksCiAgICAociJcYnJlZmVyaW5nXGIiLCAicmVmZXJyaW5nIiwgIlR3byByJ3MiLCAiZyIpLAogICAgKHIiXGJ0cmFuZmVycmVkXGIiLCAidHJhbnNmZXJyZWQiLCAiVHdvIHIncyIsICJnIiksCiAgICAociJcYnRyYW5mZXJpbmdcYiIsICJ0cmFuc2ZlcnJpbmciLCAiVHdvIHIncyIsICJnIiksCiAgICAociJcYnByZWZlcmVkXGIiLCAicHJlZmVycmVkIiwgIlR3byByJ3MiLCAiZyIpLAogICAgKHIiXGJwcmVmZXJpbmdcYiIsICJwcmVmZXJyaW5nIiwgIlR3byByJ3MiLCAiZyIpLAogICAgKHIiXGJ0YXJnZXR0ZWRcYiIsICJ0YXJnZXRlZCIsICJPbmUgdCBpcyBlbm91Z2giLCAiZyIpLAogICAgKHIiXGJ0YXJnZXR0aW5nXGIiLCAidGFyZ2V0aW5nIiwgIk9uZSB0IGlzIGVub3VnaCIsICJnIiksCiAgICAociJcYmJlbmVmaXR0ZWRcYiIsICJiZW5lZml0ZWQiLCAiT25lIHQgaXMgc3RhbmRhcmQiLCAiZyIpLAogICAgKHIiXGJiZW5lZml0dGluZ1xiIiwgImJlbmVmaXRpbmciLCAiT25lIHQgaXMgc3RhbmRhcmQiLCAiZyIpLAogICAgKHIiXGJmb2N1c3NlZFxiIiwgImZvY3VzZWQiLCAiT25lIHMgaXMgc3RhbmRhcmQiLCAiZyIpLAogICAgKHIiXGJmb2N1c3NpbmdcYiIsICJmb2N1c2luZyIsICJPbmUgcyBpcyBzdGFuZGFyZCIsICJnIiksCiAgICAociJcYmFyZ3VtZW50YXRpdmVcYiIsICJhcmd1bWVudGF0aXZlIiwgTm9uZSwgTm9uZSksCiAgICAociJcYmFyZ3VlbWVudFxiIiwgImFyZ3VtZW50IiwgIk5vIGUgYWZ0ZXIgdSIsICJnIiksCiAgICAociJcYmVnXGIoPz1bLDtdKSIsICJlLmcuIiwgIlRoZSBhYmJyZXZpYXRpb24gdGFrZXMgdHdvIGRvdHMiLCAiZyIpLAogICAgKHIiXGJpZVxiKD89Wyw7XSkiLCAiaS5lLiIsICJUaGUgYWJicmV2aWF0aW9uIHRha2VzIHR3byBkb3RzIiwgImciKSwKICAgIChyIlxiZXRjXGIoPz1bLC47XSkiLCAiZXRjLiIsICJUaGUgYWJicmV2aWF0aW9uIHRha2VzIGEgZG90IiwgImciKSwKICAgIChyIlxidGVoXGIiLCAidGhlIiwgIlRyYW5zcG9zZWQgbGV0dGVycyIsICJnIiksCiAgICAociJcYnRoaWVyXGIiLCAidGhlaXIiLCAiVHJhbnNwb3NlZCBsZXR0ZXJzIiwgImciKSwKICAgIChyIlxicmVjaWV2ZXJcYiIsICJyZWNlaXZlciIsICJJIGJlZm9yZSBlLCBleGNlcHQgYWZ0ZXIgYyIsICJnIiksCiAgICAociJcYnJlY2llcHRcYiIsICJyZWNlaXB0IiwgIkkgYmVmb3JlIGUsIGV4Y2VwdCBhZnRlciBjIiwgImciKSwKICAgIChyIlxiY29uY2lldmVcYiIsICJjb25jZWl2ZSIsICJJIGJlZm9yZSBlLCBleGNlcHQgYWZ0ZXIgYyIsICJnIiksCiAgICAociJcYmRlY2lldmVcYiIsICJkZWNlaXZlIiwgIkkgYmVmb3JlIGUsIGV4Y2VwdCBhZnRlciBjIiwgImciKSwKICAgIChyIlxicGVyY2lldmVcYiIsICJwZXJjZWl2ZSIsICJJIGJlZm9yZSBlLCBleGNlcHQgYWZ0ZXIgYyIsICJnIiksCiAgICAociJcYmFjaGVpdmVcYiIsICJhY2hpZXZlIiwgIkkgYmVmb3JlIGUsIGV4Y2VwdCBhZnRlciBjIiwgImciKSwKICAgIChyIlxiY2FsZW5kZXJcYiIsICJjYWxlbmRhciIsICJUaGUgc3BlbGxpbmcgaXMg4oCcY2FsZW5kYXLigJ0iLCAiZyIpLAogICAgKHIiXGJjYXRhZ29yeVxiIiwgImNhdGVnb3J5IiwgIlRoZSBzcGVsbGluZyBpcyDigJxjYXRlZ29yeeKAnSIsICJnIiksCiAgICAociJcYmVudmlyb21lbnRcYiIsICJlbnZpcm9ubWVudCIsICJUaGUgbiBpcyBwcmVzZW50IiwgImciKSwKICAgIChyIlxiZ292ZXJtZW50XGIiLCAiZ292ZXJubWVudCIsICJUaGUgbiBpcyBwcmVzZW50IiwgImciKSwKICAgIChyIlxia25vd2xlZ2VcYiIsICJrbm93bGVkZ2UiLCAiVGhlIGQgaXMgcHJlc2VudCIsICJnIiksCiAgICAociJcYnB1YmxpY2FsbHlcYiIsICJwdWJsaWNseSIsICJUaGUgc3BlbGxpbmcgaXMg4oCccHVibGljbHnigJ0iLCAiZyIpLAogICAgKHIiXGJzdXByaXNlXGIiLCAic3VycHJpc2UiLCAiVHdvIHIncywgb25lIHMiLCAiZyIpLAogICAgKHIiXGJzdXByaXNlZFxiIiwgInN1cnByaXNlZCIsICJUd28gcidzLCBvbmUgcyIsICJnIiksCiAgICAociJcYnByaXZpbGVkZ2VcYiIsICJwcml2aWxlZ2UiLCAiTm8gZCBpbiDigJxwcml2aWxlZ2XigJ0iLCAiZyIpLAogICAgKHIiXGJyeXRobVxiIiwgInJoeXRobSIsICJUaGUgc3BlbGxpbmcgaXMg4oCccmh5dGht4oCdIiwgImciKSwKICAgIChyIlxic3lsbGFidXMnXGIiLCAic3lsbGFidXMncyIsICJTaW5ndWxhciBwb3NzZXNzaXZlIHRha2VzICdzIiwgImciKSwKICAgIChyIlxiYW5hbHlzaXMnXGIiLCAiYW5hbHlzaXMncyIsICJTaW5ndWxhciBwb3NzZXNzaXZlIHRha2VzICdzIiwgImciKSwKICAgIChyIlxiY3Jpc2lzJ1xiIiwgImNyaXNpcydzIiwgIlNpbmd1bGFyIHBvc3Nlc3NpdmUgdGFrZXMgJ3MiLCAiZyIpLAogICAgIyAtLS0gc3R5bGU6IHdvcmR5IGFjYWRlbWljIHBocmFzZXMgLS0tCiAgICAociJcYmR1ZSB0byB0aGUgZmFjdCB0aGF0XGIiLCAiYmVjYXVzZSIsICLigJxCZWNhdXNl4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJpbiBzcGl0ZSBvZiB0aGUgZmFjdCB0aGF0XGIiLCAiYWx0aG91Z2giLCAi4oCcQWx0aG91Z2jigJ0gaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJzIiksCiAgICAociJcYmluIHRoZSBldmVudCB0aGF0XGIiLCAiaWYiLCAi4oCcSWbigJ0gaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJzIiksCiAgICAociJcYmF0IHRoaXMgcG9pbnQgaW4gdGltZVxiIiwgIm5vdyIsICLigJxOb3figJ0gaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJzIiksCiAgICAociJcYmF0IHRoYXQgcG9pbnQgaW4gdGltZVxiIiwgInRoZW4iLCAi4oCcVGhlbuKAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiZm9yIHRoZSBwdXJwb3NlIG9mXGIiLCAiZm9yIiwgIuKAnEZvcuKAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiaW4gdGhlIHByb2Nlc3Mgb2ZcYiIsIE5vbmUsICLigJxJbiB0aGUgcHJvY2VzcyBvZuKAnSBpcyB3b3JkeTsgdGhlIHZlcmIgYWxvbmUgaXMgc3Ryb25nZXIiLCAicyIpLAogICAgKHIiXGJpcyBhYmxlIHRvXGIiLCAiY2FuIiwgIuKAnENhbuKAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiYXJlIGFibGUgdG9cYiIsICJjYW4iLCAi4oCcQ2Fu4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJ3YXMgYWJsZSB0b1xiIiwgImNvdWxkIiwgIuKAnENvdWxk4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJ3ZXJlIGFibGUgdG9cYiIsICJjb3VsZCIsICLigJxDb3VsZOKAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiaW4gb3JkZXIgdG9cYiIsICJ0byIsICLigJxUb+KAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiaW4gb3JkZXIgZm9yXGIiLCAiZm9yIiwgIuKAnEZvcuKAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxidGhlIHJlYXNvbiB3aHlcYiIsICJ0aGUgcmVhc29uIiwgIuKAnFdoeeKAnSBpcyByZWR1bmRhbnQgYWZ0ZXIg4oCccmVhc29u4oCdIiwgImMiKSwKICAgIChyIlxiYmFzaWMoPzphbGx5KT9ccytmdW5kYW1lbnRhbFxiIiwgImZ1bmRhbWVudGFsIiwgIuKAnEJhc2ljIGZ1bmRhbWVudGFsbHnigJ0gaXMgZG91Ymx5IHJlZHVuZGFudCIsICJjIiksCiAgICAociJcYmNvbXBsZXRlbHlccytlbGltaW5hdGVcYiIsICJlbGltaW5hdGUiLCAiRWxpbWluYXRpb24gaXMgYWxyZWFkeSBjb21wbGV0ZSIsICJjIiksCiAgICAociJcYmNvbXBsZXRlbHlccytlcmFkaWNhdGVcYiIsICJlcmFkaWNhdGUiLCAiRXJhZGljYXRpb24gaXMgYWxyZWFkeSBjb21wbGV0ZSIsICJjIiksCiAgICAociJcYm5ld1xzK2lubm92YXRpb25cYiIsICJpbm5vdmF0aW9uIiwgIklubm92YXRpb24gaXMgYWxyZWFkeSBuZXciLCAiYyIpLAogICAgKHIiXGJ1bmV4cGVjdGVkXHMrc3VycHJpc2VcYiIsICJzdXJwcmlzZSIsICJBIHN1cnByaXNlIGlzIGFscmVhZHkgdW5leHBlY3RlZCIsICJjIiksCiAgICAociJcYnVuaW50ZW5kZWRccyttaXN0YWtlXGIiLCAibWlzdGFrZSIsICJBIG1pc3Rha2UgaXMgYWxyZWFkeSB1bmludGVuZGVkIiwgImMiKSwKICAgIChyIlxiZnJlZVxzK2dpZnRcYiIsICJnaWZ0IiwgIkEgZ2lmdCBpcyBhbHJlYWR5IGZyZWUiLCAiYyIpLAogICAgKHIiXGJlbmRccytyZXN1bHRcYiIsICJyZXN1bHQiLCAiQSByZXN1bHQgaXMgYWxyZWFkeSBhbiBlbmQiLCAiYyIpLAogICAgKHIiXGJmaW5hbFxzK291dGNvbWVcYiIsICJvdXRjb21lIiwgIkFuIG91dGNvbWUgaXMgYWxyZWFkeSBmaW5hbCIsICJjIiksCiAgICAociJcYmFic29sdXRlbHlccytlc3NlbnRpYWxcYiIsICJlc3NlbnRpYWwiLCAiRXNzZW50aWFsIGlzIGFscmVhZHkgYWJzb2x1dGUiLCAiYyIpLAogICAgKHIiXGJhYnNvbHV0ZWx5XHMrbmVjZXNzYXJ5XGIiLCAibmVjZXNzYXJ5IiwgIk5lY2Vzc2FyeSBpcyBhbHJlYWR5IGFic29sdXRlIiwgImMiKSwKICAgIChyIlxiY29tcGxldGVseVxzK2Rlc3Ryb3llZFxiIiwgImRlc3Ryb3llZCIsICJEZXN0cnVjdGlvbiBpcyBhbHJlYWR5IGNvbXBsZXRlIiwgImMiKSwKICAgIChyIlxidG90YWxseVxzK2Rlc3Ryb3llZFxiIiwgImRlc3Ryb3llZCIsICJEZXN0cnVjdGlvbiBpcyBhbHJlYWR5IHRvdGFsIiwgImMiKSwKICAgIChyIlxidmVyeVxzK3VuaXF1ZVxiIiwgInVuaXF1ZSIsICJVbmlxdWUgYWRtaXRzIG5vIGRlZ3JlZXMiLCAiYyIpLAogICAgKHIiXGJtb3N0XHMrdW5pcXVlXGIiLCAidW5pcXVlIiwgIlVuaXF1ZSBhZG1pdHMgbm8gZGVncmVlcyIsICJjIiksCiAgICAociJcYnF1aXRlXHMrdW5pcXVlXGIiLCAidW5pcXVlIiwgIlVuaXF1ZSBhZG1pdHMgbm8gZGVncmVlcyIsICJjIiksCiAgICAociJcYnJhdGhlclxzK3VuaXF1ZVxiIiwgInVuaXF1ZSIsICJVbmlxdWUgYWRtaXRzIG5vIGRlZ3JlZXMiLCAiYyIpLAogICAgKHIiXGJzb21ld2hhdFxzK3VuaXF1ZVxiIiwgInVuaXF1ZSIsICJVbmlxdWUgYWRtaXRzIG5vIGRlZ3JlZXMiLCAiYyIpLAogICAgKHIiXGJwZXJpb2Qgb2YgdGltZVxiIiwgInBlcmlvZCIsICJBIHBlcmlvZCBpcyBhbHJlYWR5IGEgc3BhbiBvZiB0aW1lIiwgImMiKSwKICAgIChyIlxibGVuZ3RoIG9mIHRpbWVcYiIsIE5vbmUsICLigJxMZW5ndGggb2YgdGltZeKAnSBpcyB3b3JkeTsg4oCcdGltZeKAnSBvciDigJxkdXJhdGlvbuKAnSBpcyBzaG9ydGVyIiwgInMiKSwKICAgIChyIlxic21hbGwgaW4gc2l6ZVxiIiwgInNtYWxsIiwgIlNpemUgaXMgaW1wbGljaXQgaW4g4oCcc21hbGzigJ0iLCAiYyIpLAogICAgKHIiXGJsYXJnZSBpbiBzaXplXGIiLCAibGFyZ2UiLCAiU2l6ZSBpcyBpbXBsaWNpdCBpbiDigJxsYXJnZeKAnSIsICJjIiksCiAgICAociJcYnJvdW5kIGluIHNoYXBlXGIiLCAicm91bmQiLCAiU2hhcGUgaXMgaW1wbGljaXQgaW4g4oCccm91bmTigJ0iLCAiYyIpLAogICAgKHIiXGJzaG9ydCBpbiBkdXJhdGlvblxiIiwgInNob3J0IiwgIkR1cmF0aW9uIGlzIGltcGxpY2l0IGluIOKAnHNob3J04oCdIiwgImMiKSwKICAgICMgLS0tIHN1YmplY3QtdmVyYiBhZ3JlZW1lbnQgKGV4cGFuZGVkKSAtLS0KICAgIChyIlxiZWFjaCBvZiB0aGUgKD86XHcrKSBhcmVcYiIsIHIiZWFjaCBvZiB0aGUgXGc8MD4gaXMiLCAi4oCcRWFjaOKAnSB0YWtlcyBhIHNpbmd1bGFyIHZlcmIiLCAiZyIpLAogICAgKHIiXGJldmVyeSBvbmUgb2YgdGhlICg/Olx3KykgYXJlXGIiLCByImV2ZXJ5IG9uZSBvZiB0aGUgXGc8MD4gaXMiLCAi4oCcRXZlcnkgb25l4oCdIHRha2VzIGEgc2luZ3VsYXIgdmVyYiIsICJnIiksCiAgICAociJcYm5laXRoZXIgb2YgdGhlICg/Olx3KykgYXJlXGIiLCByIm5laXRoZXIgb2YgdGhlIFxnPDA+IGlzIiwgIuKAnE5laXRoZXLigJ0gdGFrZXMgYSBzaW5ndWxhciB2ZXJiIiwgImciKSwKICAgIChyIlxiZWl0aGVyIG9mIHRoZSAoPzpcdyspIGFyZVxiIiwgciJlaXRoZXIgb2YgdGhlIFxnPDA+IGlzIiwgIuKAnEVpdGhlcuKAnSB0YWtlcyBhIHNpbmd1bGFyIHZlcmIiLCAiZyIpLAogICAgKHIiXGJub25lIG9mIHRoZSAoPzpcdyspICg/Ondhc3x3ZXJlKVxiIiwgTm9uZSwgIuKAnE5vbmXigJ0gY2FuIHRha2Ugc2luZ3VsYXIgb3IgcGx1cmFsOyBjaGVjayB0aGUgbm91biIsICJzIiksCiAgICAociJcYnRoZSBudW1iZXIgb2YgKD86XHcrKSBhcmVcYiIsIHIidGhlIG51bWJlciBvZiBcZzwwPiBpcyIsICLigJxUaGUgbnVtYmVyIG9m4oCdIHRha2VzIGEgc2luZ3VsYXIgdmVyYiIsICJnIiksCiAgICAociJcYmEgbnVtYmVyIG9mICg/Olx3KykgaXNcYiIsIHIiYSBudW1iZXIgb2YgXGc8MD4gYXJlIiwgIuKAnEEgbnVtYmVyIG9m4oCdIHRha2VzIGEgcGx1cmFsIHZlcmIiLCAiZyIpLAogICAgKHIiXGJ0aGUgbWFqb3JpdHkgb2YgKD86XHcrKSB3YXNcYiIsIHIidGhlIG1ham9yaXR5IG9mIFxnPDA+IHdlcmUiLCAi4oCcVGhlIG1ham9yaXR5IG9m4oCdIHRha2VzIGEgcGx1cmFsIHZlcmIgd2l0aCBhIHBsdXJhbCBub3VuIiwgImciKSwKICAgICMgLS0tIEdSQU0zOCBtaXJyb3JzOiBhcnRpY2xlcywgbW9yZSBjb25mdXNpb25zLCByZWdpc3Rlciwgd29yZHkgcGhyYXNlcyAtLS0KICAgIChyIlxiYW4gKG9uZXx1c2VyfHVuaXZlcnNpdHl8dW5pcXVlfHVuaWZvcm18dW5pdHxFdXJvcGVhbnx1bmlvbnx1dGlsaXR5KVxiIiwgciJhIFwxIiwgIlRoZXNlIGJlZ2luIHdpdGggYSBjb25zb25hbnQgc291bmQ6IFwiYVwiLCBub3QgXCJhblwiIiwgImciKSwKICAgIChyIlxiYSAoYXBwbGV8b3JhbmdlfGhvdXJ8aG9uZXN0fGhvbm9yfGhvbm91cnxoZWlyKVxiIiwgciJhbiBcMSIsICJUaGVzZSBiZWdpbiB3aXRoIGEgdm93ZWwgc291bmQ6IFwiYW5cIiwgbm90IFwiYVwiIiwgImciKSwKICAgIChyIlxicGxlYXNlIGFkdmljZVxiIiwgInBsZWFzZSBhZHZpc2UiLCAi4oCcQWR2aXNl4oCdIGlzIHRoZSB2ZXJiIiwgImciKSwKICAgIChyIlxiZGV2aWNlIGFcYiIsICJkZXZpc2UgYSIsICLigJxEZXZpc2XigJ0gKGNyZWF0ZSkgdnMg4oCcZGV2aWNl4oCdIChpbnN0cnVtZW50KSIsICJnIiksCiAgICAociJcYmRpc2NyZWV0IChkaWZmZXJlbmNlfGdhcHxzZXBhcmF0aW9ufGludGVydmFsfGNhdGVnb3J5fHZhcmlhYmxlfGZhY3RvcilcYiIsIHIiZGlzY3JldGUgXDEiLCAi4oCcRGlzY3JldGXigJ0gKHNlcGFyYXRlKSB2cyDigJxkaXNjcmVldOKAnSAoY2FyZWZ1bCkiLCAiZyIpLAogICAgKHIiXGJkaXNjcmV0ZSAoYWN0aW9ufG1hbm5lcnxiZWhhdmlvcnxiZWhhdmlvdXJ8YXBwcm9hY2h8c2lsZW5jZSlcYiIsIHIiZGlzY3JlZXQgXDEiLCAi4oCcRGlzY3JlZXTigJ0gKGNhcmVmdWwpIHZzIOKAnGRpc2NyZXRl4oCdIChzZXBhcmF0ZSkiLCAiZyIpLAogICAgKHIiXGJhbHRhciAodGhlfGF8YW58dGhpc3x0aGF0KVxzKyhjb3Vyc2V8ZGlyZWN0aW9ufGFwcHJvYWNofHN0cmF0ZWd5fHBsYW58cG9zaXRpb258YXJndW1lbnR8ZmluZGluZ3xyZXN1bHR8Y29uY2x1c2lvbilcYiIsIHIiYWx0ZXIgXDEgXDIiLCAi4oCcQWx0ZXLigJ0gKGNoYW5nZSkgdnMg4oCcYWx0YXLigJ0gKHNhY3JlZCB0YWJsZSkiLCAiZyIpLAogICAgKHIiXGJ0cmFpbCBhbmQgZXJyb3JcYiIsICJ0cmlhbCBhbmQgZXJyb3IiLCAiVGhlIHBocmFzZSBpcyBcInRyaWFsIGFuZCBlcnJvclwiIiwgImciKSwKICAgIChyIlxiY29uY2Vuc3VzXGIiLCAiY29uc2Vuc3VzIiwgIlRoZSBzcGVsbGluZyBpcyBcImNvbnNlbnN1c1wiIiwgImciKSwKICAgIChyIlxiY29uY2lvdXNcYiIsICJjb25zY2lvdXMiLCAiVGhlIHNwZWxsaW5nIGlzIFwiY29uc2Npb3VzXCIiLCAiZyIpLAogICAgKHIiXGJtYW5hZ2FibGVcYiIsICJtYW5hZ2VhYmxlIiwgIlRoZSBzcGVsbGluZyBpcyBcIm1hbmFnZWFibGVcIiIsICJnIiksCiAgICAociJcYm5vdGljYWJsZVxiIiwgIm5vdGljZWFibGUiLCAiVGhlIHNwZWxsaW5nIGlzIFwibm90aWNlYWJsZVwiIiwgImciKSwKICAgIChyIlxicGVyc2VydmVyYW5jZVxiIiwgInBlcnNldmVyYW5jZSIsICJUaGUgc3BlbGxpbmcgaXMgXCJwZXJzZXZlcmFuY2VcIiIsICJnIiksCiAgICAociJcYnVwbW9zdFxiIiwgInV0bW9zdCIsICLigJxVdG1vc3TigJ0gKGdyZWF0ZXN0KSB2cyDigJx1cG1vc3TigJ0gKHVwcGVybW9zdCkiLCAiZyIpLAogICAgKHIiXGJ2YWNjdW1cYiIsICJ2YWN1dW0iLCAiVGhlIHNwZWxsaW5nIGlzIFwidmFjdXVtXCIiLCAiZyIpLAogICAgKHIiXGJwb3Nlc3Npb25cYiIsICJwb3NzZXNzaW9uIiwgIkRvdWJsZSBzIGluIHRoZSBtaWRkbGUgYW5kIGF0IHRoZSBlbmQiLCAiZyIpLAogICAgKHIiXGJwb3Nlc3Npb25zXGIiLCAicG9zc2Vzc2lvbnMiLCAiRG91YmxlIHMgaW4gdGhlIG1pZGRsZSBhbmQgYXQgdGhlIGVuZCIsICJnIiksCiAgICAociJcYmFwYXJhdHVzXGIiLCAiYXBwYXJhdHVzIiwgIkRvdWJsZSBwIGF0IHRoZSBzdGFydCIsICJnIiksCiAgICAociJcYmNlbWV0YXJ5XGIiLCAiY2VtZXRlcnkiLCAiVGhlIHNwZWxsaW5nIGlzIFwiY2VtZXRlcnlcIiIsICJnIiksCiAgICAociJcYmNvbWl0dGVlXGIiLCAiY29tbWl0dGVlIiwgIkRvdWJsZSBtLCBkb3VibGUgdCwgZG91YmxlIGUiLCAiZyIpLAogICAgKHIiXGJleGlzdGFuY2VcYiIsICJleGlzdGVuY2UiLCAiVGhlIHNwZWxsaW5nIGlzIFwiZXhpc3RlbmNlXCIiLCAiZyIpLAogICAgKHIiXGJvY2Nhc3Npb25hbFxiIiwgIm9jY2FzaW9uYWwiLCAiVHdvIGMsIG9uZSBzIiwgImciKSwKICAgIChyIlxicGVyc2lzdGFudFxiIiwgInBlcnNpc3RlbnQiLCAiVGhlIGVuZGluZyBpcyBcIi1lbnRcIiIsICJnIiksCiAgICAociJcYnJlbGV2ZW50XGIiLCAicmVsZXZhbnQiLCAiVGhlIHNwZWxsaW5nIGlzIFwicmVsZXZhbnRcIiIsICJnIiksCiAgICAociJcYmluZGVwZW5kYW50XGIiLCAiaW5kZXBlbmRlbnQiLCAi4oCcZW504oCdIGlzIHRoZSBlbmRpbmciLCAiZyIpLAogICAgIyByZWdpc3RlciB1cGdyYWRlcwogICAgKHIiXGJhIGxvdCBvZiAocmVzZWFyY2h8c3R1ZGllc3xldmlkZW5jZXxkYXRhfHNjaG9sYXJzfGxpdGVyYXR1cmV8d29ya3xhdHRlbnRpb258ZWZmb3J0fGZvY3VzfGRlYmF0ZXxkaXNjdXNzaW9uKVxiIiwgTm9uZSwgIuKAnE11Y2jigJ0gb3IgXCJzdWJzdGFudGlhbFwiIGNhcnJpZXMgbW9yZSBhY2FkZW1pYyB3ZWlnaHQiLCAicyIpLAogICAgKHIiXGJsb3RzIG9mIChyZXNlYXJjaHxzdHVkaWVzfGV2aWRlbmNlfGRhdGF8c2Nob2xhcnN8bGl0ZXJhdHVyZXx3b3JrfGF0dGVudGlvbnxlZmZvcnR8Zm9jdXN8ZGViYXRlfGRpc2N1c3Npb24pXGIiLCBOb25lLCAi4oCcTXVjaOKAnSBvciBcInN1YnN0YW50aWFsXCIgY2FycmllcyBtb3JlIGFjYWRlbWljIHdlaWdodCIsICJzIiksCiAgICAociJcYnNob3dzPyB0aGF0XGIiLCBOb25lLCAi4oCcRGVtb25zdHJhdGVzXCIsIFwiaW5kaWNhdGVzXCIsIG9yIFwicmV2ZWFsc1wiIGlzIHN0cm9uZ2VyIiwgInMiKSwKICAgIChyIlxidGFsa3M/IGFib3V0XGIiLCBOb25lLCAi4oCcRGlzY3Vzc2VzXCIsIFwiYWRkcmVzc2VzXCIsIG9yIFwiZXhhbWluZXNcIiByZWFkcyBtb3JlIGZvcm1hbGx5IiwgInMiKSwKICAgIChyIlxibG9va3M/IGF0XGIiLCBOb25lLCAi4oCcRXhhbWluZXNcIiwgXCJpbnZlc3RpZ2F0ZXNcIiwgb3IgXCJhbmFseXNlc1wiIHJlYWRzIG1vcmUgZm9ybWFsbHkiLCAicyIpLAogICAgKHIiXGJkZWFscz8gd2l0aFxiIiwgTm9uZSwgIuKAnEFkZHJlc3Nlc1wiLCBcInRyZWF0c1wiLCBvciBcImVuZ2FnZXMgd2l0aFwiIHJlYWRzIG1vcmUgZm9ybWFsbHkiLCAicyIpLAogICAgKHIiXGJwb2ludHM/IG91dFxiIiwgTm9uZSwgIuKAnE5vdGVzXCIsIFwib2JzZXJ2ZXNcIiwgb3IgXCJhcmd1ZXNcIiByZWFkcyBtb3JlIGZvcm1hbGx5IiwgInMiKSwKICAgIChyIlxiZmluZHM/IG91dFxiIiwgTm9uZSwgIuKAnERpc2NvdmVyc1wiLCBcImRldGVybWluZXNcIiwgb3IgXCJhc2NlcnRhaW5zXCIgcmVhZHMgbW9yZSBmb3JtYWxseSIsICJzIiksCiAgICAjIG1vcmUgd29yZHkgcGhyYXNlcwogICAgKHIiXGJ3aXRoIHRoZSBleGNlcHRpb24gb2ZcYiIsICJleGNlcHQiLCAi4oCcRXhjZXB0XCIgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAociJcYmluIHRoZSBuZWlnaGJvcmhvb2Qgb2ZcYiIsICJhcHByb3hpbWF0ZWx5IiwgIuKAnEFwcHJveGltYXRlbHlcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiYSBsYXJnZSBudW1iZXIgb2ZcYiIsICJtYW55IiwgIuKAnE1hbnlcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiYSBzbWFsbCBudW1iZXIgb2ZcYiIsICJmZXciLCAi4oCcRmV3XCIgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAociJcYmluIHRoZSB2aWNpbml0eSBvZlxiIiwgIm5lYXIiLCAi4oCcTmVhclwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJ3aXRoIHJlZmVyZW5jZSB0b1xiIiwgInJlZ2FyZGluZyIsICLigJxSZWdhcmRpbmdcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiaW4gY29ubmVjdGlvbiB3aXRoXGIiLCAiYWJvdXQiLCAi4oCcQWJvdXRcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiYXMgYSBtYXR0ZXIgb2YgZmFjdFxiIiwgImluIGZhY3QiLCAi4oCcSW4gZmFjdFwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJpbiB0aGUgZmluYWwgYW5hbHlzaXNcYiIsICJ1bHRpbWF0ZWx5IiwgIuKAnFVsdGltYXRlbHlcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiZm9yIHRoZSBtb3N0IHBhcnRcYiIsICJtb3N0bHkiLCAi4oCcTW9zdGx5XCIgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAociJcYmJ5IG1lYW5zIG9mXGIiLCAiYnkiLCAi4oCcQnlcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiYnkgdmlydHVlIG9mXGIiLCAiYmVjYXVzZSIsICLigJxCZWNhdXNlXCIgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAociJcYm9uIHRoZSBncm91bmRzIHRoYXRcYiIsICJiZWNhdXNlIiwgIuKAnEJlY2F1c2VcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxic28gYXMgdG9cYiIsICJ0byIsICLigJxUb1wiIGFsb25lIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJpbiB0aGUgbm90IHRvbyBkaXN0YW50IGZ1dHVyZVxiIiwgInNvb24iLCAi4oCcU29vblwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgIyBtb3JlIGRvdWJsZWQgd29yZHMKICAgIChyIlxiZm9yIGZvclxiIiwgImZvciIsICJUaGUgd29yZCBpcyBkb3VibGVkIiwgImciKSwKICAgIChyIlxid2l0aCB3aXRoXGIiLCAid2l0aCIsICJUaGUgd29yZCBpcyBkb3VibGVkIiwgImciKSwKICAgIChyIlxid2FzIHdhc1xiIiwgIndhcyIsICJUaGUgd29yZCBpcyBkb3VibGVkIiwgImciKSwKICAgIChyIlxiYXJlIGFyZVxiIiwgImFyZSIsICJUaGUgd29yZCBpcyBkb3VibGVkIiwgImciKSwKICAgIChyIlxid2lsbCB3aWxsXGIiLCAid2lsbCIsICJUaGUgd29yZCBpcyBkb3VibGVkIiwgImciKSwKICAgIChyIlxiaGF2ZSBoYXZlXGIiLCAiaGF2ZSIsICJUaGUgd29yZCBpcyBkb3VibGVkIiwgImciKSwKICAgICMgY29tcG91bmQgbW9kaWZpZXIgaHlwaGVuYXRpb24KICAgIChyIlxid2VsbCAoa25vd258ZG9jdW1lbnRlZHxlc3RhYmxpc2hlZHxmb3VuZGVkfGFyZ3VlZHxkZWZpbmVkfGRldmVsb3BlZHxyZXNlYXJjaGVkfHN1cHBvcnRlZHxpbmZvcm1lZHxpbnRlbnRpb25lZClcYig/PVxzK1thLXpdKSIsIHIid2VsbC1cMSIsICJIeXBoZW5hdGUgYSBjb21wb3VuZCBtb2RpZmllciBiZWZvcmUgYSBub3VuIiwgImciKSwKICAgIChyIlxiaGlnaCAocXVhbGl0eXxyaXNrfGxldmVsfHNwZWVkfGRlbnNpdHl8ZnJlcXVlbmN5fHJlc29sdXRpb258cGVyZm9ybWFuY2UpXGIoPz1ccytbYS16XSkiLCByImhpZ2gtXDEiLCAiSHlwaGVuYXRlIGEgY29tcG91bmQgbW9kaWZpZXIgYmVmb3JlIGEgbm91biIsICJnIiksCiAgICAociJcYmxvbmcgKHRlcm18c3RhbmRpbmd8cnVubmluZ3xoZWxkfGVzdGFibGlzaGVkKVxiKD89XHMrW2Etel0pIiwgciJsb25nLVwxIiwgIkh5cGhlbmF0ZSBhIGNvbXBvdW5kIG1vZGlmaWVyIGJlZm9yZSBhIG5vdW4iLCAiZyIpLAogICAgKHIiXGJjcm9zcyAoc2VjdGlvbnxjdWx0dXJhbHxkaXNjaXBsaW5hcnl8bmF0aW9uYWx8Ym9yZGVyfHJlZmVyZW5jZSlcYig/PVxzK1thLXpdKSIsIHIiY3Jvc3MtXDEiLCAiSHlwaGVuYXRlIGEgY29tcG91bmQgbW9kaWZpZXIgYmVmb3JlIGEgbm91biIsICJnIiksCl0pCgpfSEVfQ09NUElMRUQgPSBbKF9yZTIuY29tcGlsZShwLCBfcmUyLkkpLCByZXAsIHdoeSwgY2F0KQogICAgICAgICAgICAgICAgZm9yIHAsIHJlcCwgd2h5LCBjYXQgaW4gX0hFVVIgaWYgcCBpcyBub3QgTm9uZV0KCl9ET1VCTEVEID0gX3JlMi5jb21waWxlKHIiXGIoW0EtWmEtel0rKVxzK1wxXGIiLCBfcmUyLkkpCl9ET1VCTEVEX09LID0geyJoYWQiLCAidGhhdCIsICJubyIsICJpcyIsICJiZSJ9CgpkZWYgX2hldXJpc3RpY19jb3JyZWN0KHRleHQpOgogICAgIiIiVGhlIG9mZmxpbmUgbGFuZTogcmVhbCBlZGl0cyB3aXRob3V0IGEgbW9kZWwsIG1pcnJvcmluZyB0aGUgcGFnZSdzIHJ1bGVzLiIiIgogICAgZWRpdHMgPSBbXQogICAgZm9yIHJ4LCByZXAsIHdoeSwgY2F0IGluIF9IRV9DT01QSUxFRDoKICAgICAgICBmb3IgbSBpbiByeC5maW5kaXRlcih0ZXh0KToKICAgICAgICAgICAgbyA9IG0uZ3JvdXAoMCkKICAgICAgICAgICAgZiA9IE5vbmUKICAgICAgICAgICAgaWYgcmVwIGlzIG5vdCBOb25lOgogICAgICAgICAgICAgICAgZiA9IG0uZXhwYW5kKHJlcCkKICAgICAgICAgICAgICAgIGlmIG0uZ3JvdXAoMClbOjFdLmlzdXBwZXIoKToKICAgICAgICAgICAgICAgICAgICBmID0gZls6MV0udXBwZXIoKSArIGZbMTpdCiAgICAgICAgICAgIGVkaXRzLmFwcGVuZCh7InN0YXJ0IjogbS5zdGFydCgpLCAiZW5kIjogbS5lbmQoKSwgIm9yaWciOiBvLAogICAgICAgICAgICAgICAgICAgICAgICAgICJmaXgiOiBmLCAid2h5Ijogd2h5IG9yICIiLCAiY2F0IjogY2F0IG9yICJnIn0pCiAgICBmb3IgbSBpbiBfRE9VQkxFRC5maW5kaXRlcih0ZXh0KToKICAgICAgICB3ID0gbS5ncm91cCgxKQogICAgICAgIGlmIHcubG93ZXIoKSBpbiBfRE9VQkxFRF9PSzoKICAgICAgICAgICAgY29udGludWUKICAgICAgICBlZGl0cy5hcHBlbmQoeyJzdGFydCI6IG0uc3RhcnQoMSksICJlbmQiOiBtLmVuZCgxKSArIGxlbih3KSArIDEsCiAgICAgICAgICAgICAgICAgICAgICAib3JpZyI6IG0uZ3JvdXAoMCksICJmaXgiOiB3LAogICAgICAgICAgICAgICAgICAgICAgIndoeSI6ICJUaGUgZG91YmxlZCB3b3JkIiwgImNhdCI6ICJnIn0pCiAgICAjIHRoZSBwYWlyOiBhIGJlZm9yZSB2b3dlbHMgdGFrZXMgYW4KICAgIGZvciBtIGluIF9yZTIuZmluZGl0ZXIociJcYihhKVxzKyhbQS1aYS16XXszLH0pXGIiLCB0ZXh0KToKICAgICAgICB3ID0gbS5ncm91cCgyKQogICAgICAgIGxvdyA9IHcubG93ZXIoKQogICAgICAgIGlmIGxvd1s6MV0gaW4gImFlaW91IiBhbmQgbm90IGxvdy5zdGFydHN3aXRoKCgidW5pIiwgIm9uZSIsICJvbmNlIiwgImV1IiwgInVzdSIpKToKICAgICAgICAgICAgZWRpdHMuYXBwZW5kKHsic3RhcnQiOiBtLnN0YXJ0KCksICJlbmQiOiBtLmVuZCgpLCAib3JpZyI6IG0uZ3JvdXAoMCksCiAgICAgICAgICAgICAgICAgICAgICAgICAgImZpeCI6ICJhbiAiICsgdywgIndoeSI6ICLigJxh4oCdIGJlZm9yZSBhIHZvd2VsIHNvdW5kIHdhbnRzIOKAnGFu4oCdIiwKICAgICAgICAgICAgICAgICAgICAgICAgICAiY2F0IjogImcifSkKICAgIGZvciBtIGluIF9yZTIuZmluZGl0ZXIociJcYihBbnxhbilccysoW2JjZGZnaGprbG1ucHFyc3R2d3h5el1bYS16XXsyLH0pXGIiLCB0ZXh0KToKICAgICAgICB3ID0gbS5ncm91cCgyKQogICAgICAgIGxvdyA9IHcubG93ZXIoKQogICAgICAgIGlmIG5vdCBsb3cuc3RhcnRzd2l0aCgoImhvdSIsICJoZWkiLCAiaG9uZSIsICJob25vIiwgInN1diIsICJtdnAiLCAic3FsIiwgImhlciIpKToKICAgICAgICAgICAgZWRpdHMuYXBwZW5kKHsic3RhcnQiOiBtLnN0YXJ0KCksICJlbmQiOiBtLmVuZCgpLCAib3JpZyI6IG0uZ3JvdXAoMCksCiAgICAgICAgICAgICAgICAgICAgICAgICAgImZpeCI6ICgiQSAiIGlmIG0uZ3JvdXAoMSkgPT0gIkFuIiBlbHNlICJhICIpICsgdywKICAgICAgICAgICAgICAgICAgICAgICAgICAid2h5IjogIuKAnGFu4oCdIGJlbG9uZ3MgYmVmb3JlIHZvd2VsIHNvdW5kcyBvbmx5IiwgImNhdCI6ICJnIn0pCiAgICBlZGl0cy5zb3J0KGtleT1sYW1iZGEgeDogeFsic3RhcnQiXSkKICAgIG91dCA9IFtdCiAgICBzZWVuID0gc2V0KCkKICAgIGZvciBlIGluIGVkaXRzOgogICAgICAgIGsgPSAoZVsic3RhcnQiXSwgZVsiZW5kIl0pCiAgICAgICAgaWYgayBpbiBzZWVuOgogICAgICAgICAgICBjb250aW51ZQogICAgICAgIHNlZW4uYWRkKGspCiAgICAgICAgb3V0LmFwcGVuZChlKQogICAgcmV0dXJuIG91dAoKZGVmIGhldXJpc3RpY19yZXdyaXRlKHRleHQsIG1vZGUpOgogICAgIiIiVGhlIG9mZmxpbmUgbGFuZSBmb3IgcmV3cml0ZTogaG9uZXN0IHRpZ2h0ZW5pbmcgb25seSwgbm8gaW52ZW50aW9uLiIiIgogICAgdCA9IHRleHQgb3IgIiIKICAgIGlmIG1vZGUgPT0gImNvbmNpc2UiIG9yIG1vZGUgPT0gInNob3J0ZW4iOgogICAgICAgIHQgPSBUSUdIVEVOX1BBVC5zdWIobGFtYmRhIG06ICIiLCB0KQogICAgICAgIHQgPSBfcmUyLnN1YihyIiAgKyIsICIgIiwgdCkKICAgICAgICB0ID0gVElHSFRFTl9QQVQyLnN1YihsYW1iZGEgbTogIiIsIHQpCiAgICAgICAgdCA9IF9yZTIuc3ViKHIiICArIiwgIiAiLCB0KQogICAgaWYgbW9kZSA9PSAiY29uZmlkZW50IjoKICAgICAgICB0ID0gX3JlMi5zdWIociJcYihjb3VsZCBwb3NzaWJseXxJIHRoaW5rIHRoYXR8SSBmZWVsIHRoYXR8SSBiZWxpZXZlIHRoYXQpXGJccyoiLCAiIiwgdCwgZmxhZ3M9X3JlMi5JKQogICAgICAgIHQgPSBfcmUyLnN1YihyIlxiKG1heWJlfHBlcmhhcHN8cG9zc2libHkpXGJccyoiLCAiIiwgdCwgZmxhZ3M9X3JlMi5JKQogICAgICAgIHQgPSBfcmUyLnN1YihyIlxzezIsfSIsICIgIiwgdCkuc3RyaXAoKQogICAgICAgIGlmIHQ6CiAgICAgICAgICAgIHQgPSB0WzBdLnVwcGVyKCkgKyB0WzE6XQogICAgcmV0dXJuIHQKCl9USUdIVEVOX1dPUkRTID0gWyJ2ZXJ5IiwgInJlYWxseSIsICJqdXN0IiwgInF1aXRlIiwgImFjdHVhbGx5IiwgImJhc2ljYWxseSIsICJsaXRlcmFsbHkiLAogICAgICAgICAgICAgICAgICAiZ2VuZXJhbGx5IiwgInByZXR0eSBtdWNoIiwgImEgYml0IiwgImEgbGl0dGxlIiwgInNvcnQgb2YiLCAia2luZCBvZiJdClRJR0hURU5fUEFUID0gX3JlMi5jb21waWxlKHIiXHMrXGIoPzoiICsgInwiLmpvaW4oX3JlMi5lc2NhcGUodykgZm9yIHcgaW4gX1RJR0hURU5fV09SRFMpICsgciIpXGIiLCBfcmUyLkkpClRJR0hURU5fUEFUMiA9IF9yZTIuY29tcGlsZShyIlxiKD86IiArICJ8Ii5qb2luKF9yZTIuZXNjYXBlKHcpIGZvciB3IGluIF9USUdIVEVOX1dPUkRTKSArIHIiKVxiXHMrIiwgX3JlMi5JKQpDT05GX1BBVCA9IF9yZTIuY29tcGlsZShyIlxiKG1heWJlfHBlcmhhcHN8bWlnaHR8Y291bGQgcG9zc2libHl8SSB0aGluayB0aGF0fEkgZmVlbCB0aGF0fEkgYmVsaWV2ZSB0aGF0KVxiW14uIT9dKiIsIF9yZTIuSSkKCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBlbmRwb2ludHMKX0NPUlJFQ1RfQ0FDSEUgPSB7fQpfQ09SUkVDVF9DQUNIRV9NQVggPSA1MDAKCgpkZWYgZXBfY29ycmVjdChib2R5KToKICAgIHRleHQgPSBib2R5LmdldCgidGV4dCIsICIiKQogICAgaWYgbm90IHRleHQuc3RyaXAoKToKICAgICAgICByZXR1cm4geyJlZGl0cyI6IFtdfQogICAgaWYgQUlbInJlYWR5Il06CiAgICAgICAgZW5naW5lID0gQUlbImdlYyJdIG9yIEFJWyJwaXBlIl0KICAgICAgICBwcmVmaXggPSAoIkZpeCB0aGUgZ3JhbW1hciwgc3BlbGxpbmcgYW5kIHB1bmN0dWF0aW9uIG9mIHRoaXMgc2VudGVuY2UuICIKICAgICAgICAgICAgICAgICAgIlByZXNlcnZlIG1lYW5pbmcsIG51bWJlcnMgYW5kIGNpdGF0aW9ucy4gT3V0cHV0IE9OTFkgdGhlIGNvcnJlY3RlZCBzZW50ZW5jZTogIgogICAgICAgICAgICAgICAgICBpZiBBSVsiZ2VjIl0gZWxzZQogICAgICAgICAgICAgICAgICAiQ29ycmVjdCB0aGUgZ3JhbW1hciwgc3BlbGxpbmcsIHB1bmN0dWF0aW9uIGFuZCB3b3JkIGNob2ljZSBvZiB0aGlzIHNlbnRlbmNlICIKICAgICAgICAgICAgICAgICAgImZvciBmb3JtYWwgYWNhZGVtaWMgRW5nbGlzaC4gUHJlc2VydmUgbWVhbmluZywgbnVtYmVycyBhbmQgY2l0YXRpb25zIGV4YWN0bHkuICIKICAgICAgICAgICAgICAgICAgIk91dHB1dCBPTkxZIHRoZSBjb3JyZWN0ZWQgc2VudGVuY2U6ICIpCiAgICAgICAgZWRpdHMgPSBbXQogICAgICAgIHNlbnRzID0gWyhtLmdyb3VwKCkuc3RyaXAoKSwgbS5zdGFydCgpKSBmb3IgbSBpbiByZS5maW5kaXRlcihyIlteLiE/XG5dK1suIT9dP1xzKiIsIHRleHQpXQogICAgICAgIGRpYWxlY3QgPSBib2R5LmdldCgiZGlhbGVjdCIsICJvZmYiKQogICAgICAgIGRjbCA9ICJVc2UgQW1lcmljYW4gc3BlbGxpbmcuICIgaWYgZGlhbGVjdCA9PSAidXMiIGVsc2UgKCJVc2UgQnJpdGlzaCBzcGVsbGluZy4gIiBpZiBkaWFsZWN0ID09ICJ1ayIgZWxzZSAiIikKICAgICAgICBmb3Igc2VudCwgb2ZmIGluIHNlbnRzOgogICAgICAgICAgICBpZiBsZW4oc2VudC5zcGxpdCgpKSA8IDM6CiAgICAgICAgICAgICAgICBjb250aW51ZQogICAgICAgICAgICAjIHNlbnRlbmNlLWxldmVsIGNhY2hlOiB1bmNoYW5nZWQgc2VudGVuY2VzIHNraXAgaW5mZXJlbmNlIGVudGlyZWx5CiAgICAgICAgICAgIGNhY2hlX2tleSA9IGhhc2goc2VudCArICJ8IiArIGRjbCArICJ8IiArIChBSS5nZXQoImxvY2FsX25hbWUiKSBvciBJTlNUUlVDVF9NT0RFTCkpCiAgICAgICAgICAgIGlmIGNhY2hlX2tleSBpbiBfQ09SUkVDVF9DQUNIRToKICAgICAgICAgICAgICAgIGNhY2hlZCA9IF9DT1JSRUNUX0NBQ0hFW2NhY2hlX2tleV0KICAgICAgICAgICAgICAgIGlmIGNhY2hlZCBpcyBub3QgTm9uZSBhbmQgY2FjaGVkLmxvd2VyKCkgIT0gc2VudC5sb3dlcigpOgogICAgICAgICAgICAgICAgICAgIGVkaXRzICs9IHdvcmRfZGlmZl9lZGl0cyhzZW50LCBjYWNoZWQsIG9mZikKICAgICAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgICAgIGlmIEFJLmdldCgibG9jYWwiKToKICAgICAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgICAgICBmaXhlZCA9IHN0cmlwX3RoaW5rKF9nZW5lcmF0ZV9sb2NhbChzZW50LCBtYXhfbmV3X3Rva2Vucz1taW4oMjU2LCBsZW4oc2VudC5zcGxpdCgpKSAqIDIgKyAyMCksCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3lzdGVtPVBST09GX1NZU1RFTSArICgiICIgKyBkY2wgaWYgZGNsIGVsc2UgIiIpLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBlcmF0dXJlPTAuMCkgb3IgIiIpCiAgICAgICAgICAgICAgICAgICAgZml4ZWQgPSBmaXhlZC5zdHJpcCgpIGlmIGZpeGVkIGVsc2UgIiIKICAgICAgICAgICAgICAgICAgICBpZiBsZW4oX0NPUlJFQ1RfQ0FDSEUpIDwgX0NPUlJFQ1RfQ0FDSEVfTUFYOgogICAgICAgICAgICAgICAgICAgICAgICBfQ09SUkVDVF9DQUNIRVtjYWNoZV9rZXldID0gZml4ZWQgb3IgTm9uZQogICAgICAgICAgICAgICAgICAgIGlmIGZpeGVkIGFuZCBmaXhlZC5sb3dlcigpICE9IHNlbnQubG93ZXIoKToKICAgICAgICAgICAgICAgICAgICAgICAgZWRpdHMgKz0gd29yZF9kaWZmX2VkaXRzKHNlbnQsIGZpeGVkLCBvZmYpCiAgICAgICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICAgICAgICAgIHBhc3MKICAgICAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIG91dCA9IGVuZ2luZShwcmVmaXggKyBzZW50LAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heF9uZXdfdG9rZW5zPW1pbigyNTYsIGludChsZW4oc2VudC5zcGxpdCgpKSAqIDIpICsgMjApLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvX3NhbXBsZT1GYWxzZSwgcmVwZXRpdGlvbl9wZW5hbHR5PTEuMikKICAgICAgICAgICAgICAgIGZpeGVkID0gb3V0WzBdLmdldCgiZ2VuZXJhdGVkX3RleHQiLCAiIikuc3RyaXAoKQogICAgICAgICAgICAgICAgaWYgbGVuKF9DT1JSRUNUX0NBQ0hFKSA8IF9DT1JSRUNUX0NBQ0hFX01BWDoKICAgICAgICAgICAgICAgICAgICBfQ09SUkVDVF9DQUNIRVtjYWNoZV9rZXldID0gZml4ZWQgb3IgTm9uZQogICAgICAgICAgICAgICAgaWYgZml4ZWQgYW5kIGZpeGVkLmxvd2VyKCkgIT0gc2VudC5sb3dlcigpOgogICAgICAgICAgICAgICAgICAgIGVkaXRzICs9IHdvcmRfZGlmZl9lZGl0cyhzZW50LCBmaXhlZCwgb2ZmKQogICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICAgICAgY29udGludWUKICAgICAgICByZXR1cm4geyJlZGl0cyI6IGVkaXRzfQogICAgcmV0dXJuIHsiZWRpdHMiOiBfaGV1cmlzdGljX2NvcnJlY3QodGV4dCl9ICAjIHRoZSBvZmZsaW5lIGxhbmUgYW5zd2VycyBmb3IgcmVhbAoKClJFV1JJVEVfUFJPTVBUUyA9IHsKICAgICJwcm9mZXNzaW9uYWwiOiAiUmV3cml0ZSB0aGUgZm9sbG93aW5nIGluIHBvbGlzaGVkIHByb2Zlc3Npb25hbCBFbmdsaXNoLiBVc2UgcHJlY2lzZSB2ZXJicywgYWN0aXZlIHZvaWNlIHdoZXJlIG5hdHVyYWwsIHZhcmllZCBzZW50ZW5jZSBzdHJ1Y3R1cmUuIEtlZXAgZXZlcnkgZmFjdCwgbnVtYmVyLCBjaXRhdGlvbiBhbmQgdGhlIG9yaWdpbmFsIG1lYW5pbmcgaW50YWN0LiIsCiAgICAiY2FzdWFsIjogIlJld3JpdGUgdGhlIGZvbGxvd2luZyBpbiByZWxheGVkLCB3YXJtLCBjb252ZXJzYXRpb25hbCBFbmdsaXNoLiBBbGxvdyBjb250cmFjdGlvbnMsIHNob3J0ZXIgc2VudGVuY2VzLCBldmVyeWRheSB3b3Jkcy4gS2VlcCBldmVyeSBmYWN0IGFuZCB0aGUgb3JpZ2luYWwgbWVhbmluZy4iLAogICAgInNjaG9sYXJseSI6ICJSZXdyaXRlIHRoZSBmb2xsb3dpbmcgaW4gZm9ybWFsIHNjaG9sYXJseSBFbmdsaXNoIHN1aXRhYmxlIGZvciBhIGRvY3RvcmFsIHRoZXNpcy4gVXNlIHByZWNpc2UgYWNhZGVtaWMgZGljdGlvbiwgdGhpcmQgcGVyc29uLCBubyBjb250cmFjdGlvbnMsIGhlZGdlZCBzcGVjdWxhdGl2ZSBjbGFpbXMgd2l0aCBhcHByb3ByaWF0ZSBlcGlzdGVtaWMgbWFya2VycywgdmFyaWVkIHNlbnRlbmNlIHN0cnVjdHVyZSB3aXRoIHN1Ym9yZGluYXRlIGNsYXVzZXMgd2hlcmUgdGhleSBhaWQgYXJndW1lbnQuIFByZXNlcnZlIGV2ZXJ5IGNpdGF0aW9uLCBudW1iZXIsIHByb3BlciBub3VuIGFuZCB0aGUgb3JpZ2luYWwgbWVhbmluZyBleGFjdGx5LiIsCiAgICAiY29uY2lzZSI6ICJSZXdyaXRlIHRoZSBmb2xsb3dpbmcgYXMgY29uY2lzZWx5IGFzIHBvc3NpYmxlLiBSZW1vdmUgZXZlcnkgcmVkdW5kYW50IHdvcmQsIHRpZ2h0ZW4gY2xhdXNlcywgbWVyZ2Ugc2VudGVuY2VzIHdoZXJlIHRoZSBsb2dpYyBwZXJtaXRzLiBMb3NlIG5vIG1lYW5pbmcsIG5vIGZhY3QsIG5vIGNpdGF0aW9uLiIsCiAgICAiY29uZmlkZW50IjogIlJld3JpdGUgdGhlIGZvbGxvd2luZyB0byBzb3VuZCBjb25maWRlbnQgYW5kIHdlbGwtc3VwcG9ydGVkLiBSZW1vdmUgdW5uZWNlc3NhcnkgaGVkZ2luZyBmcm9tIGZhY3R1YWwgc3RhdGVtZW50cywga2VlcCBoZWRnaW5nIG9ubHkgb24gZ2VudWluZWx5IHNwZWN1bGF0aXZlIGNsYWltcy4gVXNlIHN0cm9uZyBwcmVjaXNlIHZlcmJzLiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBtZWFuaW5nLiIsCiAgICAic2hvcnRlbiI6ICJTaG9ydGVuIHRoZSBmb2xsb3dpbmcgc2lnbmlmaWNhbnRseS4gS2VlcCBhbGwga2V5IHBvaW50cywgY2l0YXRpb25zIGFuZCBudW1iZXJzIGJ1dCBjdXQgZXZlcnkgd29yZCB0aGF0IGRvZXMgbm90IGNhcnJ5IG1lYW5pbmcuIiwKICAgICJleHBhbmQiOiAiRXhwYW5kIHRoZSBmb2xsb3dpbmcgd2l0aCByaWNoZXIgZGV0YWlsLCBmdWxsZXIgZXhwbGFuYXRpb24sIHNtb290aGVyIHRyYW5zaXRpb25zIGJldHdlZW4gc2VudGVuY2VzIGFuZCBwYXJhZ3JhcGhzLiBBZGQgbm8gZmFicmljYXRlZCBmYWN0cywgY2l0YXRpb25zIG9yIHN0YXRpc3RpY3MuIEtlZXAgdGhlIG9yaWdpbmFsIG1lYW5pbmcgYW5kIGV4cGFuZCBvbmx5IHdoYXQgaXMgYWxyZWFkeSBpbXBsaWVkIG9yIHN0YXRlZC4iLAogICAgInN1bW1hcml6ZSI6ICJTdW1tYXJpemUgdGhlIGZvbGxvd2luZyBpbnRvIGEgdGlnaHQgc2luZ2xlIHBhcmFncmFwaCB0aGF0IGNhcHR1cmVzIHRoZSBjZW50cmFsIGFyZ3VtZW50IGFuZCBhbGwga2V5IGZpbmRpbmdzLiBQcmVzZXJ2ZSBldmVyeSBjaXRhdGlvbiByZWZlcmVuY2UgdGhhdCBhcHBlYXJzIGluIHRoZSBvcmlnaW5hbC4iLAogICAgInBhcmFwaHJhc2UiOiAiUGFyYXBocmFzZSB0aGUgZm9sbG93aW5nOiBzYW1lIG1lYW5pbmcsIGVudGlyZWx5IG5ldyB3b3JkaW5nIGFuZCBkaWZmZXJlbnQgc2VudGVuY2Ugc3RydWN0dXJlcy4gS2VlcCBhbGwgY2l0YXRpb25zLCBudW1iZXJzLCBwcm9wZXIgbm91bnMgYW5kIHRoZSByZWdpc3RlciBleGFjdGx5LiBEbyBub3QgYWRkIG9yIHJlbW92ZSBhbnkgY2xhaW0uIiwKICAgICJodW1hbml6ZSI6ICJNYWtlIHRoZSBmb2xsb3dpbmcgc291bmQgbmF0dXJhbCBhbmQgZ2VudWluZWx5IGh1bWFuLiBWYXJ5IHNlbnRlbmNlIGxlbmd0aCwgcHJlZmVyIHBsYWluIHdvcmRzIG92ZXIgamFyZ29uLCBhbGxvdyBjb250cmFjdGlvbnMgd2hlcmUgdGhlIHJlZ2lzdGVyIHBlcm1pdHMsIHJlYWQgYWxvdWQgc21vb3RobHkuIEtlZXAgZXZlcnkgZmFjdCwgY2l0YXRpb24gYW5kIHRoZSBvcmlnaW5hbCBtZWFuaW5nLiIsCiAgICAiY3JlYXRpdmUiOiAiUmV3cml0ZSB0aGUgZm9sbG93aW5nIHdpdGggdml2aWQsIGltYWdpbmF0aXZlIHByb3NlLiBVc2UgZnJlc2ggbWV0YXBob3JzLCBzZW5zb3J5IGRldGFpbCwgYW5kIHZhcmllZCByaHl0aG0uIEtlZXAgZXZlcnkgZmFjdCBhbmQgY2l0YXRpb24gaW50YWN0LiBFbGV2YXRlIHRoZSBsYW5ndWFnZSB3aXRob3V0IGZhYnJpY2F0aW5nIGNvbnRlbnQuIiwKICAgICJhbmFseXRpY2FsIjogIlJld3JpdGUgdGhlIGZvbGxvd2luZyBpbiBwcmVjaXNlIGFuYWx5dGljYWwgRW5nbGlzaC4gUHJpb3JpdGlzZSBsb2dpY2FsIGNvbm5lY3RpdmVzLCBleHBsaWNpdCB3YXJyYW50cyBiZXR3ZWVuIGNsYWltcyBhbmQgZXZpZGVuY2UsIGFuZCBjYXJlZnVsIHF1YWxpZmljYXRpb24gb2Ygc2NvcGUuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMsIG51bWJlcnMgYW5kIG1lYW5pbmcuIiwKfQoKIyBHcmFtbWFybHktc3R5bGUgcmV3cml0ZSBwcmVzZXRzOiBzcGVjaWZpYyBwYXJhZ3JhcGgtbGV2ZWwgZ29hbHMgdGhlIHVzZXIKIyBjYW4gYXBwbHkgdG8gYSBzZWxlY3RlZCBwYXNzYWdlLiBFYWNoIHByZXNldCBjYXJyaWVzIGEgZGV0YWlsZWQgaW5zdHJ1Y3Rpb24KIyB0aGF0IGd1aWRlcyB0aGUgbW9kZWwgdG93YXJkIGEgc3BlY2lmaWMgcXVhbGl0eSwgbm90IGp1c3QgYSByZWdpc3Rlci4KUkVXUklURV9QUkVTRVRTID0gewogICAgImZvcm1hbCI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBpbiBmb3JtYWwgYWNhZGVtaWMgRW5nbGlzaC4gRWxpbWluYXRlIGNvbGxvcXVpYWxpc21zLCBjb250cmFjdGlvbnMsIGFuZCBjYXN1YWwgcGhyYXNpbmcuIFVzZSBwcmVjaXNlIGRpY3Rpb24sIGNvbXBsZXRlIHNlbnRlbmNlcywgYW5kIG1lYXN1cmVkIHRvbmUuIFByZXNlcnZlIGV2ZXJ5IGZhY3QsIGNpdGF0aW9uLCBhbmQgbnVtYmVyIGV4YWN0bHkuIiwKICAgICJpbmZvcm1hbCI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBpbiBjbGVhciwgYXBwcm9hY2hhYmxlIEVuZ2xpc2guIFVzZSBjb250cmFjdGlvbnMsIHNob3J0ZXIgc2VudGVuY2VzLCBhbmQgZXZlcnlkYXkgdm9jYWJ1bGFyeS4gS2VlcCBpdCB3YXJtIGFuZCByZWFkYWJsZSB3aXRob3V0IGxvc2luZyBwcmVjaXNpb24uIFByZXNlcnZlIGV2ZXJ5IGZhY3QgYW5kIGNpdGF0aW9uLiIsCiAgICAiY29uY2lzZSI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSB0byBiZSBhcyBjb25jaXNlIGFzIHBvc3NpYmxlIHdpdGhvdXQgbG9zaW5nIG1lYW5pbmcuIEN1dCBldmVyeSByZWR1bmRhbnQgd29yZCwgbWVyZ2UgY2xhdXNlcywgdGlnaHRlbiBwaHJhc2luZy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucywgbnVtYmVycywgYW5kIGtleSBjbGFpbXMuIiwKICAgICJlbmdhZ2luZyI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSB0byBiZSBtb3JlIGVuZ2FnaW5nLiBVc2UgdmFyaWVkIHNlbnRlbmNlIHN0cnVjdHVyZSwgc3Ryb25nIHZlcmJzLCBhbmQgYWN0aXZlIHZvaWNlLiBEcmF3IHRoZSByZWFkZXIgaW4gd2l0aCBjbGVhciBtb21lbnR1bSBmcm9tIHNlbnRlbmNlIHRvIHNlbnRlbmNlLiBQcmVzZXJ2ZSBldmVyeSBmYWN0IGFuZCBjaXRhdGlvbi4iLAogICAgInBlcnN1YXNpdmUiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gYmUgbW9yZSBwZXJzdWFzaXZlLiBTdHJlbmd0aGVuIHRoZSBsb2dpY2FsIGNvbm5lY3Rpb24gYmV0d2VlbiBldmlkZW5jZSBhbmQgY2xhaW1zLiBVc2UgY29uZmlkZW50LCBwcmVjaXNlIGxhbmd1YWdlLiBBZGRyZXNzIHBvdGVudGlhbCBjb3VudGVyYXJndW1lbnRzIGltcGxpY2l0bHkgdGhyb3VnaCBzdHJvbmdlciB3YXJyYW50cy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucy4iLAogICAgImF1dGhvcml0YXRpdmUiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gc291bmQgbW9yZSBhdXRob3JpdGF0aXZlLiBVc2UgZGVjaXNpdmUgbGFuZ3VhZ2UsIHJlbW92ZSB1bm5lY2Vzc2FyeSBoZWRnaW5nIGZyb20gZXN0YWJsaXNoZWQgZmFjdHMsIGFuZCBwcmVzZW50IGV2aWRlbmNlIHdpdGggY29uZmlkZW5jZS4gS2VlcCBoZWRnaW5nIG9ubHkgb24gZ2VudWluZWx5IHNwZWN1bGF0aXZlIGNsYWltcy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucy4iLAogICAgImRpcGxvbWF0aWMiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gYmUgbW9yZSBkaXBsb21hdGljLiBTb2Z0ZW4gYXNzZXJ0aW9ucyB0aGF0IG92ZXJjbGFpbSwgYWNrbm93bGVkZ2UgY29tcGxleGl0eSwgYW5kIHByZXNlbnQgY29udGVzdGVkIGNsYWltcyB3aXRoIGFwcHJvcHJpYXRlIHF1YWxpZmljYXRpb24uIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAiZGVzY3JpcHRpdmUiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gYmUgbW9yZSBkZXNjcmlwdGl2ZSBhbmQgdml2aWQuIEFkZCBzcGVjaWZpYyBkZXRhaWwsIGNvbmNyZXRlIGV4YW1wbGVzLCBhbmQgc2Vuc29yeSBsYW5ndWFnZSB3aGVyZSBhcHByb3ByaWF0ZS4gRG8gbm90IGZhYnJpY2F0ZSBmYWN0cyBvciBjaXRhdGlvbnMuIEVucmljaCB3aGF0IGlzIGFscmVhZHkgc3RhdGVkLiIsCiAgICAibmFycmF0aXZlIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHdpdGggYSBzdHJvbmdlciBuYXJyYXRpdmUgdGhyZWFkLiBDb25uZWN0IHNlbnRlbmNlcyB3aXRoIGNsZWFyIHRyYW5zaXRpb25zLCBidWlsZCBtb21lbnR1bSwgYW5kIGd1aWRlIHRoZSByZWFkZXIgdGhyb3VnaCB0aGUgYXJndW1lbnQgc3RlcCBieSBzdGVwLiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAogICAgInNpbXBsaWZ5IjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIGluIHNpbXBsZXIgRW5nbGlzaC4gVXNlIHNob3J0ZXIgc2VudGVuY2VzLCBjb21tb24gdm9jYWJ1bGFyeSwgYW5kIHN0cmFpZ2h0Zm9yd2FyZCBzdHJ1Y3R1cmUuIEtlZXAgdGhlIG1lYW5pbmcgZXhhY3QuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIG51bWJlcnMuIiwKICAgICJpbXByb3ZlLWZsb3ciOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gaW1wcm92ZSBpdHMgZmxvdy4gVmFyeSBzZW50ZW5jZSBsZW5ndGgsIHBsYWNlIHRoZSBtb3N0IGltcG9ydGFudCBpbmZvcm1hdGlvbiBhdCB0aGUgYmVnaW5uaW5nIG9yIGVuZCBvZiBzZW50ZW5jZXMsIGFuZCBlbnN1cmUgZWFjaCBzZW50ZW5jZSBmb2xsb3dzIGxvZ2ljYWxseSBmcm9tIHRoZSBvbmUgYmVmb3JlLiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAogICAgInN0cm9uZ2VyLXZlcmJzIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHJlcGxhY2luZyB3ZWFrIHZlcmJzIChpcywgd2FzLCBoYXMsIG1ha2UsIGdldCkgd2l0aCBzdHJvbmcgc3BlY2lmaWMgdmVyYnMuIEtlZXAgdGhlIG1lYW5pbmcgZXhhY3QuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIG51bWJlcnMuIiwKICAgICJwYXNzaXZlLXRvLWFjdGl2ZSI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBjb252ZXJ0aW5nIHBhc3NpdmUgY29uc3RydWN0aW9ucyB0byBhY3RpdmUgdm9pY2Ugd2hlcmUgdGhlIGFjdG9yIGlzIGtub3duIG9yIGNhbiBiZSBuYW1lZC4gS2VlcCBwYXNzaXZlIG9ubHkgd2hlcmUgdGhlIGFjdG9yIGlzIGdlbnVpbmVseSB1bmtub3duIG9yIGlycmVsZXZhbnQuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAidG9uZS1uZXV0cmFsIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIGluIGEgbmV1dHJhbCwgb2JqZWN0aXZlIHRvbmUuIFJlbW92ZSBlbW90aW9uYWwgbGFuZ3VhZ2UsIHN1YmplY3RpdmUgcXVhbGlmaWVycywgYW5kIHJoZXRvcmljYWwgZmxvdXJpc2hlcy4gUHJlc2VudCB0aGUgY29udGVudCBwbGFpbmx5LiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAogICAgInRvbmUtY29uZmlkZW50IjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHRvIHNvdW5kIG1vcmUgY29uZmlkZW50LiBSZW1vdmUgaGVkZ2luZyBmcm9tIGZhY3R1YWwgc3RhdGVtZW50cywgdXNlIHByZWNpc2UgY2xhaW1zLCBhbmQgbGV0IGV2aWRlbmNlIGNhcnJ5IHRoZSBlbXBoYXNpcy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucyBhbmQgZmFjdHMuIiwKICAgICJ0b25lLWNhdXRpb3VzIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHdpdGggbW9yZSBjYXV0aW91cyBlcGlzdGVtaWMgbWFya2luZy4gRGlzdGluZ3Vpc2ggZXN0YWJsaXNoZWQgZmluZGluZ3MgZnJvbSBzcGVjdWxhdGlvbiwgYW5kIHF1YWxpZnkgY2xhaW1zIHRoYXQgZXh0ZW5kIGJleW9uZCB0aGUgZXZpZGVuY2UuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAidHJhbnNpdGlvbi1maXgiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgYWRkaW5nIG9yIGltcHJvdmluZyB0cmFuc2l0aW9uYWwgd29yZHMgYW5kIHBocmFzZXMgYmV0d2VlbiBzZW50ZW5jZXMgYW5kIGlkZWFzLiBFbnN1cmUgdGhlIGxvZ2ljYWwgcmVsYXRpb25zaGlwIGJldHdlZW4gZWFjaCBzZW50ZW5jZSBpcyBleHBsaWNpdC4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucyBhbmQgZmFjdHMuIiwKICAgICJwYXJhbGxlbC1maXgiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgZml4aW5nIGFueSBmYXVsdHkgcGFyYWxsZWwgc3RydWN0dXJlLiBFbnN1cmUgaXRlbXMgaW4gYSBzZXJpZXMsIGNvbXBhcmlzb25zLCBhbmQgY29vcmRpbmF0ZWQgZWxlbWVudHMgdXNlIHRoZSBzYW1lIGdyYW1tYXRpY2FsIGZvcm0uIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAiYWNhZGVtaWMtdXBncmFkZSI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBlbGV2YXRpbmcgdGhlIHJlZ2lzdGVyIHRvIGRvY3RvcmFsIGFjYWRlbWljIHN0YW5kYXJkLiBVc2UgcHJlY2lzZSBkaXNjaXBsaW5hcnkgdm9jYWJ1bGFyeSwgY29tcGxleCBzZW50ZW5jZSBzdHJ1Y3R1cmVzIHdoZXJlIHRoZXkgYWlkIGFyZ3VtZW50LCB0aGlyZCBwZXJzb24sIG5vIGNvbnRyYWN0aW9ucywgYW5kIGNhcmVmdWwgZXBpc3RlbWljIGhlZGdpbmcuIFByZXNlcnZlIGV2ZXJ5IGNpdGF0aW9uLCBudW1iZXIsIGFuZCBwcm9wZXIgbm91biBleGFjdGx5LiBEbyBub3QgYWRkIGNsYWltcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSB0ZXh0LiIsCiAgICAidGlnaHRlbi1hcmd1bWVudCI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSB0aWdodGVuaW5nIHRoZSBhcmd1bWVudC4gUmVtb3ZlIHRhbmdlbnRzLCBlbnN1cmUgZWFjaCBzZW50ZW5jZSBhZHZhbmNlcyB0aGUgY2VudHJhbCBjbGFpbSwgYW5kIG1ha2UgdGhlIGxvZ2ljYWwgcHJvZ3Jlc3Npb24gZnJvbSBldmlkZW5jZSB0byBjb25jbHVzaW9uIGV4cGxpY2l0LiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAp9CgoKZGVmIGVwX3JlYWRlcihib2R5KToKICAgICIiIlN0YWdlIDQ6IHRoZSByZWFkZXIncyBsaWtlbHkgcmVzcG9uc2UsIGNhbG1lciB0aGFuIHRoZSBob3N0aWxlIGV4YW1pbmVyLgogICAgUGVyc29uYSBjb21lcyBmcm9tIHRoZSBhcHAncyBHb2FscyAoYXVkaWVuY2UpLiBIZXVyaXN0aWMgZmFsbGJhY2sgbWlycm9ycyB0aGUgYnJvd3Nlci4iIiIKICAgIHRleHQgPSBib2R5LmdldCgidGV4dCIsICIiKVs6OTAwMF0KICAgIGF1ZCA9IGJvZHkuZ2V0KCJhdWQiLCAiQWNhZGVtaWMgcmVhZGVycyIpCiAgICBpZiBBSVsicmVhZHkiXToKICAgICAgICBvdXQgPSBnZW5lcmF0ZSgKICAgICAgICAgICAgQ1JFRUQgKyBmIllvdSBhcmUgYSBjYXJlZnVsIGZpcnN0IHJlYWRlciBzdGFuZGluZyBpbiBmb3Ige2F1ZH0uIFJlcG9ydCB0aGUgNCBtb21lbnRzIHdoZXJlIHRoaXMgdGV4dCAiCiAgICAgICAgICAgICJsb3NlcyB0aGF0IHJlYWRlcjogd2hlcmUgYXR0ZW50aW9uIHNsaXBzLCB3aGVyZSB0cnVzdCB0aGlucywgd2hlcmUgYSBiZWF0IGlzIG1pc3NpbmcsIHdoZXJlIHRoZSAiCiAgICAgICAgICAgICJsb2dpYyBqdW1wcyB3aXRob3V0IGEgYnJpZGdlLiBPbmUgbW9tZW50IHBlciBsaW5lLCBhdCBtb3N0IDI0IHdvcmRzIGVhY2gsIGdlbnRsZSBhbmQgc3BlY2lmaWMuICIKICAgICAgICAgICAgZiJPdXRwdXQgT05MWSB0aGUgbGlzdC5cblxue3RleHR9IiwgMzgwKQogICAgICAgIGlmIG91dDoKICAgICAgICAgICAgcmF3X2l0ZW1zID0gW3JlLnN1YihyIl5ccypbLSpcZF0rWykuXHNdKiIsICIiLCBsKS5zdHJpcCgpIGZvciBsIGluIG91dC5zcGxpdGxpbmVzKCldCiAgICAgICAgICAgIHRoaW5rID0gTm9uZQogICAgICAgICAgICBpZiByYXdfaXRlbXM6CiAgICAgICAgICAgICAgICBfLCB0aGluayA9IHNwbGl0X29mZl90aGluayhyYXdfaXRlbXNbMF0pCiAgICAgICAgICAgIGl0ZW1zID0gW2wgZm9yIGwgaW4gcmF3X2l0ZW1zIGlmIGxlbihsKSA+IDEyXVs6NV0KICAgICAgICAgICAgaWYgaXRlbXM6CiAgICAgICAgICAgICAgICByZXR1cm4geyJpdGVtcyI6IGl0ZW1zLCAidGhpbmsiOiB0aGlua30KICAgIHBhcmFzID0gW3AgZm9yIHAgaW4gcmUuc3BsaXQociJcblxzKlxuIiwgdGV4dCkgaWYgcC5zdHJpcCgpXQogICAgd29yZHMgPSBsZW4odGV4dC5zcGxpdCgpKSBvciAxCiAgICBpdGVtcyA9IFtdCiAgICBmb3IgaSwgcCBpbiBlbnVtZXJhdGUocGFyYXMpOgogICAgICAgIHB3ID0gbGVuKHAuc3BsaXQoKSkKICAgICAgICBpZiBwdyA+IDE2MDoKICAgICAgICAgICAgaXRlbXMuYXBwZW5kKGYiUGFyYWdyYXBoIHtpKzF9IGlzIHtwd30gd29yZHM7IGEgcmVhZGVyJ3MgYXR0ZW50aW9uIHRoaW5zIGFyb3VuZCAxNTAuIE9uZSBicmVhdGgsIG9uZSBpZGVhLiIpCiAgICBoZWRnZSA9IGxlbihIRURHRS5maW5kYWxsKHRleHQpKSAvIG1heCgxLCB3b3JkcyAvIDIwMCkKICAgIGlmIGhlZGdlID4gMS41OgogICAgICAgIGl0ZW1zLmFwcGVuZChmIkhlZGdlZCBhYm91dCB7cm91bmQoaGVkZ2UsMSl9IHRpbWVzIHBlciAyMDAgd29yZHM7IGFuIHVuc3VyZSB3cml0ZXIgbWFrZXMgYW4gdW5zdXJlIHJlYWRlci4iKQogICAgc2lnbnMgPSBsZW4ocmUuZmluZGFsbChyIlxiKGhvd2V2ZXJ8bW9yZW92ZXJ8dGhlcmVmb3JlfHRodXN8aGVuY2V8bWVhbndoaWxlfGJ5IGNvbnRyYXN0fGluIGNvbnRyYXN0fGZpcnN0bHl8ZmluYWxseSlcYiIsIHRleHQsIHJlLkkpKQogICAgaWYgbGVuKHBhcmFzKSA+IDIgYW5kIHNpZ25zIDwgKGxlbihwYXJhcykgKyAxKSAvLyAyOgogICAgICAgIGl0ZW1zLmFwcGVuZCgiTG9uZyBzdHJldGNoZXMgY2Fycnkgbm8gc2lnbnBvc3QgKGhvd2V2ZXIsIHRoZXJlZm9yZSwgbWVhbndoaWxlKTsgYSByZWFkZXIgbG9zZXMgdGhlIHRocmVhZCBhbmQgcmUtcmVhZHMuIikKICAgIG92ZXIgPSByZS5maW5kYWxsKHIiXGIob2J2aW91c2x5fGNsZWFybHl8dW5kZW5pYWJseXxwcm92ZXM/fHByb3ZlbnxldmVyeW9uZSBrbm93cylcYiIsIHRleHQsIHJlLkkpCiAgICBpZiBvdmVyOgogICAgICAgIGl0ZW1zLmFwcGVuZChmJyJ7b3ZlclswXS5sb3dlcigpfSIgdGVsbHMgdGhlIHJlYWRlciB0aGUgcG9pbnQgbmVlZHMgbm8gc3VwcG9ydDsgdGhhdCBpcyB3aGVyZSBhIGNhcmVmdWwgcmVhZGVyIHB1c2hlcyBiYWNrLicpCiAgICBwYXNzaXZlID0gbGVuKHJlLmZpbmRhbGwociJcYig/Ondhc3x3ZXJlfGlzIGJlaW5nfGhhcyBiZWVufGhhZCBiZWVuKVxzK1x3Kyg/OmVkfGVuKVxiIiwgdGV4dCwgcmUuSSkpCiAgICBpZiBwYXNzaXZlID4gMjoKICAgICAgICBpdGVtcy5hcHBlbmQoZiJ7cGFzc2l2ZX0gcGFzc2l2ZXM6IHRoZSBhY3RvciBrZWVwcyB2YW5pc2hpbmc7IGEgcmVhZGVyIGFza3Mgd2hvIGRpZCB0aGlzLiIpCiAgICBpZiBub3QgaXRlbXM6CiAgICAgICAgaXRlbXMgPSBbIlRoZSBwYWdlIGhvbGRzIHRvZ2V0aGVyLiBBIGNhbG0gcmVhZGVyIGZpbmRzIGxpdHRsZSB0byB0cmlwIG9uIGhlcmUuIl0KICAgIHJldHVybiB7Iml0ZW1zIjogaXRlbXNbOjVdfQoKCmRlZiBlcF9yZXdyaXRlKGJvZHkpOgogICAgdGV4dCA9IGJvZHkuZ2V0KCJ0ZXh0IiwgIiIpCiAgICBtb2RlID0gYm9keS5nZXQoIm1vZGUiLCAiY29uY2lzZSIpCiAgICBzdHlsZSA9IGJvZHkuZ2V0KCJzdHlsZSIsICIiKQogICAgaW5zdHIgPSBSRVdSSVRFX1BST01QVFMuZ2V0KG1vZGUsIFJFV1JJVEVfUFJPTVBUU1siY29uY2lzZSJdKQogICAgcmF3ID0gZ2VuZXJhdGUodGV4dCwgbWF4X25ld190b2tlbnM9bWluKDEyMDAsIGxlbih0ZXh0LnNwbGl0KCkpICogMyArIDE1MCksCiAgICAgICAgICAgICAgICAgICBzeXN0ZW09ZiJ7aW5zdHJ9IHtzdHlsZX0ge0VESVRfU1lTVEVNfSIuc3RyaXAoKSwgdGVtcGVyYXR1cmU9MC4yKQogICAgYW5zLCB0aGsgPSBzcGxpdF9vZmZfdGhpbmsocmF3KSBpZiByYXcgZWxzZSAoTm9uZSwgTm9uZSkKICAgIGlmIGFuczoKICAgICAgICByZXR1cm4geyJ0ZXh0IjogYW5zLCAidGhpbmsiOiB0aGt9CiAgICByZXR1cm4geyJ0ZXh0IjogaGV1cmlzdGljX3Jld3JpdGUodGV4dCwgbW9kZSksICJ0aGluayI6IE5vbmV9CgoKZGVmIGVwX3Jld3JpdGVfcHJlc2V0KGJvZHkpOgogICAgIiIiR3JhbW1hcmx5LXN0eWxlIHByZXNldCByZXdyaXRlOiBhcHBsaWVzIGEgbmFtZWQgcmV3cml0aW5nIGdvYWwKICAgIChmb3JtYWwsIGNvbmNpc2UsIGVuZ2FnaW5nLCBldGMuKSB0byB0aGUgZ2l2ZW4gdGV4dC4iIiIKICAgIHRleHQgPSBib2R5LmdldCgidGV4dCIsICIiKQogICAgcHJlc2V0ID0gYm9keS5nZXQoInByZXNldCIsICIiKQogICAgY29udGV4dCA9IGJvZHkuZ2V0KCJjb250ZXh0IiwgIiIpICAjIG9wdGlvbmFsIHN1cnJvdW5kaW5nIHRleHQgZm9yIGNvbnRleHQKICAgIGluc3RyID0gUkVXUklURV9QUkVTRVRTLmdldChwcmVzZXQpCiAgICBpZiBub3QgaW5zdHI6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogZiJ1bmtub3duIHByZXNldDoge3ByZXNldH0ifQogICAgaWYgbm90IHRleHQuc3RyaXAoKToKICAgICAgICByZXR1cm4geyJvayI6IEZhbHNlLCAiZXJyb3IiOiAibm8gdGV4dCB0byByZXdyaXRlIn0KICAgIGN0eCA9ICIiCiAgICBpZiBjb250ZXh0LnN0cmlwKCk6CiAgICAgICAgY3R4ID0gZiJcblxuQ29udGV4dCAodGhlIHN1cnJvdW5kaW5nIHBhc3NhZ2UsIGZvciByZWZlcmVuY2Ugb25seTsgZG8gbm90IHJld3JpdGUgaXQpOlxue2NvbnRleHRbOjIwMDBdfSIKICAgIHByb21wdCA9IGYiUGFzc2FnZSB0byByZXdyaXRlOlxue3RleHR9e2N0eH0iCiAgICByYXcgPSBnZW5lcmF0ZShwcm9tcHQsIG1heF9uZXdfdG9rZW5zPW1pbigxNTAwLCBsZW4odGV4dC5zcGxpdCgpKSAqIDMgKyAyMDApLAogICAgICAgICAgICAgICAgICAgc3lzdGVtPWYie2luc3RyfSB7RURJVF9TWVNURU19IiwgdGVtcGVyYXR1cmU9MC4yKQogICAgYW5zLCB0aGsgPSBzcGxpdF9vZmZfdGhpbmsocmF3KSBpZiByYXcgZWxzZSAoTm9uZSwgTm9uZSkKICAgIGlmIGFuczoKICAgICAgICByZXR1cm4geyJvayI6IFRydWUsICJ0ZXh0IjogYW5zLCAidGhpbmsiOiB0aGssICJwcmVzZXQiOiBwcmVzZXR9CiAgICAjIGhldXJpc3RpYyBmYWxsYmFjazogYXBwbHkgd2hhdCB3ZSBjYW4gd2l0aG91dCBhIG1vZGVsCiAgICByZXR1cm4geyJvayI6IFRydWUsICJ0ZXh0IjogaGV1cmlzdGljX3Jld3JpdGUodGV4dCwgImNvbmNpc2UiIGlmICJjb25jaXNlIiBpbiBwcmVzZXQgZWxzZSAiIiksCiAgICAgICAgICAgICJ0aGluayI6IE5vbmUsICJwcmVzZXQiOiBwcmVzZXQsICJmYWxsYmFjayI6IFRydWV9CgoKZGVmIGVwX3Jld3JpdGVfY3VzdG9tKGJvZHkpOgogICAgIiIiQ3VzdG9tIHJld3JpdGU6IHRoZSB1c2VyIHByb3ZpZGVzIHRoZWlyIG93biBpbnN0cnVjdGlvbiBmb3IgaG93CiAgICB0aGUgdGV4dCBzaG91bGQgYmUgcmV3cml0dGVuLCBsaWtlIEdyYW1tYXJseSdzIGN1c3RvbSByZXdyaXRlIGZlYXR1cmUuIiIiCiAgICB0ZXh0ID0gYm9keS5nZXQoInRleHQiLCAiIikKICAgIGluc3RydWN0aW9uID0gYm9keS5nZXQoImluc3RydWN0aW9uIiwgIiIpCiAgICBpZiBub3QgdGV4dC5zdHJpcCgpOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJubyB0ZXh0IHRvIHJld3JpdGUifQogICAgaWYgbm90IGluc3RydWN0aW9uLnN0cmlwKCk6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vIGluc3RydWN0aW9uIHByb3ZpZGVkIn0KICAgIHJhdyA9IGdlbmVyYXRlKHRleHQsIG1heF9uZXdfdG9rZW5zPW1pbigxNTAwLCBsZW4odGV4dC5zcGxpdCgpKSAqIDMgKyAyMDApLAogICAgICAgICAgICAgICAgICAgc3lzdGVtPWYiUmV3cml0ZSB0aGUgdXNlcidzIHBhc3NhZ2Ugd2l0aCB0aGlzIGdvYWw6IHtpbnN0cnVjdGlvbn0uIHtFRElUX1NZU1RFTX0iLAogICAgICAgICAgICAgICAgICAgdGVtcGVyYXR1cmU9MC4yKQogICAgYW5zLCB0aGsgPSBzcGxpdF9vZmZfdGhpbmsocmF3KSBpZiByYXcgZWxzZSAoTm9uZSwgTm9uZSkKICAgIGlmIGFuczoKICAgICAgICByZXR1cm4geyJvayI6IFRydWUsICJ0ZXh0IjogYW5zLCAidGhpbmsiOiB0aGt9CiAgICByZXR1cm4geyJvayI6IEZhbHNlLCAiZXJyb3IiOiAiQUkgbW9kZWwgdW5hdmFpbGFibGUuIEluc3RhbGwgdHJhbnNmb3JtZXJzOiBwaXAgaW5zdGFsbCB0cmFuc2Zvcm1lcnMgdG9yY2giLAogICAgICAgICAgICAidGV4dCI6IHRleHQsICJ0aGluayI6IE5vbmV9CgoKZGVmIGVwX3ByZXNldHMoYm9keSk6CiAgICAiIiJSZXR1cm4gdGhlIGF2YWlsYWJsZSByZXdyaXRlIHByZXNldHMgYW5kIG1vZGVzIHNvIHRoZSBhcHAgY2FuCiAgICBidWlsZCBpdHMgVUkgZHluYW1pY2FsbHkuIiIiCiAgICByZXR1cm4gewogICAgICAgICJvayI6IFRydWUsCiAgICAgICAgInByZXNldHMiOiBsaXN0KFJFV1JJVEVfUFJFU0VUUy5rZXlzKCkpLAogICAgICAgICJtb2RlcyI6IGxpc3QoUkVXUklURV9QUk9NUFRTLmtleXMoKSksCiAgICB9CgoKZGVmIGVwX2NvbXBvc2UoYm9keSk6CiAgICBpbnN0ciA9IGJvZHkuZ2V0KCJpbnN0cnVjdGlvbiIsICIiKQogICAgc3R5bGUgPSBib2R5LmdldCgic3R5bGUiLCAiIikKICAgIHJhdyA9IGdlbmVyYXRlKENSRUVEICsgZiJXcml0ZSBleGFjdGx5IHdoYXQgaXMgYXNrZWQgaW4gY2xlYXIsIHdlbGwtc3RydWN0dXJlZCBwcm9zZS4gIgogICAgICAgICAgICAgICAgICAgZiJVc2UgcHJlY2lzZSBkaWN0aW9uLCB2YXJpZWQgc2VudGVuY2Ugc3RydWN0dXJlLCBhbmQgc21vb3RoIHRyYW5zaXRpb25zLiAiCiAgICAgICAgICAgICAgICAgICBmIkRvIG5vdCBmYWJyaWNhdGUgY2l0YXRpb25zLCBzdGF0aXN0aWNzIG9yIGZhY3RzLiB7c3R5bGV9XG5cbntpbnN0cn0iLCA4MDApCiAgICBhbnMsIHRoayA9IHNwbGl0X29mZl90aGluayhyYXcpIGlmIHJhdyBlbHNlIChOb25lLCBOb25lKQogICAgcmV0dXJuIHsidGV4dCI6IGFucyBvciAiIiwgInRoaW5rIjogdGhrfQoKCkhFREdFID0gcmUuY29tcGlsZShyIlxiKG1pZ2h0fG1heWJlfHBlcmhhcHN8c29ydCBvZnxraW5kIG9mfEkgdGhpbmt8cG9zc2libHl8SSBndWVzc3xzdWdnZXN0cz98YXBwZWFycz8pXGIiLCByZS5JKQpTVFJPTkcgPSByZS5jb21waWxlKHIiXGIod2lsbHxtdXN0fGNsZWFybHl8ZGVmaW5pdGVseXxjZXJ0YWlubHl8cHJvdmVufGFsd2F5c3xuZXZlcilcYiIsIHJlLkkpCgoKZGVmIGVwX3RvbmUoYm9keSk6CiAgICB0ZXh0ID0gYm9keS5nZXQoInRleHQiLCAiIikKICAgIGlmIEFJWyJyZWFkeSJdOgogICAgICAgIG91dCA9IGdlbmVyYXRlKENSRUVEICsgIkdpdmUgYSAyLTMgd29yZCB0b25lIGxhYmVsIGZvciB0aGlzIHRleHQsIHRoZW4gJyB8ICcsIHRoZW4gb25lIHNob3J0IHRpcC5cblxuIiArIHRleHRbOjEyMDBdLCA2MCkKICAgICAgICBvdXQgPSBzcGxpdF9vZmZfdGhpbmsob3V0KVswXSBpZiBvdXQgZWxzZSBvdXQKICAgICAgICBpZiBvdXQgYW5kICJ8IiBpbiBvdXQ6CiAgICAgICAgICAgIGxhYmVsLCB0aXAgPSAocC5zdHJpcCgpIGZvciBwIGluIG91dC5zcGxpdCgifCIsIDEpKQogICAgICAgICAgICByZXR1cm4geyJsYWJlbCI6IGxhYmVsLCAidGlwcyI6IFt0aXBdfQogICAgaGVkZ2VzID0gbGVuKEhFREdFLmZpbmRhbGwodGV4dCkpCiAgICBzdHJvbmcgPSBsZW4oU1RST05HLmZpbmRhbGwodGV4dCkpCiAgICBleGNsID0gdGV4dC5jb3VudCgiISIpCiAgICBzY29yZSA9IDAuNSArIDAuMTIgKiBzdHJvbmcgLSAwLjEyICogaGVkZ2VzICsgMC4wMyAqIGV4Y2wKICAgIGxhYmVsID0gKCJDb25maWRlbnQgLyBhc3NlcnRpdmUiIGlmIHNjb3JlID4gMC43CiAgICAgICAgICAgICBlbHNlICJIZXNpdGFudCAvIHRlbnRhdGl2ZSIgaWYgc2NvcmUgPCAwLjM1IGVsc2UgIk5ldXRyYWwiKQogICAgdGlwcyA9IFtdCiAgICBpZiBoZWRnZXMgPiAyOgogICAgICAgIHRpcHMuYXBwZW5kKCJzZXZlcmFsIGhlZGdlczsga2VlcCB0aGVtIG9uIGNsYWltcywgY3V0IHRoZW0gZnJvbSBmYWN0cyIpCiAgICBpZiBleGNsOgogICAgICAgIHRpcHMuYXBwZW5kKCJleGNsYW1hdGlvbiBtYXJrcyByZWFkIGFzIGVtb3Rpb25hbDsgbGV0IGV2aWRlbmNlIGNhcnJ5IGVtcGhhc2lzIikKICAgIHJldHVybiB7ImxhYmVsIjogbGFiZWwsICJ0aXBzIjogdGlwc30KCgpkZWYgc2hpbmdsZXModGV4dCwgbj02KToKICAgIHcgPSByZS5maW5kYWxsKHIiW2EteiddKyIsIHRleHQubG93ZXIoKSkKICAgIHJldHVybiB7IiAiLmpvaW4od1tpOmkgKyBuXSkgZm9yIGkgaW4gcmFuZ2UobGVuKHcpIC0gbiArIDEpfQoKCmRlZiBlcF9zaW1pbGFyaXR5KGJvZHkpOgogICAgYSA9IHNoaW5nbGVzKGJvZHkuZ2V0KCJ0ZXh0IiwgIiIpKQogICAgbWF0Y2hlcyA9IFtdCiAgICBmb3IgZCBpbiBib2R5LmdldCgibGlicmFyeSIsIFtdKToKICAgICAgICBiID0gc2hpbmdsZXMoZC5nZXQoInRleHQiLCAiIikpCiAgICAgICAgaWYgbm90IGEgb3Igbm90IGI6CiAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgb3YgPSBsZW4oYSAmIGIpIC8gbWluKGxlbihhKSwgbGVuKGIpKQogICAgICAgIGlmIG92ID4gMC4wNjoKICAgICAgICAgICAgbWF0Y2hlcy5hcHBlbmQoeyJ0aXRsZSI6IGQuZ2V0KCJ0aXRsZSIsICJVbnRpdGxlZCIpLCAib3ZlcmxhcCI6IHJvdW5kKG92LCAzKX0pCiAgICBtYXRjaGVzLnNvcnQoa2V5PWxhbWJkYSBtOiAtbVsib3ZlcmxhcCJdKQogICAgcmV0dXJuIHsibWF0Y2hlcyI6IG1hdGNoZXNbOjVdfQoKCkZPTExPV1VQUyA9IFsKICAgICJXaHkgZG8geW91IGJlbGlldmUgdGhhdCBob2xkcz8iLAogICAgIldoYXQgY29uY3JldGUgZXhhbXBsZSB3b3VsZCBzZXR0bGUgaXQ/IiwKICAgICJXaGF0IGZvbGxvd3MgZnJvbSB0aGF0OyBhbmQgd2hhdCBmb2xsb3dzIGlmIGl0IHdlcmUgZmFsc2U/IiwKICAgICJXaG8gZGlzYWdyZWVzLCBhbmQgd2hhdCBpcyB0aGVpciBzdHJvbmdlc3QgcG9pbnQ/IiwKICAgICJXaGF0IGV2aWRlbmNlIHdvdWxkIGNoYW5nZSB5b3VyIG1pbmQ/IiwKXQoKCmRlZiBlcF9zb2NyYXQoYm9keSk6CiAgICBzdGFnZSA9IGJvZHkuZ2V0KCJzdGFnZSIsICJRdWVzdGlvbiIpCiAgICBhbnN3ZXIgPSBib2R5LmdldCgiYW5zd2VyIiwgIiIpCiAgICBpZiBBSVsicmVhZHkiXToKICAgICAgICBvdXQgPSBnZW5lcmF0ZSgKICAgICAgICAgICAgQ1JFRUQgKyAiWW91IGFyZSBTb2NyYXRlcyBzdXBlcnZpc2luZyBhIGRvY3RvcmFsIHdyaXRlci4gR2l2ZW4gdGhlaXIgYW5zd2VyLCBhc2sgZXhhY3RseSBPTkUgIgogICAgICAgICAgICAic2hvcnQgcXVlc3Rpb24gKG1heCAyMiB3b3JkcykgdGhhdCBwcm9iZXMgYSB3ZWFrIGFzc3VtcHRpb24sIGV4cG9zZXMgYSBoaWRkZW4gcHJlbWlzZSwgb3IgIgogICAgICAgICAgICBmInB1c2hlcyB0b3dhcmQgcHJlY2lzaW9uLiBPdXRwdXQgT05MWSB0aGUgcXVlc3Rpb24uXG5cblN0YWdlOiB7c3RhZ2V9XG5UaGVpciBhbnN3ZXI6IHthbnN3ZXJ9IiwgODApCiAgICAgICAgaWYgb3V0OgogICAgICAgICAgICBhbnMsIHRoayA9IHNwbGl0X29mZl90aGluayhvdXQpCiAgICAgICAgICAgIHJldHVybiB7InF1ZXN0aW9uIjogYW5zLnN0cmlwKCJcIidgIiksICJ0aGluayI6IHRoa30KICAgIGltcG9ydCByYW5kb20KICAgIHJldHVybiB7InF1ZXN0aW9uIjogcmFuZG9tLmNob2ljZShGT0xMT1dVUFMpfQoKCmRlZiBlcF9yZXZpZXcoYm9keSk6CiAgICB0ZXh0ID0gYm9keS5nZXQoInRleHQiLCAiIilbOjkwMDBdCiAgICBpZiBBSVsicmVhZHkiXToKICAgICAgICBvdXQgPSBnZW5lcmF0ZSgKICAgICAgICAgICAgQ1JFRUQgKyAiWW91IGFyZSBhIHJpZ29yb3VzIGJ1dCBmYWlyIGRvY3RvcmFsIGV4YW1pbmVyIGF0IGEgbGVhZGluZyByZXNlYXJjaCB1bml2ZXJzaXR5LiAiCiAgICAgICAgICAgICJJZGVudGlmeSB0aGUgNCBzdHJvbmdlc3Qgb2JqZWN0aW9ucyB0byB0aGUgYXJndW1lbnQgaW4gdGhpcyB0ZXh0LiBMb29rIGZvcjogdW5zdXBwb3J0ZWQgIgogICAgICAgICAgICAiZW1waXJpY2FsIGNsYWltcywgb3ZlcmNsYWltcyBiZXlvbmQgdGhlIGV2aWRlbmNlLCBtaXNzaW5nIHdhcnJhbnRzIGNvbm5lY3RpbmcgZGF0YSB0byAiCiAgICAgICAgICAgICJjb25jbHVzaW9ucywgdW5hZGRyZXNzZWQgY291bnRlci1ldmlkZW5jZSwgY2lyY3VsYXIgcmVhc29uaW5nLCBkZWZpbml0aW9uYWwgc2xpcHBhZ2UsICIKICAgICAgICAgICAgImFuZCBtZXRob2RvbG9naWNhbCBnYXBzLiBFYWNoIG9iamVjdGlvbiBtdXN0IGJlIHNwZWNpZmljIHRvIHRoZSB0ZXh0LCBub3QgZ2VuZXJpYy4gIgogICAgICAgICAgICAiT3V0cHV0IE9OTFkgYSBudW1iZXJlZCBsaXN0LCBvbmUgb2JqZWN0aW9uIHBlciBsaW5lLCBhdCBtb3N0IDI4IHdvcmRzIGVhY2guXG5cbiIKICAgICAgICAgICAgZiJ7dGV4dH0iLCA0MDApCiAgICAgICAgaWYgb3V0OgogICAgICAgICAgICBpdGVtcyA9IFtyZS5zdWIociJeXHMqWy0qXGRdK1spLlxzXSoiLCAiIiwgbCkuc3RyaXAoKQogICAgICAgICAgICAgICAgICAgICBmb3IgbCBpbiBvdXQuc3BsaXRsaW5lcygpXQogICAgICAgICAgICB0aGluayA9IE5vbmUKICAgICAgICAgICAgcmF3X2l0ZW1zID0gaXRlbXMKICAgICAgICAgICAgaWYgcmF3X2l0ZW1zOgogICAgICAgICAgICAgICAgXywgdGhpbmsgPSBzcGxpdF9vZmZfdGhpbmsocmF3X2l0ZW1zWzBdKSBpZiByYXdfaXRlbXMgZWxzZSAoTm9uZSwgTm9uZSkKICAgICAgICAgICAgaXRlbXMgPSBbbCBmb3IgbCBpbiByYXdfaXRlbXMgaWYgbGVuKGwpID4gMTJdWzo1XQogICAgICAgICAgICBpZiBpdGVtczoKICAgICAgICAgICAgICAgIHJldHVybiB7Iml0ZW1zIjogaXRlbXMsICJ0aGluayI6IHRoaW5rfQogICAgIyBoZXVyaXN0aWMgZmFsbGJhY2sgKG1pcnJvcnMgdGhlIGJyb3dzZXIncyBydWxlcy1iYXNlZCBwYXNzKQogICAgaXRlbXMgPSBbXQogICAgb3ZlciA9IHJlLmZpbmRhbGwociJcYihwcm92ZVtzZF0/fHByb3ZlbnxvYnZpb3VzbHl8Y2xlYXJseXx1bmRlbmlhYmx5fGV2ZXJ5b25lIGtub3dzfGl0IGlzIHdlbGwga25vd24pXGIiLCB0ZXh0LCByZS5JKQogICAgaWYgb3ZlcjoKICAgICAgICBpdGVtcy5hcHBlbmQoZidPdmVyY2xhaW06ICJ7b3ZlclswXS5sb3dlcigpfSIgYXNzZXJ0cyB3aGF0IGFuIGV4YW1pbmVyIGV4cGVjdHMgeW91IHRvIGFyZ3VlOyB3aGVyZSBpcyB0aGUgZGVtb25zdHJhdGlvbj8nKQogICAgY2l0ZXMgPSByZS5maW5kYWxsKHIiXCgoPzoxOXwyMClcZFxkIiwgdGV4dCkgKyByZS5maW5kYWxsKHIiXFtbXGQsXHNcLeKAk10rXF0iLCB0ZXh0KQogICAgaWYgbGVuKHRleHQuc3BsaXQoKSkgPiA4MCBhbmQgbm90IGNpdGVzOgogICAgICAgIGl0ZW1zLmFwcGVuZCgiTm8gY2l0YXRpb25zIGRldGVjdGVkLiBXaGljaCBjbGFpbXMgd291bGQgYSBza2VwdGljIGFjY2VwdCB3aXRob3V0IGEgc291cmNlOyBhbmQgd2hpY2ggbm90PyIpCiAgICBpZiBsZW4odGV4dC5zcGxpdCgpKSA+IDEyMCBhbmQgbm90IHJlLnNlYXJjaChyIlxiKGhvd2V2ZXJ8YnV0fG9iamVjdGlvbnxuZXZlcnRoZWxlc3N8aW4gY29udHJhc3R8YWRtaXR0ZWRseSlcYiIsIHRleHQsIHJlLkkpOgogICAgICAgIGl0ZW1zLmFwcGVuZCgiTm8gY291bnRlci1tb3ZlIGRldGVjdGVkOiB0aGUgZHJhZnQgbmV2ZXIgdm9pY2VzIHRoZSBvcHBvc2luZyB2aWV3LiBTdGVlbG1hbiBpdCwgb3IgdGhlIGV4YW1pbmVyIHdpbGwuIikKICAgIGlmIG5vdCBpdGVtczoKICAgICAgICBpdGVtcyA9IFsiSXMgdGhlIGNlbnRyYWwgY2xhaW0gZmFsc2lmaWFibGU7IHdoYXQgZXZpZGVuY2Ugd291bGQgZm9yY2UgeW91IHRvIHF1YWxpZnkgb3IgYWJhbmRvbiBpdD8iLAogICAgICAgICAgICAgICAgICJXaGF0IGlzIHRoZSBzdHJvbmdlc3QgY29tcGV0aW5nIGV4cGxhbmF0aW9uIGZvciB0aGUgc2FtZSBvYnNlcnZhdGlvbnM/Il0KICAgIHJldHVybiB7Iml0ZW1zIjogaXRlbXNbOjVdfQoKCmRlZiBlcF9zZWxlY3RfbW9kZWwoYm9keSk6CiAgICBuYW1lID0gYm9keS5nZXQoIm5hbWUiLCAiIikKICAgIGNhbmQgPSBuZXh0KChjIGZvciBjIGluIHNjYW5fbG9jYWxfbW9kZWxzKCkgaWYgY1sibmFtZSJdID09IG5hbWUpLCBOb25lKQogICAgaWYgbm90IGNhbmQ6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vdCBmb3VuZCJ9CiAgICBjID0gY29uZl9yZWFkKCk7IGNbImFjdGl2ZSJdID0gbmFtZTsgY29uZl93cml0ZShjKQogICAgd2l0aCBfYWlfbG9jazoKICAgICAgICAjIGhvdCBzd2FwOiBvdXQgd2l0aCB0aGUgb2xkLCBpbiB3aXRoIHRoZSBuZXcsIHJpZ2h0IG5vdwogICAgICAgIHVubG9hZF9sb2NhbCgpCiAgICAgICAgb2sgPSBsb2FkX2xvY2FsX3BhdGgoY2FuZCkKICAgIHJldHVybiB7Im9rIjogb2ssICJhY3RpdmUiOiBBSS5nZXQoImxvY2FsX25hbWUiKSwKICAgICAgICAgICAgImtpbmQiOiBBSS5nZXQoImxvY2FsX2tpbmQiKSBpZiBvayBlbHNlIE5vbmUsCiAgICAgICAgICAgICJlcnJvciI6IE5vbmUgaWYgb2sgZWxzZSBBSS5nZXQoImxvYWRfZXJyb3IiKX0KCgpkZWYgZXBfcmVtb3ZlX21vZGVsKGJvZHkpOgogICAgaW1wb3J0IHNodXRpbAogICAgbmFtZSA9IGJvZHkuZ2V0KCJuYW1lIiwgIiIpCiAgICBjYW5kID0gbmV4dCgoYyBmb3IgYyBpbiBzY2FuX2xvY2FsX21vZGVscygpIGlmIGNbIm5hbWUiXSA9PSBuYW1lKSwgTm9uZSkKICAgIGlmIG5vdCBjYW5kOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJub3QgZm91bmQifQogICAgaWYgQUkuZ2V0KCJsb2NhbF9uYW1lIikgPT0gbmFtZToKICAgICAgICB3aXRoIF9haV9sb2NrOgogICAgICAgICAgICB1bmxvYWRfbG9jYWwoKQogICAgICAgIGMgPSBjb25mX3JlYWQoKTsgYy5wb3AoImFjdGl2ZSIsIE5vbmUpOyBjb25mX3dyaXRlKGMpCiAgICB0cnk6CiAgICAgICAgaWYgb3MucGF0aC5pc2RpcihjYW5kWyJwYXRoIl0pOgogICAgICAgICAgICBzaHV0aWwucm10cmVlKGNhbmRbInBhdGgiXSkKICAgICAgICBlbHNlOgogICAgICAgICAgICBvcy5yZW1vdmUoY2FuZFsicGF0aCJdKQogICAgICAgIHJldHVybiB7Im9rIjogVHJ1ZX0KICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICByZXR1cm4geyJvayI6IEZhbHNlLCAiZXJyb3IiOiBzdHIoZSl9CgoKIyAtLS0gbGlicmFyeSBzeW5jIGJldHdlZW4geW91ciBkZXZpY2VzIC0tLQojIFRoZSBsYXB0b3AgaXMgdGhlIGh1YjogYW55IGRldmljZSBwdXNoZXMgaXRzIHdob2xlIGxpYnJhcnkgaGVyZSwgYW55IGRldmljZQojIHB1bGxzIGl0IGJhY2suIE9uZSBzaGFyZWQgY29weSBiZXNpZGUgdGhlIHNlcnZlciwgbmV3ZXN0IHB1c2ggd2lucy4gVGhlIGFwcAojIG1lcmdlcyBvbiBwdWxsLCBhZGRpbmcgb25seSB3aGF0IGl0IGRvZXMgbm90IGFscmVhZHkgaGF2ZS4gTm90aGluZyBsZWF2ZXMKIyB0aGUgbmV0d29yayB5b3UgYXJlIG9uLgpkZWYgZXBfc3luY19wdXNoKGJvZHkpOgogICAgZG9jcyA9IGJvZHkuZ2V0KCJkb2NzIiwgW10pCiAgICBub3RlcyA9IGJvZHkuZ2V0KCJub3RlcyIsIFtdKQogICAgaWYgbm90IGlzaW5zdGFuY2UoZG9jcywgbGlzdCkgb3Igbm90IGlzaW5zdGFuY2Uobm90ZXMsIGxpc3QpOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJkb2NzIGFuZCBub3RlcyBtdXN0IGJlIGxpc3RzIn0KICAgIHBheWxvYWQgPSB7InNhdmVkX2F0IjogdGltZS5zdHJmdGltZSgiJVktJW0tJWQgJUg6JU0iKSwKICAgICAgICAgICAgICAgImRvY3MiOiBkb2NzLCAibm90ZXMiOiBub3Rlc30KICAgIHRyeToKICAgICAgICB0bXAgPSBTWU5DX1BBVEggKyAiLnRtcCIKICAgICAgICB3aXRoIG9wZW4odG1wLCAidyIpIGFzIGY6CiAgICAgICAgICAgIGpzb24uZHVtcChwYXlsb2FkLCBmKQogICAgICAgIG9zLnJlcGxhY2UodG1wLCBTWU5DX1BBVEgpCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogc3RyKGUpfQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAic2F2ZWRfYXQiOiBwYXlsb2FkWyJzYXZlZF9hdCJdLAogICAgICAgICAgICAiZG9jcyI6IGxlbihkb2NzKSwgIm5vdGVzIjogbGVuKG5vdGVzKX0KCgpkZWYgZXBfc3luY19wdWxsKF9ib2R5KToKICAgIHRyeToKICAgICAgICB3aXRoIG9wZW4oU1lOQ19QQVRIKSBhcyBmOgogICAgICAgICAgICBkYXRhID0ganNvbi5sb2FkKGYpCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJub3RoaW5nIGhhcyBiZWVuIHB1c2hlZCB5ZXQifQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAic2F2ZWRfYXQiOiBkYXRhLmdldCgic2F2ZWRfYXQiKSwKICAgICAgICAgICAgImRvY3MiOiBkYXRhLmdldCgiZG9jcyIsIFtdKSwgIm5vdGVzIjogZGF0YS5nZXQoIm5vdGVzIiwgW10pfQoKCmRlZiBlcF90cmFuc2NyaWJlKGJvZHkpOgogICAgIiIiU2NyaWJhJ3MgcmVjb3JkLXRoZW4tdHJhbnNjcmliZSBlbmRwb2ludC4gQWNjZXB0cyBiYXNlNjQgYXVkaW8sCiAgICByZXR1cm5zIHRyYW5zY3JpYmVkIHRleHQgdXNpbmcgV2hpc3Blci4gV29ya3MgZnVsbHkgb2ZmbGluZS4KICAgIE9wdGlvbmFsICdsYW5ndWFnZScgZmllbGQgKGUuZy4gJ2VuJywgJ2ZyJykgZm9yIG11bHRpbGluZ3VhbCBXaGlzcGVyLiIiIgogICAgaW1wb3J0IGJhc2U2NCBhcyBfYjY0CiAgICBhdWRpb19iNjQgPSBib2R5LmdldCgiYXVkaW8iLCAiIikKICAgIGlmIG5vdCBhdWRpb19iNjQ6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vIGF1ZGlvIGRhdGEifQogICAgbGFuZyA9IHN0cihib2R5LmdldCgibGFuZ3VhZ2UiKSBvciBib2R5LmdldCgibGFuZyIpIG9yICIiKS5zdHJpcCgpLmxvd2VyKCkKICAgIGlmIGxhbmcgaW4gKCIiLCAiYXV0byIsICJkZXRlY3QiKToKICAgICAgICBsYW5nID0gTm9uZQogICAgZWxpZiBsZW4obGFuZykgPiAyOgogICAgICAgIGxhbmcgPSBsYW5nLnNwbGl0KCItIilbMF0uc3BsaXQoIl8iKVswXVs6M10KICAgIHRyeToKICAgICAgICAjIFN0cmlwIGRhdGEgVVJMIHByZWZpeCBpZiBwcmVzZW50CiAgICAgICAgaWYgIiwiIGluIGF1ZGlvX2I2NCBhbmQgYXVkaW9fYjY0LnN0YXJ0c3dpdGgoImRhdGE6Iik6CiAgICAgICAgICAgIGF1ZGlvX2I2NCA9IGF1ZGlvX2I2NC5zcGxpdCgiLCIsIDEpWzFdCiAgICAgICAgYXVkaW9fYnl0ZXMgPSBfYjY0LmI2NGRlY29kZShhdWRpb19iNjQpCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogZiJiYWQgYXVkaW8gZGF0YToge2V9In0KICAgIGlmIGxlbihhdWRpb19ieXRlcykgPCAxMDA6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogImF1ZGlvIHRvbyBzaG9ydCJ9CiAgICB0ZXh0LCBlcnIsIGluZm8gPSB0cmFuc2NyaWJlX2F1ZGlvKGF1ZGlvX2J5dGVzLCBsYW5ndWFnZT1sYW5nKQogICAgaWYgZXJyOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6IGVyciwgImluZm8iOiBpbmZvfQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAidGV4dCI6IHRleHQgb3IgIiIsICJpbmZvIjogaW5mb30KCgpfTkVUID0geyJhdCI6IDAuMCwgIm9ubGluZSI6IEZhbHNlfQoKCmRlZiBfb25saW5lKG1heF9hZ2U9NjAuMCk6CiAgICAiIiJJcyB0aGUgaW50ZXJuZXQgcmVhY2hhYmxlPyBDYWNoZWQgZm9yIGEgbWludXRlIHNvIHRoZSBjaGVjayBuZXZlciBzbG93cyBTY3JpYmEuIiIiCiAgICBub3cgPSB0aW1lLnRpbWUoKQogICAgaWYgbm93IC0gX05FVFsiYXQiXSA8IG1heF9hZ2U6CiAgICAgICAgcmV0dXJuIF9ORVRbIm9ubGluZSJdCiAgICBvayA9IEZhbHNlCiAgICB0cnk6CiAgICAgICAgaW1wb3J0IHVybGxpYi5yZXF1ZXN0IGFzIF91cgogICAgICAgIHJlcSA9IF91ci5SZXF1ZXN0KCJodHRwczovL2FwaS5jcm9zc3JlZi5vcmcvIiwgbWV0aG9kPSJIRUFEIikKICAgICAgICBfdXIudXJsb3BlbihyZXEsIHRpbWVvdXQ9MykKICAgICAgICBvayA9IFRydWUKICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAjIGFuIEhUVFAgZXJyb3Igc3RhdHVzIHN0aWxsIHByb3ZlcyB0aGUgbmV0d29yayBpcyB1cAogICAgICAgIG9rID0gaGFzYXR0cihlLCAiY29kZSIpCiAgICBfTkVUWyJhdCJdLCBfTkVUWyJvbmxpbmUiXSA9IG5vdywgb2sKICAgIHJldHVybiBvawoKCmRlZiBfc3R0X3JlcG9ydCgpOgogICAgcmV0dXJuIHsKICAgICAgICAic3R0X2F2YWlsYWJsZSI6IF9zdHRfYXZhaWxhYmxlKCksCiAgICAgICAgInN0dF9sb2FkZWQiOiBib29sKEFJLmdldCgic3R0IikpLAogICAgICAgICJzdHRfbG9hZGluZyI6IGJvb2woX1NUVF9TVEFURVsibG9hZGluZyJdKSwKICAgICAgICAic3R0X2Vycm9yIjogX1NUVF9TVEFURS5nZXQoImVycm9yIiksCiAgICAgICAgInN0dF9tb2RlbCI6IFNUVF9NT0RFTCwKICAgICAgICAic3R0X211bHRpbGluZ3VhbCI6ICIuZW4iIG5vdCBpbiBTVFRfTU9ERUwsCiAgICAgICAgImZmbXBlZyI6IGJvb2woc2h1dGlsLndoaWNoKCJmZm1wZWciKSksCiAgICB9CgoKZGVmIGVwX25ldF9zdGF0dXMoX2JvZHkpOgogICAgIiIiSW50ZXJuZXQgcmVhY2hhYmlsaXR5IGFuZCB0aGUgdHJhbnNjcmlwdGlvbiBlbmdpbmUncyBzdGF0ZS4iIiIKICAgIG91dCA9IHsib2siOiBUcnVlLCAib25saW5lIjogX29ubGluZSgpLCAic2VydmVyIjogVHJ1ZX0KICAgIG91dC51cGRhdGUoX3N0dF9yZXBvcnQoKSkKICAgIHJldHVybiBvdXQKCgpkZWYgZXBfc3R0X3N0YXR1cyhfYm9keSk6CiAgICAiIiJUaGUgdHJhbnNjcmlwdGlvbiBlbmdpbmUncyBzdGF0ZSwgd2l0aG91dCBsb2FkaW5nIGFueXRoaW5nLiIiIgogICAgb3V0ID0geyJvayI6IFRydWV9CiAgICBvdXQudXBkYXRlKF9zdHRfcmVwb3J0KCkpCiAgICByZXR1cm4gb3V0CgoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIDIuMTM6IHRoZSB3cml0aW5nIG1vZGVsCiMgT25lIG1lYXN1cmVkIG1vZGVsLCBpbnN0YWxsZWQgd2l0aCBvbmUgcHJlc3MgZnJvbSB0aGUgbGFwdG9wJ3MgRW5naW5lIHBhbmVsOgojIGRvd25sb2FkZWQgb25jZSBpbnRvIHRoZSBtb2RlbHMgZm9sZGVyLCB0aGVuIHJ1biBieSB0aGUgYnVuZGxlZCBsbGFtYS5jcHAKIyBydW50aW1lIChiaW4vKSwgb2ZmbGluZS4gVGhlIGNob2ljZSBhbmQgaXRzIG1lYXN1cmVtZW50cyBhcmUgaW4KIyBJTktXRUxMX0hBTkRPRkZfdjdwMzQudHh0LgpXUklUSU5HX01PREVMUyA9IFsKICAgICMgbWVhc3VyZWQgNiBPY3RvYmVyIDIwMjYgKEpGTEVHIGxlYXJuZXIgc2VudGVuY2VzIGFuZCBjb3JyZWN0IFdpa2lwZWRpYQogICAgIyBzZW50ZW5jZXMsIGJlaGluZCBJbmt3ZWxsJ3Mgc2FmZXR5IGZpbHRlcik6IDQwJSBpbXByb3ZlZCwgOSUgbWFkZSB3b3JzZSwKICAgICMgNiUgb2YgY29ycmVjdCBzZW50ZW5jZXMgY2hhbmdlZDsgZXZlcnkgY2l0YXRpb24ga2VwdCBpbiAyNCByZXdyaXRlcy4KICAgIHsiaWQiOiAicXdlbjMtNGItMjUwNyIsICJsYWJlbCI6ICJRd2VuMyA0QiBJbnN0cnVjdCAoMjUwNykiLCAicmVwbyI6ICJ1bnNsb3RoL1F3ZW4zLTRCLUluc3RydWN0LTI1MDctR0dVRiIsCiAgICAgImZpbGUiOiAiUXdlbjMtNEItSW5zdHJ1Y3QtMjUwNy1RNF9LX00uZ2d1ZiIsICJieXRlcyI6IDI0OTcyODExMjAsICJtaW5fcmFtX2diIjogOCwKICAgICAibGljZW5jZSI6ICJBcGFjaGUgMi4wIiwgIm5vdGUiOiAidGhlIG1lYXN1cmVkIGNob2ljZSBmb3IgOCBHQiBjb21wdXRlcnMgYW5kIHVwIn0sCl0KSU5TVEFMTCA9IHsic3RhdGUiOiAiaWRsZSIsICJpZCI6IE5vbmUsICJkb25lIjogMCwgInRvdGFsIjogMCwgImVycm9yIjogTm9uZX0KCgpkZWYgX3JhbV9nYigpOgogICAgIiIiVGhpcyBjb21wdXRlcidzIG1lbW9yeSBpbiBHQiAoMCB3aGVuIGl0IGNhbm5vdCBiZSByZWFkKS4iIiIKICAgIHRyeToKICAgICAgICBpZiBzeXMucGxhdGZvcm0gPT0gImRhcndpbiI6CiAgICAgICAgICAgIGltcG9ydCBzdWJwcm9jZXNzCiAgICAgICAgICAgIHJldHVybiBpbnQoc3VicHJvY2Vzcy5jaGVja19vdXRwdXQoWyJzeXNjdGwiLCAiLW4iLCAiaHcubWVtc2l6ZSJdKS5zdHJpcCgpKSAvIDIgKiogMzAKICAgICAgICBpZiBzeXMucGxhdGZvcm0uc3RhcnRzd2l0aCgid2luIik6CiAgICAgICAgICAgIGltcG9ydCBjdHlwZXMKICAgICAgICAgICAgY2xhc3MgTVMoY3R5cGVzLlN0cnVjdHVyZSk6CiAgICAgICAgICAgICAgICBfZmllbGRzXyA9IFsoImR3TGVuZ3RoIiwgY3R5cGVzLmNfdWxvbmcpLCAoImR3TWVtb3J5TG9hZCIsIGN0eXBlcy5jX3Vsb25nKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICgidWxsVG90YWxQaHlzIiwgY3R5cGVzLmNfdWxvbmdsb25nKSwgKCJ1bGxBdmFpbFBoeXMiLCBjdHlwZXMuY191bG9uZ2xvbmcpLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgKCJ1bGxUb3RhbFBhZ2VGaWxlIiwgY3R5cGVzLmNfdWxvbmdsb25nKSwgKCJ1bGxBdmFpbFBhZ2VGaWxlIiwgY3R5cGVzLmNfdWxvbmdsb25nKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICgidWxsVG90YWxWaXJ0dWFsIiwgY3R5cGVzLmNfdWxvbmdsb25nKSwgKCJ1bGxBdmFpbFZpcnR1YWwiLCBjdHlwZXMuY191bG9uZ2xvbmcpLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgKCJzdWxsQXZhaWxFeHRlbmRlZFZpcnR1YWwiLCBjdHlwZXMuY191bG9uZ2xvbmcpXQogICAgICAgICAgICBtID0gTVMoKTsgbS5kd0xlbmd0aCA9IGN0eXBlcy5zaXplb2YoTVMpCiAgICAgICAgICAgIGN0eXBlcy53aW5kbGwua2VybmVsMzIuR2xvYmFsTWVtb3J5U3RhdHVzRXgoY3R5cGVzLmJ5cmVmKG0pKQogICAgICAgICAgICByZXR1cm4gbS51bGxUb3RhbFBoeXMgLyAyICoqIDMwCiAgICAgICAgd2l0aCBvcGVuKCIvcHJvYy9tZW1pbmZvIikgYXMgZjoKICAgICAgICAgICAgZm9yIGxpbmUgaW4gZjoKICAgICAgICAgICAgICAgIGlmIGxpbmUuc3RhcnRzd2l0aCgiTWVtVG90YWw6Iik6CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGludChsaW5lLnNwbGl0KClbMV0pIC8gMiAqKiAyMAogICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICBwYXNzCiAgICByZXR1cm4gMAoKCmRlZiBfcmVjb21tZW5kZWQocmFtKToKICAgICIiIlRoZSBzdHJvbmdlc3QgbWVhc3VyZWQgbW9kZWwgdGhpcyBjb21wdXRlcidzIG1lbW9yeSBob2xkcyBjb21mb3J0YWJseS4iIiIKICAgICMgbWVtb3J5IHVua25vd246IHRoZSBzbWFsbGVzdCBtZWFzdXJlZCBtb2RlbCwgbmV2ZXIgdGhlIGxhcmdlc3QKICAgIGZpdCA9IFttIGZvciBtIGluIFdSSVRJTkdfTU9ERUxTIGlmIHJhbSBhbmQgbS5nZXQoIm1pbl9yYW1fZ2IiLCA4KSA8PSByYW0gKyAwLjVdCiAgICByZXR1cm4gKGZpdFswXSBpZiBmaXQgZWxzZSBXUklUSU5HX01PREVMU1stMV0pWyJpZCJdIGlmIFdSSVRJTkdfTU9ERUxTIGVsc2UgTm9uZQoKCmRlZiBfcnVudGltZV9vaygpOgogICAgaWYgX2ZpbmRfcnVudGltZSgpOgogICAgICAgIHJldHVybiBUcnVlCiAgICB0cnk6CiAgICAgICAgaW1wb3J0IGltcG9ydGxpYi51dGlsCiAgICAgICAgcmV0dXJuIGltcG9ydGxpYi51dGlsLmZpbmRfc3BlYygibGxhbWFfY3BwIikgaXMgbm90IE5vbmUKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcmV0dXJuIEZhbHNlCgoKZGVmIGVwX21vZGVsX2NhdGFsb2coYm9keSk6CiAgICByYW0gPSBfcmFtX2diKCkKICAgIHJldHVybiB7Im9rIjogVHJ1ZSwgIm1vZGVscyI6IFdSSVRJTkdfTU9ERUxTLCAicnVudGltZSI6IF9ydW50aW1lX29rKCksCiAgICAgICAgICAgICJyYW1fZ2IiOiByb3VuZChyYW0sIDEpLCAicmVjb21tZW5kZWQiOiBfcmVjb21tZW5kZWQocmFtKSwKICAgICAgICAgICAgImluc3RhbGxlZCI6IFtjWyJuYW1lIl0gZm9yIGMgaW4gc2Nhbl9sb2NhbF9tb2RlbHMoKV0sCiAgICAgICAgICAgICJhY3RpdmUiOiBBSS5nZXQoImxvY2FsX25hbWUiKSwgInJlYWR5IjogQUlbInJlYWR5Il0sICJsb2FkaW5nIjogQUlbImxvYWRpbmciXSwKICAgICAgICAgICAgImluc3RhbGwiOiBkaWN0KElOU1RBTEwpLCAibG9hZF9lcnJvciI6IEFJLmdldCgibG9hZF9lcnJvciIpfQoKCmRlZiBfZmV0Y2godXJsLCBkZXN0KToKICAgICIiIkRvd25sb2FkIHVybCB0byBkZXN0ICh2aWEgZGVzdC5wYXJ0KSwgY291bnRpbmcgYnl0ZXMgaW50byBJTlNUQUxMLgogICAgY3VybCBmaXJzdCBvbiBhIE1hYyAodGhlIHN5c3RlbSdzIGNlcnRpZmljYXRlcyk7IFB5dGhvbiBvdGhlcndpc2UuIiIiCiAgICBpbXBvcnQgc3VicHJvY2VzcywgdXJsbGliLnJlcXVlc3QKICAgIHBhcnQgPSBkZXN0ICsgIi5wYXJ0IgogICAgaWYgc3lzLnBsYXRmb3JtID09ICJkYXJ3aW4iIGFuZCBzaHV0aWwud2hpY2goImN1cmwiKToKICAgICAgICBwcm9jID0gc3VicHJvY2Vzcy5Qb3BlbihbImN1cmwiLCAiLWZzU0wiLCAiLW8iLCBwYXJ0LCB1cmxdKQogICAgICAgIHdoaWxlIHByb2MucG9sbCgpIGlzIE5vbmU6CiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIElOU1RBTExbImRvbmUiXSA9IG9zLnBhdGguZ2V0c2l6ZShwYXJ0KQogICAgICAgICAgICBleGNlcHQgT1NFcnJvcjoKICAgICAgICAgICAgICAgIHBhc3MKICAgICAgICAgICAgdGltZS5zbGVlcCgxKQogICAgICAgIGlmIHByb2MucmV0dXJuY29kZSAhPSAwOgogICAgICAgICAgICByYWlzZSBSdW50aW1lRXJyb3IoZiJkb3dubG9hZCBmYWlsZWQgKGN1cmwgZXhpdCB7cHJvYy5yZXR1cm5jb2RlfSkiKQogICAgZWxzZToKICAgICAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4odXJsLCB0aW1lb3V0PTYwKSBhcyByLCBvcGVuKHBhcnQsICJ3YiIpIGFzIGY6CiAgICAgICAgICAgIHdoaWxlIFRydWU6CiAgICAgICAgICAgICAgICBjaHVuayA9IHIucmVhZCgxIDw8IDIwKQogICAgICAgICAgICAgICAgaWYgbm90IGNodW5rOgogICAgICAgICAgICAgICAgICAgIGJyZWFrCiAgICAgICAgICAgICAgICBmLndyaXRlKGNodW5rKQogICAgICAgICAgICAgICAgSU5TVEFMTFsiZG9uZSJdICs9IGxlbihjaHVuaykKICAgIGlmIElOU1RBTExbInRvdGFsIl0gYW5kIG9zLnBhdGguZ2V0c2l6ZShwYXJ0KSAhPSBJTlNUQUxMWyJ0b3RhbCJdOgogICAgICAgIHJhaXNlIFJ1bnRpbWVFcnJvcihmImRvd25sb2FkIGluY29tcGxldGUgKHtvcy5wYXRoLmdldHNpemUocGFydCl9IG9mIHtJTlNUQUxMWyd0b3RhbCddfSBieXRlcykiKQogICAgb3MucmVwbGFjZShwYXJ0LCBkZXN0KQoKCmRlZiBfaW5zdGFsbF93b3JrZXIobSk6CiAgICB0cnk6CiAgICAgICAgb3MubWFrZWRpcnMoTU9ERUxTX0RJUiwgZXhpc3Rfb2s9VHJ1ZSkKICAgICAgICBkZXN0ID0gb3MucGF0aC5qb2luKE1PREVMU19ESVIsIG1bImZpbGUiXSkKICAgICAgICBpZiBub3QgKG9zLnBhdGguaXNmaWxlKGRlc3QpIGFuZCBvcy5wYXRoLmdldHNpemUoZGVzdCkgPT0gbVsiYnl0ZXMiXSk6CiAgICAgICAgICAgIF9mZXRjaChmImh0dHBzOi8vaHVnZ2luZ2ZhY2UuY28ve21bJ3JlcG8nXX0vcmVzb2x2ZS9tYWluL3ttWydmaWxlJ119IiwgZGVzdCkKICAgICAgICBJTlNUQUxMWyJzdGF0ZSJdID0gImxvYWRpbmciCiAgICAgICAgdW5sb2FkX2xvY2FsKCkKICAgICAgICBjYW5kID0geyJraW5kIjogImdndWYiLCAicGF0aCI6IGRlc3QsICJuYW1lIjogbVsiZmlsZSJdfQogICAgICAgIGlmIG5vdCBsb2FkX2xvY2FsX3BhdGgoY2FuZCk6CiAgICAgICAgICAgIHJhaXNlIFJ1bnRpbWVFcnJvcihBSS5nZXQoImxvYWRfZXJyb3IiKSBvciAidGhlIG1vZGVsIHdvdWxkIG5vdCBzdGFydCIpCiAgICAgICAgYyA9IGNvbmZfcmVhZCgpOyBjWyJhY3RpdmUiXSA9IG1bImZpbGUiXTsgY29uZl93cml0ZShjKQogICAgICAgIEFJWyJyZWFkeSJdID0gVHJ1ZQogICAgICAgIEFJWyJwaXBlX2tpbmQiXSA9ICJsb2NhbCIKICAgICAgICBfQ09SUkVDVF9DQUNIRS5jbGVhcigpCiAgICAgICAgSU5TVEFMTFsic3RhdGUiXSA9ICJkb25lIgogICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgIElOU1RBTExbInN0YXRlIl0gPSAiZXJyb3IiCiAgICAgICAgSU5TVEFMTFsiZXJyb3IiXSA9IGYie3R5cGUoZSkuX19uYW1lX199OiB7ZX0iCiAgICAgICAgcHJpbnQoIltpbmt3ZWxsXSBtb2RlbCBpbnN0YWxsOiIsIElOU1RBTExbImVycm9yIl0pCgoKZGVmIGVwX21vZGVsX2luc3RhbGwoYm9keSk6CiAgICBtID0gbmV4dCgoeCBmb3IgeCBpbiBXUklUSU5HX01PREVMUyBpZiB4WyJpZCJdID09IGJvZHkuZ2V0KCJpZCIpKSwgTm9uZSkKICAgIGlmIG5vdCBtOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJ1bmtub3duIG1vZGVsIn0KICAgIGlmIElOU1RBTExbInN0YXRlIl0gaW4gKCJkb3dubG9hZGluZyIsICJsb2FkaW5nIik6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogImFuIGluc3RhbGwgaXMgYWxyZWFkeSBydW5uaW5nIn0KICAgIGlmIG5vdCBfcnVudGltZV9vaygpOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJ0aGUgbGxhbWEuY3BwIHJ1bnRpbWUgKGJpbi8pIGlzIG1pc3NpbmcgZnJvbSB0aGlzIGluc3RhbGxhdGlvbiJ9CiAgICBJTlNUQUxMLnVwZGF0ZSh7InN0YXRlIjogImRvd25sb2FkaW5nIiwgImlkIjogbVsiaWQiXSwgImRvbmUiOiAwLCAidG90YWwiOiBtWyJieXRlcyJdLCAiZXJyb3IiOiBOb25lfSkKICAgIHRocmVhZGluZy5UaHJlYWQodGFyZ2V0PV9pbnN0YWxsX3dvcmtlciwgYXJncz0obSwpLCBkYWVtb249VHJ1ZSkuc3RhcnQoKQogICAgcmV0dXJuIHsib2siOiBUcnVlfQoKClJPVVRFUyA9IHsKICAgICJjb3JyZWN0IjogZXBfY29ycmVjdCwgInJld3JpdGUiOiBlcF9yZXdyaXRlLCAicmV3cml0ZV9wcmVzZXQiOiBlcF9yZXdyaXRlX3ByZXNldCwKICAgICJyZXdyaXRlX2N1c3RvbSI6IGVwX3Jld3JpdGVfY3VzdG9tLCAicHJlc2V0cyI6IGVwX3ByZXNldHMsCiAgICAiY29tcG9zZSI6IGVwX2NvbXBvc2UsCiAgICAidG9uZSI6IGVwX3RvbmUsICJzaW1pbGFyaXR5IjogZXBfc2ltaWxhcml0eSwgInNvY3JhdCI6IGVwX3NvY3JhdCwKICAgICJyZXZpZXciOiBlcF9yZXZpZXcsICJyZWFkZXIiOiBlcF9yZWFkZXIsICJzZWxlY3RfbW9kZWwiOiBlcF9zZWxlY3RfbW9kZWwsICJyZW1vdmVfbW9kZWwiOiBlcF9yZW1vdmVfbW9kZWwsCiAgICAic3luY19wdXNoIjogZXBfc3luY19wdXNoLCAic3luY19wdWxsIjogZXBfc3luY19wdWxsLAogICAgInRyYW5zY3JpYmUiOiBlcF90cmFuc2NyaWJlLCAic3R0X3N0YXR1cyI6IGVwX3N0dF9zdGF0dXMsICJuZXRfc3RhdHVzIjogZXBfbmV0X3N0YXR1cywKICAgICJzdHRfd2FybSI6IGVwX3N0dF93YXJtLAogICAgIm1vZGVsX2NhdGFsb2ciOiBlcF9tb2RlbF9jYXRhbG9nLCAibW9kZWxfaW5zdGFsbCI6IGVwX21vZGVsX2luc3RhbGwsCn0KIyBlbmRwb2ludHMgdGhhdCBvbmx5IHRoaXMgY29tcHV0ZXIgbWF5IGNhbGwsIG5ldmVyIGEgdGFibGV0IG9uIHRoZSBuZXR3b3JrCkxPQ0FMX09OTFkgPSAoImxhbl9zdGF0dXMiLCAibGFuX2VuYWJsZSIsICJtb2RlbF9jYXRhbG9nIiwgIm1vZGVsX2luc3RhbGwiKQoKCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBIVFRQIGxheWVyCmNsYXNzIEhhbmRsZXIoQmFzZUhUVFBSZXF1ZXN0SGFuZGxlcik6CiAgICBkZWYgX3NlbmQoc2VsZiwgY29kZSwgb2JqKToKICAgICAgICBkYXRhID0ganNvbi5kdW1wcyhvYmopLmVuY29kZSgpCiAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKGNvZGUpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1UeXBlIiwgImFwcGxpY2F0aW9uL2pzb24iKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiIsICIqIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzIiwgIkNvbnRlbnQtVHlwZSIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyIsICJHRVQsIFBPU1QsIE9QVElPTlMiKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtTGVuZ3RoIiwgc3RyKGxlbihkYXRhKSkpCiAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpCiAgICAgICAgc2VsZi53ZmlsZS53cml0ZShkYXRhKQoKICAgIGRlZiBkb19PUFRJT05TKHNlbGYpOgogICAgICAgIHNlbGYuX3NlbmQoMjA0LCB7fSkKCiAgICBkZWYgZG9fR0VUKHNlbGYpOgogICAgICAgIGlmIHNlbGYucGF0aCA9PSAiL2FwaS9oZWFsdGgiOgogICAgICAgICAgICBtb2RlbCA9IEFJLmdldCgibG9jYWxfbmFtZSIpIG9yIChJTlNUUlVDVF9NT0RFTCBpZiBBSVsicmVhZHkiXSBlbHNlIE5vbmUpCiAgICAgICAgICAgIHNlbGYuX3NlbmQoMjAwLCB7Im9rIjogVHJ1ZSwgImFpIjogQUlbInJlYWR5Il0sICJtb2RlbCI6IG1vZGVsLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICJlbmdpbmUiOiBBSS5nZXQoImxvY2FsX2tpbmQiKSBvciAoInRyYW5zZm9ybWVycyIgaWYgQUlbInJlYWR5Il0gZWxzZSBOb25lKX0pCiAgICAgICAgZWxpZiBzZWxmLnBhdGggPT0gIi9hcGkvbW9kZWxzIjoKICAgICAgICAgICAgc2VsZi5fc2VuZCgyMDAsIHsiZGlyIjogTU9ERUxTX0RJUiwgImZvdW5kIjogc2Nhbl9sb2NhbF9tb2RlbHMoKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAiYWN0aXZlIjogQUkuZ2V0KCJsb2NhbF9uYW1lIil9KQogICAgICAgIGVsaWYgc2VsZi5wYXRoLnNwbGl0KCI/IilbMF0gaW4gKCIvYXBpL25ldF9zdGF0dXMiLCAiL2FwaS9zdHRfc3RhdHVzIiwgIi9hcGkvcHJlc2V0cyIpOgogICAgICAgICAgICAjIHJlYWQtb25seSBlbmRwb2ludHMgYW5zd2VyIEdFVCBhcyB3ZWxsIGFzIFBPU1QgKFNjcmliYSBhc2tzIHdpdGggR0VUKQogICAgICAgICAgICBuYW1lID0gc2VsZi5wYXRoLnNwbGl0KCI/IilbMF1bbGVuKCIvYXBpLyIpOl0KICAgICAgICAgICAgdHJ5OgogICAgICAgICAgICAgICAgc2VsZi5fc2VuZCgyMDAsIFJPVVRFU1tuYW1lXSh7fSkpCiAgICAgICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgICAgIHNlbGYuX3NlbmQoNTAwLCB7ImVycm9yIjogc3RyKGUpfSkKICAgICAgICBlbHNlOgogICAgICAgICAgICBzZWxmLl9zZW5kKDQwNCwgeyJlcnJvciI6ICJub3QgZm91bmQifSkKCiAgICBkZWYgZG9fUE9TVChzZWxmKToKICAgICAgICBmcm9tIHVybGxpYi5wYXJzZSBpbXBvcnQgdXJscGFyc2UsIHBhcnNlX3FzCiAgICAgICAgcGFyc2VkID0gdXJscGFyc2Uoc2VsZi5wYXRoKQogICAgICAgIGlmIHBhcnNlZC5wYXRoID09ICIvYXBpL3VwbG9hZF9tb2RlbCI6CiAgICAgICAgICAgIHJldHVybiBzZWxmLl91cGxvYWRfbW9kZWwocGFyc2VfcXMocGFyc2VkLnF1ZXJ5KSkKICAgICAgICBtID0gcmUubWF0Y2gociJeL2FwaS8oW2Etel9dKykkIiwgcGFyc2VkLnBhdGgpCiAgICAgICAgaWYgbSBhbmQgbS5ncm91cCgxKSBpbiBMT0NBTF9PTkxZIGFuZCBzZWxmLmNsaWVudF9hZGRyZXNzWzBdIG5vdCBpbiAoIjEyNy4wLjAuMSIsICI6OjEiLCAiOjpmZmZmOjEyNy4wLjAuMSIpOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCg0MDMsIHsiZXJyb3IiOiAib25seSBmcm9tIHRoaXMgY29tcHV0ZXIifSkKICAgICAgICBpZiBtIGFuZCBtLmdyb3VwKDEpIGluICgibGFuX3N0YXR1cyIsICJsYW5fZW5hYmxlIik6CiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIGJvZHkgPSBqc29uLmxvYWRzKHNlbGYucmZpbGUucmVhZChpbnQoc2VsZi5oZWFkZXJzLmdldCgiQ29udGVudC1MZW5ndGgiLCAwKSkgb3IgYiJ7fSIpKQogICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICAgICAgYm9keSA9IHt9CiAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDIwMCwgKGVwX2xhbl9zdGF0dXMgaWYgbS5ncm91cCgxKSA9PSAibGFuX3N0YXR1cyIgZWxzZSBlcF9sYW5fZW5hYmxlKShib2R5KSkKICAgICAgICBpZiBub3QgbSBvciBtLmdyb3VwKDEpIG5vdCBpbiBST1VURVM6CiAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDQwNCwgeyJlcnJvciI6ICJ1bmtub3duIGVuZHBvaW50In0pCiAgICAgICAgdHJ5OgogICAgICAgICAgICBib2R5ID0ganNvbi5sb2FkcyhzZWxmLnJmaWxlLnJlYWQoaW50KHNlbGYuaGVhZGVycy5nZXQoIkNvbnRlbnQtTGVuZ3RoIiwgMCkpIG9yIGIie30iKSkKICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCg0MDAsIHsiZXJyb3IiOiAiYmFkIGpzb24ifSkKICAgICAgICB0cnk6CiAgICAgICAgICAgIHNlbGYuX3NlbmQoMjAwLCBST1VURVNbbS5ncm91cCgxKV0oYm9keSkpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBlbmRwb2ludCBlcnJvcjoge2V9IikKICAgICAgICAgICAgc2VsZi5fc2VuZCg1MDAsIHsiZXJyb3IiOiBzdHIoZSl9KQoKICAgIGRlZiBfdXBsb2FkX21vZGVsKHNlbGYsIHFzKToKICAgICAgICAiIiJTdHJlYW1zIGEgbW9kZWwgZmlsZSBmcm9tIGRpc2sgb250byB0aGUgc2hlbGYuIFF1ZXJ5IHBhcmFtczoKICAgICAgICBuYW1lID0gZmlsZSBuYW1lOyBkaXIgPSBNTFggZm9sZGVyIG5hbWUgKGtlZXBzIGl0cyBpbm5lciBmaWxlcykuIiIiCiAgICAgICAgcmF3X25hbWUgPSAocXMuZ2V0KCJuYW1lIiwgWyIiXSlbMF0gb3IgIiIpLnN0cmlwKCkKICAgICAgICBzdWJfZGlyID0gKHFzLmdldCgiZGlyIiwgWyIiXSlbMF0gb3IgIiIpLnN0cmlwKCkKICAgICAgICBpZiBub3QgcmF3X25hbWU6CiAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDQwMCwgeyJlcnJvciI6ICJubyBuYW1lIn0pCiAgICAgICAgZm9yIGJhZCBpbiAoIi4uIiwgIi8iLCAiXFwiLCBvcy5zZXApOgogICAgICAgICAgICBpZiBiYWQgaW4gcmF3X25hbWUgb3IgKHN1Yl9kaXIgYW5kIGJhZCBpbiBzdWJfZGlyKToKICAgICAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDQwMCwgeyJlcnJvciI6ICJiYWQgcGF0aCJ9KQogICAgICAgIG9zLm1ha2VkaXJzKE1PREVMU19ESVIsIGV4aXN0X29rPVRydWUpCiAgICAgICAgZGVzdCA9IG9zLnBhdGguam9pbihNT0RFTFNfRElSLCBzdWJfZGlyLCByYXdfbmFtZSkgaWYgc3ViX2RpciBcCiAgICAgICAgICAgIGVsc2Ugb3MucGF0aC5qb2luKE1PREVMU19ESVIsIHJhd19uYW1lKQogICAgICAgIG9zLm1ha2VkaXJzKG9zLnBhdGguZGlybmFtZShkZXN0KSwgZXhpc3Rfb2s9VHJ1ZSkKICAgICAgICB0cnk6CiAgICAgICAgICAgIHRvdGFsID0gaW50KHNlbGYuaGVhZGVycy5nZXQoIkNvbnRlbnQtTGVuZ3RoIiwgMCkgb3IgMCkKICAgICAgICBleGNlcHQgVmFsdWVFcnJvcjoKICAgICAgICAgICAgdG90YWwgPSAwCiAgICAgICAgd3JpdHRlbiA9IDAKICAgICAgICB0cnk6CiAgICAgICAgICAgIHdpdGggb3BlbihkZXN0LCAid2IiKSBhcyBvdXQ6CiAgICAgICAgICAgICAgICByZW1haW5pbmcgPSB0b3RhbCBpZiB0b3RhbCA+IDAgZWxzZSBOb25lCiAgICAgICAgICAgICAgICB3aGlsZSBUcnVlOgogICAgICAgICAgICAgICAgICAgIHdhbnQgPSAxIDw8IDIwIGlmIHJlbWFpbmluZyBpcyBOb25lIGVsc2UgbWluKDEgPDwgMjAsIHJlbWFpbmluZykKICAgICAgICAgICAgICAgICAgICBpZiB3YW50IDw9IDA6CiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrCiAgICAgICAgICAgICAgICAgICAgY2h1bmsgPSBzZWxmLnJmaWxlLnJlYWQod2FudCkKICAgICAgICAgICAgICAgICAgICBpZiBub3QgY2h1bms6CiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrCiAgICAgICAgICAgICAgICAgICAgb3V0LndyaXRlKGNodW5rKQogICAgICAgICAgICAgICAgICAgIHdyaXR0ZW4gKz0gbGVuKGNodW5rKQogICAgICAgICAgICAgICAgICAgIGlmIHJlbWFpbmluZyBpcyBub3QgTm9uZToKICAgICAgICAgICAgICAgICAgICAgICAgcmVtYWluaW5nIC09IGxlbihjaHVuaykKICAgICAgICAgICAgICAgICAgICAgICAgaWYgcmVtYWluaW5nIDw9IDA6CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhawogICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgcmV0dXJuIHNlbGYuX3NlbmQoNTAwLCB7ImVycm9yIjogc3RyKGUpfSkKICAgICAgICBwcmludChmIltpbmt3ZWxsXSBtb2RlbCBhcnJpdmVkOiB7cmF3X25hbWV9ICh7d3JpdHRlbjosfSBieXRlcykiKQogICAgICAgICMgYSBmcmVzaCBHR1VGIGJlY29tZXMgYWN0aXZlIHdoZW4gbm90aGluZyBlbHNlIGlzIGNob3NlbiB5ZXQKICAgICAgICBpZiByYXdfbmFtZS5sb3dlcigpLmVuZHN3aXRoKCIuZ2d1ZiIpIGFuZCBub3QgY29uZl9yZWFkKCkuZ2V0KCJhY3RpdmUiKToKICAgICAgICAgICAgYyA9IGNvbmZfcmVhZCgpOyBjWyJhY3RpdmUiXSA9IHJhd19uYW1lOyBjb25mX3dyaXRlKGMpCiAgICAgICAgcmV0dXJuIHNlbGYuX3NlbmQoMjAwLCB7Im9rIjogVHJ1ZSwgIm5hbWUiOiByYXdfbmFtZSwgImJ5dGVzIjogd3JpdHRlbn0pCgogICAgZGVmIGxvZ19tZXNzYWdlKHNlbGYsIGZtdCwgKmFyZ3MpOgogICAgICAgIHBhc3MgICMgcXVpZXQKCgoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGhvbWUgbmV0d29yayAodjIuMTIpCiMgVGhlIGxhcHRvcCdzIG1vZGVsIGZvciB0aGUgdGFibGV0cyBvbiB0aGUgc2FtZSBXaS1GaS4gT2ZmIHVudGlsIHN3aXRjaGVkIG9uCiMgZnJvbSB0aGUgbGFwdG9wIGl0c2VsZi4gQSBzZWNvbmQgbGlzdGVuZXIgb24gTEFOX1BPUlQgc2VydmVzIG9ubHkgdGhlIHdyaXRpbmcKIyBhbmQgdm9pY2UgZW5kcG9pbnRzLCBhbmQgb25seSB0byBhIGRldmljZSB0aGF0IHNlbmRzIHRoZSA2LWRpZ2l0IHBhaXJpbmcgY29kZQojIGluIFgtSW5rd2VsbC1LZXkuIE1vZGVscywgdGhlIHNoZWxmIGFuZCB0aGUgc3luY2VkIGxpYnJhcnkgYXJlIG5ldmVyIHNlcnZlZAojIHRvIHRoZSBuZXR3b3JrLiBUaGUgY29kZSBhbmQgdGhlIG9uL29mZiBjaG9pY2UgbGl2ZSBpbiBpbmt3ZWxsX2xhbi5qc29uLgppbXBvcnQgaG1hYwppbXBvcnQgc2VjcmV0cwppbXBvcnQgc29ja2V0CgpMQU5fUE9SVCA9IGludChvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9MQU5fUE9SVCIsICI4MzE4IikpCkxBTl9QQVRIID0gb3MucGF0aC5qb2luKERBVEFfRElSLCAiaW5rd2VsbF9sYW4uanNvbiIpCkxBTl9ST1VURVMgPSB7ImNvcnJlY3QiLCAicmV3cml0ZSIsICJyZXdyaXRlX3ByZXNldCIsICJyZXdyaXRlX2N1c3RvbSIsICJwcmVzZXRzIiwgImNvbXBvc2UiLAogICAgICAgICAgICAgICJ0b25lIiwgInNpbWlsYXJpdHkiLCAic29jcmF0IiwgInJldmlldyIsICJyZWFkZXIiLCAidHJhbnNjcmliZSIsICJzdHRfc3RhdHVzIiwKICAgICAgICAgICAgICAic3R0X3dhcm0iLCAibmV0X3N0YXR1cyJ9CkxBTiA9IHsic2VydmVyIjogTm9uZX0KCgpkZWYgbGFuX2NvbmYoKToKICAgIHRyeToKICAgICAgICB3aXRoIG9wZW4oTEFOX1BBVEgsIGVuY29kaW5nPSJ1dGYtOCIpIGFzIGY6CiAgICAgICAgICAgIGMgPSBqc29uLmxvYWQoZikKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgYyA9IHt9CiAgICBpZiBub3QgKGlzaW5zdGFuY2UoYy5nZXQoImNvZGUiKSwgc3RyKSBhbmQgbGVuKGNbImNvZGUiXSkgPT0gNiBhbmQgY1siY29kZSJdLmlzZGlnaXQoKSk6CiAgICAgICAgY1siY29kZSJdID0gIiUwNmQiICUgc2VjcmV0cy5yYW5kYmVsb3coMTAwMDAwMCkKICAgICAgICBjLnNldGRlZmF1bHQoImVuYWJsZWQiLCBGYWxzZSkKICAgICAgICBsYW5fY29uZl93cml0ZShjKQogICAgcmV0dXJuIGMKCgpkZWYgbGFuX2NvbmZfd3JpdGUoYyk6CiAgICB0bXAgPSBMQU5fUEFUSCArICIudG1wIgogICAgd2l0aCBvcGVuKHRtcCwgInciLCBlbmNvZGluZz0idXRmLTgiKSBhcyBmOgogICAgICAgIGpzb24uZHVtcChjLCBmKQogICAgb3MucmVwbGFjZSh0bXAsIExBTl9QQVRIKQoKCmRlZiBsYW5fYWRkcmVzc2VzKCk6CiAgICAiIiJUaGlzIGNvbXB1dGVyJ3MgYWRkcmVzcyBvbiB0aGUgaG9tZSBuZXR3b3JrLCBhcyBvdGhlciBkZXZpY2VzIHNlZSBpdC4iIiIKICAgIGZvdW5kID0gW10KICAgIHRyeToKICAgICAgICBzMiA9IHNvY2tldC5zb2NrZXQoc29ja2V0LkFGX0lORVQsIHNvY2tldC5TT0NLX0RHUkFNKQogICAgICAgIHMyLmNvbm5lY3QoKCIxOTIuMC4yLjEiLCA5KSkgICMgbm8gcGFja2V0IGlzIHNlbnQ7IHRoaXMgb25seSBwaWNrcyB0aGUgb3V0Z29pbmcgaW50ZXJmYWNlCiAgICAgICAgZm91bmQuYXBwZW5kKHMyLmdldHNvY2tuYW1lKClbMF0pCiAgICAgICAgczIuY2xvc2UoKQogICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICBwYXNzCiAgICB0cnk6CiAgICAgICAgZm9yIGluZm8gaW4gc29ja2V0LmdldGFkZHJpbmZvKHNvY2tldC5nZXRob3N0bmFtZSgpLCBOb25lLCBzb2NrZXQuQUZfSU5FVCk6CiAgICAgICAgICAgIGlwID0gaW5mb1s0XVswXQogICAgICAgICAgICBpZiBpcCBub3QgaW4gZm91bmQgYW5kIG5vdCBpcC5zdGFydHN3aXRoKCIxMjcuIik6CiAgICAgICAgICAgICAgICBmb3VuZC5hcHBlbmQoaXApCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHBhc3MKICAgIHJldHVybiBbaXAgZm9yIGlwIGluIGZvdW5kIGlmIG5vdCBpcC5zdGFydHN3aXRoKCIxMjcuIildCgoKZGVmIGxhbl9zdGF0dXMoKToKICAgIGMgPSBsYW5fY29uZigpCiAgICByZXR1cm4geyJvayI6IFRydWUsICJlbmFibGVkIjogYm9vbChjLmdldCgiZW5hYmxlZCIpKSwgInJ1bm5pbmciOiBMQU5bInNlcnZlciJdIGlzIG5vdCBOb25lLAogICAgICAgICAgICAiY29kZSI6IGNbImNvZGUiXSwgInBvcnQiOiBMQU5fUE9SVCwKICAgICAgICAgICAgImFkZHJlc3NlcyI6IFsiJXM6JWQiICUgKGlwLCBMQU5fUE9SVCkgZm9yIGlwIGluIGxhbl9hZGRyZXNzZXMoKV19CgoKZGVmIGxhbl9zdGFydCgpOgogICAgaWYgTEFOWyJzZXJ2ZXIiXSBpcyBub3QgTm9uZToKICAgICAgICByZXR1cm4gVHJ1ZQogICAgdHJ5OgogICAgICAgIHNydiA9IFRocmVhZGluZ0hUVFBTZXJ2ZXIoKCIwLjAuMC4wIiwgTEFOX1BPUlQpLCBMYW5IYW5kbGVyKQogICAgZXhjZXB0IE9TRXJyb3IgYXMgZToKICAgICAgICBwcmludChmIltpbmt3ZWxsXSBob21lIG5ldHdvcms6IHBvcnQge0xBTl9QT1JUfSB1bmF2YWlsYWJsZSAoe2V9KSIpCiAgICAgICAgcmV0dXJuIEZhbHNlCiAgICBMQU5bInNlcnZlciJdID0gc3J2CiAgICB0aHJlYWRpbmcuVGhyZWFkKHRhcmdldD1zcnYuc2VydmVfZm9yZXZlciwgZGFlbW9uPVRydWUpLnN0YXJ0KCkKICAgIHByaW50KGYiW2lua3dlbGxdIGhvbWUgbmV0d29yazogdGFibGV0cyBjYW4gY29ubmVjdCBhdCB7JywgJy5qb2luKGxhbl9zdGF0dXMoKVsnYWRkcmVzc2VzJ10pIG9yICd0aGlzIGNvbXB1dGVyJ30iKQogICAgcmV0dXJuIFRydWUKCgpkZWYgbGFuX3N0b3AoKToKICAgIHNydiwgTEFOWyJzZXJ2ZXIiXSA9IExBTlsic2VydmVyIl0sIE5vbmUKICAgIGlmIHNydiBpcyBub3QgTm9uZToKICAgICAgICB0aHJlYWRpbmcuVGhyZWFkKHRhcmdldD1sYW1iZGE6IChzcnYuc2h1dGRvd24oKSwgc3J2LnNlcnZlcl9jbG9zZSgpKSwgZGFlbW9uPVRydWUpLnN0YXJ0KCkKCgpkZWYgZXBfbGFuX3N0YXR1cyhib2R5KToKICAgIHJldHVybiBsYW5fc3RhdHVzKCkKCgpkZWYgZXBfbGFuX2VuYWJsZShib2R5KToKICAgIGMgPSBsYW5fY29uZigpCiAgICBpZiBib2R5LmdldCgibmV3X2NvZGUiKToKICAgICAgICBjWyJjb2RlIl0gPSAiJTA2ZCIgJSBzZWNyZXRzLnJhbmRiZWxvdygxMDAwMDAwKQogICAgY1siZW5hYmxlZCJdID0gYm9vbChib2R5LmdldCgib24iLCBjLmdldCgiZW5hYmxlZCIpKSkKICAgIGxhbl9jb25mX3dyaXRlKGMpCiAgICBpZiBjWyJlbmFibGVkIl06CiAgICAgICAgbGFuX3N0YXJ0KCkKICAgIGVsc2U6CiAgICAgICAgbGFuX3N0b3AoKQogICAgcmV0dXJuIGxhbl9zdGF0dXMoKQoKCmNsYXNzIExhbkhhbmRsZXIoSGFuZGxlcik6CiAgICAiIiJXaGF0IGEgcGFpcmVkIHRhYmxldCBtYXkgYXNrIG9mIHRoZSBsYXB0b3A6IHdyaXRpbmcgYW5kIHZvaWNlLCBub3RoaW5nIGVsc2UuIiIiCgogICAgZGVmIF9jb3JzKHNlbGYpOgogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiIsICIqIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzIiwgIkNvbnRlbnQtVHlwZSwgWC1Jbmt3ZWxsLUtleSIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyIsICJHRVQsIFBPU1QsIE9QVElPTlMiKQogICAgICAgICMgYnJvd3NlcnMgYXNrIGJlZm9yZSBhIHBhZ2UgcmVhY2hlcyBhIGRldmljZSBvbiB0aGUgcHJpdmF0ZSBuZXR3b3JrCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctUHJpdmF0ZS1OZXR3b3JrIiwgInRydWUiKQoKICAgIGRlZiBfc2VuZChzZWxmLCBjb2RlLCBvYmopOgogICAgICAgIGRhdGEgPSBqc29uLmR1bXBzKG9iaikuZW5jb2RlKCkKICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2UoY29kZSkKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LVR5cGUiLCAiYXBwbGljYXRpb24vanNvbiIpCiAgICAgICAgc2VsZi5fY29ycygpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1MZW5ndGgiLCBzdHIobGVuKGRhdGEpKSkKICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkKICAgICAgICBzZWxmLndmaWxlLndyaXRlKGRhdGEpCgogICAgZGVmIF9wYWlyZWQoc2VsZik6CiAgICAgICAgZ2l2ZW4gPSAoc2VsZi5oZWFkZXJzLmdldCgiWC1Jbmt3ZWxsLUtleSIpIG9yICIiKS5zdHJpcCgpCiAgICAgICAgcmV0dXJuIGJvb2woZ2l2ZW4pIGFuZCBobWFjLmNvbXBhcmVfZGlnZXN0KGdpdmVuLCBsYW5fY29uZigpWyJjb2RlIl0pCgogICAgZGVmIGRvX0dFVChzZWxmKToKICAgICAgICBwYXRoID0gc2VsZi5wYXRoLnNwbGl0KCI/IilbMF0KICAgICAgICBpZiBub3Qgc2VsZi5fcGFpcmVkKCk6CiAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDQwMSwgeyJlcnJvciI6ICJwYWlyaW5nIGNvZGUgbmVlZGVkIiwgInBhaXJlZCI6IEZhbHNlfSkKICAgICAgICBpZiBwYXRoIGluICgiL2FwaS9oZWFsdGgiLCAiL2FwaS9uZXRfc3RhdHVzIiwgIi9hcGkvc3R0X3N0YXR1cyIsICIvYXBpL3ByZXNldHMiKToKICAgICAgICAgICAgcmV0dXJuIEhhbmRsZXIuZG9fR0VUKHNlbGYpCiAgICAgICAgcmV0dXJuIHNlbGYuX3NlbmQoNDA0LCB7ImVycm9yIjogIm5vdCBvZmZlcmVkIHRvIG90aGVyIGRldmljZXMifSkKCiAgICBkZWYgZG9fUE9TVChzZWxmKToKICAgICAgICBtID0gcmUubWF0Y2gociJeL2FwaS8oW2Etel9dKykkIiwgc2VsZi5wYXRoLnNwbGl0KCI/IilbMF0pCiAgICAgICAgaWYgbm90IHNlbGYuX3BhaXJlZCgpOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCg0MDEsIHsiZXJyb3IiOiAicGFpcmluZyBjb2RlIG5lZWRlZCIsICJwYWlyZWQiOiBGYWxzZX0pCiAgICAgICAgaWYgbm90IG0gb3IgbS5ncm91cCgxKSBub3QgaW4gTEFOX1JPVVRFUzoKICAgICAgICAgICAgcmV0dXJuIHNlbGYuX3NlbmQoNDA0LCB7ImVycm9yIjogIm5vdCBvZmZlcmVkIHRvIG90aGVyIGRldmljZXMifSkKICAgICAgICByZXR1cm4gSGFuZGxlci5kb19QT1NUKHNlbGYpCgpkZWYgX2Jvb3RfYmFja2dyb3VuZCgpOgogICAgX21pZ3JhdGVfbGVnYWN5KFsibW9kZWxzIl0pICAjIGJlZm9yZSB0aGUgbW9kZWwgc2Nhbiwgc28gYSBtb3ZlZCBzaGVsZiBpcyBmb3VuZAogICAgX2xvYWRfbW9kZWxzKCkKCgppZiBfX25hbWVfXyA9PSAiX19tYWluX18iOgogICAgdGhyZWFkaW5nLlRocmVhZCh0YXJnZXQ9X2Jvb3RfYmFja2dyb3VuZCwgZGFlbW9uPVRydWUpLnN0YXJ0KCkKICAgIHRyeToKICAgICAgICBpZiBsYW5fY29uZigpLmdldCgiZW5hYmxlZCIpOgogICAgICAgICAgICBsYW5fc3RhcnQoKQogICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgIHByaW50KGYiW2lua3dlbGxdIGhvbWUgbmV0d29yayBub3Qgc3RhcnRlZDoge2V9IikKICAgIHByaW50KGYiW2lua3dlbGxdIGxpc3RlbmluZyBvbiBodHRwOi8ve0hPU1R9OntQT1JUfTsga2VlcCB0aGlzIHdpbmRvdyBvcGVuIHdoaWxlIHlvdSB3cml0ZSIpCiAgICBUaHJlYWRpbmdIVFRQU2VydmVyKChIT1NULCBQT1JUKSwgSGFuZGxlcikuc2VydmVfZm9yZXZlcigpCg=="

def _server_beside_storage():
    """Write the embedded companion server beside the storage folder; never overwrite."""
    try:
        d = storage_dir()
    except Exception:
        d = None
    if not d:
        return None
    p = os.path.join(d, "server.py")
    try:
        if os.path.isfile(p):
            return p
        import base64 as _b64
        with open(p, "wb") as fh:
            fh.write(_b64.b64decode(_SERVER_EMBEDDED_B64))
        log_problem("engine: server.py written beside storage (%s)" % p)
        return p
    except Exception:
        log_problem("engine: could not write the embedded server", sys.exc_info())
        return None

def _ensure_server_running():
    """Start Inkwell's companion server if nothing answers at its address.

    The heuristic engine answers every endpoint without transformers; a laptop
    with transformers swaps in real quality underneath the same address.
    Returns "already", "started", "starting", "missing", or "error".

    Two guards ride on this, both learned from the window flood. The child is
    marked for the engine road, so a packaged app can never mistake its own
    server for another window. And the spawn itself is one-at-a-time: an
    engine already on its way answers "starting" instead of stacking another
    process on top, however often the page asks."""
    global _SERVER_PROC
    if os.environ.get(_ENGINE_ENV) == "engine":
        # This process IS the server; the engine road never spawns.
        return "already"
    if _server_health():
        return "already"
    with _SERVER_LOCK:
        if _server_health():
            return "already"
        if _SERVER_PROC is not None and _SERVER_PROC.poll() is None:
            return "starting"  # one is on the way; never stack spawns
        sp = _find_server_py()
        if not sp:
            sp = _server_beside_storage()
        if not sp:
            return "missing"
        try:
            import subprocess
            env = dict(os.environ)
            env[_ENGINE_ENV] = "engine"
            _SERVER_PROC = subprocess.Popen(
                _engine_spawn_cmd(sp),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL, start_new_session=True,
                env=env,
            )
            try:
                import time
                time.sleep(0.9)
            except Exception:
                pass
            return "started" if _server_health() else "starting"
        except Exception:
            return "error"


def start_server_api():
    try:
        return _ensure_server_running()
    except Exception:
        return "error"

# ---------------------------------------------------------------------------
# 7.40: the keeping. The page hands over whole copies of the library (every
# room: the desk, Tabula, Fontes, Scriba's transcripts) and Inkwell keeps them
# in its own folder, never on the Desktop:
#   macOS    ~/Library/Application Support/Inkwell/Earlier copies
#   Windows  %LOCALAPPDATA%\Inkwell\Earlier copies
# A copy is two files: <made>.json, the whole copy, and <made>.meta.json, what
# the list shows. Which copies stay is the page's rule (keepPrune); it asks for
# the others to be dropped. Nothing here ever reads or writes anywhere else.
_KEEP_NAME = re.compile(r"^[0-9]{10,16}$")


def _keep_dir():
    base = os.path.dirname(storage_dir() or "") or os.path.join(os.path.expanduser("~"), "Inkwell")
    d = os.path.join(base, "Earlier copies")
    os.makedirs(d, exist_ok=True)
    return d


def keep_copy_write(made, meta_json, body_json):
    made = str(made)
    if not _KEEP_NAME.match(made):
        return False
    _json.loads(meta_json)  # the list must always be readable
    d = _keep_dir()
    # the whole copy first, then its line in the list: a listed copy always has its body
    for name, text in ((made + ".json", body_json), (made + ".meta.json", meta_json)):
        tmp = os.path.join(d, name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(str(text))
        os.replace(tmp, os.path.join(d, name))
    return True


def keep_list_read():
    out = []
    d = _keep_dir()
    for name in sorted(os.listdir(d)):
        if not name.endswith(".meta.json") or not _KEEP_NAME.match(name[:-10]):
            continue
        if not os.path.exists(os.path.join(d, name[:-10] + ".json")):
            continue
        try:
            with open(os.path.join(d, name), "r", encoding="utf-8") as fh:
                m = _json.load(fh)
            if isinstance(m, dict):
                out.append(m)
        except Exception:
            pass
    return _json.dumps(out)


def keep_read_one(made):
    made = str(made)
    if not _KEEP_NAME.match(made):
        return ""
    p = os.path.join(_keep_dir(), made + ".json")
    if not os.path.exists(p):
        return ""
    with open(p, "r", encoding="utf-8") as fh:
        return fh.read()


def keep_drop_one(made):
    made = str(made)
    if not _KEEP_NAME.match(made):
        return False
    d = _keep_dir()
    for name in (made + ".meta.json", made + ".json"):
        try:
            os.remove(os.path.join(d, name))
        except FileNotFoundError:
            pass
    return True


class InkwellApi:
    """JS API exposed to the main window as window.pywebview.api.

    Inkwell page asks for two things: file saves (engine bakes, table
    exports) answered with the machine's own save dialog, and - only when
    INKWELL_NATIVE_WINDOWS=1 is set - a separate native window for Tabula or
    Abacus. The default on every platform is a single window: a second web
    view in the same process is the most likely cause of instability on some
    machines, and the app draws its own floating windows in-page, so nothing
    is lost except the risk.
    """

    APP_TITLES = {"tabula": "Tabula", "abacus": "Abacus"}
    APP_COLORS = {"tabula": "#2A2622", "abacus": "#1E3D2C"}

    def __init__(self, app_url):
        import threading
        self._app_url = app_url
        self.main_window = None
        self._wins = {}
        # Creating two native windows at once is a real way to destabilise the
        # platform web view. One creation at a time, and never a duplicate.
        self._lock = threading.RLock()
        self._creating = set()

    def _alive(self, which):
        w = self._wins.get(which)
        if w is None:
            return False
        try:
            _ = w.title
            return True
        except Exception:
            self._wins.pop(which, None)
            return False

    def clipboard_read(self):
        """7.38: the page's Paste menu item reads the clipboard here."""
        return clipboard_read_text()

    def clipboard_write(self, text):
        return clipboard_write_text(text)

    def installer_disk(self):
        """7.38: the page asks once after start; see installer_disk_tidy."""
        return installer_disk_tidy()

    def save_file(self, name, mime, data_b64):
        return save_bytes(None, name, mime, data_b64)

    def host_info(self):
        """What the window host can do, so Scriba can say precisely why the
        microphone is or is not available."""
        return host_info_dict()

    def older_docs(self):
        """Documents from before the current window host, for the page to
        offer back (it adds only what is missing, and replaces nothing)."""
        return older_library_json()

    def start_server(self):
        return start_server_api()

    def mark_booted(self):
        """Called by the page when its script has run to the end.

        A page that reaches this point has rendered, so this run is good no
        matter how the process later ends. The bad-ending breadcrumb is cleared
        here rather than only at a clean exit, because on macOS closing the
        window can terminate the process before the code after webview.start()
        is ever reached."""
        _PAGE_MARK.set()
        _end_session()
        return True


    def report_error(self, detail):
        """The pages guard hands over whatever window.onerror caught, the
        moment it catches it. It lands in the diag file with a timestamp, so a
        faulty run always leaves its evidence behind."""
        try:
            from datetime import datetime
            write_diag(["page error at %s: %s" % (datetime.now().isoformat(timespec="seconds"), str(detail)[:4000])])
        except Exception:
            pass
        try:
            log_problem("page reported an error: %s" % str(detail)[:800])
        except Exception:
            pass
        return True



    def bake_icon(self, svg_text):
        """The page hands over its own seal as SVG; the Mac rasterises it with
        QuickLook and rebuilds the icon set for the next build. From then on
        the desktop icon is the door seal by construction."""
        try:
            return bool(_bake_icon_from_svg(str(svg_text)))
        except Exception:
            return False

    def storage_set(self, key, value_json):
        """The page's persistent write-through when the web view refuses
        localStorage. Lands in a plain JSON file beside the app."""
        try:
            _BRIDGE["data"][str(key)] = str(value_json)
            _bridge_flush()
        except Exception:
            pass
        return True

    def rescue_offer(self):
        """The page asks for its library back when it woke to an empty shelf."""
        return _read_old_storage()

    def keep_copy(self, made, meta_json, body_json):
        """7.40: keep a whole copy of the library in Inkwell's own folder."""
        try:
            return bool(keep_copy_write(made, meta_json, body_json))
        except Exception:
            log_problem("keep: a copy could not be written", sys.exc_info())
            return False

    def keep_list(self):
        """7.40: the copies in Inkwell's own folder, as a JSON list."""
        try:
            return keep_list_read()
        except Exception:
            log_problem("keep: the copies could not be listed", sys.exc_info())
            return "[]"

    def keep_read(self, made):
        """7.40: one whole copy, as JSON text ('' when there is none)."""
        try:
            return keep_read_one(made)
        except Exception:
            log_problem("keep: a copy could not be read", sys.exc_info())
            return ""

    def keep_drop(self, made):
        """7.40: drop a copy the page's keeping rule no longer keeps."""
        try:
            return keep_drop_one(made)
        except Exception:
            return False

    def close_app(self, which):
        """Close a native instrument window."""
        if which not in self.APP_TITLES:
            return False
        with self._lock:
            w = self._wins.get(which)
        if w is None:
            return False
        try:
            w.destroy()
        except Exception:
            log_problem("close_app(%r): destroy failed" % (which,), sys.exc_info())
        finally:
            with self._lock:
                self._wins.pop(which, None)
        return True

    def focus_app(self, which):
        if which not in self.APP_TITLES or not self._alive(which):
            return False
        w = self._wins[which]
        try:
            w.restore()
        except Exception:
            pass
        try:
            w.show()
        except Exception:
            pass
        return True

    def open_app(self, which):
        """Open (or focus) a separate native window for the instrument."""
        if which not in self.APP_TITLES:
            return False
        with self._lock:
            if self._alive(which):
                return self.focus_app(which)
            if which in self._creating:
                log_problem("open_app(%r): already opening, ignored" % (which,))
                return False
            self._creating.add(which)
        try:
            import webview
            api = self
            win = webview.create_window(
                self.APP_TITLES[which],
                url=self._app_url + "#inkwell=" + which,
                width=1050 if which == "tabula" else 340,
                height=760 if which == "tabula" else 500,
                min_size=(MIN_WIDTH, MIN_HEIGHT),
                background_color=self.APP_COLORS[which],
                confirm_close=False,
                text_select=True,
            )
            self._wins[which] = win
            try:
                win.events.closed += (lambda *a, w=which: self._wins.pop(w, None))
            except Exception:
                pass
            return True
        except Exception:
            log_problem("open_app(%r)" % (which,))
            self._wins.pop(which, None)
            return False
        finally:
            with self._lock:
                self._creating.discard(which)


class InkwellApiSingle:
    """The API offered by default: no second native window, just file saves."""

    def __init__(self, app_url):
        self._app_url = app_url
        self.main_window = None

    def clipboard_read(self):
        """7.38: the page's Paste menu item reads the clipboard here."""
        return clipboard_read_text()

    def clipboard_write(self, text):
        return clipboard_write_text(text)

    def installer_disk(self):
        """7.38: the page asks once after start; see installer_disk_tidy."""
        return installer_disk_tidy()

    def save_file(self, name, mime, data_b64):
        return save_bytes(None, name, mime, data_b64)

    def host_info(self):
        """What the window host can do, so Scriba can say precisely why the
        microphone is or is not available."""
        return host_info_dict()

    def older_docs(self):
        """Documents from before the current window host, for the page to
        offer back (it adds only what is missing, and replaces nothing)."""
        return older_library_json()

    def start_server(self):
        return start_server_api()

    def mark_booted(self):
        """Called by the page when its script has run to the end.

        A rendered page is proof this run is good, so the bad-ending breadcrumb
        is cleared here. This is what stops a normal close, which on macOS may
        end the process before the post-start() cleanup runs, from ever being
        miscounted as a crash."""
        _PAGE_MARK.set()
        _end_session()
        return True

    def report_error(self, detail):
        """The pages guard hands over whatever window.onerror caught, the
        moment it catches it. It lands in the diag file with a timestamp, so a
        faulty run always leaves its evidence behind."""
        try:
            from datetime import datetime
            write_diag(["page error at %s: %s" % (datetime.now().isoformat(timespec="seconds"), str(detail)[:4000])])
        except Exception:
            pass
        try:
            log_problem("page reported an error: %s" % str(detail)[:800])
        except Exception:
            pass
        return True



    def bake_icon(self, svg_text):
        """The page hands over its own seal as SVG; the Mac rasterises it with
        QuickLook and rebuilds the icon set for the next build. From then on
        the desktop icon is the door seal by construction."""
        try:
            return bool(_bake_icon_from_svg(str(svg_text)))
        except Exception:
            return False

    def storage_set(self, key, value_json):
        """The page's persistent write-through when the web view refuses
        localStorage. Lands in a plain JSON file beside the app."""
        try:
            _BRIDGE["data"][str(key)] = str(value_json)
            _bridge_flush()
        except Exception:
            pass
        return True

    def rescue_offer(self):
        """The page asks for its library back when it woke to an empty shelf."""
        return _read_old_storage()

    def keep_copy(self, made, meta_json, body_json):
        """7.40: keep a whole copy of the library in Inkwell's own folder."""
        try:
            return bool(keep_copy_write(made, meta_json, body_json))
        except Exception:
            log_problem("keep: a copy could not be written", sys.exc_info())
            return False

    def keep_list(self):
        """7.40: the copies in Inkwell's own folder, as a JSON list."""
        try:
            return keep_list_read()
        except Exception:
            log_problem("keep: the copies could not be listed", sys.exc_info())
            return "[]"

    def keep_read(self, made):
        """7.40: one whole copy, as JSON text ('' when there is none)."""
        try:
            return keep_read_one(made)
        except Exception:
            log_problem("keep: a copy could not be read", sys.exc_info())
            return ""

    def keep_drop(self, made):
        """7.40: drop a copy the page's keeping rule no longer keeps."""
        try:
            return keep_drop_one(made)
        except Exception:
            return False


def _read_html_text(path):
    """Read the app page as text, or return None if it cannot be read.

    The bridge store rides inside the head, before the app's own scripts, so
    the page's boot reads its documents from disk even when the web view offers
    no localStorage at all. In a plain browser the map is empty and inert."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        try:
            store = _json.dumps(_BRIDGE.get("data") or {})
        except Exception:
            store = "{}"
        snippet = "<script>window.__inkBridgeStore=" + store + ";</script></head>"
        return text.replace("</head>", snippet, 1)
    except Exception:
        log_problem("could not read app page for inline load", sys.exc_info())
        return None


def _make_window(webview, api, app_url, app_html_path):
    """The main window, in one place so its creation can be guarded.

    Evidence rules the order of the loading roads, not theory. On this app's
    home Mac the file address paints nothing under the installed webview
    wrapper, while inline text boots (the crash log says so in plain lines:
    "file address did not paint; retrying with inline text; page booted on the
    inline retry"). So on macOS the page goes in as inline text FIRST, the
    way every good run of this app has loaded. On Windows and Linux the file
    address goes first, because those web views have always rendered it.

    Whichever road is taken, the load watchdog walks the remaining roads
    itself if the page does not confirm its start, so a bad road can never
    strand the window again.
    """
    common = dict(
        width=DEFAULT_WIDTH,
        height=DEFAULT_HEIGHT,
        min_size=(MIN_WIDTH, MIN_HEIGHT),
        background_color=ACCENT_BLUE,
        confirm_close=False,
        text_select=True,
        js_api=api,
    )
    if app_url.startswith("http://") or app_url.startswith("https://"):
        return webview.create_window(WINDOW_TITLE, url=app_url, **common)
    if sys.platform == "darwin":
        # Road one is the small local server: a real address means the web
        # view's own storage answers, and this is the origin under which the
        # library persisted for months. When the server cannot start, the page
        # goes in as inline text and the bridge store keeps saving to disk.
        try:
            _s = _serve_page(app_html_path)
        except BaseException:
            _s = None
        if _s:
            log_problem("mac: serving the page on the local address (the library's home)")
            return webview.create_window(WINDOW_TITLE, url=_s, **common)
        html = _read_html_text(app_html_path)
        if html is not None:
            log_problem("mac: server unavailable; loading the page as inline text")
            return webview.create_window(WINDOW_TITLE, html=html, **common)
        log_problem("mac: page unreadable; falling back to the file address")
    return webview.create_window(WINDOW_TITLE, url=app_html_path, **common)


def _stable_port(default=47615):
    """A fixed localhost port, remembered between runs.

    localStorage is keyed by origin, and an origin includes the port, so the
    saved work is only found again if the same port is used each time. The
    chosen port is written beside the storage folder and preferred on the next
    run, changing only if it is genuinely taken."""
    import os, socket
    base = None
    try:
        base = storage_dir()
    except Exception:
        base = None
    pf = os.path.join(base, "server_port.txt") if base else None
    saved = None
    if pf and os.path.exists(pf):
        try:
            with open(pf) as fh:
                saved = int(fh.read().strip())
        except Exception:
            saved = None
    candidates = ([saved] if saved else []) + [default] + list(range(47616, 47646))
    for port in candidates:
        if not port:
            continue
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", port))
            s.close()
            if pf:
                try:
                    with open(pf, "w") as fh:
                        fh.write(str(port))
                except Exception:
                    pass
            return port
        except Exception:
            continue
    return default


def _serve_page(app_html_path):
    """Serve the page over http://127.0.0.1 from a real file on disk.

    This is what keeps the user's work safe. Loaded inline, the page has an
    opaque origin, and a web view disables localStorage for an opaque origin, so
    every save fails and the app can only hold the work in memory. Served over a
    plain local address the page has a real, stable, trustworthy origin: saving
    to localStorage persists between sittings, and, because localhost counts as a
    secure context, the clipboard works as well. Only the one static file is
    served, and only to this machine. Returns the URL, or None if the server
    could not start, in which case the caller keeps the offline file path."""
    try:
        import os, tempfile, threading
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        text = _read_html_text(app_html_path)
        if not text or len(text) < 200:
            return None
        base = None
        try:
            base = storage_dir()
        except Exception:
            base = None
        serve_dir = os.path.join(base or tempfile.gettempdir(), "served")
        os.makedirs(serve_dir, exist_ok=True)
        with open(os.path.join(serve_dir, "Inkwell.html"), "w", encoding="utf-8") as fh:
            fh.write(text)

        vendor_dir = os.path.join(os.path.dirname(os.path.abspath(app_html_path)), "vendor")

        class _Handler(SimpleHTTPRequestHandler):
            # v7.29: the page loads its on-device models' runtime from vendor/,
            # which lives beside the page in the app, not in the served folder.
            extensions_map = dict(SimpleHTTPRequestHandler.extensions_map,
                                  **{".wasm": "application/wasm", ".mjs": "text/javascript",
                                     ".js": "text/javascript"})

            def __init__(self, *a, **k):
                super().__init__(*a, directory=serve_dir, **k)

            def translate_path(self, path):
                clean = path.split("?", 1)[0].split("#", 1)[0]
                if clean.startswith("/vendor/") and os.path.isdir(vendor_dir):
                    name = os.path.basename(clean)
                    if name and not name.startswith("."):
                        return os.path.join(vendor_dir, name)
                return super().translate_path(path)

            def log_message(self, *a):
                pass

        port = _stable_port()
        httpd = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        url = "http://127.0.0.1:%d/Inkwell.html" % port
        log_problem("serving the page at %s for a stable, storage-capable origin" % url)
        return url
    except Exception:
        log_problem("could not start the local page server; using the offline path",
                    sys.exc_info())
        return None


def _session_flag():
    """Where the breadcrumb lives. Beside the log, so one folder holds both."""
    try:
        base = pathlib.Path.home() / "Library" / "Application Support" / "Inkwell"
        base.mkdir(parents=True, exist_ok=True)
        return base / "inkwell_session.flag"
    except Exception:
        try:
            return pathlib.Path.home() / ".inkwell_session.flag"
        except Exception:
            return None


def _begin_session():
    """Return how many previous runs ended without cleaning up after themselves."""
    f = _session_flag()
    if f is None:
        return 0
    prior = 0
    try:
        if f.exists():
            prior = int((f.read_text().strip() or "1"))
    except Exception:
        prior = 1
    try:
        f.write_text(str(prior + 1))
    except Exception:
        pass
    return prior


def _end_session():
    """A clean exit removes the breadcrumb, so only bad endings accumulate."""
    f = _session_flag()
    try:
        if f is not None and f.exists():
            f.unlink()
    except Exception:
        pass


import pathlib

def main():
    # The engine road is walked first, before a window can exist. A packaged
    # app starts its server by re-running itself with the engine mark; if this
    # branch were missing, that child would open a window and spawn its own
    # child, and the next, forever - which is precisely the flood this build
    # exists to end. Marked, this process serves and nothing more.
    if os.environ.get(_ENGINE_ENV) == "engine" or _ENGINE_MARK in sys.argv[1:]:
        sys.exit(_run_engine_child())
    # The installer's safety copy: write every document this machine holds to
    # one library file, then stop. No window, no server.
    if "--export-library" in sys.argv[1:]:
        try:
            dest = sys.argv[sys.argv.index("--export-library") + 1]
        except Exception:
            print("usage: inkwell_app.py --export-library <file.json>")
            sys.exit(2)
        try:
            n = export_library_to(dest)
            print("exported %d document(s) to %s" % (n, dest))
            sys.exit(0)
        except Exception as e:
            print("export failed: %s" % e)
            sys.exit(1)
    app_html = find_app_html()
    if not app_html:
        tell_user(
            "Could not find the Inkwell app file, Inkwell.html.\n\n"
            "If you are running from the source folder, keep Inkwell.html\n"
            "beside this program. The portable version that needs no folder is\n"
            "dist/Inkwell.app, made by the Build step. It carries the whole\n"
            "app inside and opens from anywhere you move it.\n\n"
            "You can also open Inkwell.html on its own. That file is the\n"
            "whole app, offline."
        )
        sys.exit(1)

    log_problem("start: locating the window component")
    try:
        log_problem("start: companion server %s" % _ensure_server_running())
    except Exception:
        pass
    try:
        _bridge_load()
    except Exception:
        pass
    try:
        import webview  # pywebview
    except BaseException:
        # Not ImportError alone. On Windows pywebview loads pythonnet, and a
        # runtime that will not start raises RuntimeError, OSError or worse.
        # This was a crash before the window ever appeared.
        log_problem("import webview failed", sys.exc_info())
        _missing = isinstance(sys.exc_info()[1], ImportError)
        if open_in_browser(app_html):
            if _missing:
                tell_user(
                    "Inkwell has opened in your browser, because the component\n"
                    "that draws its own window is not installed.\n\n"
                    "Everything works exactly the same there, and nothing is sent\n"
                    "anywhere."
                )
            else:
                tell_user(
                    "Inkwell has opened in your browser, because the component\n"
                    "that draws its own window would not start on this PC.\n\n"
                    "Everything works exactly the same there, and nothing is sent\n"
                    "anywhere.\n\n"
                    "Details were written to:\n  %s" % crash_log_path()
                )
            return
        tell_user(friendly_missing_dependency_message())
        sys.exit(1)

    # Create the native window pointing at the local HTML file. Because the file
    # is loaded from disk, everything runs offline with no server involved.
    # background_color tints the native window behind the page. It is what shows
    # during load, so the window reads as Inkwell amethyst rather than grey.
    try:
        from pathlib import Path
        app_url = Path(app_html).as_uri()
    except Exception:
        app_url = app_html

    # Recorded once at startup so a crash report says what it was running on.
    try:
        import platform
        log_problem("start: python %s on %s %s | pywebview %s" % (
            platform.python_version(), platform.system(), platform.release(),
            getattr(webview, "__version__", "unknown")))
    except Exception:
        pass

    # A breadcrumb left set from last time means the previous session did not
    # close cleanly, almost always because the whole computer was restarted or
    # lost power while Inkwell was open. That is NOT a reason to distrust the
    # native window. Earlier builds diverted to the browser after two such
    # endings, and because the breadcrumb lives in the user's profile rather
    # than inside the app, that diversion survived deleting and reinstalling the
    # app, which is exactly how the app became stuck and could not open. The
    # window is now ALWAYS attempted. The prior state is read only to note it in
    # the log. A genuine inability to draw a window is still handled below, by
    # the real error it raises, and only then is the browser used. Every start
    # is therefore a clean start.
    _prior_bad = _begin_session()
    if _prior_bad >= 1:
        log_problem("prior session did not close cleanly (likely a restart); "
                    "opening the native window as normal")
    # The page loads from its file address, exactly as the Forge's does: no
    # local server on the main window path. The file origin persists storage
    # and unlocks the clipboard, and it removes the inline-text loading that
    # broke the seal and the right-click panel in the installed app.
    # The microphone answer must be in place before the web view exists.
    if _install_mic_permission():
        log_problem("microphone: %s handler installed (native host: %s)"
                    % (_MIC["how"], os.environ.get("INKWELL_NATIVE_HOST") == "1"))
    if not os.environ.get("INKWELL_NATIVE_WINDOWS"):
        api = InkwellApiSingle(app_url)
        log_problem("mac: one window, the app draws its own floating windows")
    else:
        api = InkwellApi(app_url)
    try:
        window = _make_window(webview, api, app_url, app_html)
    except BaseException:
        # Creating the window can fail on its own, before start() is reached.
        log_problem("create_window failed", sys.exc_info())
        if open_in_browser(app_html):
            tell_user(
                "Inkwell could not open a native window on this PC, so it has\n"
                "opened in your browser instead. Everything works the same there.\n\n"
                "On Windows the usual cause is a missing Edge WebView2 runtime; on a Mac\n"
                "it is a Python built without the frameworks a window needs.\n\n"
                "Details were written to:\n  %s" % crash_log_path())
            return
        tell_user(
            "Inkwell could not open a window on this PC.\n\n"
            "Open Inkwell.html by hand: that file IS the whole app.\n\n"
            "Details were written to:\n  %s" % crash_log_path())
        sys.exit(1)
    try:
        api.main_window = window
    except Exception:
        pass

    # ---- load watchdog -----------------------------------------------------
    # A window whose page never paints used to sit amethyst and silent for
    # ever, indistinguishable from "doing nothing". Now a watcher checks, a
    # few seconds in, that the page loaded AND that its script ran to the end
    # (the page raises window.__INKWELL_BOOTED on its last line). If either
    # has not happened it first feeds the bundled page to the window inline,
    # which bypasses any file-reading fault; if even that does not take, it
    # writes exactly what it found to inkwell_diag.txt and says so on screen.
    _boot_state = {"loaded": False}
    try:
        def _on_loaded(*_a, **_k):
            _boot_state["loaded"] = True
            log_problem("load: page reported loaded")
        window.events.loaded += _on_loaded
    except Exception:
        log_problem("load: backend exposes no loaded event; watchdog still runs")

    def _probe(w):
        def ev(js):
            try:
                return w.evaluate_js(js)
            except BaseException:
                return "!"+repr(sys.exc_info()[1])
        return {"readyState": ev("document.readyState"),
                "bodyChildren": ev("document.body ? document.body.children.length : -1"),
                "booted": ev("window.__INKWELL_BOOTED ? 1 : 0"),
                "htmlBytes": ev("document.documentElement ? document.documentElement.outerHTML.length : -1"),
                "title": ev("String(document.title)"),
                "href": ev("String(location.href)"),
                "userAgent": ev("navigator.userAgent"),
                "loadedEvent": _boot_state["loaded"]}

    def _page_ok(pr):
        # Backends differ on whether a JS number arrives as int or float, so
        # coerce; a boot flag may also arrive as a real boolean.
        try:
            kids = float(pr.get("bodyChildren"))
        except (TypeError, ValueError):
            kids = -1.0
        return kids > 0 and pr.get("booted") in (1, 1.0, True)

    def _probe_lines(pr):
        return ["%s: %r" % (k, pr[k]) for k in sorted(pr)]

    def _can_inline(text):
        # The Windows web view caps inline text near two megabytes, which a
        # baked engine exceeds, so inline recovery there is skipped for a large
        # page. macOS has no such cap for loadHTMLString.
        if text is None:
            return False
        if sys.platform == "darwin":
            return True
        return len(text) < 1800000

    def _speak_blank():
        log_problem("load: page did not start; telling the owner")
        tell_user(
            "Inkwell's window opened, but the app page inside it did not\n"
            "start. You can use Inkwell right now by opening Inkwell.html in\n"
            "your browser: that file is the whole app, offline.\n"
            "\n"
            "A note saying exactly what the window could see was written to:\n"
            "  %s\n"
            "\n"
            "Send that one small file and the cause can be fixed exactly." % diag_path())

    def _watchdog(win, html_path):
        import time
        # Wait for the page to confirm itself. A rendered page calls
        # api.mark_booted() from the end of its script, so this is set within a
        # second or two of the window appearing. Wait generously, and the moment
        # it is set, return in silence: no dialog, no reload.
        deadline = time.time() + 12.0
        while time.time() < deadline:
            if _PAGE_MARK.is_set():
                log_problem("load: page confirmed booted via api.mark_booted")
                return
            time.sleep(0.25)

        # No confirmation from the page. Before saying anything, walk the
        # remaining roads in turn. The primary road differs by platform (inline
        # first on macOS, the file address elsewhere), so the retry that comes
        # first is the road not yet tried. Every attempt is logged, so the diag
        # file says exactly which road finally took.
        text2 = _read_html_text(html_path)
        _on_darwin = (sys.platform == "darwin")
        def _wait_boot(seconds):
            _end = time.time() + seconds
            while time.time() < _end and not _PAGE_MARK.is_set():
                time.sleep(0.25)
            return _PAGE_MARK.is_set()
        if _on_darwin:
            # the server was primary: inline text is the next road
            if _can_inline(text2):
                try:
                    log_problem("load: served page did not confirm; retrying inline text")
                    win.load_html(text2)
                except BaseException:
                    log_problem("load: inline retry refused", sys.exc_info())
                if _wait_boot(8.0):
                    log_problem("load: page booted on the inline retry")
                    return
            try:
                _fu = html_path if isinstance(html_path, str) else None
            except Exception:
                _fu = None
            if _fu:
                try:
                    log_problem("load: still silent; retrying the file address")
                    win.load_url(_fu)
                except BaseException:
                    log_problem("load: file-address retry refused", sys.exc_info())
                if _wait_boot(8.0):
                    log_problem("load: page booted on the file-address retry")
                    return
        else:
            if _can_inline(text2):
                try:
                    log_problem("load: file address did not paint; retrying with inline text")
                    win.load_html(text2)
                except BaseException:
                    log_problem("load: inline retry refused", sys.exc_info())
                if _wait_boot(8.0):
                    log_problem("load: page booted on the inline retry")
                    return
        if not _PAGE_MARK.is_set():
            try:
                _served2 = _serve_page(html_path)
            except BaseException:
                _served2 = None
            if _served2:
                try:
                    log_problem("load: retrying over a local address")
                    win.load_url(_served2)
                except BaseException:
                    log_problem("load: local-address retry refused", sys.exc_info())
                _d3 = time.time() + 8.0
                while time.time() < _d3 and not _PAGE_MARK.is_set():
                    time.sleep(0.25)
                if _PAGE_MARK.is_set():
                    log_problem("load: page booted on the local-address retry")
                    return

        # Every road failed. Take ONE gentle, read-only look if the load event
        # fired. If the body is populated and the boot flag is up, the page is
        # fine and only the confirmation was lost; stay silent.
        if _PAGE_MARK.is_set():
            return
        verified = False
        if _boot_state["loaded"]:
            try:
                pr = _probe(win)
                verified = _page_ok(pr)
                write_diag(["watchdog: no mark_booted; read-only probe follows"] + _probe_lines(pr))
            except BaseException:
                write_diag(["watchdog: no mark_booted; probe raised", repr(sys.exc_info()[1])])
        else:
            write_diag(["watchdog: no mark_booted and no loaded event after 12s"])
        if verified or _PAGE_MARK.is_set():
            log_problem("load: page verified without mark_booted; staying silent")
            return
        _speak_blank()

    try:
        import threading as _th
        _wt = _th.Thread(target=_watchdog, args=(window, app_html), daemon=True)
        _wt.start()
        log_problem("load: watchdog armed")
    except Exception:
        log_problem("load: watchdog could not be started", sys.exc_info())

    # gui=None lets pywebview pick the best native backend for the platform
    # (Edge WebView2 on Windows, WKWebView on macOS, WebKitGTK/Qt on Linux).
    # debug=False keeps developer tools hidden for a clean, app-like feel.
    def _hook(exc_type, exc, tb):
        log_problem("uncaught", (exc_type, exc, tb))
        sys.__excepthook__(exc_type, exc, tb)
    sys.excepthook = _hook
    try:
        import threading
        if hasattr(threading, "excepthook"):
            threading.excepthook = lambda a: log_problem(
                "uncaught in thread", (a.exc_type, a.exc_value, a.exc_traceback))
    except Exception:
        pass

    # A guarantee that does not depend on the page or the JS bridge: if the app
    # is still running a few seconds after the window is handed to the event
    # loop, the run plainly started, so clear the bad-ending breadcrumb. The
    # page's mark_booted clears it sooner when the bridge is ready; this is the
    # backstop for the case where the bridge is slow, so an ordinary run can
    # never be miscounted as a crash.
    try:
        import threading as _thr
        _thr.Timer(4.0, _end_session).start()
    except Exception:
        pass

    # private_mode=False is what makes the work survive closing the app.
    # storage_path keeps it in the user's profile rather than in a temporary
    # unpack directory. An older pywebview may not accept either, so the failure
    # is caught and RECORDED rather than passing silently, because passing
    # silently is exactly how the data loss went unnoticed.
    _store = storage_dir()
    try:
        if _store:
            webview.start(_post_start, (window,), gui=None, debug=False, private_mode=False, storage_path=_store)
            _end_session()
        else:
            webview.start(_post_start, (window,), gui=None, debug=False, private_mode=False)
    except TypeError:
        log_problem("webview.start refused private_mode or storage_path; "
                    "this pywebview is too old for its storage knobs, so the "
                    "page keeps its own filing cabinet through the bridge")
        webview.start(_post_start, (window,), gui=None, debug=False)
    except Exception:
        # No native window could be created at all: a missing WebView2 runtime
        # on Windows is the usual reason. The page still is the application, so
        # it opens in the browser rather than the program dying in silence.
        log_problem("webview.start failed", sys.exc_info())
        if open_in_browser(app_html):
            tell_user(
                "Inkwell could not open a native window on this PC, so it has\n"
                "opened in your browser instead. Everything works the same there.\n\n"
                "On Windows that usually means a missing Edge WebView2 runtime; on a Mac,\n"
                "a Python built without the frameworks a window needs.\n"
                "Details were written to:\n  %s" % crash_log_path()
            )
        else:
            tell_user(
                "Inkwell could not open a window, and could not reach a browser\n"
                "either. Open Inkwell.html by hand: that file IS the whole app.\n\n"
                "Details were written to:\n  %s" % crash_log_path()
            )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # A crash now leaves a file to read instead of a window that vanishes.
        log_problem("fatal")
        tell_user(
            "Inkwell stopped unexpectedly.\n\n"
            "Details were written to:\n  %s\n\n"
            "Inkwell.html in the same folder still opens the whole app." % crash_log_path())
        sys.exit(1)
