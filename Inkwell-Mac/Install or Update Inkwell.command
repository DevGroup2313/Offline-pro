#!/bin/zsh
# INKWELL 7.32: install or update on macOS.
# Double-click this file (the first time: right-click, Open). It works for a
# first install and for an update. Your documents, notes and models are kept.
#
# What it does, in this order:
#   1. checks that every file of the package is here
#   2. asks you to quit Inkwell if it is open
#   3. finds your Python 3 and the window component (pywebview)
#   4. optionally installs local Whisper for Scriba
#   5. builds a fresh Inkwell.app with its native launcher (needed for the microphone)
#   6. backs up your library BEFORE touching the installed app
#   7. moves models and settings out of the old app into your own data folder
#   8. swaps the new app into place, keeping the old one until the swap succeeds
#   9. resets the microphone decision for Inkwell only, so macOS asks you fresh
#  10. opens Inkwell
# Optional settings for advanced use:
#   INKWELL_APPS_DIR   install somewhere other than /Applications
#   INKWELL_PYLIB      path to your Python shared library, if detection fails
#   INKWELL_NO_PIP=1   never run pip

set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
VER="7.32"
APPS="${INKWELL_APPS_DIR:-/Applications}"
SUPPORT="$HOME/Library/Application Support/Inkwell"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$SUPPORT/backups/$STAMP"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/inkwell-build.XXXXXX")"
BUILD="$WORK/Inkwell.app"
NATIVE=0

line() { print -r -- "$*"; }
rule() { line "=================================================="; }
stop() { line ""; line "STOPPED: $*"; line "Your installed Inkwell and your documents were not changed."; rm -rf "$WORK"; exit 1; }
ask_yes() { local a; print -n -- "$1 [y/N] "; read -r a; [[ "$a" == [yY]* ]]; }

rule; line "  INKWELL $VER: install or update"; rule; line ""

# 1. files ------------------------------------------------------------------
for f in Inkwell.html inkwell_app.py server.py Info.plist PkgInfo inkwell.icns inkwell.png \
         launcher/inkwell_launcher.c vendor/ort-wasm-simd-threaded.jsep.mjs \
         vendor/ort-wasm-simd-threaded.jsep.wasm vendor/transformers.min.js; do
  [[ -f "$f" ]] || stop "the file '$f' is missing. Unzip the whole package and run this again from inside it."
done
line "1. All package files are present."

# 2. Inkwell must be closed ---------------------------------------------------
app_running() {
  # the app itself: the native launcher, or Python running the launcher script
  pgrep -fl "Inkwell\.app/Contents/(MacOS/Inkwell|Resources/inkwell_app\.py)" 2>/dev/null \
    | grep -v -- "--inkwell-engine" | grep -v -- "--export-library" | grep -q .
}
if app_running; then
  line "2. Inkwell is open. Quit it (Inkwell menu, Quit), then press Return here."
  read -r _
  app_running && stop "Inkwell is still running. Quit it and run this again."
fi
pkill -f -- "--inkwell-engine" >/dev/null 2>&1   # the companion server; it restarts with the app
line "2. Inkwell is closed."

# 3. Python and the window component -----------------------------------------
cands=()
xcode-select -p >/dev/null 2>&1 && cands+=(/usr/bin/python3)
p="$(command -v python3 2>/dev/null)"; [[ -n "$p" ]] && cands+=("$p")
cands+=(/opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3)
PY=""
for c in "${cands[@]}"; do   # first choice: a Python that already has the window component
  [[ -x "$c" ]] || continue
  "$c" -c 'import sys; assert sys.version_info >= (3, 8); import webview' >/dev/null 2>&1 && { PY="$c"; break; }
done
if [[ -z "$PY" ]]; then
  for c in "${cands[@]}"; do
    [[ -x "$c" ]] || continue
    "$c" -c 'import sys; assert sys.version_info >= (3, 8)' >/dev/null 2>&1 && { PY="$c"; break; }
  done
fi
[[ -n "$PY" ]] || stop "no Python 3.8 or newer was found. Install the Apple command line tools with: xcode-select --install"
PY="$("$PY" -c 'import sys; print(sys.executable)')"
line "3. Python: $PY ($("$PY" -c 'import platform; print(platform.python_version())'))"

pip_install() {
  [[ "${INKWELL_NO_PIP:-0}" == "1" ]] && { line "   (pip skipped: INKWELL_NO_PIP=1)"; return 1; }
  "$PY" -m pip install --user --upgrade "$@" || "$PY" -m pip install --user --upgrade --break-system-packages "$@"
}
if ! "$PY" -c 'import webview' >/dev/null 2>&1; then
  line "   Installing the window component (pywebview), once; this needs the internet."
  pip_install pywebview
fi
if "$PY" -c 'import webview' >/dev/null 2>&1; then
  line "   Window component: pywebview $("$PY" -c 'import webview; print(getattr(webview, "__version__", "?"))' 2>/dev/null)"
else
  line "   WARNING: pywebview is not available, so Inkwell will open in your browser instead of its own window."
