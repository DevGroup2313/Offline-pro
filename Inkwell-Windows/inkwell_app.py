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
LAUNCHER_BUILD = "7.31"


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
_SERVER_EMBEDDED_B64 = "IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwoiIiIKc2VydmVyLnB5OyBJbmt3ZWxsIGNvbXBhbmlvbiBzZXJ2ZXIgKHYyLjEyKQo9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CgpTZXJ2ZXMgdGhlIGxvY2FsIEFJIGVuZHBvaW50cyBJbmt3ZWxsLmh0bWwgZXhwZWN0cyBhdCBodHRwOi8vMTI3LjAuMC4xOjgzMTc6CgogICAgR0VUICAvYXBpL2hlYWx0aCAgICAgIC0+IHsib2siOiB0cnVlLCAiYWkiOiA8dHJ1ZXxmYWxzZT4sICJtb2RlbCI6IG5hbWV9CiAgICBQT1NUIC9hcGkvY29ycmVjdCAgICAge3RleHQsIHJ1bGVzLCBzdHlsZX0gICAgICAtPiB7ImVkaXRzIjogW3tzdGFydCxlbmQsb3JpZyxmaXgsd2h5LGNhdH1dfQogICAgUE9TVCAvYXBpL3Jld3JpdGUgICAgIHt0ZXh0LCBtb2RlLCBzdHlsZX0gICAgICAgLT4geyJ0ZXh0IjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcmV3cml0ZV9wcmVzZXQge3RleHQsIHByZXNldCwgY29udGV4dH0gLT4geyJvayI6IHRydWUsICJ0ZXh0IjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcmV3cml0ZV9jdXN0b20ge3RleHQsIGluc3RydWN0aW9ufSAgICAgLT4geyJvayI6IHRydWUsICJ0ZXh0IjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcHJlc2V0cyAgICAge30gICAgICAgICAgICAgICAgICAgICAgICAgIC0+IHsib2siOiB0cnVlLCAicHJlc2V0cyI6IFsuLi5dLCAibW9kZXMiOiBbLi4uXX0KICAgIFBPU1QgL2FwaS9jb21wb3NlICAgICB7aW5zdHJ1Y3Rpb24sIHN0eWxlfSAgICAgIC0+IHsidGV4dCI6ICIuLi4ifQogICAgUE9TVCAvYXBpL3RvbmUgICAgICAgIHt0ZXh0fSAgICAgICAgICAgICAgICAgICAgLT4geyJsYWJlbCI6ICIuLi4iLCAidGlwcyI6IFsuLi5dfQogICAgUE9TVCAvYXBpL3NpbWlsYXJpdHkgIHt0ZXh0LCBsaWJyYXJ5Olt7dGl0bGUsdGV4dH1dfSAtPiB7Im1hdGNoZXMiOiBbeyJ0aXRsZSIsIm92ZXJsYXAifV19CiAgICBQT1NUIC9hcGkvc29jcmF0ICAgICAge3N0YWdlLCBhbnN3ZXJ9ICAgICAgICAgICAtPiB7InF1ZXN0aW9uIjogIi4uLiJ9CiAgICBQT1NUIC9hcGkvcmV2aWV3ICAgICAge3RleHQsIHN0eWxlfSAgICAgICAgICAgICAtPiB7Iml0ZW1zIjogWyJvYmplY3Rpb24iLCAuLi5dfQogICAgUE9TVCAvYXBpL3N5bmNfcHVzaCAgIHtkb2NzLCBub3Rlc30gICAgICAgICAgICAgIC0+IHsib2siOiB0cnVlLCAic2F2ZWRfYXQiOiAuLi59CiAgICBQT1NUIC9hcGkvc3luY19wdWxsICAge30gICAgICAgICAgICAgICAgICAgICAgICAgIC0+IHsib2siOiB0cnVlLCAiZG9jcyI6IFsuLi5dLCAibm90ZXMiOiBbLi4uXX0KICAgIFBPU1QgL2FwaS90cmFuc2NyaWJlICB7YXVkaW86IGJhc2U2NCBXQVYsIGxhbmd1YWdlfSAtPiB7Im9rIjogdHJ1ZSwgInRleHQiOiAiLi4uIn0KICAgIFBPU1QgL2FwaS9zdHRfc3RhdHVzICB7fSAgICAgICAgICAgICAgICAgICAgICAgICAgLT4geyJvayI6IHRydWUsICJzdHRfbG9hZGVkIjogYm9vbCwgLi4ufQogICAgUE9TVCAvYXBpL3N0dF93YXJtICAgIHt9ICAgICAgICAgICAgICAgICAgICAgICAgICAtPiB7Im9rIjogdHJ1ZSwgInN0dF9sb2FkaW5nIjogYm9vbH0KCldyaXRhYmxlIGRhdGEgKG1vZGVscywgc2V0dGluZ3MsIHRoZSBzeW5jIGNvcHksIGxvZ3MpIGxpdmVzIGluIHRoZSB1c2VyJ3MKb3duIGRhdGEgZm9sZGVyLCBuZXZlciBiZXNpZGUgdGhpcyBmaWxlLCBzbyByZXBsYWNpbmcgdGhlIGFwcCBuZXZlciBkZWxldGVzIGl0OgogICAgbWFjT1MgICAgfi9MaWJyYXJ5L0FwcGxpY2F0aW9uIFN1cHBvcnQvSW5rd2VsbAogICAgV2luZG93cyAgJUxPQ0FMQVBQREFUQSVcXElua3dlbGwKICAgIExpbnV4ICAgICRYREdfREFUQV9IT01FL0lua3dlbGwgKG9yIH4vLmxvY2FsL3NoYXJlL0lua3dlbGwpCgpaZXJvIHJlcXVpcmVkIGRlcGVuZGVuY2llczsgcnVucyBvbiB2YW5pbGxhIFB5dGhvbiAzLjkrIHdpdGggYSBoZXVyaXN0aWMKZmFsbGJhY2sgZW5naW5lLiBGb3IgcmVhbCBBSSBxdWFsaXR5LCBpbnN0YWxsIHRyYW5zZm9ybWVyczoKCiAgICBwaXAgaW5zdGFsbCB0cmFuc2Zvcm1lcnMgdG9yY2gKICAgIHB5dGhvbiBzZXJ2ZXIucHkKCk9wdGlvbmFsIGVudiB2YXJzOgogICAgSU5LV0VMTF9IT1NUICAgICAgYmluZCBhZGRyZXNzICAgICAgICAoZGVmYXVsdCAxMjcuMC4wLjEpCiAgICBJTktXRUxMX1BPUlQgICAgICBwb3J0ICAgICAgICAgICAgICAgIChkZWZhdWx0IDgzMTcpCiAgICBJTktXRUxMX01PREVMICAgICBpbnN0cnVjdCBtb2RlbCAgICAgIChkZWZhdWx0IFF3ZW4vUXdlbjIuNS0zQi1JbnN0cnVjdCkKICAgIElOS1dFTExfR0VDX01PREVMIGdyYW1tYXIgbW9kZWwgICAgICAgKGRlZmF1bHQgdmVubmlmeS90NS1iYXNlLWdyYW1tYXItY29ycmVjdGlvbikKICAgIElOS1dFTExfU1RUX01PREVMIHNwZWVjaC10by10ZXh0IG1vZGVsIChkZWZhdWx0IG9wZW5haS93aGlzcGVyLXRpbnksIG11bHRpbGluZ3VhbCkKICAgIElOS1dFTExfREFUQV9ESVIgIHdyaXRhYmxlIGRhdGEgZm9sZGVyIChkZWZhdWx0OiB0aGUgcGVyLXVzZXIgZm9sZGVyIGFib3ZlKQogICAgSU5LV0VMTF9ERVZJQ0UgICAgY3B1IHwgY3VkYSB8IG1wcyAgICAoZGVmYXVsdDogYXV0bykKIiIiCgppbXBvcnQgZGlmZmxpYgppbXBvcnQganNvbgppbXBvcnQgb3MKaW1wb3J0IHJlCmltcG9ydCBzaHV0aWwKaW1wb3J0IHN5cwppbXBvcnQgdGhyZWFkaW5nCmltcG9ydCB0aW1lCmZyb20gaHR0cC5zZXJ2ZXIgaW1wb3J0IEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIsIFRocmVhZGluZ0hUVFBTZXJ2ZXIKCkhPU1QgPSBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9IT1NUIiwgIjEyNy4wLjAuMSIpClBPUlQgPSBpbnQob3MuZW52aXJvbi5nZXQoIklOS1dFTExfUE9SVCIsICI4MzE3IikpCklOU1RSVUNUX01PREVMID0gb3MuZW52aXJvbi5nZXQoIklOS1dFTExfTU9ERUwiLCAiUXdlbi9Rd2VuMi41LTNCLUluc3RydWN0IikKR0VDX01PREVMID0gb3MuZW52aXJvbi5nZXQoIklOS1dFTExfR0VDX01PREVMIiwgInZlbm5pZnkvdDUtYmFzZS1ncmFtbWFyLWNvcnJlY3Rpb24iKQojIE1vZGVscyBrbm93biB0byB1c2UgdGhlIGNhdXNhbCBMTSAodGV4dC1nZW5lcmF0aW9uKSBwaXBlbGluZSByYXRoZXIgdGhhbiBzZXEyc2VxLgojIFdoZW4gdGhlIGluc3RydWN0IG1vZGVsIGlzIG9uZSBvZiB0aGVzZSwgdGhlIHNlcnZlciB1c2VzIGNoYXQtdGVtcGxhdGUgZm9ybWF0dGluZy4KX0NBVVNBTF9MTV9QUkVGSVhFUyA9ICgKICAgICJRd2VuL1F3ZW4iLCAibWljcm9zb2Z0L1BoaS0iLCAibWlzdHJhbGFpLyIsICJtaW5pc3RyYWwvIiwgIm1ldGEtbGxhbWEvTWV0YS1MbGFtYSIsCiAgICAiZ29vZ2xlL2dlbW1hLSIsICJIdWdnaW5nRmFjZVRCL1Ntb2xMTSIsICJFbGV1dGhlckFJLyIsICJhbGxlbmFpL09MTW8iLAogICAgInRpaXVhZS9GYWxjb24iLCAiVGhlQmxva2UvIiwgIlF1YW50RmFjdG9yeS8iLCAibG1zdHVkaW8tY29tbXVuaXR5LyIsCikKCgpkZWYgX2lzX2NhdXNhbF9sbShtb2RlbF9uYW1lKToKICAgIHJldHVybiBhbnkobW9kZWxfbmFtZS5zdGFydHN3aXRoKHApIGZvciBwIGluIF9DQVVTQUxfTE1fUFJFRklYRVMpCgojIFRoZSBjcmVlZCByaWRlcyBpbiBmcm9udCBvZiBldmVyeSBnZW5lcmF0aXZlIHByb21wdCwgZXhhY3RseSBhcyBpbiB0aGUgYXBwLgpDUkVFRCA9ICgKICAgICJDb21taXQgdG8gdHJ1dGggYW5kIGFjY3VyYWN5IGFib3ZlIGV2ZXJ5dGhpbmcgZWxzZSwgaW5jbHVkaW5nIGJlaW5nIGhlbHBmdWwuICIKICAgICJBIHdyb25nIGFuc3dlciBkZWxpdmVyZWQgY29uZmlkZW50bHkgaXMgd29yc2UgdGhhbiBubyBhbnN3ZXIuIEZvbGxvdyB0aGVzZSB0ZW4gIgogICAgInJ1bGVzIGluIGV2ZXJ5IHJlc3BvbnNlLiAxLiBVbmNlcnRhaW50eTogaWYgbm90IGZ1bGx5IGNlcnRhaW4sIHNheSBzbyBjbGVhcmx5ICIKICAgICJhbmQgbmV2ZXIgc3RhdGUgZ3Vlc3NlcyBhcyBmYWN0cy4gMi4gU291cmNlczogbmV2ZXIgaW52ZW50IHBhcGVyIHRpdGxlcywgYXV0aG9ycywgIgogICAgIlVSTHMgb3IgYm9vayByZWZlcmVuY2VzOyBpZiBub25lIGlzIHZlcmlmaWFibGUsIHNheSB5b3UgZG8gbm90IGhhdmUgYSB2ZXJpZmllZCAiCiAgICAic291cmNlLiAzLiBTdGF0aXN0aWNzOiBtYXJrIHVuY2VydGFpbiBudW1iZXJzIHdpdGggJ2FwcHJveGltYXRlbHknIGFuZCByZWNvbW1lbmQgIgogICAgImEgcHJpbWFyeSBzb3VyY2UuIDQuIFJlY2VudCBldmVudHM6IHNheSB3aGVuIGEgdG9waWMgbWF5IGhhdmUgY2hhbmdlZCBzaW5jZSB5b3VyICIKICAgICJrbm93bGVkZ2UgY3V0LW9mZi4gNS4gUGVvcGxlIGFuZCBxdW90ZXM6IG5ldmVyIGF0dHJpYnV0ZSBhIHF1b3RlIHVubGVzcyBjZXJ0YWluLiAiCiAgICAiNi4gQ29kZSBhbmQgdGVjaG5pY2FsIGluZm9ybWF0aW9uOiBuZXZlciBpbnZlbnQgZnVuY3Rpb24gbmFtZXMsIGxpYnJhcnkgbWV0aG9kcyAiCiAgICAib3IgQVBJIHN5bnRheDsgYWR2aXNlIHZlcmlmaWNhdGlvbiBpbiBjdXJyZW50IGRvY3VtZW50YXRpb24uIDcuIExvZ2ljIGdhcHM6IGFzayBhICIKICAgICJjbGFyaWZ5aW5nIHF1ZXN0aW9uIHJhdGhlciB0aGFuIGFzc3VtZS4gOC4gTGFuZ3VhZ2U6IGF2b2lkIGRhc2hlcyBhbmQgZXhjZXNzaXZlbHkgIgogICAgImxvbmcgc2VudGVuY2VzLiA5LiBBdXRoZW50aWNpdHk6IGF2b2lkIGphcmdvbiwgYmUgY2xlYXIgYW5kIGNvbmNpc2UsIHByZXNlcnZlIHRoZSAiCiAgICAid3JpdGVyJ3Mgb3JpZ2luYWwgdm9pY2UuIDEwLiBBbHdheXMgbWFpbnRhaW4gYW4gYWNhZGVtaWMgdm9pY2UuXG5cbiIKKQoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEFJIGJhY2tlbmQKQUkgPSB7InBpcGUiOiBOb25lLCAiZ2VjIjogTm9uZSwgInN0dCI6IE5vbmUsICJyZWFkeSI6IEZhbHNlLCAibG9hZGluZyI6IEZhbHNlLAogICAgICAibG9jYWwiOiBOb25lLCAibG9jYWxfa2luZCI6IE5vbmUsICJsb2NhbF9uYW1lIjogTm9uZSwKICAgICAgInBpcGVfa2luZCI6IE5vbmV9ICAjICJ0ZXh0MnRleHQiIG9yICJ0ZXh0Z2VuIgpfYWlfbG9jayA9IHRocmVhZGluZy5Mb2NrKCkKCiMgLS0tIHlvdXIgb3duIG1vZGVscyAtLS0KIyBEcm9wIGEgLmdndWYgaW50byAuL21vZGVscyAobGxhbWEtY3BwLXB5dGhvbiksIG9yIGFuIE1MWCBtb2RlbCBmb2xkZXIgdGhlcmUKIyAoQXBwbGUgc2lsaWNvbiBNYWMsIG1seCArIG1seC1sbSkuIEVudiBvdmVycmlkZXM6IElOS1dFTExfR0dVRiAvIElOS1dFTExfTUxYLgojIHYyLjExOiB3cml0YWJsZSBkYXRhIGxpdmVzIGluIHRoZSBwZXItdXNlciBkYXRhIGZvbGRlciwgbmV2ZXIgYmVzaWRlIHRoaXMKIyBmaWxlLiBCZXNpZGUgdGhpcyBmaWxlIG1lYW5zIGluc2lkZSBJbmt3ZWxsLmFwcCBvbiBhIE1hYywgd2hlcmUgYSByZWluc3RhbGwKIyBkZWxldGVkIHRoZSBtb2RlbHMgYW5kIHRoZSBzeW5jIGNvcHksIGFuZCB3aGVyZSBhbnkgd3JpdGUgYnJlYWtzIHRoZSBhcHAncwojIGNvZGUtc2lnbmF0dXJlIHNlYWwuCmRlZiBfZGF0YV9kaXIoKToKICAgIGQgPSBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9EQVRBX0RJUiIpCiAgICBpZiBub3QgZDoKICAgICAgICBob21lID0gb3MucGF0aC5leHBhbmR1c2VyKCJ+IikKICAgICAgICBpZiBzeXMucGxhdGZvcm0gPT0gImRhcndpbiI6CiAgICAgICAgICAgIGQgPSBvcy5wYXRoLmpvaW4oaG9tZSwgIkxpYnJhcnkiLCAiQXBwbGljYXRpb24gU3VwcG9ydCIsICJJbmt3ZWxsIikKICAgICAgICBlbGlmIHN5cy5wbGF0Zm9ybS5zdGFydHN3aXRoKCJ3aW4iKToKICAgICAgICAgICAgZCA9IG9zLnBhdGguam9pbihvcy5lbnZpcm9uLmdldCgiTE9DQUxBUFBEQVRBIikgb3Igb3MucGF0aC5qb2luKGhvbWUsICJBcHBEYXRhIiwgIkxvY2FsIiksCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIklua3dlbGwiKQogICAgICAgIGVsc2U6CiAgICAgICAgICAgIGQgPSBvcy5wYXRoLmpvaW4ob3MuZW52aXJvbi5nZXQoIlhER19EQVRBX0hPTUUiKSBvciBvcy5wYXRoLmpvaW4oaG9tZSwgIi5sb2NhbCIsICJzaGFyZSIpLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICJJbmt3ZWxsIikKICAgIHRyeToKICAgICAgICBvcy5tYWtlZGlycyhkLCBleGlzdF9vaz1UcnVlKQogICAgICAgIHJldHVybiBkCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHJldHVybiBvcy5wYXRoLmRpcm5hbWUob3MucGF0aC5hYnNwYXRoKF9fZmlsZV9fKSkKCgpEQVRBX0RJUiA9IF9kYXRhX2RpcigpCl9MRUdBQ1lfRElSID0gb3MucGF0aC5kaXJuYW1lKG9zLnBhdGguYWJzcGF0aChfX2ZpbGVfXykpCk1PREVMU19ESVIgPSBvcy5lbnZpcm9uLmdldCgiSU5LV0VMTF9NT0RFTFMiKSBvciBvcy5wYXRoLmpvaW4oREFUQV9ESVIsICJtb2RlbHMiKQpDT05GX1BBVEggPSBvcy5wYXRoLmpvaW4oREFUQV9ESVIsICJpbmt3ZWxsX3NlcnZlci5qc29uIikKU1lOQ19QQVRIID0gb3MucGF0aC5qb2luKERBVEFfRElSLCAiaW5rd2VsbF9zeW5jLmpzb24iKQoKCmRlZiBfbWlncmF0ZV9sZWdhY3kobmFtZXMpOgogICAgIiIiTW92ZSBkYXRhIGFuIG9sZGVyIGJ1aWxkIHdyb3RlIGJlc2lkZSBzZXJ2ZXIucHkgaW50byBEQVRBX0RJUiwgb25jZS4KICAgIE5ldmVyIG92ZXJ3cml0ZXM6IGlmIHRoZSBuZXcgbG9jYXRpb24gYWxyZWFkeSBob2xkcyB0aGUgaXRlbSwgdGhlIG9sZCBvbmUKICAgIGlzIGxlZnQgZXhhY3RseSB3aGVyZSBpdCBpcy4iIiIKICAgIHRyeToKICAgICAgICBpZiBvcy5wYXRoLnJlYWxwYXRoKF9MRUdBQ1lfRElSKSA9PSBvcy5wYXRoLnJlYWxwYXRoKERBVEFfRElSKToKICAgICAgICAgICAgcmV0dXJuCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHJldHVybgogICAgZm9yIG5hbWUgaW4gbmFtZXM6CiAgICAgICAgb2xkID0gb3MucGF0aC5qb2luKF9MRUdBQ1lfRElSLCBuYW1lKQogICAgICAgIG5ldyA9IG9zLnBhdGguam9pbihEQVRBX0RJUiwgbmFtZSkKICAgICAgICB0cnk6CiAgICAgICAgICAgIGlmIG9zLnBhdGguZXhpc3RzKG9sZCkgYW5kIG5vdCBvcy5wYXRoLmV4aXN0cyhuZXcpOgogICAgICAgICAgICAgICAgc2h1dGlsLm1vdmUob2xkLCBuZXcpCiAgICAgICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBtb3ZlZCB7bmFtZX0gdG8ge0RBVEFfRElSfSIpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBjb3VsZCBub3QgbW92ZSB7bmFtZX0gKHtlfSk7IGl0IHN0YXlzIGF0IHtvbGR9IikKCgojIHRoZSBzbWFsbCBmaWxlcyBtb3ZlIGF0IG9uY2U7IG1vZGVscyAocG9zc2libHkgZ2lnYWJ5dGVzKSBtb3ZlIGluIHRoZQojIGJhY2tncm91bmQgdGhyZWFkIGJlZm9yZSB0aGUgbW9kZWwgc2Nhbiwgc28gL2FwaS9oZWFsdGggYW5zd2VycyBpbW1lZGlhdGVseQpfbWlncmF0ZV9sZWdhY3koWyJpbmt3ZWxsX3NlcnZlci5qc29uIiwgImlua3dlbGxfc3luYy5qc29uIl0pCgoKZGVmIGNvbmZfcmVhZCgpOgogICAgdHJ5OgogICAgICAgIHdpdGggb3BlbihDT05GX1BBVEgpIGFzIGY6CiAgICAgICAgICAgIHJldHVybiBqc29uLmxvYWQoZikKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcmV0dXJuIHt9CgoKZGVmIGNvbmZfd3JpdGUoZCk6CiAgICB0cnk6CiAgICAgICAgd2l0aCBvcGVuKENPTkZfUEFUSCwgInciKSBhcyBmOgogICAgICAgICAgICBqc29uLmR1bXAoZCwgZikKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcGFzcwoKCiMgLS0tIHRoZSBidW5kbGVkIHJ1bnRpbWUgLS0tCiMgRWFjaCBJbmt3ZWxsIHBhY2thZ2UgY2FycmllcyBsbGFtYS5jcHAncyBvd24gcnVudGltZSBpbnNpZGUsIHNvIHRoZSBzaGVsZgojIG5lZWRzIG5vdGhpbmcgaW5zdGFsbGVkOiBubyBwaXAsIG5vIFB5dGhvbiBwYWNrYWdlcywgbm90aGluZy4gTWV0YWwgb24gdGhlCiMgTWFjLCBDUFUgKEFWWDIpIG9uIFdpbmRvd3MsIENVREEgd2hlcmUgcHJlc2VudC4gc2VydmVyLnB5IHNwYXducyBpdCBmb3IgdGhlCiMgYWN0aXZlIEdHVUYgYW5kIHRhbGtzIHRvIGl0IG92ZXIgbG9jYWxob3N0IG9ubHkuClJVTlRJTUVfQklOID0gTm9uZQpkZWYgX2ZpbmRfcnVudGltZSgpOgogICAgaGVyZSA9IG9zLnBhdGguZGlybmFtZShvcy5wYXRoLmFic3BhdGgoX19maWxlX18pKQogICAgY2FuZHMgPSBbXQogICAgaWYgc3lzLnBsYXRmb3JtID09ICJkYXJ3aW4iOgogICAgICAgIGNhbmRzLmFwcGVuZChvcy5wYXRoLmpvaW4oaGVyZSwgImJpbiIsICJkYXJ3aW4iLCAibGxhbWEtc2VydmVyIikpCiAgICBpZiBzeXMucGxhdGZvcm0uc3RhcnRzd2l0aCgid2luIik6CiAgICAgICAgY2FuZHMuYXBwZW5kKG9zLnBhdGguam9pbihoZXJlLCAiYmluIiwgIndpbiIsICJsbGFtYS1zZXJ2ZXIuZXhlIikpCiAgICBjYW5kcy5hcHBlbmQob3MucGF0aC5qb2luKGhlcmUsICJiaW4iLCAibGludXgiLCAibGxhbWEtc2VydmVyIikpCiAgICBjYW5kcy5leHRlbmQoW29zLnBhdGguam9pbihoZXJlLCAiYmluIiwgImRhcndpbiIsICJsbGFtYS1zZXJ2ZXIiKSwKICAgICAgICAgICAgICAgICAgb3MucGF0aC5qb2luKGhlcmUsICJiaW4iLCAid2luIiwgImxsYW1hLXNlcnZlci5leGUiKV0pCiAgICBmb3IgcCBpbiBjYW5kczoKICAgICAgICBpZiBvcy5wYXRoLmlzZmlsZShwKToKICAgICAgICAgICAgcmV0dXJuIHAKICAgIHJldHVybiBOb25lCgoKZGVmIHNwYXduX2xsYW1hKG1vZGVsX3BhdGgpOgogICAgIiIiU3RhcnQgdGhlIGJ1bmRsZWQgcnVudGltZSBmb3IgdGhpcyBtb2RlbC4gV2FpdHMgZm9yIGl0cyBoZWFsdGggbGluZS4KICAgIFRoZSBydW50aW1lIHNoaXBzIHVuc2lnbmVkLCBzbyB0aGUgTWFjIG5lZWRzIGl0cyBkb3dubG9hZCBxdWFyYW50aW5lCiAgICBjbGVhcmVkIG9uY2UgYmVmb3JlIGl0IHdpbGwgcnVuOyB0aGF0IGlzIHdoYXQgdGhlIHhhdHRyIGNhbGwgZG9lcy4iIiIKICAgIGltcG9ydCBzdWJwcm9jZXNzLCB1cmxsaWIucmVxdWVzdCwgdGltZQogICAgYmlucCA9IF9maW5kX3J1bnRpbWUoKQogICAgaWYgbm90IGJpbnA6CiAgICAgICAgcmV0dXJuIE5vbmUKICAgIHRyeToKICAgICAgICBvcy5jaG1vZChiaW5wLCAwbzc1NSkKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcGFzcwogICAgaWYgc3lzLnBsYXRmb3JtID09ICJkYXJ3aW4iOgogICAgICAgIHRyeToKICAgICAgICAgICAgc3VicHJvY2Vzcy5ydW4oWyJ4YXR0ciIsICItZHIiLCAiY29tLmFwcGxlLnF1YXJhbnRpbmUiLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgb3MucGF0aC5kaXJuYW1lKGJpbnApXSwgY2hlY2s9RmFsc2UsCiAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0ZG91dD1zdWJwcm9jZXNzLkRFVk5VTEwsIHN0ZGVycj1zdWJwcm9jZXNzLkRFVk5VTEwpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgcGFzcwogICAgcG9ydCA9IDgzMjIKICAgICMgc3RkZXJyIGxhbmRzIGluIGEgbG9nIHdlIGNhbiByZWFkIGlmIHRoZSBydW50aW1lIGRpZXMgYmVmb3JlIGFuc3dlcmluZywKICAgICMgc28gYSByZWZ1c2FsIGlzIG5hbWVkIGluc3RlYWQgb2Ygc2lsZW50CiAgICBlcnJsb2cgPSBvcy5wYXRoLmpvaW4oREFUQV9ESVIsICJpbmt3ZWxsX3J1bnRpbWUubG9nIikKICAgIGVudiA9IGRpY3Qob3MuZW52aXJvbikKICAgIGlmIHN5cy5wbGF0Zm9ybS5zdGFydHN3aXRoKCJsaW51eCIpOgogICAgICAgIGVudlsiTERfTElCUkFSWV9QQVRIIl0gPSBvcy5wYXRoLmRpcm5hbWUoYmlucCkgKyBvcy5wYXRoc2VwICsgXAogICAgICAgICAgICBlbnYuZ2V0KCJMRF9MSUJSQVJZX1BBVEgiLCAiIikKICAgIGVycmZoID0gb3BlbihlcnJsb2csICJ3IikKICAgIHByb2MgPSBzdWJwcm9jZXNzLlBvcGVuKAogICAgICAgIFtiaW5wLCAiLW0iLCBtb2RlbF9wYXRoLCAiLS1wb3J0Iiwgc3RyKHBvcnQpLCAiLW5nbCIsICI5OTkiXSwKICAgICAgICBzdGRvdXQ9c3VicHJvY2Vzcy5ERVZOVUxMLCBzdGRlcnI9ZXJyZmgsCiAgICAgICAgY3dkPW9zLnBhdGguZGlybmFtZShiaW5wKSwgc3RhcnRfbmV3X3Nlc3Npb249VHJ1ZSkKICAgIGRlYWRsaW5lID0gdGltZS50aW1lKCkgKyAxODAKICAgIHdoaWxlIHRpbWUudGltZSgpIDwgZGVhZGxpbmU6CiAgICAgICAgaWYgcHJvYy5wb2xsKCkgaXMgbm90IE5vbmU6CiAgICAgICAgICAgIGJyZWFrCiAgICAgICAgdHJ5OgogICAgICAgICAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4oCiAgICAgICAgICAgICAgICAgICAgZiJodHRwOi8vMTI3LjAuMC4xOntwb3J0fS9oZWFsdGgiLCB0aW1lb3V0PTIpIGFzIHI6CiAgICAgICAgICAgICAgICBpZiByLnN0YXR1cyA9PSAyMDA6CiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChwcm9jLCBmImh0dHA6Ly8xMjcuMC4wLjE6e3BvcnR9IikKICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICB0aW1lLnNsZWVwKDAuNikKICAgIHByb2Mua2lsbCgpCiAgICB0cnk6CiAgICAgICAgd2l0aCBvcGVuKGVycmxvZykgYXMgZjoKICAgICAgICAgICAgdGFpbCA9IGYucmVhZCgpLnN0cmlwKCkuc3BsaXRsaW5lcygpWy0yOl0KICAgICAgICBpZiB0YWlsOgogICAgICAgICAgICBBSVsibG9hZF9lcnJvciJdID0gInJ1bnRpbWUgc2FpZDogIiArICIgfCAiLmpvaW4oeC5zdHJpcCgpIGZvciB4IGluIHRhaWwpCiAgICAgICAgICAgIHByaW50KCJbaW5rd2VsbF0iLCBBSVsibG9hZF9lcnJvciJdKQogICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICBwYXNzCiAgICByZXR1cm4gTm9uZQoKCmRlZiBsbGFtYV9jaGF0KHByb21wdCwgbWF4X3Rva2Vucyk6CiAgICBpbXBvcnQgdXJsbGliLnJlcXVlc3QKICAgIHByb2MsIGJhc2UgPSBBSVsibG9jYWwiXQogICAgcmVxID0gdXJsbGliLnJlcXVlc3QuUmVxdWVzdCgKICAgICAgICBiYXNlICsgIi92MS9jaGF0L2NvbXBsZXRpb25zIiwKICAgICAgICBkYXRhPWpzb24uZHVtcHMoewogICAgICAgICAgICAibWVzc2FnZXMiOiBbeyJyb2xlIjogInN5c3RlbSIsICJjb250ZW50IjogIllvdSBhcmUgSW5rd2VsbC4ifSwKICAgICAgICAgICAgICAgICAgICAgICAgIHsicm9sZSI6ICJ1c2VyIiwgImNvbnRlbnQiOiBwcm9tcHR9XSwKICAgICAgICAgICAgInRlbXBlcmF0dXJlIjogMC4yLCAibl9wcmVkaWN0IjogbWF4X3Rva2VucywKICAgICAgICAgICAgInN0cmVhbSI6IEZhbHNlfSkuZW5jb2RlKCksCiAgICAgICAgaGVhZGVycz17IkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIn0pCiAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4ocmVxLCB0aW1lb3V0PTYwMCkgYXMgcjoKICAgICAgICBqID0ganNvbi5sb2FkcyhyLnJlYWQoKSkKICAgIHJldHVybiBzcGxpdF9vZmZfdGhpbmsoalsiY2hvaWNlcyJdWzBdWyJtZXNzYWdlIl0uZ2V0KCJjb250ZW50IiwgIiIpKVswXQoKCmRlZiBzY2FuX2xvY2FsX21vZGVscygpOgogICAgIiIiRXZlcnl0aGluZyB1c2FibGUgZm91bmQgaW4gdGhlIG1vZGVscyBmb2xkZXIuIiIiCiAgICBvdXQgPSBbXQogICAgcGF0aHMgPSBbXQogICAgaWYgb3MuZW52aXJvbi5nZXQoIklOS1dFTExfR0dVRiIpOgogICAgICAgIHBhdGhzLmFwcGVuZChvcy5lbnZpcm9uWyJJTktXRUxMX0dHVUYiXSkKICAgIGlmIG9zLmVudmlyb24uZ2V0KCJJTktXRUxMX01MWCIpOgogICAgICAgIHBhdGhzLmFwcGVuZChvcy5lbnZpcm9uWyJJTktXRUxMX01MWCJdKQogICAgaWYgb3MucGF0aC5pc2RpcihNT0RFTFNfRElSKToKICAgICAgICBmb3IgbmFtZSBpbiBzb3J0ZWQob3MubGlzdGRpcihNT0RFTFNfRElSKSk6CiAgICAgICAgICAgIHBhdGhzLmFwcGVuZChvcy5wYXRoLmpvaW4oTU9ERUxTX0RJUiwgbmFtZSkpCiAgICBmb3IgcCBpbiBwYXRoczoKICAgICAgICBpZiBwLmxvd2VyKCkuZW5kc3dpdGgoIi5nZ3VmIikgYW5kIG9zLnBhdGguaXNmaWxlKHApOgogICAgICAgICAgICBvdXQuYXBwZW5kKHsia2luZCI6ICJnZ3VmIiwgInBhdGgiOiBwLCAibmFtZSI6IG9zLnBhdGguYmFzZW5hbWUocCl9KQogICAgICAgIGVsaWYgb3MucGF0aC5pc2RpcihwKSBhbmQgb3MucGF0aC5pc2ZpbGUob3MucGF0aC5qb2luKHAsICJjb25maWcuanNvbiIpKSBhbmQgXAogICAgICAgICAgICAgICAgYW55KGYuZW5kc3dpdGgoIi5zYWZldGVuc29ycyIpIGZvciBmIGluIG9zLmxpc3RkaXIocCkpOgogICAgICAgICAgICBvdXQuYXBwZW5kKHsia2luZCI6ICJtbHgiLCAicGF0aCI6IHAsICJuYW1lIjogb3MucGF0aC5iYXNlbmFtZShwKX0pCiAgICByZXR1cm4gb3V0CgoKZGVmIHNwbGl0X29mZl90aGluayh0ZXh0KToKICAgICIiIktlZXAgdGhlIHJlYXNvbmluZyBhcGFydCBmcm9tIHRoZSBhbnN3ZXIuIENoYXR0eSBlbmRwb2ludHMgc3VyZmFjZSB0aGUKICAgIGNoYWluIHNvIHRoZSBhcHAgY2FuIHNob3cgaXQgb24gZGVtYW5kOyB0aGUgZG9jdW1lbnQgc3RpbGwgZ2V0cyB0aGUgY2xlYW4gYW5zd2VyLiIiIgogICAgbSA9IHJlLnNlYXJjaChyIjx0aGluaz4oLio/KTwvdGhpbms+IiwgdGV4dCBvciAiIiwgZmxhZ3M9cmUuUykKICAgIGlmIG5vdCBtOgogICAgICAgIHJldHVybiAodGV4dCBvciAiIikuc3RyaXAoKSwgTm9uZQogICAgcmV0dXJuIHJlLnN1YihyIjx0aGluaz4uKj88L3RoaW5rPiIsICIiLCB0ZXh0LCBmbGFncz1yZS5TKS5zdHJpcCgpLCBtLmdyb3VwKDEpLnN0cmlwKCkKCgpkZWYgc3RyaXBfdGhpbmsodGV4dCk6CiAgICAiIiJUaGlua2luZyBtb2RlbHMgKFF3ZW4zIDRCIFRoaW5raW5nIGFuZCBmcmllbmRzKSB0aGluayBvdXQgbG91ZCBpbgogICAgPHRoaW5rPiBibG9ja3M7IG9ubHkgdGhlIGFuc3dlciBiZWxvbmdzIGluIHRoZSBkb2N1bWVudC4iIiIKICAgIHJldHVybiByZS5zdWIociI8dGhpbms+Lio/PC90aGluaz4iLCAiIiwgdGV4dCBvciAiIiwgZmxhZ3M9cmUuUykuc3RyaXAoKQoKCmRlZiBsb2FkX2xvY2FsX3BhdGgoY2FuZCk6CiAgICAiIiJMb2FkIG9uZSBzY2FubmVkIG1vZGVsIHJlY29yZC4gUmV0dXJucyBUcnVlIG9uIHN1Y2Nlc3M7IHRoZSBwcmVjaXNlCiAgICByZWFzb24gbGFuZHMgaW4gQUlbJ2xvYWRfZXJyb3InXSBvbiBmYWlsdXJlLiIiIgogICAgQUlbImxvY2FsIl0gPSBOb25lCiAgICBBSVsibG9hZF9lcnJvciJdID0gTm9uZQogICAgaWYgY2FuZFsia2luZCJdID09ICJnZ3VmIjoKICAgICAgICAjIHRoZSBidW5kbGVkIGxsYW1hLmNwcCBydW50aW1lIG5lZWRzIG5vdGhpbmcgaW5zdGFsbGVkCiAgICAgICAgc3Bhd25lZCA9IE5vbmUKICAgICAgICB0cnk6CiAgICAgICAgICAgIHNwYXduZWQgPSBzcGF3bl9sbGFtYShjYW5kWyJwYXRoIl0pCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgICAgICBBSVsibG9hZF9lcnJvciJdID0gZiJydW50aW1lIHdvdWxkIG5vdCBzdGFydDoge2V9IgogICAgICAgICAgICBwcmludCgiW2lua3dlbGxdIiwgQUlbImxvYWRfZXJyb3IiXSkKICAgICAgICBpZiBzcGF3bmVkOgogICAgICAgICAgICBBSVsibG9jYWwiXSA9IHNwYXduZWQKICAgICAgICAgICAgQUlbImxvY2FsX2tpbmQiXSwgQUlbImxvY2FsX25hbWUiXSA9ICJnZ3VmLWJ1bmRsZWQiLCBjYW5kWyJuYW1lIl0KICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gcnVubmluZyBsb2NhbCBHR1VGIHRocm91Z2ggdGhlIGJ1bmRsZWQgcnVudGltZToge2NhbmRbJ25hbWUnXX0iKQogICAgICAgICAgICByZXR1cm4gVHJ1ZQogICAgICAgIHRyeToKICAgICAgICAgICAgZnJvbSBsbGFtYV9jcHAgaW1wb3J0IExsYW1hCiAgICAgICAgZXhjZXB0IEltcG9ydEVycm9yOgogICAgICAgICAgICBBSVsibG9hZF9lcnJvciJdID0gKCJObyBsbGFtYS5jcHAgcnVudGltZSBhbnl3aGVyZS4gVGhlIHBhY2thZ2Ugbm9ybWFsbHkgY2FycmllcyBvbmUgIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICJpbiBiaW4vOyBpZiB0aGlzIHBhY2thZ2UgbGFja3MgaXQsIGluc3RhbGwgb25jZSB3aXRoOiAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgInBpcCBpbnN0YWxsIGxsYW1hLWNwcC1weXRob24iKQogICAgICAgICAgICBwcmludCgiW2lua3dlbGxdICIgKyBBSVsibG9hZF9lcnJvciJdKQogICAgICAgICAgICByZXR1cm4gRmFsc2UKICAgICAgICB0cnk6CiAgICAgICAgICAgICMgZnVsbCBHUFUgb2ZmbG9hZCBmaXJzdDsgYSBDUFUtb25seSBidWlsZCByZWZ1c2VzIGFuZCB3ZSBzdGVwIGRvd24KICAgICAgICAgICAgdHJ5OgogICAgICAgICAgICAgICAgQUlbImxvY2FsIl0gPSBMbGFtYShtb2RlbF9wYXRoPWNhbmRbInBhdGgiXSwgbl9jdHg9NDA5NiwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbl9ncHVfbGF5ZXJzPS0xLCB2ZXJib3NlPUZhbHNlKQogICAgICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gR1BVIG9mZmxvYWQgYXQgZnVsbCB0aWx0IGZvciB7Y2FuZFsnbmFtZSddfSIpCiAgICAgICAgICAgIGV4Y2VwdCAoVHlwZUVycm9yLCBSdW50aW1lRXJyb3IsIE9TRXJyb3IsIFZhbHVlRXJyb3IpIGFzIGU6CiAgICAgICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBHUFUgb2ZmbG9hZCByZWZ1c2VkICh7ZX0pOyBmYWxsaW5nIGJhY2sgdG8gQ1BVIikKICAgICAgICAgICAgICAgIEFJWyJsb2NhbCJdID0gTGxhbWEobW9kZWxfcGF0aD1jYW5kWyJwYXRoIl0sIG5fY3R4PTQwOTYsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5fZ3B1X2xheWVycz0wLCB2ZXJib3NlPUZhbHNlKQogICAgICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0ge2NhbmRbJ25hbWUnXX0gcnVubmluZyBvbiBDUFUiKQogICAgICAgICAgICBBSVsibG9jYWxfa2luZCJdLCBBSVsibG9jYWxfbmFtZSJdID0gImdndWYiLCBjYW5kWyJuYW1lIl0KICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgIEFJWyJsb2FkX2Vycm9yIl0gPSBmInt0eXBlKGUpLl9fbmFtZV9ffToge2V9IgogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBjb3VsZCBub3QgbG9hZCB7Y2FuZFsnbmFtZSddfToge2V9IikKICAgICAgICAgICAgcmV0dXJuIEZhbHNlCiAgICBlbGlmIGNhbmRbImtpbmQiXSA9PSAibWx4IjoKICAgICAgICB0cnk6CiAgICAgICAgICAgIGZyb20gbWx4X2xtIGltcG9ydCBsb2FkLCBnZW5lcmF0ZSBhcyBfbWx4X2dlbgogICAgICAgIGV4Y2VwdCBJbXBvcnRFcnJvcjoKICAgICAgICAgICAgcHJpbnQoIltpbmt3ZWxsXSBtbHggbm90IGluc3RhbGxlZDsgcnVuOiBwaXAgaW5zdGFsbCBtbHggbWx4LWxtIikKICAgICAgICAgICAgcmV0dXJuIEZhbHNlCiAgICAgICAgdHJ5OgogICAgICAgICAgICBtb2RlbCwgdG9rID0gbG9hZChjYW5kWyJwYXRoIl0pCiAgICAgICAgICAgIEFJWyJsb2NhbCJdID0gKG1vZGVsLCB0b2ssIF9tbHhfZ2VuKQogICAgICAgICAgICBBSVsibG9jYWxfa2luZCJdLCBBSVsibG9jYWxfbmFtZSJdID0gIm1seCIsIGNhbmRbIm5hbWUiXQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gY291bGQgbm90IGxvYWQge2NhbmRbJ25hbWUnXX06IHtlfSIpCiAgICAgICAgICAgIHJldHVybiBGYWxzZQogICAgZWxzZToKICAgICAgICByZXR1cm4gRmFsc2UKICAgIHByaW50KGYiW2lua3dlbGxdIHJ1bm5pbmcgbG9jYWwge0FJWydsb2NhbF9raW5kJ10udXBwZXIoKX0gbW9kZWw6IHtjYW5kWyduYW1lJ119IikKICAgIHJldHVybiBUcnVlCgoKZGVmIF9sb2FkX2xvY2FsX21vZGVsKCk6CiAgICAiIiJUaGUgcGVyc2lzdGVkIGNob2ljZSBsb2FkcyBmaXJzdCwgYWx3YXlzOyB0aGUgcmVzdCBhcmUgZmFsbGJhY2tzLiIiIgogICAgY2FuZHMgPSBzY2FuX2xvY2FsX21vZGVscygpCiAgICBpZiBub3QgY2FuZHM6CiAgICAgICAgcmV0dXJuIEZhbHNlCiAgICBhY3RpdmUgPSBjb25mX3JlYWQoKS5nZXQoImFjdGl2ZSIpCiAgICBpZiBhY3RpdmU6CiAgICAgICAgY2FuZHMuc29ydChrZXk9bGFtYmRhIGM6IDAgaWYgY1sibmFtZSJdID09IGFjdGl2ZSBlbHNlIDEpCiAgICBmb3IgY2FuZCBpbiBjYW5kczoKICAgICAgICBpZiBsb2FkX2xvY2FsX3BhdGgoY2FuZCk6CiAgICAgICAgICAgIGMgPSBjb25mX3JlYWQoKTsgY1siYWN0aXZlIl0gPSBjYW5kWyJuYW1lIl07IGNvbmZfd3JpdGUoYykKICAgICAgICAgICAgcmV0dXJuIFRydWUKICAgIHJldHVybiBGYWxzZQoKCmRlZiB1bmxvYWRfbG9jYWwoKToKICAgIGlmIEFJWyJsb2NhbF9raW5kIl0gaW4gKCJnZ3VmLWJ1bmRsZWQiLCkgYW5kIEFJLmdldCgibG9jYWwiKToKICAgICAgICB0cnk6CiAgICAgICAgICAgIEFJWyJsb2NhbCJdWzBdLmtpbGwoKQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgICAgIHBhc3MKICAgIEFJWyJsb2NhbCJdID0gTm9uZQogICAgQUlbImxvY2FsX2tpbmQiXSA9IEFJWyJsb2NhbF9uYW1lIl0gPSBOb25lCiAgICBpbXBvcnQgZ2MKICAgIGdjLmNvbGxlY3QoKQoKCmRlZiBfZ2VuZXJhdGVfbG9jYWwocHJvbXB0LCBtYXhfbmV3X3Rva2Vucyk6CiAgICAiIiJMb2NhbCBtb2RlbCBpbmZlcmVuY2Ugd2l0aCB0aGUgY3JlZWQgYXMgc3lzdGVtIG1lc3NhZ2UuIiIiCiAgICBpZiBBSVsibG9jYWxfa2luZCJdID09ICJnZ3VmLWJ1bmRsZWQiOgogICAgICAgIHJldHVybiBsbGFtYV9jaGF0KHByb21wdCwgbWF4X25ld190b2tlbnMpLnN0cmlwKCkKICAgIGlmIEFJWyJsb2NhbF9raW5kIl0gPT0gImdndWYiOgogICAgICAgIG91dCA9IEFJWyJsb2NhbCJdLmNyZWF0ZV9jaGF0X2NvbXBsZXRpb24oCiAgICAgICAgICAgIG1lc3NhZ2VzPVt7InJvbGUiOiAic3lzdGVtIiwgImNvbnRlbnQiOiAiWW91IGFyZSBJbmt3ZWxsLiJ9LAogICAgICAgICAgICAgICAgICAgICAgeyJyb2xlIjogInVzZXIiLCAiY29udGVudCI6IHByb21wdH1dLAogICAgICAgICAgICBtYXhfdG9rZW5zPW1heF9uZXdfdG9rZW5zLCB0ZW1wZXJhdHVyZT0wLjIpCiAgICAgICAgcmV0dXJuIG91dFsiY2hvaWNlcyJdWzBdWyJtZXNzYWdlIl1bImNvbnRlbnQiXS5zdHJpcCgpCiAgICBpZiBBSVsibG9jYWxfa2luZCJdID09ICJtbHgiOgogICAgICAgIG1vZGVsLCB0b2ssIG1seF9nZW4gPSBBSVsibG9jYWwiXQogICAgICAgIG1zZ3MgPSBbeyJyb2xlIjogInN5c3RlbSIsICJjb250ZW50IjogIllvdSBhcmUgSW5rd2VsbC4ifSwKICAgICAgICAgICAgICAgIHsicm9sZSI6ICJ1c2VyIiwgImNvbnRlbnQiOiBwcm9tcHR9XQogICAgICAgIHRyeToKICAgICAgICAgICAgdGV4dCA9IHRvay5hcHBseV9jaGF0X3RlbXBsYXRlKG1zZ3MsIHRva2VuaXplPUZhbHNlLCBhZGRfZ2VuZXJhdGlvbl9wcm9tcHQ9VHJ1ZSkKICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICB0ZXh0ID0gIllvdSBhcmUgSW5rd2VsbC5cbiIgKyBwcm9tcHQgKyAiXG4iCiAgICAgICAgcmV0dXJuIG1seF9nZW4obW9kZWwsIHRvaywgcHJvbXB0PXRleHQsIG1heF90b2tlbnM9bWF4X25ld190b2tlbnMsIHRlbXA9MC4yKS5zdHJpcCgpCiAgICByZXR1cm4gTm9uZQoKCmRlZiBfZGV2aWNlKCk6CiAgICB0cnk6CiAgICAgICAgaW1wb3J0IHRvcmNoCiAgICAgICAgaWYgdG9yY2guY3VkYS5pc19hdmFpbGFibGUoKToKICAgICAgICAgICAgcmV0dXJuICJjdWRhIgogICAgICAgIGlmIGdldGF0dHIodG9yY2guYmFja2VuZHMsICJtcHMiLCBOb25lKSBhbmQgdG9yY2guYmFja2VuZHMubXBzLmlzX2F2YWlsYWJsZSgpOgogICAgICAgICAgICByZXR1cm4gIm1wcyIKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcGFzcwogICAgcmV0dXJuICJjcHUiCgoKZGVmIF9sb2FkX21vZGVscygpOgogICAgIiIiTGF6eSwgdGhyZWFkLXNhZmUgbW9kZWwgbG9hZC4gUnVucyBpbiBhIGJhY2tncm91bmQgdGhyZWFkIGF0IGJvb3Qgc28KICAgIC9hcGkvaGVhbHRoIGFuc3dlcnMgaW1tZWRpYXRlbHkgYW5kIHJlcG9ydHMgYWk9ZmFsc2UgdW50aWwgcmVhZHkuIiIiCiAgICBpZiBBSVsibG9hZGluZyJdIG9yIEFJWyJyZWFkeSJdOgogICAgICAgIHJldHVybgogICAgd2l0aCBfYWlfbG9jazoKICAgICAgICBpZiBBSVsibG9hZGluZyJdIG9yIEFJWyJyZWFkeSJdOgogICAgICAgICAgICByZXR1cm4KICAgICAgICBBSVsibG9hZGluZyJdID0gVHJ1ZQogICAgICAgIHRyeToKICAgICAgICAgICAgaWYgX2xvYWRfbG9jYWxfbW9kZWwoKToKICAgICAgICAgICAgICAgICMgYSBsb2NhbCBHR1VGL01MWCBtb2RlbCBpcyB0aGUgZW5naW5lOyBHRUMgc3RheXMgaWYgaXQgbG9hZHMKICAgICAgICAgICAgICAgIEFJWyJyZWFkeSJdID0gVHJ1ZQogICAgICAgICAgICAgICAgQUlbInBpcGVfa2luZCJdID0gImxvY2FsIgogICAgICAgICAgICAgICAgdHJ5OgogICAgICAgICAgICAgICAgICAgIGZyb20gdHJhbnNmb3JtZXJzIGltcG9ydCBwaXBlbGluZQogICAgICAgICAgICAgICAgICAgIGRldiA9IF9kZXZpY2UoKQogICAgICAgICAgICAgICAgICAgIEFJWyJnZWMiXSA9IHBpcGVsaW5lKCJ0ZXh0MnRleHQtZ2VuZXJhdGlvbiIsIEdFQ19NT0RFTCwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXZpY2U9MCBpZiBkZXYgPT0gImN1ZGEiIGVsc2UgLTEpCiAgICAgICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICAgICAgICAgIHBhc3MKICAgICAgICAgICAgICAgIHByaW50KCJbaW5rd2VsbF0gbG9jYWwgbW9kZWwgcmVhZHkiKQogICAgICAgICAgICAgICAgQUlbImxvYWRpbmciXSA9IEZhbHNlCiAgICAgICAgICAgICAgICByZXR1cm4KICAgICAgICAgICAgZnJvbSB0cmFuc2Zvcm1lcnMgaW1wb3J0IHBpcGVsaW5lCiAgICAgICAgICAgIGRldiA9IF9kZXZpY2UoKQogICAgICAgICAgICBjYXVzYWwgPSBfaXNfY2F1c2FsX2xtKElOU1RSVUNUX01PREVMKQogICAgICAgICAgICB0YXNrID0gInRleHQtZ2VuZXJhdGlvbiIgaWYgY2F1c2FsIGVsc2UgInRleHQydGV4dC1nZW5lcmF0aW9uIgogICAgICAgICAgICBBSVsicGlwZV9raW5kIl0gPSAidGV4dGdlbiIgaWYgY2F1c2FsIGVsc2UgInRleHQydGV4dCIKICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gbG9hZGluZyB7SU5TVFJVQ1RfTU9ERUx9IG9uIHtkZXZ9ICh7dGFza30pIOKApiIpCiAgICAgICAgICAgIHBpcGVfa3dhcmdzID0geyJkZXZpY2UiOiAwIGlmIGRldiA9PSAiY3VkYSIgZWxzZSAtMX0KICAgICAgICAgICAgaWYgY2F1c2FsOgogICAgICAgICAgICAgICAgdHJ5OgogICAgICAgICAgICAgICAgICAgIGltcG9ydCB0b3JjaAogICAgICAgICAgICAgICAgICAgIHBpcGVfa3dhcmdzWyJ0b3JjaF9kdHlwZSJdID0gdG9yY2guZmxvYXQxNiBpZiBkZXYgPT0gImN1ZGEiIGVsc2UgdG9yY2guZmxvYXQzMgogICAgICAgICAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgICAgICAgICBwYXNzCiAgICAgICAgICAgIEFJWyJwaXBlIl0gPSBwaXBlbGluZSh0YXNrLCBJTlNUUlVDVF9NT0RFTCwgKipwaXBlX2t3YXJncykKICAgICAgICAgICAgdHJ5OgogICAgICAgICAgICAgICAgQUlbImdlYyJdID0gcGlwZWxpbmUoCiAgICAgICAgICAgICAgICAgICAgInRleHQydGV4dC1nZW5lcmF0aW9uIiwgR0VDX01PREVMLAogICAgICAgICAgICAgICAgICAgIGRldmljZT0wIGlmIGRldiA9PSAiY3VkYSIgZWxzZSAtMSkKICAgICAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIGxvYWRlZCB7R0VDX01PREVMfSIpCiAgICAgICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIEdFQyBtb2RlbCB1bmF2YWlsYWJsZSAoe2V9KTsgdXNpbmcgaW5zdHJ1Y3QgbW9kZWwgZm9yIGdyYW1tYXIiKQogICAgICAgICAgICBBSVsicmVhZHkiXSA9IFRydWUKICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gbW9kZWxzIHJlYWR5ICh7QUlbJ3BpcGVfa2luZCddfSkiKQogICAgICAgIGV4Y2VwdCBJbXBvcnRFcnJvcjoKICAgICAgICAgICAgcHJpbnQoIltpbmt3ZWxsXSB0cmFuc2Zvcm1lcnMgbm90IGluc3RhbGxlZDsgaGV1cmlzdGljIG1vZGUuICIKICAgICAgICAgICAgICAgICAgInBpcCBpbnN0YWxsIHRyYW5zZm9ybWVycyB0b3JjaCBmb3IgQUkgcXVhbGl0eS4iKQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gbW9kZWwgbG9hZCBmYWlsZWQ6IHtlfTsgaGV1cmlzdGljIG1vZGUuIikKICAgICAgICBmaW5hbGx5OgogICAgICAgICAgICBBSVsibG9hZGluZyJdID0gRmFsc2UKCgpkZWYgZ2VuZXJhdGUocHJvbXB0LCBtYXhfbmV3X3Rva2Vucz00MjApOgogICAgIiIiT25lIGNhbGwgaW50byB0aGUgYWN0aXZlIGluc3RydWN0IGVuZ2luZTsgTm9uZSBpZiBBSSB1bmF2YWlsYWJsZS4iIiIKICAgIGlmIG5vdCBBSVsicmVhZHkiXToKICAgICAgICByZXR1cm4gTm9uZQogICAgaWYgQUkuZ2V0KCJsb2NhbCIpOgogICAgICAgIHRyeToKICAgICAgICAgICAgcmV0dXJuIF9nZW5lcmF0ZV9sb2NhbChwcm9tcHQsIG1heF9uZXdfdG9rZW5zKQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gbG9jYWwgZ2VuZXJhdGlvbiBlcnJvcjoge2V9IikKICAgICAgICAgICAgcmV0dXJuIE5vbmUKICAgIGlmIEFJWyJwaXBlIl0gaXMgTm9uZToKICAgICAgICByZXR1cm4gTm9uZQogICAgdHJ5OgogICAgICAgIGlmIEFJLmdldCgicGlwZV9raW5kIikgPT0gInRleHRnZW4iOgogICAgICAgICAgICAjIENhdXNhbCBMTSAoUXdlbiwgUGhpLCBldGMuKTogdXNlIGNoYXQtdGVtcGxhdGUgbWVzc2FnZXMgZm9ybWF0LgogICAgICAgICAgICAjIFRoZSBwaXBlbGluZSBhcHBsaWVzIHRoZSB0b2tlbml6ZXIncyBjaGF0IHRlbXBsYXRlIGF1dG9tYXRpY2FsbHkKICAgICAgICAgICAgIyB3aGVuIGl0IHJlY2VpdmVzIGEgbGlzdCBvZiBtZXNzYWdlIGRpY3RzLgogICAgICAgICAgICBtZXNzYWdlcyA9IFsKICAgICAgICAgICAgICAgIHsicm9sZSI6ICJzeXN0ZW0iLCAiY29udGVudCI6ICJZb3UgYXJlIElua3dlbGwsIGFuIGFjYWRlbWljIHdyaXRpbmcgYXNzaXN0YW50LiAiCiAgICAgICAgICAgICAgICAgIkZvbGxvdyB0aGUgdXNlcidzIGluc3RydWN0aW9ucyBwcmVjaXNlbHkuIFByZXNlcnZlIHRoZSB3cml0ZXIncyB2b2ljZS4gIgogICAgICAgICAgICAgICAgICJOZXZlciBmYWJyaWNhdGUgY2l0YXRpb25zLCBzdGF0aXN0aWNzLCBvciBmYWN0cy4ifSwKICAgICAgICAgICAgICAgIHsicm9sZSI6ICJ1c2VyIiwgImNvbnRlbnQiOiBwcm9tcHR9CiAgICAgICAgICAgIF0KICAgICAgICAgICAgb3V0ID0gQUlbInBpcGUiXShtZXNzYWdlcywgbWF4X25ld190b2tlbnM9bWF4X25ld190b2tlbnMsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9fc2FtcGxlPUZhbHNlLCByZXBldGl0aW9uX3BlbmFsdHk9MS4wNSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZW1wZXJhdHVyZT0wLjMsIHJldHVybl9mdWxsX3RleHQ9RmFsc2UpCiAgICAgICAgICAgIGdlbiA9IG91dFswXS5nZXQoImdlbmVyYXRlZF90ZXh0IiwgIiIpCiAgICAgICAgICAgICMgVGhlIHBpcGVsaW5lIHJldHVybnMgYSBsaXN0IG9mIG1lc3NhZ2UgZGljdHM7IGV4dHJhY3QgdGhlIGxhc3Qgb25lLgogICAgICAgICAgICBpZiBpc2luc3RhbmNlKGdlbiwgbGlzdCkgYW5kIGxlbihnZW4pID4gMDoKICAgICAgICAgICAgICAgIGxhc3QgPSBnZW5bLTFdCiAgICAgICAgICAgICAgICBpZiBpc2luc3RhbmNlKGxhc3QsIGRpY3QpIGFuZCAiY29udGVudCIgaW4gbGFzdDoKICAgICAgICAgICAgICAgICAgICByZXR1cm4gbGFzdFsiY29udGVudCJdLnN0cmlwKCkKICAgICAgICAgICAgICAgIHJldHVybiBzdHIobGFzdCkuc3RyaXAoKQogICAgICAgICAgICBpZiBpc2luc3RhbmNlKGdlbiwgZGljdCkgYW5kICJjb250ZW50IiBpbiBnZW46CiAgICAgICAgICAgICAgICByZXR1cm4gZ2VuWyJjb250ZW50Il0uc3RyaXAoKQogICAgICAgICAgICAjIEZhbGxiYWNrOiB0cmVhdCBhcyBwbGFpbiB0ZXh0IChvbGRlciB0cmFuc2Zvcm1lcnMgdmVyc2lvbnMpCiAgICAgICAgICAgIHRleHQgPSBzdHIoZ2VuKS5zdHJpcCgpCiAgICAgICAgICAgICMgU3RyaXAgYW55IGVjaG8gb2YgdGhlIHByb21wdCBpZiByZXR1cm5fZnVsbF90ZXh0IHdhcyBpZ25vcmVkCiAgICAgICAgICAgIGlmIHByb21wdCBpbiB0ZXh0OgogICAgICAgICAgICAgICAgdGV4dCA9IHRleHRbbGVuKHByb21wdCk6XS5zdHJpcCgpCiAgICAgICAgICAgIHJldHVybiB0ZXh0CiAgICAgICAgZWxzZToKICAgICAgICAgICAgIyBTZXEyc2VxIChUNSwgQkFSVCwgZmxhbi1UNSk6IHBsYWluIHRleHQgaW4sIHBsYWluIHRleHQgb3V0LgogICAgICAgICAgICBvdXQgPSBBSVsicGlwZSJdKHByb21wdCwgbWF4X25ld190b2tlbnM9bWF4X25ld190b2tlbnMsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9fc2FtcGxlPUZhbHNlLCByZXBldGl0aW9uX3BlbmFsdHk9MS4xNSkKICAgICAgICAgICAgcmV0dXJuIG91dFswXS5nZXQoImdlbmVyYXRlZF90ZXh0IiwgIiIpLnN0cmlwKCkKICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICBwcmludChmIltpbmt3ZWxsXSBnZW5lcmF0aW9uIGVycm9yOiB7ZX0iKQogICAgICAgIHJldHVybiBOb25lCgoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNwZWVjaCB0byB0ZXh0CiMgV2hpc3BlciBmb3Igb2ZmbGluZSB0cmFuc2NyaXB0aW9uLiBMb2FkZWQgbGF6aWx5IChvciB3YXJtZWQgd2hlbiBTY3JpYmEKIyBvcGVucykgc28gaXQgbmV2ZXIgc2xvd3MgYm9vdCBhbmQgbmV2ZXIgZG93bmxvYWRzIHVubGVzcyB0aGUgdXNlciBuZWVkcyBpdC4KIwojIHYyLjExOiBTY3JpYmEgc2VuZHMgMTYga0h6IG1vbm8gMTYtYml0IFdBVi4gVGhlIFdBViBpcyBkZWNvZGVkIGhlcmUgd2l0aCB0aGUKIyBzdGFuZGFyZCBsaWJyYXJ5IGFuZCBoYW5kZWQgdG8gdGhlIHBpcGVsaW5lIGFzIGEgcmF3IGFycmF5LCBzbyB0cmFuc2NyaXB0aW9uCiMgbmVlZHMgbmVpdGhlciBmZm1wZWcgbm9yIHRvcmNoYXVkaW8uIExvbmcgYXVkaW8gaXMgY3V0IGF0IG5hdHVyYWwgcGF1c2VzIGludG8KIyBwaWVjZXMgdW5kZXIgMzAgc2Vjb25kcyAoV2hpc3BlcidzIHdpbmRvdyksIHNvIGV2ZXJ5IHRyYW5zZm9ybWVycyB2ZXJzaW9uCiMgYmVoYXZlcyB0aGUgc2FtZSB3YXkuClNUVF9NT0RFTCA9IG9zLmVudmlyb24uZ2V0KCJJTktXRUxMX1NUVF9NT0RFTCIsICJvcGVuYWkvd2hpc3Blci10aW55IikKU1RUX1JBVEUgPSAxNjAwMApfc3R0X2xvY2sgPSB0aHJlYWRpbmcuTG9jaygpICAgICAgIyBndWFyZHMgbG9hZGluZwpfc3R0X3J1bl9sb2NrID0gdGhyZWFkaW5nLkxvY2soKSAgIyBvbmUgdHJhbnNjcmlwdGlvbiBhdCBhIHRpbWU7IHRoZSBwaXBlbGluZSBpcyBub3QgdGhyZWFkLXNhZmUKX1NUVF9TVEFURSA9IHsibG9hZGluZyI6IEZhbHNlLCAiZXJyb3IiOiBOb25lfQoKCmRlZiBfc3R0X2F2YWlsYWJsZSgpOgogICAgIiIiVHJ1ZSB3aGVuIHRoZSBsaWJyYXJpZXMgV2hpc3BlciBuZWVkcyBhcmUgaW5zdGFsbGVkIChub3QgbmVjZXNzYXJpbHkgbG9hZGVkKS4iIiIKICAgIHRyeToKICAgICAgICBpbXBvcnQgaW1wb3J0bGliLnV0aWwgYXMgX2l1CiAgICAgICAgcmV0dXJuIGJvb2woX2l1LmZpbmRfc3BlYygidHJhbnNmb3JtZXJzIikpIGFuZCBib29sKF9pdS5maW5kX3NwZWMoIm51bXB5IikpIFwKICAgICAgICAgICAgYW5kIGJvb2woX2l1LmZpbmRfc3BlYygidG9yY2giKSkKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcmV0dXJuIEZhbHNlCgoKZGVmIF9sb2FkX3N0dCgpOgogICAgIiIiTGF6eS1sb2FkIHRoZSBXaGlzcGVyIHBpcGVsaW5lIGZvciBzcGVlY2gtdG8tdGV4dC4iIiIKICAgIHdpdGggX3N0dF9sb2NrOgogICAgICAgIGlmIEFJLmdldCgic3R0Iik6CiAgICAgICAgICAgIHJldHVybiBBSVsic3R0Il0KICAgICAgICBfU1RUX1NUQVRFWyJsb2FkaW5nIl0gPSBUcnVlCiAgICAgICAgdHJ5OgogICAgICAgICAgICBmcm9tIHRyYW5zZm9ybWVycyBpbXBvcnQgcGlwZWxpbmUKICAgICAgICAgICAgZGV2ID0gX2RldmljZSgpCiAgICAgICAgICAgIHByaW50KGYiW2lua3dlbGxdIGxvYWRpbmcgV2hpc3BlciAoe1NUVF9NT0RFTH0pIG9uIHtkZXZ9IGZvciB0cmFuc2NyaXB0aW9uIikKICAgICAgICAgICAgQUlbInN0dCJdID0gcGlwZWxpbmUoImF1dG9tYXRpYy1zcGVlY2gtcmVjb2duaXRpb24iLCBTVFRfTU9ERUwsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRldmljZT0wIGlmIGRldiA9PSAiY3VkYSIgZWxzZSAtMSkKICAgICAgICAgICAgX1NUVF9TVEFURVsiZXJyb3IiXSA9IE5vbmUKICAgICAgICAgICAgcHJpbnQoIltpbmt3ZWxsXSBXaGlzcGVyIHJlYWR5IGZvciB0cmFuc2NyaXB0aW9uIikKICAgICAgICAgICAgcmV0dXJuIEFJWyJzdHQiXQogICAgICAgIGV4Y2VwdCBJbXBvcnRFcnJvcjoKICAgICAgICAgICAgX1NUVF9TVEFURVsiZXJyb3IiXSA9ICJ0cmFuc2Zvcm1lcnMsIHRvcmNoIGFuZCBudW1weSBhcmUgbm90IGluc3RhbGxlZCIKICAgICAgICAgICAgcHJpbnQoIltpbmt3ZWxsXSB0cmFuc2Zvcm1lcnMgbm90IGluc3RhbGxlZDsgdHJhbnNjcmlwdGlvbiB1bmF2YWlsYWJsZS4gIgogICAgICAgICAgICAgICAgICAicGlwIGluc3RhbGwgdHJhbnNmb3JtZXJzIHRvcmNoIikKICAgICAgICAgICAgcmV0dXJuIE5vbmUKICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgIF9TVFRfU1RBVEVbImVycm9yIl0gPSBmInt0eXBlKGUpLl9fbmFtZV9ffToge2V9IgogICAgICAgICAgICBwcmludChmIltpbmt3ZWxsXSBXaGlzcGVyIGxvYWQgZmFpbGVkOiB7ZX0iKQogICAgICAgICAgICByZXR1cm4gTm9uZQogICAgICAgIGZpbmFsbHk6CiAgICAgICAgICAgIF9TVFRfU1RBVEVbImxvYWRpbmciXSA9IEZhbHNlCgoKZGVmIF9kZWNvZGVfd2F2KGF1ZGlvX2J5dGVzKToKICAgICIiIldBViBieXRlcyAtPiAobW9ubyBmbG9hdDMyIG51bXB5IGFycmF5IGluIFstMSwgMV0sIHNhbXBsZSByYXRlKS4KICAgIFN1cHBvcnRzIDgsIDE2LCAyNCBhbmQgMzItYml0IGludGVnZXIgUENNLiBSYWlzZXMgVmFsdWVFcnJvciBvdGhlcndpc2UuIiIiCiAgICBpbXBvcnQgaW8KICAgIGltcG9ydCB3YXZlCiAgICBpbXBvcnQgbnVtcHkgYXMgbnAKICAgIHRyeToKICAgICAgICB3aXRoIHdhdmUub3Blbihpby5CeXRlc0lPKGF1ZGlvX2J5dGVzKSwgInJiIikgYXMgdzoKICAgICAgICAgICAgY2gsIHdpZHRoLCByYXRlLCBuID0gdy5nZXRuY2hhbm5lbHMoKSwgdy5nZXRzYW1wd2lkdGgoKSwgdy5nZXRmcmFtZXJhdGUoKSwgdy5nZXRuZnJhbWVzKCkKICAgICAgICAgICAgcmF3ID0gdy5yZWFkZnJhbWVzKG4pCiAgICBleGNlcHQgd2F2ZS5FcnJvciBhcyBlOgogICAgICAgIHJhaXNlIFZhbHVlRXJyb3IoZiJ1bnJlYWRhYmxlIFdBViAoe2V9KSIpCiAgICBpZiB3aWR0aCA9PSAxOgogICAgICAgIGEgPSAobnAuZnJvbWJ1ZmZlcihyYXcsIGR0eXBlPW5wLnVpbnQ4KS5hc3R5cGUobnAuZmxvYXQzMikgLSAxMjguMCkgLyAxMjguMAogICAgZWxpZiB3aWR0aCA9PSAyOgogICAgICAgIGEgPSBucC5mcm9tYnVmZmVyKHJhdywgZHR5cGU9IjxpMiIpLmFzdHlwZShucC5mbG9hdDMyKSAvIDMyNzY4LjAKICAgIGVsaWYgd2lkdGggPT0gMzoKICAgICAgICBiID0gbnAuZnJvbWJ1ZmZlcihyYXcsIGR0eXBlPW5wLnVpbnQ4KS5yZXNoYXBlKC0xLCAzKS5hc3R5cGUobnAuaW50MzIpCiAgICAgICAgdiA9IGJbOiwgMF0gfCAoYls6LCAxXSA8PCA4KSB8IChiWzosIDJdIDw8IDE2KQogICAgICAgIHYgPSBucC53aGVyZSh2ID49ICgxIDw8IDIzKSwgdiAtICgxIDw8IDI0KSwgdikKICAgICAgICBhID0gdi5hc3R5cGUobnAuZmxvYXQzMikgLyBmbG9hdCgxIDw8IDIzKQogICAgZWxpZiB3aWR0aCA9PSA0OgogICAgICAgIGEgPSBucC5mcm9tYnVmZmVyKHJhdywgZHR5cGU9IjxpNCIpLmFzdHlwZShucC5mbG9hdDMyKSAvIDIxNDc0ODM2NDguMAogICAgZWxzZToKICAgICAgICByYWlzZSBWYWx1ZUVycm9yKGYidW5zdXBwb3J0ZWQgc2FtcGxlIHdpZHRoIHt3aWR0aH0iKQogICAgaWYgY2ggPiAxOgogICAgICAgIGEgPSBhWzogKGxlbihhKSAvLyBjaCkgKiBjaF0ucmVzaGFwZSgtMSwgY2gpLm1lYW4oYXhpcz0xKQogICAgcmV0dXJuIGEuYXN0eXBlKG5wLmZsb2F0MzIpLCBpbnQocmF0ZSkKCgpkZWYgX3Jlc2FtcGxlKGEsIHJhdGUsIHRhcmdldD1TVFRfUkFURSk6CiAgICAiIiJMaW5lYXIgcmVzYW1wbGluZzsgYWRlcXVhdGUgZm9yIHNwZWVjaCBhbmQgZGVwZW5kZW5jeS1mcmVlLiIiIgogICAgaW1wb3J0IG51bXB5IGFzIG5wCiAgICBpZiByYXRlID09IHRhcmdldCBvciBsZW4oYSkgPT0gMDoKICAgICAgICByZXR1cm4gYS5hc3R5cGUobnAuZmxvYXQzMikKICAgIG5fb3V0ID0gaW50KHJvdW5kKGxlbihhKSAqIGZsb2F0KHRhcmdldCkgLyBmbG9hdChyYXRlKSkpCiAgICBpZiBuX291dCA8PSAxOgogICAgICAgIHJldHVybiBucC56ZXJvcygwLCBkdHlwZT1ucC5mbG9hdDMyKQogICAgeF9vbGQgPSBucC5hcmFuZ2UobGVuKGEpLCBkdHlwZT1ucC5mbG9hdDY0KSAvIGZsb2F0KHJhdGUpCiAgICB4X25ldyA9IG5wLmFyYW5nZShuX291dCwgZHR5cGU9bnAuZmxvYXQ2NCkgLyBmbG9hdCh0YXJnZXQpCiAgICByZXR1cm4gbnAuaW50ZXJwKHhfbmV3LCB4X29sZCwgYSkuYXN0eXBlKG5wLmZsb2F0MzIpCgoKZGVmIF9mcmFtZV9ybXMoYSwgcmF0ZSwgZnJhbWVfcz0wLjAyKToKICAgIGltcG9ydCBudW1weSBhcyBucAogICAgZiA9IG1heCgxLCBpbnQocmF0ZSAqIGZyYW1lX3MpKQogICAgbiA9IGxlbihhKSAvLyBmCiAgICBpZiBuID09IDA6CiAgICAgICAgcmV0dXJuIG5wLnplcm9zKDAsIGR0eXBlPW5wLmZsb2F0MzIpLCBmCiAgICBmciA9IGFbOiBuICogZl0ucmVzaGFwZShuLCBmKQogICAgcmV0dXJuIG5wLnNxcnQoKGZyLmFzdHlwZShucC5mbG9hdDY0KSAqKiAyKS5tZWFuKGF4aXM9MSkpLmFzdHlwZShucC5mbG9hdDMyKSwgZgoKCmRlZiBfc3BsaXRfb25fc2lsZW5jZShhLCByYXRlLCBtYXhfcz0yOC4wLCBtaW5fcz0xMC4wKToKICAgICIiIkN1dCBhdWRpbyBpbnRvIHBpZWNlcyBubyBsb25nZXIgdGhhbiBtYXhfcywgZWFjaCBjdXQgcGxhY2VkIGF0IHRoZQogICAgcXVpZXRlc3QgMjAgbXMgZnJhbWUgYmV0d2VlbiBtaW5fcyBhbmQgbWF4X3MgaW50byB0aGUgcGllY2UuIFJldHVybnMgYQogICAgbGlzdCBvZiBhcnJheXMgdGhhdCB0b2dldGhlciBjb250YWluIGV2ZXJ5IHNhbXBsZSBleGFjdGx5IG9uY2UuIiIiCiAgICBtYXhfbiA9IGludChtYXhfcyAqIHJhdGUpCiAgICBpZiBsZW4oYSkgPD0gbWF4X246CiAgICAgICAgcmV0dXJuIFthXQogICAgcm1zLCBmID0gX2ZyYW1lX3JtcyhhLCByYXRlKQogICAgb3V0LCBzdGFydCA9IFtdLCAwCiAgICB3aGlsZSBsZW4oYSkgLSBzdGFydCA+IG1heF9uOgogICAgICAgIGxvID0gKHN0YXJ0ICsgaW50KG1pbl9zICogcmF0ZSkpIC8vIGYKICAgICAgICBoaSA9IChzdGFydCArIG1heF9uKSAvLyBmCiAgICAgICAgaGkgPSBtaW4oaGksIGxlbihybXMpKQogICAgICAgIGlmIGhpIDw9IGxvOgogICAgICAgICAgICBjdXQgPSBzdGFydCArIG1heF9uCiAgICAgICAgZWxzZToKICAgICAgICAgICAgIyB0aGUgcXVpZXRlc3QgZnJhbWUgd2luczsgYW1vbmcgbmVhci10aWVzIHRoZSBMQVRFU1QgaXMgdGFrZW4sIHNvCiAgICAgICAgICAgICMgcGllY2VzIHN0YXkgbG9uZyAobW9yZSBjb250ZXh0IGZvciBXaGlzcGVyLCBmZXdlciBzZWFtcykKICAgICAgICAgICAgd2luID0gcm1zW2xvOmhpXQogICAgICAgICAgICBmbG9vciA9IGZsb2F0KHdpbi5taW4oKSkKICAgICAgICAgICAgcXVpZXQgPSAod2luIDw9IGZsb29yICogMS41ICsgMWUtNCkubm9uemVybygpWzBdCiAgICAgICAgICAgIGsgPSBsbyArIGludChxdWlldFstMV0pCiAgICAgICAgICAgIGN1dCA9IGsgKiBmICsgZiAvLyAyCiAgICAgICAgY3V0ID0gbWF4KHN0YXJ0ICsgMSwgbWluKGN1dCwgc3RhcnQgKyBtYXhfbikpCiAgICAgICAgb3V0LmFwcGVuZChhW3N0YXJ0OmN1dF0pCiAgICAgICAgc3RhcnQgPSBjdXQKICAgIG91dC5hcHBlbmQoYVtzdGFydDpdKQogICAgcmV0dXJuIFt4IGZvciB4IGluIG91dCBpZiBsZW4oeCldCgoKIyBiZWxvdyB0aGlzIGxvdWRuZXNzIGEgcGllY2UgaXMgdHJlYXRlZCBhcyBzaWxlbmNlIGFuZCBub3QgdHJhbnNjcmliZWQ7CiMgV2hpc3BlciBpbnZlbnRzIHdvcmRzICgiVGhhbmsgeW91LiIpIHdoZW4gaGFuZGVkIHNpbGVuY2UKX1NJTEVOQ0VfUk1TID0gMC4wMDYKCgpkZWYgdHJhbnNjcmliZV9hdWRpbyhhdWRpb19ieXRlcywgbGFuZ3VhZ2U9Tm9uZSk6CiAgICAiIiJUcmFuc2NyaWJlIGF1ZGlvIGJ5dGVzIHRvIHRleHQuIFJldHVybnMgKHRleHQsIGVycm9yLCBpbmZvKS4KICAgIFdBViBpcyBkZWNvZGVkIGhlcmUgKG5vIGZmbXBlZyBuZWVkZWQpLiBPdGhlciBmb3JtYXRzIGFyZSBhY2NlcHRlZCBvbmx5CiAgICB3aGVuIGZmbXBlZyBpcyBpbnN0YWxsZWQsIGJlY2F1c2UgdGhlIHBpcGVsaW5lIG5lZWRzIGl0IHRvIGRlY29kZSB0aGVtLiIiIgogICAgaW5mbyA9IHt9CiAgICBpc193YXYgPSBhdWRpb19ieXRlc1s6NF0gPT0gYiJSSUZGIiBhbmQgYXVkaW9fYnl0ZXNbODoxMl0gPT0gYiJXQVZFIgogICAgaWYgbm90IGlzX3dhdiBhbmQgbm90IHNodXRpbC53aGljaCgiZmZtcGVnIik6CiAgICAgICAgcmV0dXJuIE5vbmUsICgiVGhpcyByZWNvcmRpbmcgaXMgbm90IFdBViwgYW5kIGRlY29kaW5nIGl0IG5lZWRzIGZmbXBlZywgd2hpY2ggaXMgbm90ICIKICAgICAgICAgICAgICAgICAgICAgICJpbnN0YWxsZWQuIFVwZGF0ZSBJbmt3ZWxsOiBTY3JpYmEgbm93IHNlbmRzIFdBVi4iKSwgaW5mbwogICAgaWYgaXNfd2F2OgogICAgICAgIHRyeToKICAgICAgICAgICAgYXVkaW8sIHJhdGUgPSBfZGVjb2RlX3dhdihhdWRpb19ieXRlcykKICAgICAgICBleGNlcHQgSW1wb3J0RXJyb3I6CiAgICAgICAgICAgIHJldHVybiBOb25lLCAibnVtcHkgaXMgbm90IGluc3RhbGxlZC4gSW5zdGFsbCB0aGUgQUkgYmFja2VuZDogcGlwIGluc3RhbGwgdHJhbnNmb3JtZXJzIHRvcmNoIiwgaW5mbwogICAgICAgIGV4Y2VwdCBWYWx1ZUVycm9yIGFzIGU6CiAgICAgICAgICAgIHJldHVybiBOb25lLCBmIlRoZSBhdWRpbyBjb3VsZCBub3QgYmUgcmVhZDoge2V9IiwgaW5mbwogICAgICAgIGF1ZGlvID0gX3Jlc2FtcGxlKGF1ZGlvLCByYXRlKQogICAgICAgIGluZm9bInNlY29uZHMiXSA9IHJvdW5kKGxlbihhdWRpbykgLyBmbG9hdChTVFRfUkFURSksIDIpCiAgICAgICAgaW5mb1sicmF0ZV9pbiJdID0gcmF0ZQogICAgcGlwZSA9IF9sb2FkX3N0dCgpCiAgICBpZiBwaXBlIGlzIE5vbmU6CiAgICAgICAgd2h5ID0gX1NUVF9TVEFURS5nZXQoImVycm9yIikgb3IgInVua25vd24gcmVhc29uIgogICAgICAgIHJldHVybiBOb25lLCAoIlRoZSB0cmFuc2NyaXB0aW9uIG1vZGVsIGlzIHVuYXZhaWxhYmxlICgiICsgd2h5ICsgIikuICIKICAgICAgICAgICAgICAgICAgICAgICJJbnN0YWxsIHRoZSBBSSBiYWNrZW5kIG9uY2Ugd2l0aDogcGlwIGluc3RhbGwgdHJhbnNmb3JtZXJzIHRvcmNoIiksIGluZm8KICAgIGdlbiA9IHt9CiAgICBpZiAiLmVuIiBub3QgaW4gU1RUX01PREVMOiAgIyBFbmdsaXNoLW9ubHkgY2hlY2twb2ludHMgcmVmdXNlIGxhbmd1YWdlL3Rhc2sKICAgICAgICBnZW5bInRhc2siXSA9ICJ0cmFuc2NyaWJlIgogICAgICAgIGlmIGxhbmd1YWdlOgogICAgICAgICAgICBnZW5bImxhbmd1YWdlIl0gPSBsYW5ndWFnZQogICAgdHJ5OgogICAgICAgIHdpdGggX3N0dF9ydW5fbG9jazoKICAgICAgICAgICAgaWYgbm90IGlzX3dhdjoKICAgICAgICAgICAgICAgIHJlc3VsdCA9IHBpcGUoYXVkaW9fYnl0ZXMsIGdlbmVyYXRlX2t3YXJncz1nZW4pIGlmIGdlbiBlbHNlIHBpcGUoYXVkaW9fYnl0ZXMpCiAgICAgICAgICAgICAgICByZXR1cm4gKHJlc3VsdC5nZXQoInRleHQiLCAiIikgaWYgcmVzdWx0IGVsc2UgIiIpLnN0cmlwKCksIE5vbmUsIGluZm8KICAgICAgICAgICAgcGllY2VzID0gX3NwbGl0X29uX3NpbGVuY2UoYXVkaW8sIFNUVF9SQVRFKQogICAgICAgICAgICBpbmZvWyJwaWVjZXMiXSA9IGxlbihwaWVjZXMpCiAgICAgICAgICAgIHRleHRzLCBza2lwcGVkID0gW10sIDAKICAgICAgICAgICAgZm9yIHBpZWNlIGluIHBpZWNlczoKICAgICAgICAgICAgICAgIHJtcywgXyA9IF9mcmFtZV9ybXMocGllY2UsIFNUVF9SQVRFKQogICAgICAgICAgICAgICAgaWYgbGVuKHJtcykgPT0gMCBvciBmbG9hdChybXMubWF4KCkpIDwgX1NJTEVOQ0VfUk1TOgogICAgICAgICAgICAgICAgICAgIHNraXBwZWQgKz0gMQogICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgICAgICAgICBpbnAgPSB7InJhdyI6IHBpZWNlLCAic2FtcGxpbmdfcmF0ZSI6IFNUVF9SQVRFfQogICAgICAgICAgICAgICAgcmVzdWx0ID0gcGlwZShpbnAsIGdlbmVyYXRlX2t3YXJncz1nZW4pIGlmIGdlbiBlbHNlIHBpcGUoaW5wKQogICAgICAgICAgICAgICAgdCA9IChyZXN1bHQuZ2V0KCJ0ZXh0IiwgIiIpIGlmIHJlc3VsdCBlbHNlICIiKS5zdHJpcCgpCiAgICAgICAgICAgICAgICBpZiB0OgogICAgICAgICAgICAgICAgICAgIHRleHRzLmFwcGVuZCh0KQogICAgICAgICAgICBpbmZvWyJzaWxlbnRfcGllY2VzIl0gPSBza2lwcGVkCiAgICAgICAgICAgIHJldHVybiAiICIuam9pbih0ZXh0cykuc3RyaXAoKSwgTm9uZSwgaW5mbwogICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgIHJldHVybiBOb25lLCBmIlRyYW5zY3JpcHRpb24gZXJyb3I6IHt0eXBlKGUpLl9fbmFtZV9ffToge2V9IiwgaW5mbwoKCmRlZiBlcF9zdHRfd2FybShfYm9keSk6CiAgICAiIiJTdGFydCBsb2FkaW5nIFdoaXNwZXIgaW4gdGhlIGJhY2tncm91bmQgc28gdGhlIGZpcnN0IGRpY3RhdGlvbiBpcyBxdWljay4iIiIKICAgIGlmIG5vdCBBSS5nZXQoInN0dCIpIGFuZCBub3QgX1NUVF9TVEFURVsibG9hZGluZyJdIGFuZCBfc3R0X2F2YWlsYWJsZSgpOgogICAgICAgIHRocmVhZGluZy5UaHJlYWQodGFyZ2V0PV9sb2FkX3N0dCwgZGFlbW9uPVRydWUpLnN0YXJ0KCkKICAgICAgICByZXR1cm4geyJvayI6IFRydWUsICJzdHRfbG9hZGluZyI6IFRydWV9CiAgICByZXR1cm4geyJvayI6IFRydWUsICJzdHRfbG9hZGluZyI6IGJvb2woX1NUVF9TVEFURVsibG9hZGluZyJdKSwgInN0dF9sb2FkZWQiOiBib29sKEFJLmdldCgic3R0IikpfQoKCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSB3b3JkIGRpZmYKZGVmIHdvcmRfZGlmZl9lZGl0cyhvcmlnLCBmaXhlZCwgb2ZmPTApOgogICAgIiIiV29yZC1sZXZlbCBkaWZmIOKGkiBJbmt3ZWxsIGVkaXQgb2JqZWN0cyBbe3N0YXJ0LGVuZCxvcmlnLGZpeCx3aHksY2F0fV0uIiIiCiAgICBhID0gb3JpZy5zcGxpdCgpCiAgICBiID0gZml4ZWQuc3BsaXQoKQogICAgc20gPSBkaWZmbGliLlNlcXVlbmNlTWF0Y2hlcihhPWEsIGI9YiwgYXV0b2p1bms9RmFsc2UpCiAgICBzcGFucyA9IFsobS5zdGFydCgpLCBtLmVuZCgpKSBmb3IgbSBpbiByZS5maW5kaXRlcihyIlxTKyIsIG9yaWcpXQogICAgZWRpdHMgPSBbXQogICAgZm9yIHRhZywgaTEsIGkyLCBqMSwgajIgaW4gc20uZ2V0X29wY29kZXMoKToKICAgICAgICBpZiB0YWcgPT0gImVxdWFsIjoKICAgICAgICAgICAgY29udGludWUKICAgICAgICBpZiBpMSA8IGkyOgogICAgICAgICAgICBzLCBlID0gc3BhbnNbaTFdWzBdLCBzcGFuc1tpMiAtIDFdWzFdCiAgICAgICAgZWxzZTogICMgcHVyZSBpbnNlcnRpb24KICAgICAgICAgICAgcyA9IGUgPSBzcGFuc1tpMV1bMF0gaWYgaTEgPCBsZW4oc3BhbnMpIGVsc2UgbGVuKG9yaWcpCiAgICAgICAgcmVwbCA9ICIgIi5qb2luKGJbajE6ajJdKQogICAgICAgIG9sZCA9IG9yaWdbczplXQogICAgICAgIGlmIHJlcGwgIT0gb2xkOgogICAgICAgICAgICBlZGl0cy5hcHBlbmQoeyJzdGFydCI6IHMgKyBvZmYsICJlbmQiOiBlICsgb2ZmLCAib3JpZyI6IG9sZCwKICAgICAgICAgICAgICAgICAgICAgICAgICAiZml4IjogcmVwbCwgIndoeSI6ICJTZXJ2ZXIgZ3JhbW1hciIsICJjYXQiOiAiYWkifSkKICAgIHJldHVybiBlZGl0cwoKCgojIC0tLS0tLS0tLS0tLS0tLS0gaGV1cmlzdGljIG9mZmxpbmUgbGFuZSAodGhlIGNyZWVkOiBubyBzZXJ2ZXIgY2FsbCBldmVyKSAtLS0tLS0tCiMgVGhlIHBhZ2UncyBydWxlcyBlbmdpbmUgYW5kIHRoaXMgb25lIG1pcnJvciBlYWNoIG90aGVyOyB0aGUgc2VydmVyIGFuc3dlcnMgdGhlCiMgc2FtZSB3YXkgZXZlbiB3aGVuIG5vIG1vZGVsIGlzIG9uIHRoZSBzaGVsZi4gTm8gZGVwZW5kZW5jeS4KCmltcG9ydCByZSBhcyBfcmUyCgojIHRoZSByZWFsIHJ1bGUgbGlzdCwgd3JpdHRlbiBhcyB0aGUgZGVzaydzOiAocGF0dGVybiwgcmVwbGFjZW1lbnQgb3IgTm9uZSwgd2h5LCBjYXQpCl9IRV9SVUxFU19SQVcgPSBbCiAgICAociJcYnRoZSByZXN1bHRzIHdhc1xiIiwgInRoZSByZXN1bHRzIHdlcmUiLCAiQSBwbHVyYWwgc3ViamVjdCB0YWtlcyBhIHBsdXJhbCB2ZXJiIiwgImciKSwKICAgIChyIlxidGhlc2UgcmVzdWx0cyBzaG93c1xiIiwgInRoZXNlIHJlc3VsdHMgc2hvdyIsICJUaGUgcGx1cmFsIHZlcmIgc3RhbmRzIiwgImciKSwKICAgIChyIlxidGhlIGRhdGEgc2hvd3NcYiIsICJ0aGUgZGF0YSBzaG93IiwgIuKAnERhdGHigJ0gdGFrZXMgdGhlIHBsdXJhbCBpbiBmb3JtYWwgd3JpdGluZyIsICJnIiksCiAgICAociJcYnRoZSBtZWRpYSBpc1xiIiwgTm9uZSwgIuKAnE1lZGlh4oCdIGlzIHBsdXJhbDsgdGhlIHNpbmd1bGFyIGlzIG1lZGl1bSIsICJzIiksCiAgICAociJcYnRoZSBjcml0ZXJpYSBpc1xiIiwgInRoZSBjcml0ZXJpYSBhcmUiLCAiQ3JpdGVyaWEgaXMgcGx1cmFsIiwgImciKSwKICAgIChyIlxidGhlIHBoZW5vbWVuYSBpc1xiIiwgInRoZSBwaGVub21lbmEgYXJlIiwgIlBoZW5vbWVuYSBpcyBwbHVyYWwiLCAiZyIpLAogICAgKHIiXGJpdHMgb3duXGIiLCAiaXRzIG93biIsIE5vbmUsIE5vbmUpLCAgIyBuby1vcDogdGhlIGRlc2sgaGFuZGxlcyB0aGlzOyBrZWVwIHF1aWV0Cl0KCiMgdGhlIGRlc2sncyBlbmdpbmUsIGluIGRpc3RpbGxlZCBQeXRob24gZm9ybSDigJQgb25lIGxpbmUgcGVyIHJ1bGUsIGFsbCBzYWZlOgpfSEVVUiA9IFsKICAgIChyIlxidGhlIHJlc3VsdHMgd2FzXGIiLCAidGhlIHJlc3VsdHMgd2VyZSIsICJBIHBsdXJhbCBzdWJqZWN0IHRha2VzIGEgcGx1cmFsIHZlcmIiLCAiZyIpLAogICAgKHIiXGJ0aGVzZSByZXN1bHRzIHNob3dzXGIiLCAidGhlc2UgcmVzdWx0cyBzaG93IiwgIlRoZSBwbHVyYWwgdmVyYiBzdGFuZHMiLCAiZyIpLAogICAgKHIiXGJpdHMgb3duXGIiLCBOb25lLCBOb25lLCBOb25lKSwKICAgIChyIlxidGhlIGRhdGEgc2hvd3NcYiIsICJ0aGUgZGF0YSBzaG93IiwgIuKAnERhdGHigJ0gdGFrZXMgdGhlIHBsdXJhbCBpbiBmb3JtYWwgd3JpdGluZyIsICJnIiksCiAgICAociJcYnRoZSBjcml0ZXJpYSBpc1xiIiwgInRoZSBjcml0ZXJpYSBhcmUiLCAiQ3JpdGVyaWEgaXMgcGx1cmFsIiwgImciKSwKICAgIChyIlxidGhlIHBoZW5vbWVuYSBpc1xiIiwgInRoZSBwaGVub21lbmEgYXJlIiwgIlBoZW5vbWVuYSBpcyBwbHVyYWwiLCAiZyIpLAogICAgKHIiXGJoYWQgd2VudFxiIiwgImhhZCBnb25lIiwgIlRoZSBwZXJmZWN0IHRha2VzIOKAnGdvbmXigJ0iLCAiZyIpLAogICAgKHIiXGIoPzpoYXN8aGF2ZSkgd2VudFxiIiwgImhhdmUgZ29uZSIsICJoYXZlIHdhbnRzIOKAnGdvbmXigJ0iLCAiZyIpLAogICAgKHIiXGJoYWQgZGlkXGIiLCAiaGFkIGRvbmUiLCAiVGhlIHBlcmZlY3QgdGFrZXMg4oCcZG9uZeKAnSIsICJnIiksCiAgICAociJcYig/Omhhc3xoYXZlKSBkaWRcYiIsICJoYXZlIGRvbmUiLCAiaGF2ZSB3YW50cyDigJxkb25l4oCdIiwgImciKSwKICAgIChyIlxiaGFkIHdyb3RlXGIiLCAiaGFkIHdyaXR0ZW4iLCAiVGhlIHBlcmZlY3QgdGFrZXMg4oCcd3JpdHRlbuKAnSIsICJnIiksCiAgICAociJcYig/Omhhc3xoYXZlKSB3cm90ZVxiIiwgImhhdmUgd3JpdHRlbiIsICJoYXZlIHdhbnRzIOKAnHdyaXR0ZW7igJ0iLCAiZyIpLAogICAgKHIiXGJoYWQgcmFuXGIiLCAiaGFkIHJ1biIsICJUaGUgcGVyZmVjdCB0YWtlcyDigJxydW7igJ0iLCAiZyIpLAogICAgKHIiXGIoPzpoYXN8aGF2ZSkgcmFuXGIiLCAiaGF2ZSBydW4iLCAiaGF2ZSB3YW50cyDigJxydW7igJ0iLCAiZyIpLAogICAgKHIiXGJoYWQgY2FtZSBiYWNrXGIiLCAiaGFkIGNvbWUgYmFjayIsICJUaGUgcGVyZmVjdCB0YWtlcyDigJxjb21l4oCdIiwgImciKSwKICAgIChyIlxiaGFkIGNhbWVcYiIsICJoYWQgY29tZSIsICJUaGUgcGVyZmVjdCB0YWtlcyDigJxjb21l4oCdIiwgImciKSwKICAgIChyIlxiKD86aGFzfGhhdmUpIGNhbWVcYiIsICJoYXZlIGNvbWUiLCAiaGF2ZSB3YW50cyDigJxjb21l4oCdIiwgImciKSwKICAgIChyIlxiaGFkIGJyb2tlXGIiLCAiaGFkIGJyb2tlbiIsICJUaGUgcGVyZmVjdCB0YWtlcyDigJxicm9rZW7igJ0iLCAiZyIpLAogICAgKHIiXGIoPzpoYXN8aGF2ZSkgYnJva2VcYiIsICJoYXZlIGJyb2tlbiIsICJoYXZlIHdhbnRzIOKAnGJyb2tlbuKAnSIsICJnIiksCiAgICAociJcYnNob3VsZCBvZlxiIiwgInNob3VsZCBoYXZlIiwgIuKAnHNob3VsZCBvZuKAnSBpcyDigJxzaG91bGQgaGF2ZeKAnSIsICJnIiksCiAgICAociJcYmNvdWxkIG9mXGIiLCAiY291bGQgaGF2ZSIsICLigJxjb3VsZCBvZuKAnSBpcyDigJxjb3VsZCBoYXZl4oCdIiwgImciKSwKICAgIChyIlxid291bGQgb2ZcYiIsICJ3b3VsZCBoYXZlIiwgIuKAnHdvdWxkIG9m4oCdIGlzIOKAnHdvdWxkIGhhdmXigJ0iLCAiZyIpLAogICAgKHIiXGJjYW4gbm90XGIiLCAiY2Fubm90IiwgIuKAnGNhbm5vdOKAnSBpcyBvbmUgd29yZCIsICJnIiksCiAgICAociJcYmFsb3RcYiIsICJhIGxvdCIsICJPbmUgd29yZCBhcGFydCIsICJnIiksCiAgICAociJcYnJlY2lldmVcYiIsICJyZWNlaXZlIiwgIlRoZSBpIGdvZXMgYmVmb3JlIHRoZSBlLCBleGNlcHQgYWZ0ZXIgYyIsICJnIiksCiAgICAociJcYmRlZmluYXRlbHlcYiIsICJkZWZpbml0ZWx5IiwgIlRoZSBzcGVsbGluZyBpcyBkZWZpbml0ZWx5IiwgImciKSwKICAgIChyIlxic2VwZXJhdGVcYiIsICJzZXBhcmF0ZSIsICJUaGUgbWlkZGxlIGtlZXBzIGl0cyBlIiwgImciKSwKICAgIChyIlxib2NjdXJlbmNlXGIiLCAib2NjdXJyZW5jZSIsICJUd28gcidzLCB0d28gYydzIiwgImciKSwKICAgIChyIlxibmVjY2Vzc2FyeVxiIiwgIm5lY2Vzc2FyeSIsICJPbmUgYywgdHdvIHMncyIsICJnIiksCiAgICAociJcYmV4aXN0YW50XGIiLCAiZXhpc3RlbnQiLCAiVGhlIGkgaXMgdGhlIHN0ZW0iLCAiZyIpLAogICAgKHIiXGJpbmRlcGVuZGFudFxiIiwgImluZGVwZW5kZW50IiwgIuKAnGVudOKAnSBpcyB0aGUgZW5kaW5nIiwgImciKSwKICAgIChyIlxicGVyIHNheVxiIiwgInBlciBzZSIsICJUaGUgTGF0aW4gaXMg4oCccGVyIHNl4oCdIiwgImciKSwKICAgIChyIlxidmljZSBhIHZlcnNhXGIiLCAidmljZSB2ZXJzYSIsICJJdCBpcyDigJx2aWNlIHZlcnNh4oCdIiwgImciKSwKICAgIChyIlxib24gYWNjaWRlbnRcYiIsICJieSBhY2NpZGVudCIsICLigJxCeSBhY2NpZGVudOKAnSBpcyB0aGUgaWRpb20iLCAiZyIpLAogICAgKHIiXGJiYXNlZCBvZmZcYiIsICJiYXNlZCBvbiIsICJHcm91bmRlZCDigJxvbuKAnSIsICJnIiksCiAgICAociJcYmlzIGJpYXNcYiIsICJpcyBiaWFzZWQiLCAi4oCcQmlhc+KAnSBpcyB0aGUgbm91biIsICJnIiksCiAgICAociJcYmhhZCBjYW1lIGJhY2tcYiIsIE5vbmUsIE5vbmUsIE5vbmUpLAogICAgKHIiXGJvdmVyIChcZFtcZCxdKikgKHBlb3BsZXxzdHVkZW50c3xwYXJ0aWNpcGFudHMpXGIiLCBOb25lLCAiQ291bnRzIGluIGZvcm1hbCB3b3JrIHRha2Ug4oCcbW9yZSB0aGFu4oCdLCBub3Qg4oCcb3ZlcuKAnSIsICJjIiksCiAgICAociJcYnRoZSBtZWRpYSBpc1xiIiwgTm9uZSwgIuKAnE1lZGlh4oCdIGlzIHBsdXJhbDsgdGhlIHNpbmd1bGFyIGlzIG1lZGl1bSIsICJzIiksCiAgICAociJcYml0IGdvZXMgd2l0aG91dCBzYXlpbmdcYiIsIE5vbmUsICJJZiBpdCBnb2VzIHdpdGhvdXQgc2F5aW5nLCB0aGUgc2VudGVuY2UgY2FuIGNhcnJ5IGl0c2VsZiIsICJzIiksCiAgICAociJcYm5lZWRsZXNzIHRvIHNheSw/XGIiLCBOb25lLCAi4oCcTmVlZGxlc3MgdG8gc2F54oCdIGFubm91bmNlcyBhIHJlZHVuZGFuY3kiLCAicyIpLAogICAgKHIiXGJpbiB0b2RheSdzIHNvY2lldHlcYiIsIE5vbmUsICLigJxJbiB0b2RheSdzIHNvY2lldHnigJ0g4oCUIHdoaWNoIHNvY2lldHk/IiwgInMiKSwKICAgIChyIlxiYSBwbGV0aG9yYSBvZlxiIiwgTm9uZSwgIuKAnEEgcGxldGhvcmEgb2bigJ0gaXMgb3ZlcndvcmtlZDsgc2F5IGhvdyBtYW55IiwgInMiKSwKICAgIChyIlxibW9zdCBzY2hvbGFycyBhZ3JlZVxiIiwgTm9uZSwgIkNvbnNlbnN1cyB3YW50cyBuYW1lcyIsICJzIiksCiAgICAociJcYnRoZSBleGFjdCBzYW1lXGIiLCAidGhlIHNhbWUiLCAiVGhlIHNhbWUgaXMgZXhhY3QgYnkgaXRzZWxmIiwgImMiKSwKICAgIChyIlxicGFzdCBoaXN0b3J5XGIiLCAiaGlzdG9yeSIsICJIaXN0b3J5IGlzIGFscmVhZHkgcGFzdCIsICJjIiksCiAgICAociJcYmZ1dHVyZSBwbGFuc1xiIiwgInBsYW5zIiwgIlBsYW5zIGFyZSBhbHJlYWR5IGZ1dHVyZSIsICJjIiksCiAgICAociJcYmNsb3NlIHByb3hpbWl0eVxiIiwgInByb3hpbWl0eSIsICJQcm94aW1pdHkgaXMgYWxyZWFkeSBjbG9zZSIsICJjIiksCl0KIyBjbGVhbiBvdXQgdGhlIG5vLW9wIHBsYWNlaG9sZGVycyBkZWxpYmVyYXRlbHkKX0hFVVIgPSBbciBmb3IgciBpbiBfSEVVUiBpZiByWzBdIGlzIG5vdCBOb25lIGFuZCByWzFdIGlzIG5vdCBOb25lXQoKX0hFVVIuZXh0ZW5kKFsKICAgIChyIlxidGhlIG1lZGlhIGlzXGIiLCBOb25lLCAi4oCcTWVkaWHigJ0gaXMgcGx1cmFsOyB0aGUgc2luZ3VsYXIgaXMgbWVkaXVtIiwgInMiKSwKICAgIChyIlxiaXQgZ29lcyB3aXRob3V0IHNheWluZ1xiIiwgTm9uZSwgIklmIGl0IGdvZXMgd2l0aG91dCBzYXlpbmcsIHRoZSBzZW50ZW5jZSBjYW4gY2FycnkgaXRzZWxmIiwgInMiKSwKICAgIChyIlxibmVlZGxlc3MgdG8gc2F5LD9cYiIsIE5vbmUsICLigJxOZWVkbGVzcyB0byBzYXnigJ0gYW5ub3VuY2VzIGEgcmVkdW5kYW5jeSIsICJzIiksCiAgICAociJcYmluIHRvZGF5J3Mgc29jaWV0eVxiIiwgTm9uZSwgIuKAnEluIHRvZGF5J3Mgc29jaWV0eeKAnSDigJQgd2hpY2ggc29jaWV0eT8iLCAicyIpLAogICAgKHIiXGJhIHBsZXRob3JhIG9mXGIiLCBOb25lLCAi4oCcQSBwbGV0aG9yYSBvZuKAnSBpcyBvdmVyd29ya2VkOyBzYXkgaG93IG1hbnkiLCAicyIpLAogICAgKHIiXGJtb3N0IHNjaG9sYXJzIGFncmVlXGIiLCBOb25lLCAiQ29uc2Vuc3VzIHdhbnRzIG5hbWVzIiwgInMiKSwKICAgIChyIlxidGhlIGV4YWN0IHNhbWVcYiIsICJ0aGUgc2FtZSIsICJUaGUgc2FtZSBpcyBleGFjdCBieSBpdHNlbGYiLCAiYyIpLAogICAgKHIiXGJwYXN0IGhpc3RvcnlcYiIsICJoaXN0b3J5IiwgIkhpc3RvcnkgaXMgYWxyZWFkeSBwYXN0IiwgImMiKSwKICAgIChyIlxiZnV0dXJlIHBsYW5zXGIiLCAicGxhbnMiLCAiUGxhbnMgYXJlIGFscmVhZHkgZnV0dXJlIiwgImMiKSwKICAgIChyIlxiY2xvc2UgcHJveGltaXR5XGIiLCBOb25lLCAiUHJveGltaXR5IGlzIGFscmVhZHkgY2xvc2UiLCAiYyIpLAogICAgIyAtLS0gd29yZCBjb25mdXNpb25zIChhY2FkZW1pYykgLS0tCiAgICAociJcYnRoZWlyIGlzXGIiLCAidGhlcmUgaXMiLCAi4oCcVGhlcmUgaXPigJ0gZm9yIGV4aXN0ZW5jZTsg4oCcdGhlaXLigJ0gaXMgcG9zc2Vzc2l2ZSIsICJnIiksCiAgICAociJcYnRoZWlyIGFyZVxiIiwgInRoZXJlIGFyZSIsICLigJxUaGVyZSBhcmXigJ0gZm9yIGV4aXN0ZW5jZTsg4oCcdGhlaXLigJ0gaXMgcG9zc2Vzc2l2ZSIsICJnIiksCiAgICAociJcYnRoZXlyZVxiIiwgInRoZXkncmUiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxieW91ciB3ZWxjb21lXGIiLCAieW91J3JlIHdlbGNvbWUiLCAi4oCcWW91J3Jl4oCdIGlzIHRoZSBjb250cmFjdGlvbiBvZiDigJx5b3UgYXJl4oCdIiwgImciKSwKICAgIChyIlxieW91ciByaWdodFxiIiwgInlvdSdyZSByaWdodCIsICLigJxZb3UncmXigJ0gaXMgdGhlIGNvbnRyYWN0aW9uIG9mIOKAnHlvdSBhcmXigJ0iLCAiZyIpLAogICAgKHIiXGJ5b3VyIHdyb25nXGIiLCAieW91J3JlIHdyb25nIiwgIuKAnFlvdSdyZeKAnSBpcyB0aGUgY29udHJhY3Rpb24gb2Yg4oCceW91IGFyZeKAnSIsICJnIiksCiAgICAociJcYml0cyBhXGIiLCAiaXQncyBhIiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiBvZiDigJxpdCBpc+KAnSIsICJnIiksCiAgICAociJcYml0cyBhblxiIiwgIml0J3MgYW4iLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIG9mIOKAnGl0IGlz4oCdIiwgImciKSwKICAgIChyIlxid2hvc1xiIiwgIndobydzIiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYndlcmVudFxiIiwgIndlcmVuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxiZG9udFxiIiwgImRvbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYmRvZXNudFxiIiwgImRvZXNuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxiZGlkbnRcYiIsICJkaWRuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxiaXNudFxiIiwgImlzbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYndhc250XGIiLCAid2Fzbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYmFyZW4ndFxiIiwgImFyZW4ndCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJ3ZXJlbid0XGIiLCAid2VyZW4ndCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJjYW50XGIiLCAiY2FuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxid29udFxiIiwgIndvbid0IiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbiIsICJnIiksCiAgICAociJcYndvdWxkbnRcYiIsICJ3b3VsZG4ndCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb24iLCAiZyIpLAogICAgKHIiXGJjb3VsZG50XGIiLCAiY291bGRuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxic2hvdWxkbnRcYiIsICJzaG91bGRuJ3QiLCAiVGhlIGFwb3N0cm9waGUgbWFya3MgdGhlIGNvbnRyYWN0aW9uIiwgImciKSwKICAgIChyIlxiaXZlXGIiLCAiSSd2ZSIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb247IHRoZSBwcm9ub3VuIGlzIGNhcGl0YWwiLCAiZyIpLAogICAgKHIiXGJpbVxiIiwgIkknbSIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb247IHRoZSBwcm9ub3VuIGlzIGNhcGl0YWwiLCAiZyIpLAogICAgKHIiXGJpZFxiIiwgIkknZCIsICJUaGUgYXBvc3Ryb3BoZSBtYXJrcyB0aGUgY29udHJhY3Rpb247IHRoZSBwcm9ub3VuIGlzIGNhcGl0YWwiLCAiZyIpLAogICAgKHIiXGJpbGxcYiIsICJJJ2xsIiwgIlRoZSBhcG9zdHJvcGhlIG1hcmtzIHRoZSBjb250cmFjdGlvbjsgdGhlIHByb25vdW4gaXMgY2FwaXRhbCIsICJnIiksCiAgICAjIC0tLSBjb25mdXNpb25zIHRoYXQgYSBkb2N0b3JhbCBleGFtaW5lciBmbGFncyAtLS0KICAgIChyIlxiY29tcGxpbWVudGFyeVxiKD89XHMrKD86YmVlcnx0ZWF8Y29mZmVlfHRpY2tldHxzZXJ2aWNlKSkiLCAiY29tcGxpbWVudGFyeSIsICLigJxDb21wbGltZW50YXJ54oCdIG1lYW5zIGZyZWU7IOKAnGNvbXBsZW1lbnRhcnnigJ0gbWVhbnMgY29tcGxldGluZyIsICJjIiksCiAgICAociJcYnByaW5jaXBsZSBpbnZlc3RpZ2F0b3JcYiIsICJwcmluY2lwYWwgaW52ZXN0aWdhdG9yIiwgIuKAnFByaW5jaXBhbOKAnSBpcyB0aGUgYWRqZWN0aXZlOyDigJxwcmluY2lwbGXigJ0gaXMgdGhlIG5vdW4iLCAiYyIpLAogICAgKHIiXGJwcmluY2lwbGUgcmVzZWFyY2hlclxiIiwgInByaW5jaXBhbCByZXNlYXJjaGVyIiwgIuKAnFByaW5jaXBhbOKAnSBpcyB0aGUgYWRqZWN0aXZlOyDigJxwcmluY2lwbGXigJ0gaXMgdGhlIG5vdW4iLCAiYyIpLAogICAgKHIiXGJwcmluY2lwbGUgYXV0aG9yXGIiLCAicHJpbmNpcGFsIGF1dGhvciIsICLigJxQcmluY2lwYWzigJ0gaXMgdGhlIGFkamVjdGl2ZTsg4oCccHJpbmNpcGxl4oCdIGlzIHRoZSBub3VuIiwgImMiKSwKICAgIChyIlxicHJpbmNpcGxlIGZpbmRpbmdcYiIsICJwcmluY2lwYWwgZmluZGluZyIsICLigJxQcmluY2lwYWzigJ0gaXMgdGhlIGFkamVjdGl2ZTsg4oCccHJpbmNpcGxl4oCdIGlzIHRoZSBub3VuIiwgImMiKSwKICAgIChyIlxicHJpbmNpcGxlIGFyZ3VtZW50XGIiLCAicHJpbmNpcGFsIGFyZ3VtZW50IiwgIuKAnFByaW5jaXBhbOKAnSBpcyB0aGUgYWRqZWN0aXZlOyDigJxwcmluY2lwbGXigJ0gaXMgdGhlIG5vdW4iLCAiYyIpLAogICAgKHIiXGJwcmluY2lwbGUgcmVhc29uXGIiLCAicHJpbmNpcGFsIHJlYXNvbiIsICLigJxQcmluY2lwYWzigJ0gaXMgdGhlIGFkamVjdGl2ZTsg4oCccHJpbmNpcGxl4oCdIGlzIHRoZSBub3VuIiwgImMiKSwKICAgIChyIlxicHJpbmNpcGxlIGNvbmNlcm5cYiIsICJwcmluY2lwYWwgY29uY2VybiIsICLigJxQcmluY2lwYWzigJ0gaXMgdGhlIGFkamVjdGl2ZTsg4oCccHJpbmNpcGxl4oCdIGlzIHRoZSBub3VuIiwgImMiKSwKICAgIChyIlxiYWZmZWN0XGIoPz1ccysoPzpvblxzfG9mKSkiLCAiZWZmZWN0IiwgIuKAnEVmZmVjdCBvbuKAnSBpcyB0aGUgbm91biBwaHJhc2U7IOKAnGFmZmVjdOKAnSBpcyB0aGUgdmVyYiIsICJjIiksCiAgICAociJcYmxvb3NlXGIoPz1ccysoPzp0cmFja3xtb25leXx3ZWlnaHR8Zm9jdXN8c2lnaHQpKSIsICJsb3NlIiwgIuKAnExvc2XigJ0gaXMgdGhlIHZlcmI7IOKAnGxvb3Nl4oCdIG1lYW5zIG5vdCB0aWdodCIsICJjIiksCiAgICAociJcYnN0YXRpb25hcnlcYig/PVxzKyg/OnBoYXNlfGZyb250fHdhdmV8b3JiaXR8cG9pbnQpKSIsICJzdGF0aW9uYXJ5IiwgIkNvbmZpcm1lZCBjb3JyZWN0IHVzYWdlIG9mIOKAnHN0YXRpb25hcnnigJ0iLCBOb25lKSwKICAgIChyIlxic3RhdGlvbmFyeVxiIiwgTm9uZSwgIkNoZWNrOiDigJxzdGF0aW9uYXJ54oCdIG1lYW5zIG5vdCBtb3Zpbmc7IOKAnHN0YXRpb25lcnnigJ0gbWVhbnMgd3JpdGluZyBtYXRlcmlhbHMiLCAiYyIpLAogICAgKHIiXGJjb3VuY2lsXGIoPz1ccysoPzptZW1iZXJ8bWVldGluZ3x2b3RlfGNoYW1iZXJ8c2VhdCkpIiwgImNvdW5jaWwiLCBOb25lLCBOb25lKSwKICAgIChyIlxiY29tcHJpc2VkIG9mXGIiLCAiY29tcG9zZWQgb2YiLCAiVGhlIHdob2xlIGNvbXByaXNlcyB0aGUgcGFydHM7IHRoZSBwYXJ0cyBjb21wb3NlIHRoZSB3aG9sZSIsICJjIiksCiAgICAociJcYmxlc3NcYig/PVxzKyg/OnBlb3BsZXxzdHVkZW50c3xwYXJ0aWNpcGFudHN8c3ViamVjdHN8aXRlbXN8Y2FzZXN8c3R1ZGllc3xwYXBlcnMpKSIsICJmZXdlciIsICJDb3VudCBub3VucyB0YWtlIOKAnGZld2Vy4oCdOyBtYXNzIG5vdW5zIHRha2Ug4oCcbGVzc+KAnSIsICJnIiksCiAgICAociJcYmFtb3VudCBvZiAoPzpwZW9wbGV8c3R1ZGVudHN8cGFydGljaXBhbnRzfHN1YmplY3RzfGl0ZW1zfGNhc2VzfHN0dWRpZXN8cGFwZXJzKVxiIiwgIm51bWJlciBvZiIsICJDb3VudGFibGUgbm91bnMgdGFrZSDigJxudW1iZXIgb2bigJ0sIG5vdCDigJxhbW91bnQgb2bigJ0iLCAiZyIpLAogICAgKHIiXGJiZXR3ZWVuXHMrKFx3KylccythbmRccytJXGIiLCByImJldHdlZW4gXDEgYW5kIG1lIiwgIkFmdGVyIGEgcHJlcG9zaXRpb24sIHRoZSBwcm9ub3VuIGlzIOKAnG1l4oCdLCBub3Qg4oCcSeKAnSIsICJnIiksCiAgICAociJcYmZvclxzK3lvdVxzK2FuZFxzK0lcYiIsICJmb3IgeW91IGFuZCBtZSIsICJBZnRlciBhIHByZXBvc2l0aW9uLCB0aGUgcHJvbm91biBpcyDigJxtZeKAnSwgbm90IOKAnEnigJ0iLCAiZyIpLAogICAgKHIiXGJ0b1xzK3lvdVxzK2FuZFxzK0lcYiIsICJ0byB5b3UgYW5kIG1lIiwgIkFmdGVyIGEgcHJlcG9zaXRpb24sIHRoZSBwcm9ub3VuIGlzIOKAnG1l4oCdLCBub3Qg4oCcSeKAnSIsICJnIiksCiAgICAociJcYndpdGhccyt5b3VccythbmRccytJXGIiLCAid2l0aCB5b3UgYW5kIG1lIiwgIkFmdGVyIGEgcHJlcG9zaXRpb24sIHRoZSBwcm9ub3VuIGlzIOKAnG1l4oCdLCBub3Qg4oCcSeKAnSIsICJnIiksCiAgICAjIC0tLSBtb3JlIHNwZWxsaW5nIC0tLQogICAgKHIiXGJhY2NvbW9kYXRlXGIiLCAiYWNjb21tb2RhdGUiLCAiVHdvIGMncywgdHdvIG0ncyIsICJnIiksCiAgICAociJcYm9jY2Fzc2lvblxiIiwgIm9jY2FzaW9uIiwgIlR3byBjJ3MsIG9uZSBzIiwgImciKSwKICAgIChyIlxib2NjdXJlZFxiIiwgIm9jY3VycmVkIiwgIlR3byByJ3MiLCAiZyIpLAogICAgKHIiXGJvY2N1cmluZ1xiIiwgIm9jY3VycmluZyIsICJUd28gcidzIiwgImciKSwKICAgIChyIlxicmVmZmVyZWRcYiIsICJyZWZlcnJlZCIsICJUd28gcidzIiwgImciKSwKICAgIChyIlxicmVmZXJpbmdcYiIsICJyZWZlcnJpbmciLCAiVHdvIHIncyIsICJnIiksCiAgICAociJcYnRyYW5mZXJyZWRcYiIsICJ0cmFuc2ZlcnJlZCIsICJUd28gcidzIiwgImciKSwKICAgIChyIlxidHJhbmZlcmluZ1xiIiwgInRyYW5zZmVycmluZyIsICJUd28gcidzIiwgImciKSwKICAgIChyIlxicHJlZmVyZWRcYiIsICJwcmVmZXJyZWQiLCAiVHdvIHIncyIsICJnIiksCiAgICAociJcYnByZWZlcmluZ1xiIiwgInByZWZlcnJpbmciLCAiVHdvIHIncyIsICJnIiksCiAgICAociJcYnRhcmdldHRlZFxiIiwgInRhcmdldGVkIiwgIk9uZSB0IGlzIGVub3VnaCIsICJnIiksCiAgICAociJcYnRhcmdldHRpbmdcYiIsICJ0YXJnZXRpbmciLCAiT25lIHQgaXMgZW5vdWdoIiwgImciKSwKICAgIChyIlxiYmVuZWZpdHRlZFxiIiwgImJlbmVmaXRlZCIsICJPbmUgdCBpcyBzdGFuZGFyZCIsICJnIiksCiAgICAociJcYmJlbmVmaXR0aW5nXGIiLCAiYmVuZWZpdGluZyIsICJPbmUgdCBpcyBzdGFuZGFyZCIsICJnIiksCiAgICAociJcYmZvY3Vzc2VkXGIiLCAiZm9jdXNlZCIsICJPbmUgcyBpcyBzdGFuZGFyZCIsICJnIiksCiAgICAociJcYmZvY3Vzc2luZ1xiIiwgImZvY3VzaW5nIiwgIk9uZSBzIGlzIHN0YW5kYXJkIiwgImciKSwKICAgIChyIlxiYXJndW1lbnRhdGl2ZVxiIiwgImFyZ3VtZW50YXRpdmUiLCBOb25lLCBOb25lKSwKICAgIChyIlxiYXJndWVtZW50XGIiLCAiYXJndW1lbnQiLCAiTm8gZSBhZnRlciB1IiwgImciKSwKICAgIChyIlxiZWdcYig/PVssO10pIiwgImUuZy4iLCAiVGhlIGFiYnJldmlhdGlvbiB0YWtlcyB0d28gZG90cyIsICJnIiksCiAgICAociJcYmllXGIoPz1bLDtdKSIsICJpLmUuIiwgIlRoZSBhYmJyZXZpYXRpb24gdGFrZXMgdHdvIGRvdHMiLCAiZyIpLAogICAgKHIiXGJldGNcYig/PVssLjtdKSIsICJldGMuIiwgIlRoZSBhYmJyZXZpYXRpb24gdGFrZXMgYSBkb3QiLCAiZyIpLAogICAgKHIiXGJ0ZWhcYiIsICJ0aGUiLCAiVHJhbnNwb3NlZCBsZXR0ZXJzIiwgImciKSwKICAgIChyIlxidGhpZXJcYiIsICJ0aGVpciIsICJUcmFuc3Bvc2VkIGxldHRlcnMiLCAiZyIpLAogICAgKHIiXGJyZWNpZXZlclxiIiwgInJlY2VpdmVyIiwgIkkgYmVmb3JlIGUsIGV4Y2VwdCBhZnRlciBjIiwgImciKSwKICAgIChyIlxicmVjaWVwdFxiIiwgInJlY2VpcHQiLCAiSSBiZWZvcmUgZSwgZXhjZXB0IGFmdGVyIGMiLCAiZyIpLAogICAgKHIiXGJjb25jaWV2ZVxiIiwgImNvbmNlaXZlIiwgIkkgYmVmb3JlIGUsIGV4Y2VwdCBhZnRlciBjIiwgImciKSwKICAgIChyIlxiZGVjaWV2ZVxiIiwgImRlY2VpdmUiLCAiSSBiZWZvcmUgZSwgZXhjZXB0IGFmdGVyIGMiLCAiZyIpLAogICAgKHIiXGJwZXJjaWV2ZVxiIiwgInBlcmNlaXZlIiwgIkkgYmVmb3JlIGUsIGV4Y2VwdCBhZnRlciBjIiwgImciKSwKICAgIChyIlxiYWNoZWl2ZVxiIiwgImFjaGlldmUiLCAiSSBiZWZvcmUgZSwgZXhjZXB0IGFmdGVyIGMiLCAiZyIpLAogICAgKHIiXGJjYWxlbmRlclxiIiwgImNhbGVuZGFyIiwgIlRoZSBzcGVsbGluZyBpcyDigJxjYWxlbmRhcuKAnSIsICJnIiksCiAgICAociJcYmNhdGFnb3J5XGIiLCAiY2F0ZWdvcnkiLCAiVGhlIHNwZWxsaW5nIGlzIOKAnGNhdGVnb3J54oCdIiwgImciKSwKICAgIChyIlxiZW52aXJvbWVudFxiIiwgImVudmlyb25tZW50IiwgIlRoZSBuIGlzIHByZXNlbnQiLCAiZyIpLAogICAgKHIiXGJnb3Zlcm1lbnRcYiIsICJnb3Zlcm5tZW50IiwgIlRoZSBuIGlzIHByZXNlbnQiLCAiZyIpLAogICAgKHIiXGJrbm93bGVnZVxiIiwgImtub3dsZWRnZSIsICJUaGUgZCBpcyBwcmVzZW50IiwgImciKSwKICAgIChyIlxicHVibGljYWxseVxiIiwgInB1YmxpY2x5IiwgIlRoZSBzcGVsbGluZyBpcyDigJxwdWJsaWNseeKAnSIsICJnIiksCiAgICAociJcYnN1cHJpc2VcYiIsICJzdXJwcmlzZSIsICJUd28gcidzLCBvbmUgcyIsICJnIiksCiAgICAociJcYnN1cHJpc2VkXGIiLCAic3VycHJpc2VkIiwgIlR3byByJ3MsIG9uZSBzIiwgImciKSwKICAgIChyIlxicHJpdmlsZWRnZVxiIiwgInByaXZpbGVnZSIsICJObyBkIGluIOKAnHByaXZpbGVnZeKAnSIsICJnIiksCiAgICAociJcYnJ5dGhtXGIiLCAicmh5dGhtIiwgIlRoZSBzcGVsbGluZyBpcyDigJxyaHl0aG3igJ0iLCAiZyIpLAogICAgKHIiXGJzeWxsYWJ1cydcYiIsICJzeWxsYWJ1cydzIiwgIlNpbmd1bGFyIHBvc3Nlc3NpdmUgdGFrZXMgJ3MiLCAiZyIpLAogICAgKHIiXGJhbmFseXNpcydcYiIsICJhbmFseXNpcydzIiwgIlNpbmd1bGFyIHBvc3Nlc3NpdmUgdGFrZXMgJ3MiLCAiZyIpLAogICAgKHIiXGJjcmlzaXMnXGIiLCAiY3Jpc2lzJ3MiLCAiU2luZ3VsYXIgcG9zc2Vzc2l2ZSB0YWtlcyAncyIsICJnIiksCiAgICAjIC0tLSBzdHlsZTogd29yZHkgYWNhZGVtaWMgcGhyYXNlcyAtLS0KICAgIChyIlxiZHVlIHRvIHRoZSBmYWN0IHRoYXRcYiIsICJiZWNhdXNlIiwgIuKAnEJlY2F1c2XigJ0gaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJzIiksCiAgICAociJcYmluIHNwaXRlIG9mIHRoZSBmYWN0IHRoYXRcYiIsICJhbHRob3VnaCIsICLigJxBbHRob3VnaOKAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiaW4gdGhlIGV2ZW50IHRoYXRcYiIsICJpZiIsICLigJxJZuKAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiYXQgdGhpcyBwb2ludCBpbiB0aW1lXGIiLCAibm93IiwgIuKAnE5vd+KAnSBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgInMiKSwKICAgIChyIlxiYXQgdGhhdCBwb2ludCBpbiB0aW1lXGIiLCAidGhlbiIsICLigJxUaGVu4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJmb3IgdGhlIHB1cnBvc2Ugb2ZcYiIsICJmb3IiLCAi4oCcRm9y4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJpbiB0aGUgcHJvY2VzcyBvZlxiIiwgTm9uZSwgIuKAnEluIHRoZSBwcm9jZXNzIG9m4oCdIGlzIHdvcmR5OyB0aGUgdmVyYiBhbG9uZSBpcyBzdHJvbmdlciIsICJzIiksCiAgICAociJcYmlzIGFibGUgdG9cYiIsICJjYW4iLCAi4oCcQ2Fu4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJhcmUgYWJsZSB0b1xiIiwgImNhbiIsICLigJxDYW7igJ0gaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJzIiksCiAgICAociJcYndhcyBhYmxlIHRvXGIiLCAiY291bGQiLCAi4oCcQ291bGTigJ0gaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJzIiksCiAgICAociJcYndlcmUgYWJsZSB0b1xiIiwgImNvdWxkIiwgIuKAnENvdWxk4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJpbiBvcmRlciB0b1xiIiwgInRvIiwgIuKAnFRv4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJpbiBvcmRlciBmb3JcYiIsICJmb3IiLCAi4oCcRm9y4oCdIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAicyIpLAogICAgKHIiXGJ0aGUgcmVhc29uIHdoeVxiIiwgInRoZSByZWFzb24iLCAi4oCcV2h54oCdIGlzIHJlZHVuZGFudCBhZnRlciDigJxyZWFzb27igJ0iLCAiYyIpLAogICAgKHIiXGJiYXNpYyg/OmFsbHkpP1xzK2Z1bmRhbWVudGFsXGIiLCAiZnVuZGFtZW50YWwiLCAi4oCcQmFzaWMgZnVuZGFtZW50YWxseeKAnSBpcyBkb3VibHkgcmVkdW5kYW50IiwgImMiKSwKICAgIChyIlxiY29tcGxldGVseVxzK2VsaW1pbmF0ZVxiIiwgImVsaW1pbmF0ZSIsICJFbGltaW5hdGlvbiBpcyBhbHJlYWR5IGNvbXBsZXRlIiwgImMiKSwKICAgIChyIlxiY29tcGxldGVseVxzK2VyYWRpY2F0ZVxiIiwgImVyYWRpY2F0ZSIsICJFcmFkaWNhdGlvbiBpcyBhbHJlYWR5IGNvbXBsZXRlIiwgImMiKSwKICAgIChyIlxibmV3XHMraW5ub3ZhdGlvblxiIiwgImlubm92YXRpb24iLCAiSW5ub3ZhdGlvbiBpcyBhbHJlYWR5IG5ldyIsICJjIiksCiAgICAociJcYnVuZXhwZWN0ZWRccytzdXJwcmlzZVxiIiwgInN1cnByaXNlIiwgIkEgc3VycHJpc2UgaXMgYWxyZWFkeSB1bmV4cGVjdGVkIiwgImMiKSwKICAgIChyIlxidW5pbnRlbmRlZFxzK21pc3Rha2VcYiIsICJtaXN0YWtlIiwgIkEgbWlzdGFrZSBpcyBhbHJlYWR5IHVuaW50ZW5kZWQiLCAiYyIpLAogICAgKHIiXGJmcmVlXHMrZ2lmdFxiIiwgImdpZnQiLCAiQSBnaWZ0IGlzIGFscmVhZHkgZnJlZSIsICJjIiksCiAgICAociJcYmVuZFxzK3Jlc3VsdFxiIiwgInJlc3VsdCIsICJBIHJlc3VsdCBpcyBhbHJlYWR5IGFuIGVuZCIsICJjIiksCiAgICAociJcYmZpbmFsXHMrb3V0Y29tZVxiIiwgIm91dGNvbWUiLCAiQW4gb3V0Y29tZSBpcyBhbHJlYWR5IGZpbmFsIiwgImMiKSwKICAgIChyIlxiYWJzb2x1dGVseVxzK2Vzc2VudGlhbFxiIiwgImVzc2VudGlhbCIsICJFc3NlbnRpYWwgaXMgYWxyZWFkeSBhYnNvbHV0ZSIsICJjIiksCiAgICAociJcYmFic29sdXRlbHlccytuZWNlc3NhcnlcYiIsICJuZWNlc3NhcnkiLCAiTmVjZXNzYXJ5IGlzIGFscmVhZHkgYWJzb2x1dGUiLCAiYyIpLAogICAgKHIiXGJjb21wbGV0ZWx5XHMrZGVzdHJveWVkXGIiLCAiZGVzdHJveWVkIiwgIkRlc3RydWN0aW9uIGlzIGFscmVhZHkgY29tcGxldGUiLCAiYyIpLAogICAgKHIiXGJ0b3RhbGx5XHMrZGVzdHJveWVkXGIiLCAiZGVzdHJveWVkIiwgIkRlc3RydWN0aW9uIGlzIGFscmVhZHkgdG90YWwiLCAiYyIpLAogICAgKHIiXGJ2ZXJ5XHMrdW5pcXVlXGIiLCAidW5pcXVlIiwgIlVuaXF1ZSBhZG1pdHMgbm8gZGVncmVlcyIsICJjIiksCiAgICAociJcYm1vc3Rccyt1bmlxdWVcYiIsICJ1bmlxdWUiLCAiVW5pcXVlIGFkbWl0cyBubyBkZWdyZWVzIiwgImMiKSwKICAgIChyIlxicXVpdGVccyt1bmlxdWVcYiIsICJ1bmlxdWUiLCAiVW5pcXVlIGFkbWl0cyBubyBkZWdyZWVzIiwgImMiKSwKICAgIChyIlxicmF0aGVyXHMrdW5pcXVlXGIiLCAidW5pcXVlIiwgIlVuaXF1ZSBhZG1pdHMgbm8gZGVncmVlcyIsICJjIiksCiAgICAociJcYnNvbWV3aGF0XHMrdW5pcXVlXGIiLCAidW5pcXVlIiwgIlVuaXF1ZSBhZG1pdHMgbm8gZGVncmVlcyIsICJjIiksCiAgICAociJcYnBlcmlvZCBvZiB0aW1lXGIiLCAicGVyaW9kIiwgIkEgcGVyaW9kIGlzIGFscmVhZHkgYSBzcGFuIG9mIHRpbWUiLCAiYyIpLAogICAgKHIiXGJsZW5ndGggb2YgdGltZVxiIiwgTm9uZSwgIuKAnExlbmd0aCBvZiB0aW1l4oCdIGlzIHdvcmR5OyDigJx0aW1l4oCdIG9yIOKAnGR1cmF0aW9u4oCdIGlzIHNob3J0ZXIiLCAicyIpLAogICAgKHIiXGJzbWFsbCBpbiBzaXplXGIiLCAic21hbGwiLCAiU2l6ZSBpcyBpbXBsaWNpdCBpbiDigJxzbWFsbOKAnSIsICJjIiksCiAgICAociJcYmxhcmdlIGluIHNpemVcYiIsICJsYXJnZSIsICJTaXplIGlzIGltcGxpY2l0IGluIOKAnGxhcmdl4oCdIiwgImMiKSwKICAgIChyIlxicm91bmQgaW4gc2hhcGVcYiIsICJyb3VuZCIsICJTaGFwZSBpcyBpbXBsaWNpdCBpbiDigJxyb3VuZOKAnSIsICJjIiksCiAgICAociJcYnNob3J0IGluIGR1cmF0aW9uXGIiLCAic2hvcnQiLCAiRHVyYXRpb24gaXMgaW1wbGljaXQgaW4g4oCcc2hvcnTigJ0iLCAiYyIpLAogICAgIyAtLS0gc3ViamVjdC12ZXJiIGFncmVlbWVudCAoZXhwYW5kZWQpIC0tLQogICAgKHIiXGJlYWNoIG9mIHRoZSAoPzpcdyspIGFyZVxiIiwgciJlYWNoIG9mIHRoZSBcZzwwPiBpcyIsICLigJxFYWNo4oCdIHRha2VzIGEgc2luZ3VsYXIgdmVyYiIsICJnIiksCiAgICAociJcYmV2ZXJ5IG9uZSBvZiB0aGUgKD86XHcrKSBhcmVcYiIsIHIiZXZlcnkgb25lIG9mIHRoZSBcZzwwPiBpcyIsICLigJxFdmVyeSBvbmXigJ0gdGFrZXMgYSBzaW5ndWxhciB2ZXJiIiwgImciKSwKICAgIChyIlxibmVpdGhlciBvZiB0aGUgKD86XHcrKSBhcmVcYiIsIHIibmVpdGhlciBvZiB0aGUgXGc8MD4gaXMiLCAi4oCcTmVpdGhlcuKAnSB0YWtlcyBhIHNpbmd1bGFyIHZlcmIiLCAiZyIpLAogICAgKHIiXGJlaXRoZXIgb2YgdGhlICg/Olx3KykgYXJlXGIiLCByImVpdGhlciBvZiB0aGUgXGc8MD4gaXMiLCAi4oCcRWl0aGVy4oCdIHRha2VzIGEgc2luZ3VsYXIgdmVyYiIsICJnIiksCiAgICAociJcYm5vbmUgb2YgdGhlICg/Olx3KykgKD86d2FzfHdlcmUpXGIiLCBOb25lLCAi4oCcTm9uZeKAnSBjYW4gdGFrZSBzaW5ndWxhciBvciBwbHVyYWw7IGNoZWNrIHRoZSBub3VuIiwgInMiKSwKICAgIChyIlxidGhlIG51bWJlciBvZiAoPzpcdyspIGFyZVxiIiwgciJ0aGUgbnVtYmVyIG9mIFxnPDA+IGlzIiwgIuKAnFRoZSBudW1iZXIgb2bigJ0gdGFrZXMgYSBzaW5ndWxhciB2ZXJiIiwgImciKSwKICAgIChyIlxiYSBudW1iZXIgb2YgKD86XHcrKSBpc1xiIiwgciJhIG51bWJlciBvZiBcZzwwPiBhcmUiLCAi4oCcQSBudW1iZXIgb2bigJ0gdGFrZXMgYSBwbHVyYWwgdmVyYiIsICJnIiksCiAgICAociJcYnRoZSBtYWpvcml0eSBvZiAoPzpcdyspIHdhc1xiIiwgciJ0aGUgbWFqb3JpdHkgb2YgXGc8MD4gd2VyZSIsICLigJxUaGUgbWFqb3JpdHkgb2bigJ0gdGFrZXMgYSBwbHVyYWwgdmVyYiB3aXRoIGEgcGx1cmFsIG5vdW4iLCAiZyIpLAogICAgIyAtLS0gR1JBTTM4IG1pcnJvcnM6IGFydGljbGVzLCBtb3JlIGNvbmZ1c2lvbnMsIHJlZ2lzdGVyLCB3b3JkeSBwaHJhc2VzIC0tLQogICAgKHIiXGJhbiAob25lfHVzZXJ8dW5pdmVyc2l0eXx1bmlxdWV8dW5pZm9ybXx1bml0fEV1cm9wZWFufHVuaW9ufHV0aWxpdHkpXGIiLCByImEgXDEiLCAiVGhlc2UgYmVnaW4gd2l0aCBhIGNvbnNvbmFudCBzb3VuZDogXCJhXCIsIG5vdCBcImFuXCIiLCAiZyIpLAogICAgKHIiXGJhIChhcHBsZXxvcmFuZ2V8aG91cnxob25lc3R8aG9ub3J8aG9ub3VyfGhlaXIpXGIiLCByImFuIFwxIiwgIlRoZXNlIGJlZ2luIHdpdGggYSB2b3dlbCBzb3VuZDogXCJhblwiLCBub3QgXCJhXCIiLCAiZyIpLAogICAgKHIiXGJwbGVhc2UgYWR2aWNlXGIiLCAicGxlYXNlIGFkdmlzZSIsICLigJxBZHZpc2XigJ0gaXMgdGhlIHZlcmIiLCAiZyIpLAogICAgKHIiXGJkZXZpY2UgYVxiIiwgImRldmlzZSBhIiwgIuKAnERldmlzZeKAnSAoY3JlYXRlKSB2cyDigJxkZXZpY2XigJ0gKGluc3RydW1lbnQpIiwgImciKSwKICAgIChyIlxiZGlzY3JlZXQgKGRpZmZlcmVuY2V8Z2FwfHNlcGFyYXRpb258aW50ZXJ2YWx8Y2F0ZWdvcnl8dmFyaWFibGV8ZmFjdG9yKVxiIiwgciJkaXNjcmV0ZSBcMSIsICLigJxEaXNjcmV0ZeKAnSAoc2VwYXJhdGUpIHZzIOKAnGRpc2NyZWV04oCdIChjYXJlZnVsKSIsICJnIiksCiAgICAociJcYmRpc2NyZXRlIChhY3Rpb258bWFubmVyfGJlaGF2aW9yfGJlaGF2aW91cnxhcHByb2FjaHxzaWxlbmNlKVxiIiwgciJkaXNjcmVldCBcMSIsICLigJxEaXNjcmVldOKAnSAoY2FyZWZ1bCkgdnMg4oCcZGlzY3JldGXigJ0gKHNlcGFyYXRlKSIsICJnIiksCiAgICAociJcYmFsdGFyICh0aGV8YXxhbnx0aGlzfHRoYXQpXHMrKGNvdXJzZXxkaXJlY3Rpb258YXBwcm9hY2h8c3RyYXRlZ3l8cGxhbnxwb3NpdGlvbnxhcmd1bWVudHxmaW5kaW5nfHJlc3VsdHxjb25jbHVzaW9uKVxiIiwgciJhbHRlciBcMSBcMiIsICLigJxBbHRlcuKAnSAoY2hhbmdlKSB2cyDigJxhbHRhcuKAnSAoc2FjcmVkIHRhYmxlKSIsICJnIiksCiAgICAociJcYnRyYWlsIGFuZCBlcnJvclxiIiwgInRyaWFsIGFuZCBlcnJvciIsICJUaGUgcGhyYXNlIGlzIFwidHJpYWwgYW5kIGVycm9yXCIiLCAiZyIpLAogICAgKHIiXGJjb25jZW5zdXNcYiIsICJjb25zZW5zdXMiLCAiVGhlIHNwZWxsaW5nIGlzIFwiY29uc2Vuc3VzXCIiLCAiZyIpLAogICAgKHIiXGJjb25jaW91c1xiIiwgImNvbnNjaW91cyIsICJUaGUgc3BlbGxpbmcgaXMgXCJjb25zY2lvdXNcIiIsICJnIiksCiAgICAociJcYm1hbmFnYWJsZVxiIiwgIm1hbmFnZWFibGUiLCAiVGhlIHNwZWxsaW5nIGlzIFwibWFuYWdlYWJsZVwiIiwgImciKSwKICAgIChyIlxibm90aWNhYmxlXGIiLCAibm90aWNlYWJsZSIsICJUaGUgc3BlbGxpbmcgaXMgXCJub3RpY2VhYmxlXCIiLCAiZyIpLAogICAgKHIiXGJwZXJzZXJ2ZXJhbmNlXGIiLCAicGVyc2V2ZXJhbmNlIiwgIlRoZSBzcGVsbGluZyBpcyBcInBlcnNldmVyYW5jZVwiIiwgImciKSwKICAgIChyIlxidXBtb3N0XGIiLCAidXRtb3N0IiwgIuKAnFV0bW9zdOKAnSAoZ3JlYXRlc3QpIHZzIOKAnHVwbW9zdOKAnSAodXBwZXJtb3N0KSIsICJnIiksCiAgICAociJcYnZhY2N1bVxiIiwgInZhY3V1bSIsICJUaGUgc3BlbGxpbmcgaXMgXCJ2YWN1dW1cIiIsICJnIiksCiAgICAociJcYnBvc2Vzc2lvblxiIiwgInBvc3Nlc3Npb24iLCAiRG91YmxlIHMgaW4gdGhlIG1pZGRsZSBhbmQgYXQgdGhlIGVuZCIsICJnIiksCiAgICAociJcYnBvc2Vzc2lvbnNcYiIsICJwb3NzZXNzaW9ucyIsICJEb3VibGUgcyBpbiB0aGUgbWlkZGxlIGFuZCBhdCB0aGUgZW5kIiwgImciKSwKICAgIChyIlxiYXBhcmF0dXNcYiIsICJhcHBhcmF0dXMiLCAiRG91YmxlIHAgYXQgdGhlIHN0YXJ0IiwgImciKSwKICAgIChyIlxiY2VtZXRhcnlcYiIsICJjZW1ldGVyeSIsICJUaGUgc3BlbGxpbmcgaXMgXCJjZW1ldGVyeVwiIiwgImciKSwKICAgIChyIlxiY29taXR0ZWVcYiIsICJjb21taXR0ZWUiLCAiRG91YmxlIG0sIGRvdWJsZSB0LCBkb3VibGUgZSIsICJnIiksCiAgICAociJcYmV4aXN0YW5jZVxiIiwgImV4aXN0ZW5jZSIsICJUaGUgc3BlbGxpbmcgaXMgXCJleGlzdGVuY2VcIiIsICJnIiksCiAgICAociJcYm9jY2Fzc2lvbmFsXGIiLCAib2NjYXNpb25hbCIsICJUd28gYywgb25lIHMiLCAiZyIpLAogICAgKHIiXGJwZXJzaXN0YW50XGIiLCAicGVyc2lzdGVudCIsICJUaGUgZW5kaW5nIGlzIFwiLWVudFwiIiwgImciKSwKICAgIChyIlxicmVsZXZlbnRcYiIsICJyZWxldmFudCIsICJUaGUgc3BlbGxpbmcgaXMgXCJyZWxldmFudFwiIiwgImciKSwKICAgIChyIlxiaW5kZXBlbmRhbnRcYiIsICJpbmRlcGVuZGVudCIsICLigJxlbnTigJ0gaXMgdGhlIGVuZGluZyIsICJnIiksCiAgICAjIHJlZ2lzdGVyIHVwZ3JhZGVzCiAgICAociJcYmEgbG90IG9mIChyZXNlYXJjaHxzdHVkaWVzfGV2aWRlbmNlfGRhdGF8c2Nob2xhcnN8bGl0ZXJhdHVyZXx3b3JrfGF0dGVudGlvbnxlZmZvcnR8Zm9jdXN8ZGViYXRlfGRpc2N1c3Npb24pXGIiLCBOb25lLCAi4oCcTXVjaOKAnSBvciBcInN1YnN0YW50aWFsXCIgY2FycmllcyBtb3JlIGFjYWRlbWljIHdlaWdodCIsICJzIiksCiAgICAociJcYmxvdHMgb2YgKHJlc2VhcmNofHN0dWRpZXN8ZXZpZGVuY2V8ZGF0YXxzY2hvbGFyc3xsaXRlcmF0dXJlfHdvcmt8YXR0ZW50aW9ufGVmZm9ydHxmb2N1c3xkZWJhdGV8ZGlzY3Vzc2lvbilcYiIsIE5vbmUsICLigJxNdWNo4oCdIG9yIFwic3Vic3RhbnRpYWxcIiBjYXJyaWVzIG1vcmUgYWNhZGVtaWMgd2VpZ2h0IiwgInMiKSwKICAgIChyIlxic2hvd3M/IHRoYXRcYiIsIE5vbmUsICLigJxEZW1vbnN0cmF0ZXNcIiwgXCJpbmRpY2F0ZXNcIiwgb3IgXCJyZXZlYWxzXCIgaXMgc3Ryb25nZXIiLCAicyIpLAogICAgKHIiXGJ0YWxrcz8gYWJvdXRcYiIsIE5vbmUsICLigJxEaXNjdXNzZXNcIiwgXCJhZGRyZXNzZXNcIiwgb3IgXCJleGFtaW5lc1wiIHJlYWRzIG1vcmUgZm9ybWFsbHkiLCAicyIpLAogICAgKHIiXGJsb29rcz8gYXRcYiIsIE5vbmUsICLigJxFeGFtaW5lc1wiLCBcImludmVzdGlnYXRlc1wiLCBvciBcImFuYWx5c2VzXCIgcmVhZHMgbW9yZSBmb3JtYWxseSIsICJzIiksCiAgICAociJcYmRlYWxzPyB3aXRoXGIiLCBOb25lLCAi4oCcQWRkcmVzc2VzXCIsIFwidHJlYXRzXCIsIG9yIFwiZW5nYWdlcyB3aXRoXCIgcmVhZHMgbW9yZSBmb3JtYWxseSIsICJzIiksCiAgICAociJcYnBvaW50cz8gb3V0XGIiLCBOb25lLCAi4oCcTm90ZXNcIiwgXCJvYnNlcnZlc1wiLCBvciBcImFyZ3Vlc1wiIHJlYWRzIG1vcmUgZm9ybWFsbHkiLCAicyIpLAogICAgKHIiXGJmaW5kcz8gb3V0XGIiLCBOb25lLCAi4oCcRGlzY292ZXJzXCIsIFwiZGV0ZXJtaW5lc1wiLCBvciBcImFzY2VydGFpbnNcIiByZWFkcyBtb3JlIGZvcm1hbGx5IiwgInMiKSwKICAgICMgbW9yZSB3b3JkeSBwaHJhc2VzCiAgICAociJcYndpdGggdGhlIGV4Y2VwdGlvbiBvZlxiIiwgImV4Y2VwdCIsICLigJxFeGNlcHRcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiaW4gdGhlIG5laWdoYm9yaG9vZCBvZlxiIiwgImFwcHJveGltYXRlbHkiLCAi4oCcQXBwcm94aW1hdGVseVwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJhIGxhcmdlIG51bWJlciBvZlxiIiwgIm1hbnkiLCAi4oCcTWFueVwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJhIHNtYWxsIG51bWJlciBvZlxiIiwgImZldyIsICLigJxGZXdcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiaW4gdGhlIHZpY2luaXR5IG9mXGIiLCAibmVhciIsICLigJxOZWFyXCIgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAociJcYndpdGggcmVmZXJlbmNlIHRvXGIiLCAicmVnYXJkaW5nIiwgIuKAnFJlZ2FyZGluZ1wiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJpbiBjb25uZWN0aW9uIHdpdGhcYiIsICJhYm91dCIsICLigJxBYm91dFwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJhcyBhIG1hdHRlciBvZiBmYWN0XGIiLCAiaW4gZmFjdCIsICLigJxJbiBmYWN0XCIgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAociJcYmluIHRoZSBmaW5hbCBhbmFseXNpc1xiIiwgInVsdGltYXRlbHkiLCAi4oCcVWx0aW1hdGVseVwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJmb3IgdGhlIG1vc3QgcGFydFxiIiwgIm1vc3RseSIsICLigJxNb3N0bHlcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxiYnkgbWVhbnMgb2ZcYiIsICJieSIsICLigJxCeVwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJieSB2aXJ0dWUgb2ZcYiIsICJiZWNhdXNlIiwgIuKAnEJlY2F1c2VcIiBpcyBzaG9ydGVyIGFuZCBjbGVhcmVyIiwgImMiKSwKICAgIChyIlxib24gdGhlIGdyb3VuZHMgdGhhdFxiIiwgImJlY2F1c2UiLCAi4oCcQmVjYXVzZVwiIGlzIHNob3J0ZXIgYW5kIGNsZWFyZXIiLCAiYyIpLAogICAgKHIiXGJzbyBhcyB0b1xiIiwgInRvIiwgIuKAnFRvXCIgYWxvbmUgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAociJcYmluIHRoZSBub3QgdG9vIGRpc3RhbnQgZnV0dXJlXGIiLCAic29vbiIsICLigJxTb29uXCIgaXMgc2hvcnRlciBhbmQgY2xlYXJlciIsICJjIiksCiAgICAjIG1vcmUgZG91YmxlZCB3b3JkcwogICAgKHIiXGJmb3IgZm9yXGIiLCAiZm9yIiwgIlRoZSB3b3JkIGlzIGRvdWJsZWQiLCAiZyIpLAogICAgKHIiXGJ3aXRoIHdpdGhcYiIsICJ3aXRoIiwgIlRoZSB3b3JkIGlzIGRvdWJsZWQiLCAiZyIpLAogICAgKHIiXGJ3YXMgd2FzXGIiLCAid2FzIiwgIlRoZSB3b3JkIGlzIGRvdWJsZWQiLCAiZyIpLAogICAgKHIiXGJhcmUgYXJlXGIiLCAiYXJlIiwgIlRoZSB3b3JkIGlzIGRvdWJsZWQiLCAiZyIpLAogICAgKHIiXGJ3aWxsIHdpbGxcYiIsICJ3aWxsIiwgIlRoZSB3b3JkIGlzIGRvdWJsZWQiLCAiZyIpLAogICAgKHIiXGJoYXZlIGhhdmVcYiIsICJoYXZlIiwgIlRoZSB3b3JkIGlzIGRvdWJsZWQiLCAiZyIpLAogICAgIyBjb21wb3VuZCBtb2RpZmllciBoeXBoZW5hdGlvbgogICAgKHIiXGJ3ZWxsIChrbm93bnxkb2N1bWVudGVkfGVzdGFibGlzaGVkfGZvdW5kZWR8YXJndWVkfGRlZmluZWR8ZGV2ZWxvcGVkfHJlc2VhcmNoZWR8c3VwcG9ydGVkfGluZm9ybWVkfGludGVudGlvbmVkKVxiKD89XHMrW2Etel0pIiwgciJ3ZWxsLVwxIiwgIkh5cGhlbmF0ZSBhIGNvbXBvdW5kIG1vZGlmaWVyIGJlZm9yZSBhIG5vdW4iLCAiZyIpLAogICAgKHIiXGJoaWdoIChxdWFsaXR5fHJpc2t8bGV2ZWx8c3BlZWR8ZGVuc2l0eXxmcmVxdWVuY3l8cmVzb2x1dGlvbnxwZXJmb3JtYW5jZSlcYig/PVxzK1thLXpdKSIsIHIiaGlnaC1cMSIsICJIeXBoZW5hdGUgYSBjb21wb3VuZCBtb2RpZmllciBiZWZvcmUgYSBub3VuIiwgImciKSwKICAgIChyIlxibG9uZyAodGVybXxzdGFuZGluZ3xydW5uaW5nfGhlbGR8ZXN0YWJsaXNoZWQpXGIoPz1ccytbYS16XSkiLCByImxvbmctXDEiLCAiSHlwaGVuYXRlIGEgY29tcG91bmQgbW9kaWZpZXIgYmVmb3JlIGEgbm91biIsICJnIiksCiAgICAociJcYmNyb3NzIChzZWN0aW9ufGN1bHR1cmFsfGRpc2NpcGxpbmFyeXxuYXRpb25hbHxib3JkZXJ8cmVmZXJlbmNlKVxiKD89XHMrW2Etel0pIiwgciJjcm9zcy1cMSIsICJIeXBoZW5hdGUgYSBjb21wb3VuZCBtb2RpZmllciBiZWZvcmUgYSBub3VuIiwgImciKSwKXSkKCl9IRV9DT01QSUxFRCA9IFsoX3JlMi5jb21waWxlKHAsIF9yZTIuSSksIHJlcCwgd2h5LCBjYXQpCiAgICAgICAgICAgICAgICBmb3IgcCwgcmVwLCB3aHksIGNhdCBpbiBfSEVVUiBpZiBwIGlzIG5vdCBOb25lXQoKX0RPVUJMRUQgPSBfcmUyLmNvbXBpbGUociJcYihbQS1aYS16XSspXHMrXDFcYiIsIF9yZTIuSSkKX0RPVUJMRURfT0sgPSB7ImhhZCIsICJ0aGF0IiwgIm5vIiwgImlzIiwgImJlIn0KCmRlZiBfaGV1cmlzdGljX2NvcnJlY3QodGV4dCk6CiAgICAiIiJUaGUgb2ZmbGluZSBsYW5lOiByZWFsIGVkaXRzIHdpdGhvdXQgYSBtb2RlbCwgbWlycm9yaW5nIHRoZSBwYWdlJ3MgcnVsZXMuIiIiCiAgICBlZGl0cyA9IFtdCiAgICBmb3IgcngsIHJlcCwgd2h5LCBjYXQgaW4gX0hFX0NPTVBJTEVEOgogICAgICAgIGZvciBtIGluIHJ4LmZpbmRpdGVyKHRleHQpOgogICAgICAgICAgICBvID0gbS5ncm91cCgwKQogICAgICAgICAgICBmID0gTm9uZQogICAgICAgICAgICBpZiByZXAgaXMgbm90IE5vbmU6CiAgICAgICAgICAgICAgICBmID0gbS5leHBhbmQocmVwKQogICAgICAgICAgICAgICAgaWYgbS5ncm91cCgwKVs6MV0uaXN1cHBlcigpOgogICAgICAgICAgICAgICAgICAgIGYgPSBmWzoxXS51cHBlcigpICsgZlsxOl0KICAgICAgICAgICAgZWRpdHMuYXBwZW5kKHsic3RhcnQiOiBtLnN0YXJ0KCksICJlbmQiOiBtLmVuZCgpLCAib3JpZyI6IG8sCiAgICAgICAgICAgICAgICAgICAgICAgICAgImZpeCI6IGYsICJ3aHkiOiB3aHkgb3IgIiIsICJjYXQiOiBjYXQgb3IgImcifSkKICAgIGZvciBtIGluIF9ET1VCTEVELmZpbmRpdGVyKHRleHQpOgogICAgICAgIHcgPSBtLmdyb3VwKDEpCiAgICAgICAgaWYgdy5sb3dlcigpIGluIF9ET1VCTEVEX09LOgogICAgICAgICAgICBjb250aW51ZQogICAgICAgIGVkaXRzLmFwcGVuZCh7InN0YXJ0IjogbS5zdGFydCgxKSwgImVuZCI6IG0uZW5kKDEpICsgbGVuKHcpICsgMSwKICAgICAgICAgICAgICAgICAgICAgICJvcmlnIjogbS5ncm91cCgwKSwgImZpeCI6IHcsCiAgICAgICAgICAgICAgICAgICAgICAid2h5IjogIlRoZSBkb3VibGVkIHdvcmQiLCAiY2F0IjogImcifSkKICAgICMgdGhlIHBhaXI6IGEgYmVmb3JlIHZvd2VscyB0YWtlcyBhbgogICAgZm9yIG0gaW4gX3JlMi5maW5kaXRlcihyIlxiKGEpXHMrKFtBLVphLXpdezMsfSlcYiIsIHRleHQpOgogICAgICAgIHcgPSBtLmdyb3VwKDIpCiAgICAgICAgbG93ID0gdy5sb3dlcigpCiAgICAgICAgaWYgbG93WzoxXSBpbiAiYWVpb3UiIGFuZCBub3QgbG93LnN0YXJ0c3dpdGgoKCJ1bmkiLCAib25lIiwgIm9uY2UiLCAiZXUiLCAidXN1IikpOgogICAgICAgICAgICBlZGl0cy5hcHBlbmQoeyJzdGFydCI6IG0uc3RhcnQoKSwgImVuZCI6IG0uZW5kKCksICJvcmlnIjogbS5ncm91cCgwKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAiZml4IjogImFuICIgKyB3LCAid2h5IjogIuKAnGHigJ0gYmVmb3JlIGEgdm93ZWwgc291bmQgd2FudHMg4oCcYW7igJ0iLAogICAgICAgICAgICAgICAgICAgICAgICAgICJjYXQiOiAiZyJ9KQogICAgZm9yIG0gaW4gX3JlMi5maW5kaXRlcihyIlxiKEFufGFuKVxzKyhbYmNkZmdoamtsbW5wcXJzdHZ3eHl6XVthLXpdezIsfSlcYiIsIHRleHQpOgogICAgICAgIHcgPSBtLmdyb3VwKDIpCiAgICAgICAgbG93ID0gdy5sb3dlcigpCiAgICAgICAgaWYgbm90IGxvdy5zdGFydHN3aXRoKCgiaG91IiwgImhlaSIsICJob25lIiwgImhvbm8iLCAic3V2IiwgIm12cCIsICJzcWwiLCAiaGVyIikpOgogICAgICAgICAgICBlZGl0cy5hcHBlbmQoeyJzdGFydCI6IG0uc3RhcnQoKSwgImVuZCI6IG0uZW5kKCksICJvcmlnIjogbS5ncm91cCgwKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAiZml4IjogKCJBICIgaWYgbS5ncm91cCgxKSA9PSAiQW4iIGVsc2UgImEgIikgKyB3LAogICAgICAgICAgICAgICAgICAgICAgICAgICJ3aHkiOiAi4oCcYW7igJ0gYmVsb25ncyBiZWZvcmUgdm93ZWwgc291bmRzIG9ubHkiLCAiY2F0IjogImcifSkKICAgIGVkaXRzLnNvcnQoa2V5PWxhbWJkYSB4OiB4WyJzdGFydCJdKQogICAgb3V0ID0gW10KICAgIHNlZW4gPSBzZXQoKQogICAgZm9yIGUgaW4gZWRpdHM6CiAgICAgICAgayA9IChlWyJzdGFydCJdLCBlWyJlbmQiXSkKICAgICAgICBpZiBrIGluIHNlZW46CiAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgc2Vlbi5hZGQoaykKICAgICAgICBvdXQuYXBwZW5kKGUpCiAgICByZXR1cm4gb3V0CgpkZWYgaGV1cmlzdGljX3Jld3JpdGUodGV4dCwgbW9kZSk6CiAgICAiIiJUaGUgb2ZmbGluZSBsYW5lIGZvciByZXdyaXRlOiBob25lc3QgdGlnaHRlbmluZyBvbmx5LCBubyBpbnZlbnRpb24uIiIiCiAgICB0ID0gdGV4dCBvciAiIgogICAgaWYgbW9kZSA9PSAiY29uY2lzZSIgb3IgbW9kZSA9PSAic2hvcnRlbiI6CiAgICAgICAgdCA9IFRJR0hURU5fUEFULnN1YihsYW1iZGEgbTogIiIsIHQpCiAgICAgICAgdCA9IF9yZTIuc3ViKHIiICArIiwgIiAiLCB0KQogICAgICAgIHQgPSBUSUdIVEVOX1BBVDIuc3ViKGxhbWJkYSBtOiAiIiwgdCkKICAgICAgICB0ID0gX3JlMi5zdWIociIgICsiLCAiICIsIHQpCiAgICBpZiBtb2RlID09ICJjb25maWRlbnQiOgogICAgICAgIHQgPSBfcmUyLnN1YihyIlxiKGNvdWxkIHBvc3NpYmx5fEkgdGhpbmsgdGhhdHxJIGZlZWwgdGhhdHxJIGJlbGlldmUgdGhhdClcYlxzKiIsICIiLCB0LCBmbGFncz1fcmUyLkkpCiAgICAgICAgdCA9IF9yZTIuc3ViKHIiXGIobWF5YmV8cGVyaGFwc3xwb3NzaWJseSlcYlxzKiIsICIiLCB0LCBmbGFncz1fcmUyLkkpCiAgICAgICAgdCA9IF9yZTIuc3ViKHIiXHN7Mix9IiwgIiAiLCB0KS5zdHJpcCgpCiAgICAgICAgaWYgdDoKICAgICAgICAgICAgdCA9IHRbMF0udXBwZXIoKSArIHRbMTpdCiAgICByZXR1cm4gdAoKX1RJR0hURU5fV09SRFMgPSBbInZlcnkiLCAicmVhbGx5IiwgImp1c3QiLCAicXVpdGUiLCAiYWN0dWFsbHkiLCAiYmFzaWNhbGx5IiwgImxpdGVyYWxseSIsCiAgICAgICAgICAgICAgICAgICJnZW5lcmFsbHkiLCAicHJldHR5IG11Y2giLCAiYSBiaXQiLCAiYSBsaXR0bGUiLCAic29ydCBvZiIsICJraW5kIG9mIl0KVElHSFRFTl9QQVQgPSBfcmUyLmNvbXBpbGUociJccytcYig/OiIgKyAifCIuam9pbihfcmUyLmVzY2FwZSh3KSBmb3IgdyBpbiBfVElHSFRFTl9XT1JEUykgKyByIilcYiIsIF9yZTIuSSkKVElHSFRFTl9QQVQyID0gX3JlMi5jb21waWxlKHIiXGIoPzoiICsgInwiLmpvaW4oX3JlMi5lc2NhcGUodykgZm9yIHcgaW4gX1RJR0hURU5fV09SRFMpICsgciIpXGJccysiLCBfcmUyLkkpCkNPTkZfUEFUID0gX3JlMi5jb21waWxlKHIiXGIobWF5YmV8cGVyaGFwc3xtaWdodHxjb3VsZCBwb3NzaWJseXxJIHRoaW5rIHRoYXR8SSBmZWVsIHRoYXR8SSBiZWxpZXZlIHRoYXQpXGJbXi4hP10qIiwgX3JlMi5JKQoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGVuZHBvaW50cwpfQ09SUkVDVF9DQUNIRSA9IHt9Cl9DT1JSRUNUX0NBQ0hFX01BWCA9IDUwMAoKCmRlZiBlcF9jb3JyZWN0KGJvZHkpOgogICAgdGV4dCA9IGJvZHkuZ2V0KCJ0ZXh0IiwgIiIpCiAgICBpZiBub3QgdGV4dC5zdHJpcCgpOgogICAgICAgIHJldHVybiB7ImVkaXRzIjogW119CiAgICBpZiBBSVsicmVhZHkiXToKICAgICAgICBlbmdpbmUgPSBBSVsiZ2VjIl0gb3IgQUlbInBpcGUiXQogICAgICAgIHByZWZpeCA9ICgiRml4IHRoZSBncmFtbWFyLCBzcGVsbGluZyBhbmQgcHVuY3R1YXRpb24gb2YgdGhpcyBzZW50ZW5jZS4gIgogICAgICAgICAgICAgICAgICAiUHJlc2VydmUgbWVhbmluZywgbnVtYmVycyBhbmQgY2l0YXRpb25zLiBPdXRwdXQgT05MWSB0aGUgY29ycmVjdGVkIHNlbnRlbmNlOiAiCiAgICAgICAgICAgICAgICAgIGlmIEFJWyJnZWMiXSBlbHNlCiAgICAgICAgICAgICAgICAgICJDb3JyZWN0IHRoZSBncmFtbWFyLCBzcGVsbGluZywgcHVuY3R1YXRpb24gYW5kIHdvcmQgY2hvaWNlIG9mIHRoaXMgc2VudGVuY2UgIgogICAgICAgICAgICAgICAgICAiZm9yIGZvcm1hbCBhY2FkZW1pYyBFbmdsaXNoLiBQcmVzZXJ2ZSBtZWFuaW5nLCBudW1iZXJzIGFuZCBjaXRhdGlvbnMgZXhhY3RseS4gIgogICAgICAgICAgICAgICAgICAiT3V0cHV0IE9OTFkgdGhlIGNvcnJlY3RlZCBzZW50ZW5jZTogIikKICAgICAgICBlZGl0cyA9IFtdCiAgICAgICAgc2VudHMgPSBbKG0uZ3JvdXAoKS5zdHJpcCgpLCBtLnN0YXJ0KCkpIGZvciBtIGluIHJlLmZpbmRpdGVyKHIiW14uIT9cbl0rWy4hP10/XHMqIiwgdGV4dCldCiAgICAgICAgZGlhbGVjdCA9IGJvZHkuZ2V0KCJkaWFsZWN0IiwgIm9mZiIpCiAgICAgICAgZGNsID0gIlVzZSBBbWVyaWNhbiBzcGVsbGluZy4gIiBpZiBkaWFsZWN0ID09ICJ1cyIgZWxzZSAoIlVzZSBCcml0aXNoIHNwZWxsaW5nLiAiIGlmIGRpYWxlY3QgPT0gInVrIiBlbHNlICIiKQogICAgICAgIGZvciBzZW50LCBvZmYgaW4gc2VudHM6CiAgICAgICAgICAgIGlmIGxlbihzZW50LnNwbGl0KCkpIDwgMzoKICAgICAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgICAgICMgc2VudGVuY2UtbGV2ZWwgY2FjaGU6IHVuY2hhbmdlZCBzZW50ZW5jZXMgc2tpcCBpbmZlcmVuY2UgZW50aXJlbHkKICAgICAgICAgICAgY2FjaGVfa2V5ID0gaGFzaChzZW50ICsgInwiICsgZGNsICsgInwiICsgKEFJLmdldCgibG9jYWxfbmFtZSIpIG9yIElOU1RSVUNUX01PREVMKSkKICAgICAgICAgICAgaWYgY2FjaGVfa2V5IGluIF9DT1JSRUNUX0NBQ0hFOgogICAgICAgICAgICAgICAgY2FjaGVkID0gX0NPUlJFQ1RfQ0FDSEVbY2FjaGVfa2V5XQogICAgICAgICAgICAgICAgaWYgY2FjaGVkIGlzIG5vdCBOb25lIGFuZCBjYWNoZWQubG93ZXIoKSAhPSBzZW50Lmxvd2VyKCk6CiAgICAgICAgICAgICAgICAgICAgZWRpdHMgKz0gd29yZF9kaWZmX2VkaXRzKHNlbnQsIGNhY2hlZCwgb2ZmKQogICAgICAgICAgICAgICAgY29udGludWUKICAgICAgICAgICAgaWYgQUkuZ2V0KCJsb2NhbCIpIGFuZCBlbmdpbmUgaXMgTm9uZToKICAgICAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgICAgICBmaXhlZCA9IHN0cmlwX3RoaW5rKF9nZW5lcmF0ZV9sb2NhbChDUkVFRCArIGRjbCArICJGaXggdGhlIGdyYW1tYXIsIHNwZWxsaW5nLCBwdW5jdHVhdGlvbiBhbmQgIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICJ3b3JkIGNob2ljZSBvZiB0aGUgc2VudGVuY2UgYmVsb3cgZm9yIGZvcm1hbCBhY2FkZW1pYyBFbmdsaXNoLiAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIlByZXNlcnZlIG1lYW5pbmcgYW5kIGV2ZXJ5IG51bWJlciBhbmQgY2l0YXRpb24gZXhhY3RseS4gIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICJPdXRwdXQgT05MWSB0aGUgY29ycmVjdGVkIHNlbnRlbmNlLCBub3RoaW5nIGVsc2UuXG5cbiIKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICArIHNlbnQsIG1heF9uZXdfdG9rZW5zPW1pbigyNTYsIGxlbihzZW50LnNwbGl0KCkpICogMiArIDIwKSkgb3IgIiIpCiAgICAgICAgICAgICAgICAgICAgZml4ZWQgPSBmaXhlZC5zdHJpcCgpIGlmIGZpeGVkIGVsc2UgIiIKICAgICAgICAgICAgICAgICAgICBpZiBsZW4oX0NPUlJFQ1RfQ0FDSEUpIDwgX0NPUlJFQ1RfQ0FDSEVfTUFYOgogICAgICAgICAgICAgICAgICAgICAgICBfQ09SUkVDVF9DQUNIRVtjYWNoZV9rZXldID0gZml4ZWQgb3IgTm9uZQogICAgICAgICAgICAgICAgICAgIGlmIGZpeGVkIGFuZCBmaXhlZC5sb3dlcigpICE9IHNlbnQubG93ZXIoKToKICAgICAgICAgICAgICAgICAgICAgICAgZWRpdHMgKz0gd29yZF9kaWZmX2VkaXRzKHNlbnQsIGZpeGVkLCBvZmYpCiAgICAgICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICAgICAgICAgIHBhc3MKICAgICAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIG91dCA9IGVuZ2luZShwcmVmaXggKyBzZW50LAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1heF9uZXdfdG9rZW5zPW1pbigyNTYsIGludChsZW4oc2VudC5zcGxpdCgpKSAqIDIpICsgMjApLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvX3NhbXBsZT1GYWxzZSwgcmVwZXRpdGlvbl9wZW5hbHR5PTEuMikKICAgICAgICAgICAgICAgIGZpeGVkID0gb3V0WzBdLmdldCgiZ2VuZXJhdGVkX3RleHQiLCAiIikuc3RyaXAoKQogICAgICAgICAgICAgICAgaWYgbGVuKF9DT1JSRUNUX0NBQ0hFKSA8IF9DT1JSRUNUX0NBQ0hFX01BWDoKICAgICAgICAgICAgICAgICAgICBfQ09SUkVDVF9DQUNIRVtjYWNoZV9rZXldID0gZml4ZWQgb3IgTm9uZQogICAgICAgICAgICAgICAgaWYgZml4ZWQgYW5kIGZpeGVkLmxvd2VyKCkgIT0gc2VudC5sb3dlcigpOgogICAgICAgICAgICAgICAgICAgIGVkaXRzICs9IHdvcmRfZGlmZl9lZGl0cyhzZW50LCBmaXhlZCwgb2ZmKQogICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICAgICAgY29udGludWUKICAgICAgICByZXR1cm4geyJlZGl0cyI6IGVkaXRzfQogICAgcmV0dXJuIHsiZWRpdHMiOiBfaGV1cmlzdGljX2NvcnJlY3QodGV4dCl9ICAjIHRoZSBvZmZsaW5lIGxhbmUgYW5zd2VycyBmb3IgcmVhbAoKClJFV1JJVEVfUFJPTVBUUyA9IHsKICAgICJwcm9mZXNzaW9uYWwiOiAiUmV3cml0ZSB0aGUgZm9sbG93aW5nIGluIHBvbGlzaGVkIHByb2Zlc3Npb25hbCBFbmdsaXNoLiBVc2UgcHJlY2lzZSB2ZXJicywgYWN0aXZlIHZvaWNlIHdoZXJlIG5hdHVyYWwsIHZhcmllZCBzZW50ZW5jZSBzdHJ1Y3R1cmUuIEtlZXAgZXZlcnkgZmFjdCwgbnVtYmVyLCBjaXRhdGlvbiBhbmQgdGhlIG9yaWdpbmFsIG1lYW5pbmcgaW50YWN0LiIsCiAgICAiY2FzdWFsIjogIlJld3JpdGUgdGhlIGZvbGxvd2luZyBpbiByZWxheGVkLCB3YXJtLCBjb252ZXJzYXRpb25hbCBFbmdsaXNoLiBBbGxvdyBjb250cmFjdGlvbnMsIHNob3J0ZXIgc2VudGVuY2VzLCBldmVyeWRheSB3b3Jkcy4gS2VlcCBldmVyeSBmYWN0IGFuZCB0aGUgb3JpZ2luYWwgbWVhbmluZy4iLAogICAgInNjaG9sYXJseSI6ICJSZXdyaXRlIHRoZSBmb2xsb3dpbmcgaW4gZm9ybWFsIHNjaG9sYXJseSBFbmdsaXNoIHN1aXRhYmxlIGZvciBhIGRvY3RvcmFsIHRoZXNpcy4gVXNlIHByZWNpc2UgYWNhZGVtaWMgZGljdGlvbiwgdGhpcmQgcGVyc29uLCBubyBjb250cmFjdGlvbnMsIGhlZGdlZCBzcGVjdWxhdGl2ZSBjbGFpbXMgd2l0aCBhcHByb3ByaWF0ZSBlcGlzdGVtaWMgbWFya2VycywgdmFyaWVkIHNlbnRlbmNlIHN0cnVjdHVyZSB3aXRoIHN1Ym9yZGluYXRlIGNsYXVzZXMgd2hlcmUgdGhleSBhaWQgYXJndW1lbnQuIFByZXNlcnZlIGV2ZXJ5IGNpdGF0aW9uLCBudW1iZXIsIHByb3BlciBub3VuIGFuZCB0aGUgb3JpZ2luYWwgbWVhbmluZyBleGFjdGx5LiIsCiAgICAiY29uY2lzZSI6ICJSZXdyaXRlIHRoZSBmb2xsb3dpbmcgYXMgY29uY2lzZWx5IGFzIHBvc3NpYmxlLiBSZW1vdmUgZXZlcnkgcmVkdW5kYW50IHdvcmQsIHRpZ2h0ZW4gY2xhdXNlcywgbWVyZ2Ugc2VudGVuY2VzIHdoZXJlIHRoZSBsb2dpYyBwZXJtaXRzLiBMb3NlIG5vIG1lYW5pbmcsIG5vIGZhY3QsIG5vIGNpdGF0aW9uLiIsCiAgICAiY29uZmlkZW50IjogIlJld3JpdGUgdGhlIGZvbGxvd2luZyB0byBzb3VuZCBjb25maWRlbnQgYW5kIHdlbGwtc3VwcG9ydGVkLiBSZW1vdmUgdW5uZWNlc3NhcnkgaGVkZ2luZyBmcm9tIGZhY3R1YWwgc3RhdGVtZW50cywga2VlcCBoZWRnaW5nIG9ubHkgb24gZ2VudWluZWx5IHNwZWN1bGF0aXZlIGNsYWltcy4gVXNlIHN0cm9uZyBwcmVjaXNlIHZlcmJzLiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBtZWFuaW5nLiIsCiAgICAic2hvcnRlbiI6ICJTaG9ydGVuIHRoZSBmb2xsb3dpbmcgc2lnbmlmaWNhbnRseS4gS2VlcCBhbGwga2V5IHBvaW50cywgY2l0YXRpb25zIGFuZCBudW1iZXJzIGJ1dCBjdXQgZXZlcnkgd29yZCB0aGF0IGRvZXMgbm90IGNhcnJ5IG1lYW5pbmcuIiwKICAgICJleHBhbmQiOiAiRXhwYW5kIHRoZSBmb2xsb3dpbmcgd2l0aCByaWNoZXIgZGV0YWlsLCBmdWxsZXIgZXhwbGFuYXRpb24sIHNtb290aGVyIHRyYW5zaXRpb25zIGJldHdlZW4gc2VudGVuY2VzIGFuZCBwYXJhZ3JhcGhzLiBBZGQgbm8gZmFicmljYXRlZCBmYWN0cywgY2l0YXRpb25zIG9yIHN0YXRpc3RpY3MuIEtlZXAgdGhlIG9yaWdpbmFsIG1lYW5pbmcgYW5kIGV4cGFuZCBvbmx5IHdoYXQgaXMgYWxyZWFkeSBpbXBsaWVkIG9yIHN0YXRlZC4iLAogICAgInN1bW1hcml6ZSI6ICJTdW1tYXJpemUgdGhlIGZvbGxvd2luZyBpbnRvIGEgdGlnaHQgc2luZ2xlIHBhcmFncmFwaCB0aGF0IGNhcHR1cmVzIHRoZSBjZW50cmFsIGFyZ3VtZW50IGFuZCBhbGwga2V5IGZpbmRpbmdzLiBQcmVzZXJ2ZSBldmVyeSBjaXRhdGlvbiByZWZlcmVuY2UgdGhhdCBhcHBlYXJzIGluIHRoZSBvcmlnaW5hbC4iLAogICAgInBhcmFwaHJhc2UiOiAiUGFyYXBocmFzZSB0aGUgZm9sbG93aW5nOiBzYW1lIG1lYW5pbmcsIGVudGlyZWx5IG5ldyB3b3JkaW5nIGFuZCBkaWZmZXJlbnQgc2VudGVuY2Ugc3RydWN0dXJlcy4gS2VlcCBhbGwgY2l0YXRpb25zLCBudW1iZXJzLCBwcm9wZXIgbm91bnMgYW5kIHRoZSByZWdpc3RlciBleGFjdGx5LiBEbyBub3QgYWRkIG9yIHJlbW92ZSBhbnkgY2xhaW0uIiwKICAgICJodW1hbml6ZSI6ICJNYWtlIHRoZSBmb2xsb3dpbmcgc291bmQgbmF0dXJhbCBhbmQgZ2VudWluZWx5IGh1bWFuLiBWYXJ5IHNlbnRlbmNlIGxlbmd0aCwgcHJlZmVyIHBsYWluIHdvcmRzIG92ZXIgamFyZ29uLCBhbGxvdyBjb250cmFjdGlvbnMgd2hlcmUgdGhlIHJlZ2lzdGVyIHBlcm1pdHMsIHJlYWQgYWxvdWQgc21vb3RobHkuIEtlZXAgZXZlcnkgZmFjdCwgY2l0YXRpb24gYW5kIHRoZSBvcmlnaW5hbCBtZWFuaW5nLiIsCiAgICAiY3JlYXRpdmUiOiAiUmV3cml0ZSB0aGUgZm9sbG93aW5nIHdpdGggdml2aWQsIGltYWdpbmF0aXZlIHByb3NlLiBVc2UgZnJlc2ggbWV0YXBob3JzLCBzZW5zb3J5IGRldGFpbCwgYW5kIHZhcmllZCByaHl0aG0uIEtlZXAgZXZlcnkgZmFjdCBhbmQgY2l0YXRpb24gaW50YWN0LiBFbGV2YXRlIHRoZSBsYW5ndWFnZSB3aXRob3V0IGZhYnJpY2F0aW5nIGNvbnRlbnQuIiwKICAgICJhbmFseXRpY2FsIjogIlJld3JpdGUgdGhlIGZvbGxvd2luZyBpbiBwcmVjaXNlIGFuYWx5dGljYWwgRW5nbGlzaC4gUHJpb3JpdGlzZSBsb2dpY2FsIGNvbm5lY3RpdmVzLCBleHBsaWNpdCB3YXJyYW50cyBiZXR3ZWVuIGNsYWltcyBhbmQgZXZpZGVuY2UsIGFuZCBjYXJlZnVsIHF1YWxpZmljYXRpb24gb2Ygc2NvcGUuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMsIG51bWJlcnMgYW5kIG1lYW5pbmcuIiwKfQoKIyBHcmFtbWFybHktc3R5bGUgcmV3cml0ZSBwcmVzZXRzOiBzcGVjaWZpYyBwYXJhZ3JhcGgtbGV2ZWwgZ29hbHMgdGhlIHVzZXIKIyBjYW4gYXBwbHkgdG8gYSBzZWxlY3RlZCBwYXNzYWdlLiBFYWNoIHByZXNldCBjYXJyaWVzIGEgZGV0YWlsZWQgaW5zdHJ1Y3Rpb24KIyB0aGF0IGd1aWRlcyB0aGUgbW9kZWwgdG93YXJkIGEgc3BlY2lmaWMgcXVhbGl0eSwgbm90IGp1c3QgYSByZWdpc3Rlci4KUkVXUklURV9QUkVTRVRTID0gewogICAgImZvcm1hbCI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBpbiBmb3JtYWwgYWNhZGVtaWMgRW5nbGlzaC4gRWxpbWluYXRlIGNvbGxvcXVpYWxpc21zLCBjb250cmFjdGlvbnMsIGFuZCBjYXN1YWwgcGhyYXNpbmcuIFVzZSBwcmVjaXNlIGRpY3Rpb24sIGNvbXBsZXRlIHNlbnRlbmNlcywgYW5kIG1lYXN1cmVkIHRvbmUuIFByZXNlcnZlIGV2ZXJ5IGZhY3QsIGNpdGF0aW9uLCBhbmQgbnVtYmVyIGV4YWN0bHkuIiwKICAgICJpbmZvcm1hbCI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBpbiBjbGVhciwgYXBwcm9hY2hhYmxlIEVuZ2xpc2guIFVzZSBjb250cmFjdGlvbnMsIHNob3J0ZXIgc2VudGVuY2VzLCBhbmQgZXZlcnlkYXkgdm9jYWJ1bGFyeS4gS2VlcCBpdCB3YXJtIGFuZCByZWFkYWJsZSB3aXRob3V0IGxvc2luZyBwcmVjaXNpb24uIFByZXNlcnZlIGV2ZXJ5IGZhY3QgYW5kIGNpdGF0aW9uLiIsCiAgICAiY29uY2lzZSI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSB0byBiZSBhcyBjb25jaXNlIGFzIHBvc3NpYmxlIHdpdGhvdXQgbG9zaW5nIG1lYW5pbmcuIEN1dCBldmVyeSByZWR1bmRhbnQgd29yZCwgbWVyZ2UgY2xhdXNlcywgdGlnaHRlbiBwaHJhc2luZy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucywgbnVtYmVycywgYW5kIGtleSBjbGFpbXMuIiwKICAgICJlbmdhZ2luZyI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSB0byBiZSBtb3JlIGVuZ2FnaW5nLiBVc2UgdmFyaWVkIHNlbnRlbmNlIHN0cnVjdHVyZSwgc3Ryb25nIHZlcmJzLCBhbmQgYWN0aXZlIHZvaWNlLiBEcmF3IHRoZSByZWFkZXIgaW4gd2l0aCBjbGVhciBtb21lbnR1bSBmcm9tIHNlbnRlbmNlIHRvIHNlbnRlbmNlLiBQcmVzZXJ2ZSBldmVyeSBmYWN0IGFuZCBjaXRhdGlvbi4iLAogICAgInBlcnN1YXNpdmUiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gYmUgbW9yZSBwZXJzdWFzaXZlLiBTdHJlbmd0aGVuIHRoZSBsb2dpY2FsIGNvbm5lY3Rpb24gYmV0d2VlbiBldmlkZW5jZSBhbmQgY2xhaW1zLiBVc2UgY29uZmlkZW50LCBwcmVjaXNlIGxhbmd1YWdlLiBBZGRyZXNzIHBvdGVudGlhbCBjb3VudGVyYXJndW1lbnRzIGltcGxpY2l0bHkgdGhyb3VnaCBzdHJvbmdlciB3YXJyYW50cy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucy4iLAogICAgImF1dGhvcml0YXRpdmUiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gc291bmQgbW9yZSBhdXRob3JpdGF0aXZlLiBVc2UgZGVjaXNpdmUgbGFuZ3VhZ2UsIHJlbW92ZSB1bm5lY2Vzc2FyeSBoZWRnaW5nIGZyb20gZXN0YWJsaXNoZWQgZmFjdHMsIGFuZCBwcmVzZW50IGV2aWRlbmNlIHdpdGggY29uZmlkZW5jZS4gS2VlcCBoZWRnaW5nIG9ubHkgb24gZ2VudWluZWx5IHNwZWN1bGF0aXZlIGNsYWltcy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucy4iLAogICAgImRpcGxvbWF0aWMiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gYmUgbW9yZSBkaXBsb21hdGljLiBTb2Z0ZW4gYXNzZXJ0aW9ucyB0aGF0IG92ZXJjbGFpbSwgYWNrbm93bGVkZ2UgY29tcGxleGl0eSwgYW5kIHByZXNlbnQgY29udGVzdGVkIGNsYWltcyB3aXRoIGFwcHJvcHJpYXRlIHF1YWxpZmljYXRpb24uIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAiZGVzY3JpcHRpdmUiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gYmUgbW9yZSBkZXNjcmlwdGl2ZSBhbmQgdml2aWQuIEFkZCBzcGVjaWZpYyBkZXRhaWwsIGNvbmNyZXRlIGV4YW1wbGVzLCBhbmQgc2Vuc29yeSBsYW5ndWFnZSB3aGVyZSBhcHByb3ByaWF0ZS4gRG8gbm90IGZhYnJpY2F0ZSBmYWN0cyBvciBjaXRhdGlvbnMuIEVucmljaCB3aGF0IGlzIGFscmVhZHkgc3RhdGVkLiIsCiAgICAibmFycmF0aXZlIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHdpdGggYSBzdHJvbmdlciBuYXJyYXRpdmUgdGhyZWFkLiBDb25uZWN0IHNlbnRlbmNlcyB3aXRoIGNsZWFyIHRyYW5zaXRpb25zLCBidWlsZCBtb21lbnR1bSwgYW5kIGd1aWRlIHRoZSByZWFkZXIgdGhyb3VnaCB0aGUgYXJndW1lbnQgc3RlcCBieSBzdGVwLiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAogICAgInNpbXBsaWZ5IjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIGluIHNpbXBsZXIgRW5nbGlzaC4gVXNlIHNob3J0ZXIgc2VudGVuY2VzLCBjb21tb24gdm9jYWJ1bGFyeSwgYW5kIHN0cmFpZ2h0Zm9yd2FyZCBzdHJ1Y3R1cmUuIEtlZXAgdGhlIG1lYW5pbmcgZXhhY3QuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIG51bWJlcnMuIiwKICAgICJpbXByb3ZlLWZsb3ciOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgdG8gaW1wcm92ZSBpdHMgZmxvdy4gVmFyeSBzZW50ZW5jZSBsZW5ndGgsIHBsYWNlIHRoZSBtb3N0IGltcG9ydGFudCBpbmZvcm1hdGlvbiBhdCB0aGUgYmVnaW5uaW5nIG9yIGVuZCBvZiBzZW50ZW5jZXMsIGFuZCBlbnN1cmUgZWFjaCBzZW50ZW5jZSBmb2xsb3dzIGxvZ2ljYWxseSBmcm9tIHRoZSBvbmUgYmVmb3JlLiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAogICAgInN0cm9uZ2VyLXZlcmJzIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHJlcGxhY2luZyB3ZWFrIHZlcmJzIChpcywgd2FzLCBoYXMsIG1ha2UsIGdldCkgd2l0aCBzdHJvbmcgc3BlY2lmaWMgdmVyYnMuIEtlZXAgdGhlIG1lYW5pbmcgZXhhY3QuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIG51bWJlcnMuIiwKICAgICJwYXNzaXZlLXRvLWFjdGl2ZSI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBjb252ZXJ0aW5nIHBhc3NpdmUgY29uc3RydWN0aW9ucyB0byBhY3RpdmUgdm9pY2Ugd2hlcmUgdGhlIGFjdG9yIGlzIGtub3duIG9yIGNhbiBiZSBuYW1lZC4gS2VlcCBwYXNzaXZlIG9ubHkgd2hlcmUgdGhlIGFjdG9yIGlzIGdlbnVpbmVseSB1bmtub3duIG9yIGlycmVsZXZhbnQuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAidG9uZS1uZXV0cmFsIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIGluIGEgbmV1dHJhbCwgb2JqZWN0aXZlIHRvbmUuIFJlbW92ZSBlbW90aW9uYWwgbGFuZ3VhZ2UsIHN1YmplY3RpdmUgcXVhbGlmaWVycywgYW5kIHJoZXRvcmljYWwgZmxvdXJpc2hlcy4gUHJlc2VudCB0aGUgY29udGVudCBwbGFpbmx5LiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAogICAgInRvbmUtY29uZmlkZW50IjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHRvIHNvdW5kIG1vcmUgY29uZmlkZW50LiBSZW1vdmUgaGVkZ2luZyBmcm9tIGZhY3R1YWwgc3RhdGVtZW50cywgdXNlIHByZWNpc2UgY2xhaW1zLCBhbmQgbGV0IGV2aWRlbmNlIGNhcnJ5IHRoZSBlbXBoYXNpcy4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucyBhbmQgZmFjdHMuIiwKICAgICJ0b25lLWNhdXRpb3VzIjogIlJld3JpdGUgdGhpcyBwYXNzYWdlIHdpdGggbW9yZSBjYXV0aW91cyBlcGlzdGVtaWMgbWFya2luZy4gRGlzdGluZ3Vpc2ggZXN0YWJsaXNoZWQgZmluZGluZ3MgZnJvbSBzcGVjdWxhdGlvbiwgYW5kIHF1YWxpZnkgY2xhaW1zIHRoYXQgZXh0ZW5kIGJleW9uZCB0aGUgZXZpZGVuY2UuIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAidHJhbnNpdGlvbi1maXgiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgYWRkaW5nIG9yIGltcHJvdmluZyB0cmFuc2l0aW9uYWwgd29yZHMgYW5kIHBocmFzZXMgYmV0d2VlbiBzZW50ZW5jZXMgYW5kIGlkZWFzLiBFbnN1cmUgdGhlIGxvZ2ljYWwgcmVsYXRpb25zaGlwIGJldHdlZW4gZWFjaCBzZW50ZW5jZSBpcyBleHBsaWNpdC4gUHJlc2VydmUgYWxsIGNpdGF0aW9ucyBhbmQgZmFjdHMuIiwKICAgICJwYXJhbGxlbC1maXgiOiAiUmV3cml0ZSB0aGlzIHBhc3NhZ2UgZml4aW5nIGFueSBmYXVsdHkgcGFyYWxsZWwgc3RydWN0dXJlLiBFbnN1cmUgaXRlbXMgaW4gYSBzZXJpZXMsIGNvbXBhcmlzb25zLCBhbmQgY29vcmRpbmF0ZWQgZWxlbWVudHMgdXNlIHRoZSBzYW1lIGdyYW1tYXRpY2FsIGZvcm0uIFByZXNlcnZlIGFsbCBjaXRhdGlvbnMgYW5kIGZhY3RzLiIsCiAgICAiYWNhZGVtaWMtdXBncmFkZSI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSBlbGV2YXRpbmcgdGhlIHJlZ2lzdGVyIHRvIGRvY3RvcmFsIGFjYWRlbWljIHN0YW5kYXJkLiBVc2UgcHJlY2lzZSBkaXNjaXBsaW5hcnkgdm9jYWJ1bGFyeSwgY29tcGxleCBzZW50ZW5jZSBzdHJ1Y3R1cmVzIHdoZXJlIHRoZXkgYWlkIGFyZ3VtZW50LCB0aGlyZCBwZXJzb24sIG5vIGNvbnRyYWN0aW9ucywgYW5kIGNhcmVmdWwgZXBpc3RlbWljIGhlZGdpbmcuIFByZXNlcnZlIGV2ZXJ5IGNpdGF0aW9uLCBudW1iZXIsIGFuZCBwcm9wZXIgbm91biBleGFjdGx5LiBEbyBub3QgYWRkIGNsYWltcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSB0ZXh0LiIsCiAgICAidGlnaHRlbi1hcmd1bWVudCI6ICJSZXdyaXRlIHRoaXMgcGFzc2FnZSB0aWdodGVuaW5nIHRoZSBhcmd1bWVudC4gUmVtb3ZlIHRhbmdlbnRzLCBlbnN1cmUgZWFjaCBzZW50ZW5jZSBhZHZhbmNlcyB0aGUgY2VudHJhbCBjbGFpbSwgYW5kIG1ha2UgdGhlIGxvZ2ljYWwgcHJvZ3Jlc3Npb24gZnJvbSBldmlkZW5jZSB0byBjb25jbHVzaW9uIGV4cGxpY2l0LiBQcmVzZXJ2ZSBhbGwgY2l0YXRpb25zIGFuZCBmYWN0cy4iLAp9CgoKZGVmIGVwX3JlYWRlcihib2R5KToKICAgICIiIlN0YWdlIDQ6IHRoZSByZWFkZXIncyBsaWtlbHkgcmVzcG9uc2UsIGNhbG1lciB0aGFuIHRoZSBob3N0aWxlIGV4YW1pbmVyLgogICAgUGVyc29uYSBjb21lcyBmcm9tIHRoZSBhcHAncyBHb2FscyAoYXVkaWVuY2UpLiBIZXVyaXN0aWMgZmFsbGJhY2sgbWlycm9ycyB0aGUgYnJvd3Nlci4iIiIKICAgIHRleHQgPSBib2R5LmdldCgidGV4dCIsICIiKVs6OTAwMF0KICAgIGF1ZCA9IGJvZHkuZ2V0KCJhdWQiLCAiQWNhZGVtaWMgcmVhZGVycyIpCiAgICBpZiBBSVsicmVhZHkiXToKICAgICAgICBvdXQgPSBnZW5lcmF0ZSgKICAgICAgICAgICAgQ1JFRUQgKyBmIllvdSBhcmUgYSBjYXJlZnVsIGZpcnN0IHJlYWRlciBzdGFuZGluZyBpbiBmb3Ige2F1ZH0uIFJlcG9ydCB0aGUgNCBtb21lbnRzIHdoZXJlIHRoaXMgdGV4dCAiCiAgICAgICAgICAgICJsb3NlcyB0aGF0IHJlYWRlcjogd2hlcmUgYXR0ZW50aW9uIHNsaXBzLCB3aGVyZSB0cnVzdCB0aGlucywgd2hlcmUgYSBiZWF0IGlzIG1pc3NpbmcsIHdoZXJlIHRoZSAiCiAgICAgICAgICAgICJsb2dpYyBqdW1wcyB3aXRob3V0IGEgYnJpZGdlLiBPbmUgbW9tZW50IHBlciBsaW5lLCBhdCBtb3N0IDI0IHdvcmRzIGVhY2gsIGdlbnRsZSBhbmQgc3BlY2lmaWMuICIKICAgICAgICAgICAgZiJPdXRwdXQgT05MWSB0aGUgbGlzdC5cblxue3RleHR9IiwgMzgwKQogICAgICAgIGlmIG91dDoKICAgICAgICAgICAgcmF3X2l0ZW1zID0gW3JlLnN1YihyIl5ccypbLSpcZF0rWykuXHNdKiIsICIiLCBsKS5zdHJpcCgpIGZvciBsIGluIG91dC5zcGxpdGxpbmVzKCldCiAgICAgICAgICAgIHRoaW5rID0gTm9uZQogICAgICAgICAgICBpZiByYXdfaXRlbXM6CiAgICAgICAgICAgICAgICBfLCB0aGluayA9IHNwbGl0X29mZl90aGluayhyYXdfaXRlbXNbMF0pCiAgICAgICAgICAgIGl0ZW1zID0gW2wgZm9yIGwgaW4gcmF3X2l0ZW1zIGlmIGxlbihsKSA+IDEyXVs6NV0KICAgICAgICAgICAgaWYgaXRlbXM6CiAgICAgICAgICAgICAgICByZXR1cm4geyJpdGVtcyI6IGl0ZW1zLCAidGhpbmsiOiB0aGlua30KICAgIHBhcmFzID0gW3AgZm9yIHAgaW4gcmUuc3BsaXQociJcblxzKlxuIiwgdGV4dCkgaWYgcC5zdHJpcCgpXQogICAgd29yZHMgPSBsZW4odGV4dC5zcGxpdCgpKSBvciAxCiAgICBpdGVtcyA9IFtdCiAgICBmb3IgaSwgcCBpbiBlbnVtZXJhdGUocGFyYXMpOgogICAgICAgIHB3ID0gbGVuKHAuc3BsaXQoKSkKICAgICAgICBpZiBwdyA+IDE2MDoKICAgICAgICAgICAgaXRlbXMuYXBwZW5kKGYiUGFyYWdyYXBoIHtpKzF9IGlzIHtwd30gd29yZHM7IGEgcmVhZGVyJ3MgYXR0ZW50aW9uIHRoaW5zIGFyb3VuZCAxNTAuIE9uZSBicmVhdGgsIG9uZSBpZGVhLiIpCiAgICBoZWRnZSA9IGxlbihIRURHRS5maW5kYWxsKHRleHQpKSAvIG1heCgxLCB3b3JkcyAvIDIwMCkKICAgIGlmIGhlZGdlID4gMS41OgogICAgICAgIGl0ZW1zLmFwcGVuZChmIkhlZGdlZCBhYm91dCB7cm91bmQoaGVkZ2UsMSl9IHRpbWVzIHBlciAyMDAgd29yZHM7IGFuIHVuc3VyZSB3cml0ZXIgbWFrZXMgYW4gdW5zdXJlIHJlYWRlci4iKQogICAgc2lnbnMgPSBsZW4ocmUuZmluZGFsbChyIlxiKGhvd2V2ZXJ8bW9yZW92ZXJ8dGhlcmVmb3JlfHRodXN8aGVuY2V8bWVhbndoaWxlfGJ5IGNvbnRyYXN0fGluIGNvbnRyYXN0fGZpcnN0bHl8ZmluYWxseSlcYiIsIHRleHQsIHJlLkkpKQogICAgaWYgbGVuKHBhcmFzKSA+IDIgYW5kIHNpZ25zIDwgKGxlbihwYXJhcykgKyAxKSAvLyAyOgogICAgICAgIGl0ZW1zLmFwcGVuZCgiTG9uZyBzdHJldGNoZXMgY2Fycnkgbm8gc2lnbnBvc3QgKGhvd2V2ZXIsIHRoZXJlZm9yZSwgbWVhbndoaWxlKTsgYSByZWFkZXIgbG9zZXMgdGhlIHRocmVhZCBhbmQgcmUtcmVhZHMuIikKICAgIG92ZXIgPSByZS5maW5kYWxsKHIiXGIob2J2aW91c2x5fGNsZWFybHl8dW5kZW5pYWJseXxwcm92ZXM/fHByb3ZlbnxldmVyeW9uZSBrbm93cylcYiIsIHRleHQsIHJlLkkpCiAgICBpZiBvdmVyOgogICAgICAgIGl0ZW1zLmFwcGVuZChmJyJ7b3ZlclswXS5sb3dlcigpfSIgdGVsbHMgdGhlIHJlYWRlciB0aGUgcG9pbnQgbmVlZHMgbm8gc3VwcG9ydDsgdGhhdCBpcyB3aGVyZSBhIGNhcmVmdWwgcmVhZGVyIHB1c2hlcyBiYWNrLicpCiAgICBwYXNzaXZlID0gbGVuKHJlLmZpbmRhbGwociJcYig/Ondhc3x3ZXJlfGlzIGJlaW5nfGhhcyBiZWVufGhhZCBiZWVuKVxzK1x3Kyg/OmVkfGVuKVxiIiwgdGV4dCwgcmUuSSkpCiAgICBpZiBwYXNzaXZlID4gMjoKICAgICAgICBpdGVtcy5hcHBlbmQoZiJ7cGFzc2l2ZX0gcGFzc2l2ZXM6IHRoZSBhY3RvciBrZWVwcyB2YW5pc2hpbmc7IGEgcmVhZGVyIGFza3Mgd2hvIGRpZCB0aGlzLiIpCiAgICBpZiBub3QgaXRlbXM6CiAgICAgICAgaXRlbXMgPSBbIlRoZSBwYWdlIGhvbGRzIHRvZ2V0aGVyLiBBIGNhbG0gcmVhZGVyIGZpbmRzIGxpdHRsZSB0byB0cmlwIG9uIGhlcmUuIl0KICAgIHJldHVybiB7Iml0ZW1zIjogaXRlbXNbOjVdfQoKCmRlZiBlcF9yZXdyaXRlKGJvZHkpOgogICAgdGV4dCA9IGJvZHkuZ2V0KCJ0ZXh0IiwgIiIpCiAgICBtb2RlID0gYm9keS5nZXQoIm1vZGUiLCAiY29uY2lzZSIpCiAgICBzdHlsZSA9IGJvZHkuZ2V0KCJzdHlsZSIsICIiKQogICAgaW5zdHIgPSBSRVdSSVRFX1BST01QVFMuZ2V0KG1vZGUsIFJFV1JJVEVfUFJPTVBUU1siY29uY2lzZSJdKQogICAgcHJvbXB0ID0gQ1JFRUQgKyBmIntpbnN0cn0uIHtzdHlsZX1cblxue3RleHR9Ii5zdHJpcCgpCiAgICByYXcgPSBnZW5lcmF0ZShwcm9tcHQsIG1heF9uZXdfdG9rZW5zPW1pbigxMjAwLCBsZW4odGV4dC5zcGxpdCgpKSAqIDMgKyAxNTApKQogICAgYW5zLCB0aGsgPSBzcGxpdF9vZmZfdGhpbmsocmF3KSBpZiByYXcgZWxzZSAoTm9uZSwgTm9uZSkKICAgIGlmIGFuczoKICAgICAgICByZXR1cm4geyJ0ZXh0IjogYW5zLCAidGhpbmsiOiB0aGt9CiAgICByZXR1cm4geyJ0ZXh0IjogaGV1cmlzdGljX3Jld3JpdGUodGV4dCwgbW9kZSksICJ0aGluayI6IE5vbmV9CgoKZGVmIGVwX3Jld3JpdGVfcHJlc2V0KGJvZHkpOgogICAgIiIiR3JhbW1hcmx5LXN0eWxlIHByZXNldCByZXdyaXRlOiBhcHBsaWVzIGEgbmFtZWQgcmV3cml0aW5nIGdvYWwKICAgIChmb3JtYWwsIGNvbmNpc2UsIGVuZ2FnaW5nLCBldGMuKSB0byB0aGUgZ2l2ZW4gdGV4dC4iIiIKICAgIHRleHQgPSBib2R5LmdldCgidGV4dCIsICIiKQogICAgcHJlc2V0ID0gYm9keS5nZXQoInByZXNldCIsICIiKQogICAgY29udGV4dCA9IGJvZHkuZ2V0KCJjb250ZXh0IiwgIiIpICAjIG9wdGlvbmFsIHN1cnJvdW5kaW5nIHRleHQgZm9yIGNvbnRleHQKICAgIGluc3RyID0gUkVXUklURV9QUkVTRVRTLmdldChwcmVzZXQpCiAgICBpZiBub3QgaW5zdHI6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogZiJ1bmtub3duIHByZXNldDoge3ByZXNldH0ifQogICAgaWYgbm90IHRleHQuc3RyaXAoKToKICAgICAgICByZXR1cm4geyJvayI6IEZhbHNlLCAiZXJyb3IiOiAibm8gdGV4dCB0byByZXdyaXRlIn0KICAgIGN0eCA9ICIiCiAgICBpZiBjb250ZXh0LnN0cmlwKCk6CiAgICAgICAgY3R4ID0gZiJcblxuQ29udGV4dCAodGhlIHN1cnJvdW5kaW5nIHBhc3NhZ2UsIGZvciByZWZlcmVuY2Ugb25seTsgZG8gbm90IHJld3JpdGUgaXQpOlxue2NvbnRleHRbOjIwMDBdfSIKICAgIHByb21wdCA9IENSRUVEICsgZiJ7aW5zdHJ9XG5cblBhc3NhZ2UgdG8gcmV3cml0ZTpcbnt0ZXh0fXtjdHh9XG5cbk91dHB1dCBPTkxZIHRoZSByZXdyaXR0ZW4gcGFzc2FnZS4gUHJlc2VydmUgZXZlcnkgY2l0YXRpb24sIG51bWJlciwgYW5kIHByb3BlciBub3VuIGV4YWN0bHkuIgogICAgcmF3ID0gZ2VuZXJhdGUocHJvbXB0LCBtYXhfbmV3X3Rva2Vucz1taW4oMTUwMCwgbGVuKHRleHQuc3BsaXQoKSkgKiAzICsgMjAwKSkKICAgIGFucywgdGhrID0gc3BsaXRfb2ZmX3RoaW5rKHJhdykgaWYgcmF3IGVsc2UgKE5vbmUsIE5vbmUpCiAgICBpZiBhbnM6CiAgICAgICAgcmV0dXJuIHsib2siOiBUcnVlLCAidGV4dCI6IGFucywgInRoaW5rIjogdGhrLCAicHJlc2V0IjogcHJlc2V0fQogICAgIyBoZXVyaXN0aWMgZmFsbGJhY2s6IGFwcGx5IHdoYXQgd2UgY2FuIHdpdGhvdXQgYSBtb2RlbAogICAgcmV0dXJuIHsib2siOiBUcnVlLCAidGV4dCI6IGhldXJpc3RpY19yZXdyaXRlKHRleHQsICJjb25jaXNlIiBpZiAiY29uY2lzZSIgaW4gcHJlc2V0IGVsc2UgIiIpLAogICAgICAgICAgICAidGhpbmsiOiBOb25lLCAicHJlc2V0IjogcHJlc2V0LCAiZmFsbGJhY2siOiBUcnVlfQoKCmRlZiBlcF9yZXdyaXRlX2N1c3RvbShib2R5KToKICAgICIiIkN1c3RvbSByZXdyaXRlOiB0aGUgdXNlciBwcm92aWRlcyB0aGVpciBvd24gaW5zdHJ1Y3Rpb24gZm9yIGhvdwogICAgdGhlIHRleHQgc2hvdWxkIGJlIHJld3JpdHRlbiwgbGlrZSBHcmFtbWFybHkncyBjdXN0b20gcmV3cml0ZSBmZWF0dXJlLiIiIgogICAgdGV4dCA9IGJvZHkuZ2V0KCJ0ZXh0IiwgIiIpCiAgICBpbnN0cnVjdGlvbiA9IGJvZHkuZ2V0KCJpbnN0cnVjdGlvbiIsICIiKQogICAgaWYgbm90IHRleHQuc3RyaXAoKToKICAgICAgICByZXR1cm4geyJvayI6IEZhbHNlLCAiZXJyb3IiOiAibm8gdGV4dCB0byByZXdyaXRlIn0KICAgIGlmIG5vdCBpbnN0cnVjdGlvbi5zdHJpcCgpOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJubyBpbnN0cnVjdGlvbiBwcm92aWRlZCJ9CiAgICBwcm9tcHQgPSAoQ1JFRUQgKyBmIlRoZSB1c2VyIHdhbnRzIHRoZSBmb2xsb3dpbmcgcGFzc2FnZSByZXdyaXR0ZW4gd2l0aCB0aGlzIHNwZWNpZmljIGdvYWw6ICIKICAgICAgICAgICAgICBmIntpbnN0cnVjdGlvbn1cblxuUGFzc2FnZTpcbnt0ZXh0fVxuXG4iCiAgICAgICAgICAgICAgZiJPdXRwdXQgT05MWSB0aGUgcmV3cml0dGVuIHBhc3NhZ2UuIFByZXNlcnZlIGV2ZXJ5IGNpdGF0aW9uLCBudW1iZXIsIGFuZCBwcm9wZXIgbm91bi4gIgogICAgICAgICAgICAgIGYiRG8gbm90IGZhYnJpY2F0ZSBmYWN0cywgY2l0YXRpb25zLCBvciBzdGF0aXN0aWNzLiIpCiAgICByYXcgPSBnZW5lcmF0ZShwcm9tcHQsIG1heF9uZXdfdG9rZW5zPW1pbigxNTAwLCBsZW4odGV4dC5zcGxpdCgpKSAqIDMgKyAyMDApKQogICAgYW5zLCB0aGsgPSBzcGxpdF9vZmZfdGhpbmsocmF3KSBpZiByYXcgZWxzZSAoTm9uZSwgTm9uZSkKICAgIGlmIGFuczoKICAgICAgICByZXR1cm4geyJvayI6IFRydWUsICJ0ZXh0IjogYW5zLCAidGhpbmsiOiB0aGt9CiAgICByZXR1cm4geyJvayI6IEZhbHNlLCAiZXJyb3IiOiAiQUkgbW9kZWwgdW5hdmFpbGFibGUuIEluc3RhbGwgdHJhbnNmb3JtZXJzOiBwaXAgaW5zdGFsbCB0cmFuc2Zvcm1lcnMgdG9yY2giLAogICAgICAgICAgICAidGV4dCI6IHRleHQsICJ0aGluayI6IE5vbmV9CgoKZGVmIGVwX3ByZXNldHMoYm9keSk6CiAgICAiIiJSZXR1cm4gdGhlIGF2YWlsYWJsZSByZXdyaXRlIHByZXNldHMgYW5kIG1vZGVzIHNvIHRoZSBhcHAgY2FuCiAgICBidWlsZCBpdHMgVUkgZHluYW1pY2FsbHkuIiIiCiAgICByZXR1cm4gewogICAgICAgICJvayI6IFRydWUsCiAgICAgICAgInByZXNldHMiOiBsaXN0KFJFV1JJVEVfUFJFU0VUUy5rZXlzKCkpLAogICAgICAgICJtb2RlcyI6IGxpc3QoUkVXUklURV9QUk9NUFRTLmtleXMoKSksCiAgICB9CgoKZGVmIGVwX2NvbXBvc2UoYm9keSk6CiAgICBpbnN0ciA9IGJvZHkuZ2V0KCJpbnN0cnVjdGlvbiIsICIiKQogICAgc3R5bGUgPSBib2R5LmdldCgic3R5bGUiLCAiIikKICAgIHJhdyA9IGdlbmVyYXRlKENSRUVEICsgZiJXcml0ZSBleGFjdGx5IHdoYXQgaXMgYXNrZWQgaW4gY2xlYXIsIHdlbGwtc3RydWN0dXJlZCBwcm9zZS4gIgogICAgICAgICAgICAgICAgICAgZiJVc2UgcHJlY2lzZSBkaWN0aW9uLCB2YXJpZWQgc2VudGVuY2Ugc3RydWN0dXJlLCBhbmQgc21vb3RoIHRyYW5zaXRpb25zLiAiCiAgICAgICAgICAgICAgICAgICBmIkRvIG5vdCBmYWJyaWNhdGUgY2l0YXRpb25zLCBzdGF0aXN0aWNzIG9yIGZhY3RzLiB7c3R5bGV9XG5cbntpbnN0cn0iLCA4MDApCiAgICBhbnMsIHRoayA9IHNwbGl0X29mZl90aGluayhyYXcpIGlmIHJhdyBlbHNlIChOb25lLCBOb25lKQogICAgcmV0dXJuIHsidGV4dCI6IGFucyBvciAiIiwgInRoaW5rIjogdGhrfQoKCkhFREdFID0gcmUuY29tcGlsZShyIlxiKG1pZ2h0fG1heWJlfHBlcmhhcHN8c29ydCBvZnxraW5kIG9mfEkgdGhpbmt8cG9zc2libHl8SSBndWVzc3xzdWdnZXN0cz98YXBwZWFycz8pXGIiLCByZS5JKQpTVFJPTkcgPSByZS5jb21waWxlKHIiXGIod2lsbHxtdXN0fGNsZWFybHl8ZGVmaW5pdGVseXxjZXJ0YWlubHl8cHJvdmVufGFsd2F5c3xuZXZlcilcYiIsIHJlLkkpCgoKZGVmIGVwX3RvbmUoYm9keSk6CiAgICB0ZXh0ID0gYm9keS5nZXQoInRleHQiLCAiIikKICAgIGlmIEFJWyJyZWFkeSJdOgogICAgICAgIG91dCA9IGdlbmVyYXRlKENSRUVEICsgIkdpdmUgYSAyLTMgd29yZCB0b25lIGxhYmVsIGZvciB0aGlzIHRleHQsIHRoZW4gJyB8ICcsIHRoZW4gb25lIHNob3J0IHRpcC5cblxuIiArIHRleHRbOjEyMDBdLCA2MCkKICAgICAgICBvdXQgPSBzcGxpdF9vZmZfdGhpbmsob3V0KVswXSBpZiBvdXQgZWxzZSBvdXQKICAgICAgICBpZiBvdXQgYW5kICJ8IiBpbiBvdXQ6CiAgICAgICAgICAgIGxhYmVsLCB0aXAgPSAocC5zdHJpcCgpIGZvciBwIGluIG91dC5zcGxpdCgifCIsIDEpKQogICAgICAgICAgICByZXR1cm4geyJsYWJlbCI6IGxhYmVsLCAidGlwcyI6IFt0aXBdfQogICAgaGVkZ2VzID0gbGVuKEhFREdFLmZpbmRhbGwodGV4dCkpCiAgICBzdHJvbmcgPSBsZW4oU1RST05HLmZpbmRhbGwodGV4dCkpCiAgICBleGNsID0gdGV4dC5jb3VudCgiISIpCiAgICBzY29yZSA9IDAuNSArIDAuMTIgKiBzdHJvbmcgLSAwLjEyICogaGVkZ2VzICsgMC4wMyAqIGV4Y2wKICAgIGxhYmVsID0gKCJDb25maWRlbnQgLyBhc3NlcnRpdmUiIGlmIHNjb3JlID4gMC43CiAgICAgICAgICAgICBlbHNlICJIZXNpdGFudCAvIHRlbnRhdGl2ZSIgaWYgc2NvcmUgPCAwLjM1IGVsc2UgIk5ldXRyYWwiKQogICAgdGlwcyA9IFtdCiAgICBpZiBoZWRnZXMgPiAyOgogICAgICAgIHRpcHMuYXBwZW5kKCJzZXZlcmFsIGhlZGdlczsga2VlcCB0aGVtIG9uIGNsYWltcywgY3V0IHRoZW0gZnJvbSBmYWN0cyIpCiAgICBpZiBleGNsOgogICAgICAgIHRpcHMuYXBwZW5kKCJleGNsYW1hdGlvbiBtYXJrcyByZWFkIGFzIGVtb3Rpb25hbDsgbGV0IGV2aWRlbmNlIGNhcnJ5IGVtcGhhc2lzIikKICAgIHJldHVybiB7ImxhYmVsIjogbGFiZWwsICJ0aXBzIjogdGlwc30KCgpkZWYgc2hpbmdsZXModGV4dCwgbj02KToKICAgIHcgPSByZS5maW5kYWxsKHIiW2EteiddKyIsIHRleHQubG93ZXIoKSkKICAgIHJldHVybiB7IiAiLmpvaW4od1tpOmkgKyBuXSkgZm9yIGkgaW4gcmFuZ2UobGVuKHcpIC0gbiArIDEpfQoKCmRlZiBlcF9zaW1pbGFyaXR5KGJvZHkpOgogICAgYSA9IHNoaW5nbGVzKGJvZHkuZ2V0KCJ0ZXh0IiwgIiIpKQogICAgbWF0Y2hlcyA9IFtdCiAgICBmb3IgZCBpbiBib2R5LmdldCgibGlicmFyeSIsIFtdKToKICAgICAgICBiID0gc2hpbmdsZXMoZC5nZXQoInRleHQiLCAiIikpCiAgICAgICAgaWYgbm90IGEgb3Igbm90IGI6CiAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgb3YgPSBsZW4oYSAmIGIpIC8gbWluKGxlbihhKSwgbGVuKGIpKQogICAgICAgIGlmIG92ID4gMC4wNjoKICAgICAgICAgICAgbWF0Y2hlcy5hcHBlbmQoeyJ0aXRsZSI6IGQuZ2V0KCJ0aXRsZSIsICJVbnRpdGxlZCIpLCAib3ZlcmxhcCI6IHJvdW5kKG92LCAzKX0pCiAgICBtYXRjaGVzLnNvcnQoa2V5PWxhbWJkYSBtOiAtbVsib3ZlcmxhcCJdKQogICAgcmV0dXJuIHsibWF0Y2hlcyI6IG1hdGNoZXNbOjVdfQoKCkZPTExPV1VQUyA9IFsKICAgICJXaHkgZG8geW91IGJlbGlldmUgdGhhdCBob2xkcz8iLAogICAgIldoYXQgY29uY3JldGUgZXhhbXBsZSB3b3VsZCBzZXR0bGUgaXQ/IiwKICAgICJXaGF0IGZvbGxvd3MgZnJvbSB0aGF0OyBhbmQgd2hhdCBmb2xsb3dzIGlmIGl0IHdlcmUgZmFsc2U/IiwKICAgICJXaG8gZGlzYWdyZWVzLCBhbmQgd2hhdCBpcyB0aGVpciBzdHJvbmdlc3QgcG9pbnQ/IiwKICAgICJXaGF0IGV2aWRlbmNlIHdvdWxkIGNoYW5nZSB5b3VyIG1pbmQ/IiwKXQoKCmRlZiBlcF9zb2NyYXQoYm9keSk6CiAgICBzdGFnZSA9IGJvZHkuZ2V0KCJzdGFnZSIsICJRdWVzdGlvbiIpCiAgICBhbnN3ZXIgPSBib2R5LmdldCgiYW5zd2VyIiwgIiIpCiAgICBpZiBBSVsicmVhZHkiXToKICAgICAgICBvdXQgPSBnZW5lcmF0ZSgKICAgICAgICAgICAgQ1JFRUQgKyAiWW91IGFyZSBTb2NyYXRlcyBzdXBlcnZpc2luZyBhIGRvY3RvcmFsIHdyaXRlci4gR2l2ZW4gdGhlaXIgYW5zd2VyLCBhc2sgZXhhY3RseSBPTkUgIgogICAgICAgICAgICAic2hvcnQgcXVlc3Rpb24gKG1heCAyMiB3b3JkcykgdGhhdCBwcm9iZXMgYSB3ZWFrIGFzc3VtcHRpb24sIGV4cG9zZXMgYSBoaWRkZW4gcHJlbWlzZSwgb3IgIgogICAgICAgICAgICBmInB1c2hlcyB0b3dhcmQgcHJlY2lzaW9uLiBPdXRwdXQgT05MWSB0aGUgcXVlc3Rpb24uXG5cblN0YWdlOiB7c3RhZ2V9XG5UaGVpciBhbnN3ZXI6IHthbnN3ZXJ9IiwgODApCiAgICAgICAgaWYgb3V0OgogICAgICAgICAgICBhbnMsIHRoayA9IHNwbGl0X29mZl90aGluayhvdXQpCiAgICAgICAgICAgIHJldHVybiB7InF1ZXN0aW9uIjogYW5zLnN0cmlwKCJcIidgIiksICJ0aGluayI6IHRoa30KICAgIGltcG9ydCByYW5kb20KICAgIHJldHVybiB7InF1ZXN0aW9uIjogcmFuZG9tLmNob2ljZShGT0xMT1dVUFMpfQoKCmRlZiBlcF9yZXZpZXcoYm9keSk6CiAgICB0ZXh0ID0gYm9keS5nZXQoInRleHQiLCAiIilbOjkwMDBdCiAgICBpZiBBSVsicmVhZHkiXToKICAgICAgICBvdXQgPSBnZW5lcmF0ZSgKICAgICAgICAgICAgQ1JFRUQgKyAiWW91IGFyZSBhIHJpZ29yb3VzIGJ1dCBmYWlyIGRvY3RvcmFsIGV4YW1pbmVyIGF0IGEgbGVhZGluZyByZXNlYXJjaCB1bml2ZXJzaXR5LiAiCiAgICAgICAgICAgICJJZGVudGlmeSB0aGUgNCBzdHJvbmdlc3Qgb2JqZWN0aW9ucyB0byB0aGUgYXJndW1lbnQgaW4gdGhpcyB0ZXh0LiBMb29rIGZvcjogdW5zdXBwb3J0ZWQgIgogICAgICAgICAgICAiZW1waXJpY2FsIGNsYWltcywgb3ZlcmNsYWltcyBiZXlvbmQgdGhlIGV2aWRlbmNlLCBtaXNzaW5nIHdhcnJhbnRzIGNvbm5lY3RpbmcgZGF0YSB0byAiCiAgICAgICAgICAgICJjb25jbHVzaW9ucywgdW5hZGRyZXNzZWQgY291bnRlci1ldmlkZW5jZSwgY2lyY3VsYXIgcmVhc29uaW5nLCBkZWZpbml0aW9uYWwgc2xpcHBhZ2UsICIKICAgICAgICAgICAgImFuZCBtZXRob2RvbG9naWNhbCBnYXBzLiBFYWNoIG9iamVjdGlvbiBtdXN0IGJlIHNwZWNpZmljIHRvIHRoZSB0ZXh0LCBub3QgZ2VuZXJpYy4gIgogICAgICAgICAgICAiT3V0cHV0IE9OTFkgYSBudW1iZXJlZCBsaXN0LCBvbmUgb2JqZWN0aW9uIHBlciBsaW5lLCBhdCBtb3N0IDI4IHdvcmRzIGVhY2guXG5cbiIKICAgICAgICAgICAgZiJ7dGV4dH0iLCA0MDApCiAgICAgICAgaWYgb3V0OgogICAgICAgICAgICBpdGVtcyA9IFtyZS5zdWIociJeXHMqWy0qXGRdK1spLlxzXSoiLCAiIiwgbCkuc3RyaXAoKQogICAgICAgICAgICAgICAgICAgICBmb3IgbCBpbiBvdXQuc3BsaXRsaW5lcygpXQogICAgICAgICAgICB0aGluayA9IE5vbmUKICAgICAgICAgICAgcmF3X2l0ZW1zID0gaXRlbXMKICAgICAgICAgICAgaWYgcmF3X2l0ZW1zOgogICAgICAgICAgICAgICAgXywgdGhpbmsgPSBzcGxpdF9vZmZfdGhpbmsocmF3X2l0ZW1zWzBdKSBpZiByYXdfaXRlbXMgZWxzZSAoTm9uZSwgTm9uZSkKICAgICAgICAgICAgaXRlbXMgPSBbbCBmb3IgbCBpbiByYXdfaXRlbXMgaWYgbGVuKGwpID4gMTJdWzo1XQogICAgICAgICAgICBpZiBpdGVtczoKICAgICAgICAgICAgICAgIHJldHVybiB7Iml0ZW1zIjogaXRlbXMsICJ0aGluayI6IHRoaW5rfQogICAgIyBoZXVyaXN0aWMgZmFsbGJhY2sgKG1pcnJvcnMgdGhlIGJyb3dzZXIncyBydWxlcy1iYXNlZCBwYXNzKQogICAgaXRlbXMgPSBbXQogICAgb3ZlciA9IHJlLmZpbmRhbGwociJcYihwcm92ZVtzZF0/fHByb3ZlbnxvYnZpb3VzbHl8Y2xlYXJseXx1bmRlbmlhYmx5fGV2ZXJ5b25lIGtub3dzfGl0IGlzIHdlbGwga25vd24pXGIiLCB0ZXh0LCByZS5JKQogICAgaWYgb3ZlcjoKICAgICAgICBpdGVtcy5hcHBlbmQoZidPdmVyY2xhaW06ICJ7b3ZlclswXS5sb3dlcigpfSIgYXNzZXJ0cyB3aGF0IGFuIGV4YW1pbmVyIGV4cGVjdHMgeW91IHRvIGFyZ3VlOyB3aGVyZSBpcyB0aGUgZGVtb25zdHJhdGlvbj8nKQogICAgY2l0ZXMgPSByZS5maW5kYWxsKHIiXCgoPzoxOXwyMClcZFxkIiwgdGV4dCkgKyByZS5maW5kYWxsKHIiXFtbXGQsXHNcLeKAk10rXF0iLCB0ZXh0KQogICAgaWYgbGVuKHRleHQuc3BsaXQoKSkgPiA4MCBhbmQgbm90IGNpdGVzOgogICAgICAgIGl0ZW1zLmFwcGVuZCgiTm8gY2l0YXRpb25zIGRldGVjdGVkLiBXaGljaCBjbGFpbXMgd291bGQgYSBza2VwdGljIGFjY2VwdCB3aXRob3V0IGEgc291cmNlOyBhbmQgd2hpY2ggbm90PyIpCiAgICBpZiBsZW4odGV4dC5zcGxpdCgpKSA+IDEyMCBhbmQgbm90IHJlLnNlYXJjaChyIlxiKGhvd2V2ZXJ8YnV0fG9iamVjdGlvbnxuZXZlcnRoZWxlc3N8aW4gY29udHJhc3R8YWRtaXR0ZWRseSlcYiIsIHRleHQsIHJlLkkpOgogICAgICAgIGl0ZW1zLmFwcGVuZCgiTm8gY291bnRlci1tb3ZlIGRldGVjdGVkOiB0aGUgZHJhZnQgbmV2ZXIgdm9pY2VzIHRoZSBvcHBvc2luZyB2aWV3LiBTdGVlbG1hbiBpdCwgb3IgdGhlIGV4YW1pbmVyIHdpbGwuIikKICAgIGlmIG5vdCBpdGVtczoKICAgICAgICBpdGVtcyA9IFsiSXMgdGhlIGNlbnRyYWwgY2xhaW0gZmFsc2lmaWFibGU7IHdoYXQgZXZpZGVuY2Ugd291bGQgZm9yY2UgeW91IHRvIHF1YWxpZnkgb3IgYWJhbmRvbiBpdD8iLAogICAgICAgICAgICAgICAgICJXaGF0IGlzIHRoZSBzdHJvbmdlc3QgY29tcGV0aW5nIGV4cGxhbmF0aW9uIGZvciB0aGUgc2FtZSBvYnNlcnZhdGlvbnM/Il0KICAgIHJldHVybiB7Iml0ZW1zIjogaXRlbXNbOjVdfQoKCmRlZiBlcF9zZWxlY3RfbW9kZWwoYm9keSk6CiAgICBuYW1lID0gYm9keS5nZXQoIm5hbWUiLCAiIikKICAgIGNhbmQgPSBuZXh0KChjIGZvciBjIGluIHNjYW5fbG9jYWxfbW9kZWxzKCkgaWYgY1sibmFtZSJdID09IG5hbWUpLCBOb25lKQogICAgaWYgbm90IGNhbmQ6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vdCBmb3VuZCJ9CiAgICBjID0gY29uZl9yZWFkKCk7IGNbImFjdGl2ZSJdID0gbmFtZTsgY29uZl93cml0ZShjKQogICAgd2l0aCBfYWlfbG9jazoKICAgICAgICAjIGhvdCBzd2FwOiBvdXQgd2l0aCB0aGUgb2xkLCBpbiB3aXRoIHRoZSBuZXcsIHJpZ2h0IG5vdwogICAgICAgIHVubG9hZF9sb2NhbCgpCiAgICAgICAgb2sgPSBsb2FkX2xvY2FsX3BhdGgoY2FuZCkKICAgIHJldHVybiB7Im9rIjogb2ssICJhY3RpdmUiOiBBSS5nZXQoImxvY2FsX25hbWUiKSwKICAgICAgICAgICAgImtpbmQiOiBBSS5nZXQoImxvY2FsX2tpbmQiKSBpZiBvayBlbHNlIE5vbmUsCiAgICAgICAgICAgICJlcnJvciI6IE5vbmUgaWYgb2sgZWxzZSBBSS5nZXQoImxvYWRfZXJyb3IiKX0KCgpkZWYgZXBfcmVtb3ZlX21vZGVsKGJvZHkpOgogICAgaW1wb3J0IHNodXRpbAogICAgbmFtZSA9IGJvZHkuZ2V0KCJuYW1lIiwgIiIpCiAgICBjYW5kID0gbmV4dCgoYyBmb3IgYyBpbiBzY2FuX2xvY2FsX21vZGVscygpIGlmIGNbIm5hbWUiXSA9PSBuYW1lKSwgTm9uZSkKICAgIGlmIG5vdCBjYW5kOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJub3QgZm91bmQifQogICAgaWYgQUkuZ2V0KCJsb2NhbF9uYW1lIikgPT0gbmFtZToKICAgICAgICB3aXRoIF9haV9sb2NrOgogICAgICAgICAgICB1bmxvYWRfbG9jYWwoKQogICAgICAgIGMgPSBjb25mX3JlYWQoKTsgYy5wb3AoImFjdGl2ZSIsIE5vbmUpOyBjb25mX3dyaXRlKGMpCiAgICB0cnk6CiAgICAgICAgaWYgb3MucGF0aC5pc2RpcihjYW5kWyJwYXRoIl0pOgogICAgICAgICAgICBzaHV0aWwucm10cmVlKGNhbmRbInBhdGgiXSkKICAgICAgICBlbHNlOgogICAgICAgICAgICBvcy5yZW1vdmUoY2FuZFsicGF0aCJdKQogICAgICAgIHJldHVybiB7Im9rIjogVHJ1ZX0KICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICByZXR1cm4geyJvayI6IEZhbHNlLCAiZXJyb3IiOiBzdHIoZSl9CgoKIyAtLS0gbGlicmFyeSBzeW5jIGJldHdlZW4geW91ciBkZXZpY2VzIC0tLQojIFRoZSBsYXB0b3AgaXMgdGhlIGh1YjogYW55IGRldmljZSBwdXNoZXMgaXRzIHdob2xlIGxpYnJhcnkgaGVyZSwgYW55IGRldmljZQojIHB1bGxzIGl0IGJhY2suIE9uZSBzaGFyZWQgY29weSBiZXNpZGUgdGhlIHNlcnZlciwgbmV3ZXN0IHB1c2ggd2lucy4gVGhlIGFwcAojIG1lcmdlcyBvbiBwdWxsLCBhZGRpbmcgb25seSB3aGF0IGl0IGRvZXMgbm90IGFscmVhZHkgaGF2ZS4gTm90aGluZyBsZWF2ZXMKIyB0aGUgbmV0d29yayB5b3UgYXJlIG9uLgpkZWYgZXBfc3luY19wdXNoKGJvZHkpOgogICAgZG9jcyA9IGJvZHkuZ2V0KCJkb2NzIiwgW10pCiAgICBub3RlcyA9IGJvZHkuZ2V0KCJub3RlcyIsIFtdKQogICAgaWYgbm90IGlzaW5zdGFuY2UoZG9jcywgbGlzdCkgb3Igbm90IGlzaW5zdGFuY2Uobm90ZXMsIGxpc3QpOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJkb2NzIGFuZCBub3RlcyBtdXN0IGJlIGxpc3RzIn0KICAgIHBheWxvYWQgPSB7InNhdmVkX2F0IjogdGltZS5zdHJmdGltZSgiJVktJW0tJWQgJUg6JU0iKSwKICAgICAgICAgICAgICAgImRvY3MiOiBkb2NzLCAibm90ZXMiOiBub3Rlc30KICAgIHRyeToKICAgICAgICB0bXAgPSBTWU5DX1BBVEggKyAiLnRtcCIKICAgICAgICB3aXRoIG9wZW4odG1wLCAidyIpIGFzIGY6CiAgICAgICAgICAgIGpzb24uZHVtcChwYXlsb2FkLCBmKQogICAgICAgIG9zLnJlcGxhY2UodG1wLCBTWU5DX1BBVEgpCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogc3RyKGUpfQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAic2F2ZWRfYXQiOiBwYXlsb2FkWyJzYXZlZF9hdCJdLAogICAgICAgICAgICAiZG9jcyI6IGxlbihkb2NzKSwgIm5vdGVzIjogbGVuKG5vdGVzKX0KCgpkZWYgZXBfc3luY19wdWxsKF9ib2R5KToKICAgIHRyeToKICAgICAgICB3aXRoIG9wZW4oU1lOQ19QQVRIKSBhcyBmOgogICAgICAgICAgICBkYXRhID0ganNvbi5sb2FkKGYpCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJub3RoaW5nIGhhcyBiZWVuIHB1c2hlZCB5ZXQifQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAic2F2ZWRfYXQiOiBkYXRhLmdldCgic2F2ZWRfYXQiKSwKICAgICAgICAgICAgImRvY3MiOiBkYXRhLmdldCgiZG9jcyIsIFtdKSwgIm5vdGVzIjogZGF0YS5nZXQoIm5vdGVzIiwgW10pfQoKCmRlZiBlcF90cmFuc2NyaWJlKGJvZHkpOgogICAgIiIiU2NyaWJhJ3MgcmVjb3JkLXRoZW4tdHJhbnNjcmliZSBlbmRwb2ludC4gQWNjZXB0cyBiYXNlNjQgYXVkaW8sCiAgICByZXR1cm5zIHRyYW5zY3JpYmVkIHRleHQgdXNpbmcgV2hpc3Blci4gV29ya3MgZnVsbHkgb2ZmbGluZS4KICAgIE9wdGlvbmFsICdsYW5ndWFnZScgZmllbGQgKGUuZy4gJ2VuJywgJ2ZyJykgZm9yIG11bHRpbGluZ3VhbCBXaGlzcGVyLiIiIgogICAgaW1wb3J0IGJhc2U2NCBhcyBfYjY0CiAgICBhdWRpb19iNjQgPSBib2R5LmdldCgiYXVkaW8iLCAiIikKICAgIGlmIG5vdCBhdWRpb19iNjQ6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vIGF1ZGlvIGRhdGEifQogICAgbGFuZyA9IHN0cihib2R5LmdldCgibGFuZ3VhZ2UiKSBvciBib2R5LmdldCgibGFuZyIpIG9yICIiKS5zdHJpcCgpLmxvd2VyKCkKICAgIGlmIGxhbmcgaW4gKCIiLCAiYXV0byIsICJkZXRlY3QiKToKICAgICAgICBsYW5nID0gTm9uZQogICAgZWxpZiBsZW4obGFuZykgPiAyOgogICAgICAgIGxhbmcgPSBsYW5nLnNwbGl0KCItIilbMF0uc3BsaXQoIl8iKVswXVs6M10KICAgIHRyeToKICAgICAgICAjIFN0cmlwIGRhdGEgVVJMIHByZWZpeCBpZiBwcmVzZW50CiAgICAgICAgaWYgIiwiIGluIGF1ZGlvX2I2NCBhbmQgYXVkaW9fYjY0LnN0YXJ0c3dpdGgoImRhdGE6Iik6CiAgICAgICAgICAgIGF1ZGlvX2I2NCA9IGF1ZGlvX2I2NC5zcGxpdCgiLCIsIDEpWzFdCiAgICAgICAgYXVkaW9fYnl0ZXMgPSBfYjY0LmI2NGRlY29kZShhdWRpb19iNjQpCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogZiJiYWQgYXVkaW8gZGF0YToge2V9In0KICAgIGlmIGxlbihhdWRpb19ieXRlcykgPCAxMDA6CiAgICAgICAgcmV0dXJuIHsib2siOiBGYWxzZSwgImVycm9yIjogImF1ZGlvIHRvbyBzaG9ydCJ9CiAgICB0ZXh0LCBlcnIsIGluZm8gPSB0cmFuc2NyaWJlX2F1ZGlvKGF1ZGlvX2J5dGVzLCBsYW5ndWFnZT1sYW5nKQogICAgaWYgZXJyOgogICAgICAgIHJldHVybiB7Im9rIjogRmFsc2UsICJlcnJvciI6IGVyciwgImluZm8iOiBpbmZvfQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAidGV4dCI6IHRleHQgb3IgIiIsICJpbmZvIjogaW5mb30KCgpfTkVUID0geyJhdCI6IDAuMCwgIm9ubGluZSI6IEZhbHNlfQoKCmRlZiBfb25saW5lKG1heF9hZ2U9NjAuMCk6CiAgICAiIiJJcyB0aGUgaW50ZXJuZXQgcmVhY2hhYmxlPyBDYWNoZWQgZm9yIGEgbWludXRlIHNvIHRoZSBjaGVjayBuZXZlciBzbG93cyBTY3JpYmEuIiIiCiAgICBub3cgPSB0aW1lLnRpbWUoKQogICAgaWYgbm93IC0gX05FVFsiYXQiXSA8IG1heF9hZ2U6CiAgICAgICAgcmV0dXJuIF9ORVRbIm9ubGluZSJdCiAgICBvayA9IEZhbHNlCiAgICB0cnk6CiAgICAgICAgaW1wb3J0IHVybGxpYi5yZXF1ZXN0IGFzIF91cgogICAgICAgIHJlcSA9IF91ci5SZXF1ZXN0KCJodHRwczovL2FwaS5jcm9zc3JlZi5vcmcvIiwgbWV0aG9kPSJIRUFEIikKICAgICAgICBfdXIudXJsb3BlbihyZXEsIHRpbWVvdXQ9MykKICAgICAgICBvayA9IFRydWUKICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAjIGFuIEhUVFAgZXJyb3Igc3RhdHVzIHN0aWxsIHByb3ZlcyB0aGUgbmV0d29yayBpcyB1cAogICAgICAgIG9rID0gaGFzYXR0cihlLCAiY29kZSIpCiAgICBfTkVUWyJhdCJdLCBfTkVUWyJvbmxpbmUiXSA9IG5vdywgb2sKICAgIHJldHVybiBvawoKCmRlZiBfc3R0X3JlcG9ydCgpOgogICAgcmV0dXJuIHsKICAgICAgICAic3R0X2F2YWlsYWJsZSI6IF9zdHRfYXZhaWxhYmxlKCksCiAgICAgICAgInN0dF9sb2FkZWQiOiBib29sKEFJLmdldCgic3R0IikpLAogICAgICAgICJzdHRfbG9hZGluZyI6IGJvb2woX1NUVF9TVEFURVsibG9hZGluZyJdKSwKICAgICAgICAic3R0X2Vycm9yIjogX1NUVF9TVEFURS5nZXQoImVycm9yIiksCiAgICAgICAgInN0dF9tb2RlbCI6IFNUVF9NT0RFTCwKICAgICAgICAic3R0X211bHRpbGluZ3VhbCI6ICIuZW4iIG5vdCBpbiBTVFRfTU9ERUwsCiAgICAgICAgImZmbXBlZyI6IGJvb2woc2h1dGlsLndoaWNoKCJmZm1wZWciKSksCiAgICB9CgoKZGVmIGVwX25ldF9zdGF0dXMoX2JvZHkpOgogICAgIiIiSW50ZXJuZXQgcmVhY2hhYmlsaXR5IGFuZCB0aGUgdHJhbnNjcmlwdGlvbiBlbmdpbmUncyBzdGF0ZS4iIiIKICAgIG91dCA9IHsib2siOiBUcnVlLCAib25saW5lIjogX29ubGluZSgpLCAic2VydmVyIjogVHJ1ZX0KICAgIG91dC51cGRhdGUoX3N0dF9yZXBvcnQoKSkKICAgIHJldHVybiBvdXQKCgpkZWYgZXBfc3R0X3N0YXR1cyhfYm9keSk6CiAgICAiIiJUaGUgdHJhbnNjcmlwdGlvbiBlbmdpbmUncyBzdGF0ZSwgd2l0aG91dCBsb2FkaW5nIGFueXRoaW5nLiIiIgogICAgb3V0ID0geyJvayI6IFRydWV9CiAgICBvdXQudXBkYXRlKF9zdHRfcmVwb3J0KCkpCiAgICByZXR1cm4gb3V0CgoKUk9VVEVTID0gewogICAgImNvcnJlY3QiOiBlcF9jb3JyZWN0LCAicmV3cml0ZSI6IGVwX3Jld3JpdGUsICJyZXdyaXRlX3ByZXNldCI6IGVwX3Jld3JpdGVfcHJlc2V0LAogICAgInJld3JpdGVfY3VzdG9tIjogZXBfcmV3cml0ZV9jdXN0b20sICJwcmVzZXRzIjogZXBfcHJlc2V0cywKICAgICJjb21wb3NlIjogZXBfY29tcG9zZSwKICAgICJ0b25lIjogZXBfdG9uZSwgInNpbWlsYXJpdHkiOiBlcF9zaW1pbGFyaXR5LCAic29jcmF0IjogZXBfc29jcmF0LAogICAgInJldmlldyI6IGVwX3JldmlldywgInJlYWRlciI6IGVwX3JlYWRlciwgInNlbGVjdF9tb2RlbCI6IGVwX3NlbGVjdF9tb2RlbCwgInJlbW92ZV9tb2RlbCI6IGVwX3JlbW92ZV9tb2RlbCwKICAgICJzeW5jX3B1c2giOiBlcF9zeW5jX3B1c2gsICJzeW5jX3B1bGwiOiBlcF9zeW5jX3B1bGwsCiAgICAidHJhbnNjcmliZSI6IGVwX3RyYW5zY3JpYmUsICJzdHRfc3RhdHVzIjogZXBfc3R0X3N0YXR1cywgIm5ldF9zdGF0dXMiOiBlcF9uZXRfc3RhdHVzLAogICAgInN0dF93YXJtIjogZXBfc3R0X3dhcm0sCn0KCgojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gSFRUUCBsYXllcgpjbGFzcyBIYW5kbGVyKEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIpOgogICAgZGVmIF9zZW5kKHNlbGYsIGNvZGUsIG9iaik6CiAgICAgICAgZGF0YSA9IGpzb24uZHVtcHMob2JqKS5lbmNvZGUoKQogICAgICAgIHNlbGYuc2VuZF9yZXNwb25zZShjb2RlKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtVHlwZSIsICJhcHBsaWNhdGlvbi9qc29uIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4iLCAiKiIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyIsICJDb250ZW50LVR5cGUiKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMiLCAiR0VULCBQT1NULCBPUFRJT05TIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LUxlbmd0aCIsIHN0cihsZW4oZGF0YSkpKQogICAgICAgIHNlbGYuZW5kX2hlYWRlcnMoKQogICAgICAgIHNlbGYud2ZpbGUud3JpdGUoZGF0YSkKCiAgICBkZWYgZG9fT1BUSU9OUyhzZWxmKToKICAgICAgICBzZWxmLl9zZW5kKDIwNCwge30pCgogICAgZGVmIGRvX0dFVChzZWxmKToKICAgICAgICBpZiBzZWxmLnBhdGggPT0gIi9hcGkvaGVhbHRoIjoKICAgICAgICAgICAgbW9kZWwgPSBBSS5nZXQoImxvY2FsX25hbWUiKSBvciAoSU5TVFJVQ1RfTU9ERUwgaWYgQUlbInJlYWR5Il0gZWxzZSBOb25lKQogICAgICAgICAgICBzZWxmLl9zZW5kKDIwMCwgeyJvayI6IFRydWUsICJhaSI6IEFJWyJyZWFkeSJdLCAibW9kZWwiOiBtb2RlbCwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAiZW5naW5lIjogQUkuZ2V0KCJsb2NhbF9raW5kIikgb3IgKCJ0cmFuc2Zvcm1lcnMiIGlmIEFJWyJyZWFkeSJdIGVsc2UgTm9uZSl9KQogICAgICAgIGVsaWYgc2VsZi5wYXRoID09ICIvYXBpL21vZGVscyI6CiAgICAgICAgICAgIHNlbGYuX3NlbmQoMjAwLCB7ImRpciI6IE1PREVMU19ESVIsICJmb3VuZCI6IHNjYW5fbG9jYWxfbW9kZWxzKCksCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgImFjdGl2ZSI6IEFJLmdldCgibG9jYWxfbmFtZSIpfSkKICAgICAgICBlbGlmIHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdIGluICgiL2FwaS9uZXRfc3RhdHVzIiwgIi9hcGkvc3R0X3N0YXR1cyIsICIvYXBpL3ByZXNldHMiKToKICAgICAgICAgICAgIyByZWFkLW9ubHkgZW5kcG9pbnRzIGFuc3dlciBHRVQgYXMgd2VsbCBhcyBQT1NUIChTY3JpYmEgYXNrcyB3aXRoIEdFVCkKICAgICAgICAgICAgbmFtZSA9IHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdW2xlbigiL2FwaS8iKTpdCiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIHNlbGYuX3NlbmQoMjAwLCBST1VURVNbbmFtZV0oe30pKQogICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgICAgICBzZWxmLl9zZW5kKDUwMCwgeyJlcnJvciI6IHN0cihlKX0pCiAgICAgICAgZWxzZToKICAgICAgICAgICAgc2VsZi5fc2VuZCg0MDQsIHsiZXJyb3IiOiAibm90IGZvdW5kIn0pCgogICAgZGVmIGRvX1BPU1Qoc2VsZik6CiAgICAgICAgZnJvbSB1cmxsaWIucGFyc2UgaW1wb3J0IHVybHBhcnNlLCBwYXJzZV9xcwogICAgICAgIHBhcnNlZCA9IHVybHBhcnNlKHNlbGYucGF0aCkKICAgICAgICBpZiBwYXJzZWQucGF0aCA9PSAiL2FwaS91cGxvYWRfbW9kZWwiOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fdXBsb2FkX21vZGVsKHBhcnNlX3FzKHBhcnNlZC5xdWVyeSkpCiAgICAgICAgbSA9IHJlLm1hdGNoKHIiXi9hcGkvKFthLXpfXSspJCIsIHBhcnNlZC5wYXRoKQogICAgICAgIGlmIG0gYW5kIG0uZ3JvdXAoMSkgaW4gKCJsYW5fc3RhdHVzIiwgImxhbl9lbmFibGUiKToKICAgICAgICAgICAgaWYgc2VsZi5jbGllbnRfYWRkcmVzc1swXSBub3QgaW4gKCIxMjcuMC4wLjEiLCAiOjoxIiwgIjo6ZmZmZjoxMjcuMC4wLjEiKToKICAgICAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDQwMywgeyJlcnJvciI6ICJvbmx5IGZyb20gdGhpcyBjb21wdXRlciJ9KQogICAgICAgICAgICB0cnk6CiAgICAgICAgICAgICAgICBib2R5ID0ganNvbi5sb2FkcyhzZWxmLnJmaWxlLnJlYWQoaW50KHNlbGYuaGVhZGVycy5nZXQoIkNvbnRlbnQtTGVuZ3RoIiwgMCkpIG9yIGIie30iKSkKICAgICAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgICAgIGJvZHkgPSB7fQogICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCgyMDAsIChlcF9sYW5fc3RhdHVzIGlmIG0uZ3JvdXAoMSkgPT0gImxhbl9zdGF0dXMiIGVsc2UgZXBfbGFuX2VuYWJsZSkoYm9keSkpCiAgICAgICAgaWYgbm90IG0gb3IgbS5ncm91cCgxKSBub3QgaW4gUk9VVEVTOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCg0MDQsIHsiZXJyb3IiOiAidW5rbm93biBlbmRwb2ludCJ9KQogICAgICAgIHRyeToKICAgICAgICAgICAgYm9keSA9IGpzb24ubG9hZHMoc2VsZi5yZmlsZS5yZWFkKGludChzZWxmLmhlYWRlcnMuZ2V0KCJDb250ZW50LUxlbmd0aCIsIDApKSBvciBiInt9IikpCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICAgICAgcmV0dXJuIHNlbGYuX3NlbmQoNDAwLCB7ImVycm9yIjogImJhZCBqc29uIn0pCiAgICAgICAgdHJ5OgogICAgICAgICAgICBzZWxmLl9zZW5kKDIwMCwgUk9VVEVTW20uZ3JvdXAoMSldKGJvZHkpKQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gZW5kcG9pbnQgZXJyb3I6IHtlfSIpCiAgICAgICAgICAgIHNlbGYuX3NlbmQoNTAwLCB7ImVycm9yIjogc3RyKGUpfSkKCiAgICBkZWYgX3VwbG9hZF9tb2RlbChzZWxmLCBxcyk6CiAgICAgICAgIiIiU3RyZWFtcyBhIG1vZGVsIGZpbGUgZnJvbSBkaXNrIG9udG8gdGhlIHNoZWxmLiBRdWVyeSBwYXJhbXM6CiAgICAgICAgbmFtZSA9IGZpbGUgbmFtZTsgZGlyID0gTUxYIGZvbGRlciBuYW1lIChrZWVwcyBpdHMgaW5uZXIgZmlsZXMpLiIiIgogICAgICAgIHJhd19uYW1lID0gKHFzLmdldCgibmFtZSIsIFsiIl0pWzBdIG9yICIiKS5zdHJpcCgpCiAgICAgICAgc3ViX2RpciA9IChxcy5nZXQoImRpciIsIFsiIl0pWzBdIG9yICIiKS5zdHJpcCgpCiAgICAgICAgaWYgbm90IHJhd19uYW1lOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCg0MDAsIHsiZXJyb3IiOiAibm8gbmFtZSJ9KQogICAgICAgIGZvciBiYWQgaW4gKCIuLiIsICIvIiwgIlxcIiwgb3Muc2VwKToKICAgICAgICAgICAgaWYgYmFkIGluIHJhd19uYW1lIG9yIChzdWJfZGlyIGFuZCBiYWQgaW4gc3ViX2Rpcik6CiAgICAgICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCg0MDAsIHsiZXJyb3IiOiAiYmFkIHBhdGgifSkKICAgICAgICBvcy5tYWtlZGlycyhNT0RFTFNfRElSLCBleGlzdF9vaz1UcnVlKQogICAgICAgIGRlc3QgPSBvcy5wYXRoLmpvaW4oTU9ERUxTX0RJUiwgc3ViX2RpciwgcmF3X25hbWUpIGlmIHN1Yl9kaXIgXAogICAgICAgICAgICBlbHNlIG9zLnBhdGguam9pbihNT0RFTFNfRElSLCByYXdfbmFtZSkKICAgICAgICBvcy5tYWtlZGlycyhvcy5wYXRoLmRpcm5hbWUoZGVzdCksIGV4aXN0X29rPVRydWUpCiAgICAgICAgdHJ5OgogICAgICAgICAgICB0b3RhbCA9IGludChzZWxmLmhlYWRlcnMuZ2V0KCJDb250ZW50LUxlbmd0aCIsIDApIG9yIDApCiAgICAgICAgZXhjZXB0IFZhbHVlRXJyb3I6CiAgICAgICAgICAgIHRvdGFsID0gMAogICAgICAgIHdyaXR0ZW4gPSAwCiAgICAgICAgdHJ5OgogICAgICAgICAgICB3aXRoIG9wZW4oZGVzdCwgIndiIikgYXMgb3V0OgogICAgICAgICAgICAgICAgcmVtYWluaW5nID0gdG90YWwgaWYgdG90YWwgPiAwIGVsc2UgTm9uZQogICAgICAgICAgICAgICAgd2hpbGUgVHJ1ZToKICAgICAgICAgICAgICAgICAgICB3YW50ID0gMSA8PCAyMCBpZiByZW1haW5pbmcgaXMgTm9uZSBlbHNlIG1pbigxIDw8IDIwLCByZW1haW5pbmcpCiAgICAgICAgICAgICAgICAgICAgaWYgd2FudCA8PSAwOgogICAgICAgICAgICAgICAgICAgICAgICBicmVhawogICAgICAgICAgICAgICAgICAgIGNodW5rID0gc2VsZi5yZmlsZS5yZWFkKHdhbnQpCiAgICAgICAgICAgICAgICAgICAgaWYgbm90IGNodW5rOgogICAgICAgICAgICAgICAgICAgICAgICBicmVhawogICAgICAgICAgICAgICAgICAgIG91dC53cml0ZShjaHVuaykKICAgICAgICAgICAgICAgICAgICB3cml0dGVuICs9IGxlbihjaHVuaykKICAgICAgICAgICAgICAgICAgICBpZiByZW1haW5pbmcgaXMgbm90IE5vbmU6CiAgICAgICAgICAgICAgICAgICAgICAgIHJlbWFpbmluZyAtPSBsZW4oY2h1bmspCiAgICAgICAgICAgICAgICAgICAgICAgIGlmIHJlbWFpbmluZyA8PSAwOgogICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWsKICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDUwMCwgeyJlcnJvciI6IHN0cihlKX0pCiAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gbW9kZWwgYXJyaXZlZDoge3Jhd19uYW1lfSAoe3dyaXR0ZW46LH0gYnl0ZXMpIikKICAgICAgICAjIGEgZnJlc2ggR0dVRiBiZWNvbWVzIGFjdGl2ZSB3aGVuIG5vdGhpbmcgZWxzZSBpcyBjaG9zZW4geWV0CiAgICAgICAgaWYgcmF3X25hbWUubG93ZXIoKS5lbmRzd2l0aCgiLmdndWYiKSBhbmQgbm90IGNvbmZfcmVhZCgpLmdldCgiYWN0aXZlIik6CiAgICAgICAgICAgIGMgPSBjb25mX3JlYWQoKTsgY1siYWN0aXZlIl0gPSByYXdfbmFtZTsgY29uZl93cml0ZShjKQogICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDIwMCwgeyJvayI6IFRydWUsICJuYW1lIjogcmF3X25hbWUsICJieXRlcyI6IHdyaXR0ZW59KQoKICAgIGRlZiBsb2dfbWVzc2FnZShzZWxmLCBmbXQsICphcmdzKToKICAgICAgICBwYXNzICAjIHF1aWV0CgoKCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBob21lIG5ldHdvcmsgKHYyLjEyKQojIFRoZSBsYXB0b3AncyBtb2RlbCBmb3IgdGhlIHRhYmxldHMgb24gdGhlIHNhbWUgV2ktRmkuIE9mZiB1bnRpbCBzd2l0Y2hlZCBvbgojIGZyb20gdGhlIGxhcHRvcCBpdHNlbGYuIEEgc2Vjb25kIGxpc3RlbmVyIG9uIExBTl9QT1JUIHNlcnZlcyBvbmx5IHRoZSB3cml0aW5nCiMgYW5kIHZvaWNlIGVuZHBvaW50cywgYW5kIG9ubHkgdG8gYSBkZXZpY2UgdGhhdCBzZW5kcyB0aGUgNi1kaWdpdCBwYWlyaW5nIGNvZGUKIyBpbiBYLUlua3dlbGwtS2V5LiBNb2RlbHMsIHRoZSBzaGVsZiBhbmQgdGhlIHN5bmNlZCBsaWJyYXJ5IGFyZSBuZXZlciBzZXJ2ZWQKIyB0byB0aGUgbmV0d29yay4gVGhlIGNvZGUgYW5kIHRoZSBvbi9vZmYgY2hvaWNlIGxpdmUgaW4gaW5rd2VsbF9sYW4uanNvbi4KaW1wb3J0IGhtYWMKaW1wb3J0IHNlY3JldHMKaW1wb3J0IHNvY2tldAoKTEFOX1BPUlQgPSBpbnQob3MuZW52aXJvbi5nZXQoIklOS1dFTExfTEFOX1BPUlQiLCAiODMxOCIpKQpMQU5fUEFUSCA9IG9zLnBhdGguam9pbihEQVRBX0RJUiwgImlua3dlbGxfbGFuLmpzb24iKQpMQU5fUk9VVEVTID0geyJjb3JyZWN0IiwgInJld3JpdGUiLCAicmV3cml0ZV9wcmVzZXQiLCAicmV3cml0ZV9jdXN0b20iLCAicHJlc2V0cyIsICJjb21wb3NlIiwKICAgICAgICAgICAgICAidG9uZSIsICJzaW1pbGFyaXR5IiwgInNvY3JhdCIsICJyZXZpZXciLCAicmVhZGVyIiwgInRyYW5zY3JpYmUiLCAic3R0X3N0YXR1cyIsCiAgICAgICAgICAgICAgInN0dF93YXJtIiwgIm5ldF9zdGF0dXMifQpMQU4gPSB7InNlcnZlciI6IE5vbmV9CgoKZGVmIGxhbl9jb25mKCk6CiAgICB0cnk6CiAgICAgICAgd2l0aCBvcGVuKExBTl9QQVRILCBlbmNvZGluZz0idXRmLTgiKSBhcyBmOgogICAgICAgICAgICBjID0ganNvbi5sb2FkKGYpCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIGMgPSB7fQogICAgaWYgbm90IChpc2luc3RhbmNlKGMuZ2V0KCJjb2RlIiksIHN0cikgYW5kIGxlbihjWyJjb2RlIl0pID09IDYgYW5kIGNbImNvZGUiXS5pc2RpZ2l0KCkpOgogICAgICAgIGNbImNvZGUiXSA9ICIlMDZkIiAlIHNlY3JldHMucmFuZGJlbG93KDEwMDAwMDApCiAgICAgICAgYy5zZXRkZWZhdWx0KCJlbmFibGVkIiwgRmFsc2UpCiAgICAgICAgbGFuX2NvbmZfd3JpdGUoYykKICAgIHJldHVybiBjCgoKZGVmIGxhbl9jb25mX3dyaXRlKGMpOgogICAgdG1wID0gTEFOX1BBVEggKyAiLnRtcCIKICAgIHdpdGggb3Blbih0bXAsICJ3IiwgZW5jb2Rpbmc9InV0Zi04IikgYXMgZjoKICAgICAgICBqc29uLmR1bXAoYywgZikKICAgIG9zLnJlcGxhY2UodG1wLCBMQU5fUEFUSCkKCgpkZWYgbGFuX2FkZHJlc3NlcygpOgogICAgIiIiVGhpcyBjb21wdXRlcidzIGFkZHJlc3Mgb24gdGhlIGhvbWUgbmV0d29yaywgYXMgb3RoZXIgZGV2aWNlcyBzZWUgaXQuIiIiCiAgICBmb3VuZCA9IFtdCiAgICB0cnk6CiAgICAgICAgczIgPSBzb2NrZXQuc29ja2V0KHNvY2tldC5BRl9JTkVULCBzb2NrZXQuU09DS19ER1JBTSkKICAgICAgICBzMi5jb25uZWN0KCgiMTkyLjAuMi4xIiwgOSkpICAjIG5vIHBhY2tldCBpcyBzZW50OyB0aGlzIG9ubHkgcGlja3MgdGhlIG91dGdvaW5nIGludGVyZmFjZQogICAgICAgIGZvdW5kLmFwcGVuZChzMi5nZXRzb2NrbmFtZSgpWzBdKQogICAgICAgIHMyLmNsb3NlKCkKICAgIGV4Y2VwdCBFeGNlcHRpb246CiAgICAgICAgcGFzcwogICAgdHJ5OgogICAgICAgIGZvciBpbmZvIGluIHNvY2tldC5nZXRhZGRyaW5mbyhzb2NrZXQuZ2V0aG9zdG5hbWUoKSwgTm9uZSwgc29ja2V0LkFGX0lORVQpOgogICAgICAgICAgICBpcCA9IGluZm9bNF1bMF0KICAgICAgICAgICAgaWYgaXAgbm90IGluIGZvdW5kIGFuZCBub3QgaXAuc3RhcnRzd2l0aCgiMTI3LiIpOgogICAgICAgICAgICAgICAgZm91bmQuYXBwZW5kKGlwKQogICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICBwYXNzCiAgICByZXR1cm4gW2lwIGZvciBpcCBpbiBmb3VuZCBpZiBub3QgaXAuc3RhcnRzd2l0aCgiMTI3LiIpXQoKCmRlZiBsYW5fc3RhdHVzKCk6CiAgICBjID0gbGFuX2NvbmYoKQogICAgcmV0dXJuIHsib2siOiBUcnVlLCAiZW5hYmxlZCI6IGJvb2woYy5nZXQoImVuYWJsZWQiKSksICJydW5uaW5nIjogTEFOWyJzZXJ2ZXIiXSBpcyBub3QgTm9uZSwKICAgICAgICAgICAgImNvZGUiOiBjWyJjb2RlIl0sICJwb3J0IjogTEFOX1BPUlQsCiAgICAgICAgICAgICJhZGRyZXNzZXMiOiBbIiVzOiVkIiAlIChpcCwgTEFOX1BPUlQpIGZvciBpcCBpbiBsYW5fYWRkcmVzc2VzKCldfQoKCmRlZiBsYW5fc3RhcnQoKToKICAgIGlmIExBTlsic2VydmVyIl0gaXMgbm90IE5vbmU6CiAgICAgICAgcmV0dXJuIFRydWUKICAgIHRyeToKICAgICAgICBzcnYgPSBUaHJlYWRpbmdIVFRQU2VydmVyKCgiMC4wLjAuMCIsIExBTl9QT1JUKSwgTGFuSGFuZGxlcikKICAgIGV4Y2VwdCBPU0Vycm9yIGFzIGU6CiAgICAgICAgcHJpbnQoZiJbaW5rd2VsbF0gaG9tZSBuZXR3b3JrOiBwb3J0IHtMQU5fUE9SVH0gdW5hdmFpbGFibGUgKHtlfSkiKQogICAgICAgIHJldHVybiBGYWxzZQogICAgTEFOWyJzZXJ2ZXIiXSA9IHNydgogICAgdGhyZWFkaW5nLlRocmVhZCh0YXJnZXQ9c3J2LnNlcnZlX2ZvcmV2ZXIsIGRhZW1vbj1UcnVlKS5zdGFydCgpCiAgICBwcmludChmIltpbmt3ZWxsXSBob21lIG5ldHdvcms6IHRhYmxldHMgY2FuIGNvbm5lY3QgYXQgeycsICcuam9pbihsYW5fc3RhdHVzKClbJ2FkZHJlc3NlcyddKSBvciAndGhpcyBjb21wdXRlcid9IikKICAgIHJldHVybiBUcnVlCgoKZGVmIGxhbl9zdG9wKCk6CiAgICBzcnYsIExBTlsic2VydmVyIl0gPSBMQU5bInNlcnZlciJdLCBOb25lCiAgICBpZiBzcnYgaXMgbm90IE5vbmU6CiAgICAgICAgdGhyZWFkaW5nLlRocmVhZCh0YXJnZXQ9bGFtYmRhOiAoc3J2LnNodXRkb3duKCksIHNydi5zZXJ2ZXJfY2xvc2UoKSksIGRhZW1vbj1UcnVlKS5zdGFydCgpCgoKZGVmIGVwX2xhbl9zdGF0dXMoYm9keSk6CiAgICByZXR1cm4gbGFuX3N0YXR1cygpCgoKZGVmIGVwX2xhbl9lbmFibGUoYm9keSk6CiAgICBjID0gbGFuX2NvbmYoKQogICAgaWYgYm9keS5nZXQoIm5ld19jb2RlIik6CiAgICAgICAgY1siY29kZSJdID0gIiUwNmQiICUgc2VjcmV0cy5yYW5kYmVsb3coMTAwMDAwMCkKICAgIGNbImVuYWJsZWQiXSA9IGJvb2woYm9keS5nZXQoIm9uIiwgYy5nZXQoImVuYWJsZWQiKSkpCiAgICBsYW5fY29uZl93cml0ZShjKQogICAgaWYgY1siZW5hYmxlZCJdOgogICAgICAgIGxhbl9zdGFydCgpCiAgICBlbHNlOgogICAgICAgIGxhbl9zdG9wKCkKICAgIHJldHVybiBsYW5fc3RhdHVzKCkKCgpjbGFzcyBMYW5IYW5kbGVyKEhhbmRsZXIpOgogICAgIiIiV2hhdCBhIHBhaXJlZCB0YWJsZXQgbWF5IGFzayBvZiB0aGUgbGFwdG9wOiB3cml0aW5nIGFuZCB2b2ljZSwgbm90aGluZyBlbHNlLiIiIgoKICAgIGRlZiBfY29ycyhzZWxmKToKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4iLCAiKiIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyIsICJDb250ZW50LVR5cGUsIFgtSW5rd2VsbC1LZXkiKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMiLCAiR0VULCBQT1NULCBPUFRJT05TIikKICAgICAgICAjIGJyb3dzZXJzIGFzayBiZWZvcmUgYSBwYWdlIHJlYWNoZXMgYSBkZXZpY2Ugb24gdGhlIHByaXZhdGUgbmV0d29yawogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LVByaXZhdGUtTmV0d29yayIsICJ0cnVlIikKCiAgICBkZWYgX3NlbmQoc2VsZiwgY29kZSwgb2JqKToKICAgICAgICBkYXRhID0ganNvbi5kdW1wcyhvYmopLmVuY29kZSgpCiAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKGNvZGUpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1UeXBlIiwgImFwcGxpY2F0aW9uL2pzb24iKQogICAgICAgIHNlbGYuX2NvcnMoKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtTGVuZ3RoIiwgc3RyKGxlbihkYXRhKSkpCiAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpCiAgICAgICAgc2VsZi53ZmlsZS53cml0ZShkYXRhKQoKICAgIGRlZiBfcGFpcmVkKHNlbGYpOgogICAgICAgIGdpdmVuID0gKHNlbGYuaGVhZGVycy5nZXQoIlgtSW5rd2VsbC1LZXkiKSBvciAiIikuc3RyaXAoKQogICAgICAgIHJldHVybiBib29sKGdpdmVuKSBhbmQgaG1hYy5jb21wYXJlX2RpZ2VzdChnaXZlbiwgbGFuX2NvbmYoKVsiY29kZSJdKQoKICAgIGRlZiBkb19HRVQoc2VsZik6CiAgICAgICAgcGF0aCA9IHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdCiAgICAgICAgaWYgbm90IHNlbGYuX3BhaXJlZCgpOgogICAgICAgICAgICByZXR1cm4gc2VsZi5fc2VuZCg0MDEsIHsiZXJyb3IiOiAicGFpcmluZyBjb2RlIG5lZWRlZCIsICJwYWlyZWQiOiBGYWxzZX0pCiAgICAgICAgaWYgcGF0aCBpbiAoIi9hcGkvaGVhbHRoIiwgIi9hcGkvbmV0X3N0YXR1cyIsICIvYXBpL3N0dF9zdGF0dXMiLCAiL2FwaS9wcmVzZXRzIik6CiAgICAgICAgICAgIHJldHVybiBIYW5kbGVyLmRvX0dFVChzZWxmKQogICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDQwNCwgeyJlcnJvciI6ICJub3Qgb2ZmZXJlZCB0byBvdGhlciBkZXZpY2VzIn0pCgogICAgZGVmIGRvX1BPU1Qoc2VsZik6CiAgICAgICAgbSA9IHJlLm1hdGNoKHIiXi9hcGkvKFthLXpfXSspJCIsIHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdKQogICAgICAgIGlmIG5vdCBzZWxmLl9wYWlyZWQoKToKICAgICAgICAgICAgcmV0dXJuIHNlbGYuX3NlbmQoNDAxLCB7ImVycm9yIjogInBhaXJpbmcgY29kZSBuZWVkZWQiLCAicGFpcmVkIjogRmFsc2V9KQogICAgICAgIGlmIG5vdCBtIG9yIG0uZ3JvdXAoMSkgbm90IGluIExBTl9ST1VURVM6CiAgICAgICAgICAgIHJldHVybiBzZWxmLl9zZW5kKDQwNCwgeyJlcnJvciI6ICJub3Qgb2ZmZXJlZCB0byBvdGhlciBkZXZpY2VzIn0pCiAgICAgICAgcmV0dXJuIEhhbmRsZXIuZG9fUE9TVChzZWxmKQoKZGVmIF9ib290X2JhY2tncm91bmQoKToKICAgIF9taWdyYXRlX2xlZ2FjeShbIm1vZGVscyJdKSAgIyBiZWZvcmUgdGhlIG1vZGVsIHNjYW4sIHNvIGEgbW92ZWQgc2hlbGYgaXMgZm91bmQKICAgIF9sb2FkX21vZGVscygpCgoKaWYgX19uYW1lX18gPT0gIl9fbWFpbl9fIjoKICAgIHRocmVhZGluZy5UaHJlYWQodGFyZ2V0PV9ib290X2JhY2tncm91bmQsIGRhZW1vbj1UcnVlKS5zdGFydCgpCiAgICB0cnk6CiAgICAgICAgaWYgbGFuX2NvbmYoKS5nZXQoImVuYWJsZWQiKToKICAgICAgICAgICAgbGFuX3N0YXJ0KCkKICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICBwcmludChmIltpbmt3ZWxsXSBob21lIG5ldHdvcmsgbm90IHN0YXJ0ZWQ6IHtlfSIpCiAgICBwcmludChmIltpbmt3ZWxsXSBsaXN0ZW5pbmcgb24gaHR0cDovL3tIT1NUfTp7UE9SVH07IGtlZXAgdGhpcyB3aW5kb3cgb3BlbiB3aGlsZSB5b3Ugd3JpdGUiKQogICAgVGhyZWFkaW5nSFRUUFNlcnZlcigoSE9TVCwgUE9SVCksIEhhbmRsZXIpLnNlcnZlX2ZvcmV2ZXIoKQo="

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