fi

# 4. optional local Whisper --------------------------------------------------
MACHINE="$("$PY" -c 'import platform; print(platform.machine())')"
if [[ "$MACHINE" == "x86_64" ]]; then
  # Intel Macs: PyTorch 2.2.2 is the last release built for them, transformers
  # 4.57.6 the last that accepts it, and NumPy must stay below 2 to match.
  WHISPER_PKGS=("torch==2.2.2" "numpy<2" "transformers>=4.40,<4.58")
else
  WHISPER_PKGS=(transformers torch numpy)
fi
whisper_ok() { "$PY" -c 'import numpy, torch, transformers; torch.from_numpy(numpy.zeros(1))' >/dev/null 2>&1; }
if whisper_ok; then
  line "4. Local transcription (Whisper) libraries are installed and work together."
elif "$PY" -c 'import transformers, torch' >/dev/null 2>&1; then
  line "4. The transcription libraries are installed but do not work together on this Mac"
  line "   (usually a NumPy version that this PyTorch cannot use)."
  if ask_yes "   Repair them now?"; then
    pip_install "${WHISPER_PKGS[@]}"
    whisper_ok && line "   Repaired." || line "   The repair did not succeed. Scriba will use the system's dictation where it can."
  fi
else
  line "4. Scriba transcribes on this Mac with Whisper. That needs the libraries"
  line "   transformers and torch (a download of several hundred megabytes, once),"
  line "   and on first use a Whisper model of about 150 MB."
  if ask_yes "   Install them now?"; then
    pip_install "${WHISPER_PKGS[@]}"
    whisper_ok && line "   Installed and checked." || line "   The install did not finish. Scriba will use the system's dictation where it can."
  else
    line "   Skipped. You can run this installer again later to add them."
  fi
fi
# 5. build the app -------------------------------------------------------------
PROBE="$WORK/probe.py"
cat > "$PROBE" <<'PYEOF'
import ctypes, os, platform, sys
class Dl(ctypes.Structure):
    _fields_ = [("fname", ctypes.c_char_p), ("fbase", ctypes.c_void_p),
                ("sname", ctypes.c_char_p), ("saddr", ctypes.c_void_p)]
lib = ""
try:
    libc = ctypes.CDLL(None)
    libc.dladdr.argtypes = [ctypes.c_void_p, ctypes.POINTER(Dl)]
    info = Dl()
    addr = ctypes.cast(ctypes.pythonapi.Py_BytesMain, ctypes.c_void_p).value
    if libc.dladdr(addr, ctypes.byref(info)) and info.fname:
        lib = os.path.realpath(info.fname.decode())
except Exception:
    lib = ""
if lib and lib == os.path.realpath(sys.executable):
    lib = ""   # Python is built without a shared library; nothing to load
print("lib=" + lib)
print("home=" + sys.base_prefix)
print("python=" + sys.executable)
print("arch=" + platform.machine())
PYEOF
"$PY" "$PROBE" > "$WORK/runtime.txt" || stop "could not inspect Python."
if [[ -n "${INKWELL_PYLIB:-}" ]]; then
  grep -v '^lib=' "$WORK/runtime.txt" > "$WORK/rt2"; print -r -- "lib=$INKWELL_PYLIB" >> "$WORK/rt2"; mv "$WORK/rt2" "$WORK/runtime.txt"
fi
PYLIB="$(sed -n 's/^lib=//p' "$WORK/runtime.txt")"
ARCH="$(sed -n 's/^arch=//p' "$WORK/runtime.txt")"

mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources/vendor"
cp Info.plist PkgInfo "$BUILD/Contents/"
cp Inkwell.html inkwell_app.py server.py inkwell.icns inkwell.png "$BUILD/Contents/Resources/"
cp vendor/* "$BUILD/Contents/Resources/vendor/"
grep -v '^arch=' "$WORK/runtime.txt" > "$BUILD/Contents/Resources/inkwell_runtime.txt"

CC=()
if xcrun -f clang >/dev/null 2>&1; then CC=(xcrun clang)
elif command -v clang >/dev/null 2>&1; then CC=(clang)
fi
if [[ -n "$PYLIB" && -f "$PYLIB" && ${#CC[@]} -gt 0 ]]; then
  MINV="10.13"; [[ "$ARCH" == "arm64" ]] && MINV="11.0"
  if "${CC[@]}" -O2 -Wall -arch "$ARCH" -mmacosx-version-min="$MINV" \
       -o "$BUILD/Contents/MacOS/Inkwell" launcher/inkwell_launcher.c 2>"$WORK/cc.log"; then
    NATIVE=1
  else
    line "   The native launcher did not compile:"; sed 's/^/     /' "$WORK/cc.log"
  fi
fi
if [[ $NATIVE -eq 0 ]]; then
  cat > "$BUILD/Contents/MacOS/Inkwell" <<SHEOF
#!/bin/zsh
# Fallback launcher (the native one could not be built). Inkwell works,
# but macOS will not let Scriba use the microphone in this mode.
cd "\$(dirname "\$0")/../Resources" || exit 1
exec "$PY" inkwell_app.py
SHEOF
  line "5. App built WITHOUT the native launcher. Inkwell works, but Scriba cannot use the microphone."
  [[ -z "$PYLIB" ]] && line "   Reason: this Python has no shared library (pyenv builds often lack one). Python from python.org,"
  [[ -z "$PYLIB" ]] && line "   Homebrew or the Apple command line tools all work."
  [[ ${#CC[@]} -eq 0 ]] && line "   Reason: no C compiler. Install the Apple command line tools with: xcode-select --install"
else
  line "5. App built with the native launcher ($ARCH)."
fi
chmod +x "$BUILD/Contents/MacOS/Inkwell"
plutil -lint "$BUILD/Contents/Info.plist" >/dev/null || stop "the app's Info.plist is not valid."
xattr -cr "$BUILD" 2>/dev/null
codesign --force --sign - --identifier studio.inkwell.desk "$BUILD" >/dev/null 2>&1 || line "   (ad-hoc signing reported a problem)"
codesign --verify --strict "$BUILD" >/dev/null 2>&1 && line "   Signature verified." || line "   WARNING: the signature did not verify."

# 6. back up the library before anything is replaced ----------------------------
mkdir -p "$BACKUP" || stop "could not create the backup folder $BACKUP"
if "$PY" "$HERE/inkwell_app.py" --export-library "$BACKUP/inkwell-library-backup.json" > "$WORK/export.log" 2>&1; then
  line "6. Library backup: $(cat "$WORK/export.log")"
  if grep -q "exported [1-9]" "$WORK/export.log"; then
    cp "$BACKUP/inkwell-library-backup.json" "$HOME/Desktop/Inkwell library backup $STAMP.json" 2>/dev/null \
      && line "   A copy is on your Desktop. File, Import library reads it if ever needed."
  fi
else
  line "6. WARNING: the library backup did not complete:"; sed 's/^/     /' "$WORK/export.log"
  ask_yes "   Continue anyway? (Your documents stay where they are either way.)" || stop "stopped at your request."
fi
[[ -f "$SUPPORT/storage/inkwell_store.json" ]] && cp "$SUPPORT/storage/inkwell_store.json" "$BACKUP/" 2>/dev/null
for id in org.python.python com.apple.python3 studio.inkwell.desk; do
  [[ -d "$HOME/Library/WebKit/$id/WebsiteData" ]] && { mkdir -p "$BACKUP/WebKit/$id"; ditto "$HOME/Library/WebKit/$id/WebsiteData" "$BACKUP/WebKit/$id/WebsiteData" 2>/dev/null; }
done
line "   Raw copies of the web storage: $BACKUP"

# 7. move models and settings out of the old app --------------------------------
OLD=""
for c in "$APPS/Inkwell.app" "$HOME/Applications/Inkwell.app"; do [[ -d "$c" ]] && { OLD="$c"; break; }; done
mkdir -p "$SUPPORT"
if [[ -n "$OLD" ]]; then
  for name in models inkwell_server.json inkwell_sync.json; do
    src="$OLD/Contents/Resources/$name"
    [[ -e "$src" ]] || continue
    if [[ -e "$SUPPORT/$name" ]]; then
      mv "$src" "$BACKUP/old-app-$name" && line "7. Kept the older $name from the old app in the backup folder."
    else
      mv "$src" "$SUPPORT/$name" && line "7. Moved $name to $SUPPORT"
    fi
  done
fi
line "7. Your data folder: $SUPPORT"

# 8. swap the new app into place -------------------------------------------------
DEST="${OLD:-$APPS/Inkwell.app}"
if ! { mkdir -p "$(dirname "$DEST")" && ditto "$BUILD" "$DEST.new" ; } 2>/dev/null; then
  DEST="$HOME/Applications/Inkwell.app"; mkdir -p "$HOME/Applications"
  ditto "$BUILD" "$DEST.new" || stop "could not copy the new app into Applications."
fi
if [[ -d "$DEST" ]]; then
  mv "$DEST" "$DEST.old" || { rm -rf "$DEST.new"; stop "could not move the old app aside."; }
fi
if mv "$DEST.new" "$DEST"; then
  rm -rf "$DEST.old"
else
  [[ -d "$DEST.old" ]] && mv "$DEST.old" "$DEST"
  stop "could not put the new app in place; the old one was restored."
fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
line "8. Installed: $DEST"

# 9. a fresh microphone decision, for Inkwell only --------------------------------
if [[ $NATIVE -eq 1 ]]; then
  tccutil reset Microphone studio.inkwell.desk >/dev/null 2>&1
  line "9. macOS will ask once for the microphone the first time you press Record in Scriba."
fi
rm -rf "$WORK"

line ""; rule
line "  Inkwell $VER is installed."
line "  Library backup: $BACKUP"
[[ $NATIVE -eq 1 ]] && line "  Scriba: press Record, then click Allow when macOS asks."
rule
open "$DEST" >/dev/null 2>&1
