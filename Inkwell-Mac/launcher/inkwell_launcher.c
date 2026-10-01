/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 *
 * inkwell_launcher.c: the native executable inside Inkwell.app (v7.26).
 *
 * WHY THIS EXISTS
 * macOS decides whether a process may use the microphone by looking at the
 * app bundle that owns the process. Until 7.25 the bundle's executable was a
 * shell script that replaced itself with python3, so the owner macOS saw was
 * Python, whose Info.plist has no microphone usage description. WebKit then
 * refused every microphone request without showing any prompt. That is the
 * Scriba failure.
 *
 * This launcher is a real Mach-O executable inside Inkwell.app. It loads the
 * user's own Python library into its own process and runs inkwell_app.py
 * there, so the owning bundle is Inkwell.app, whose Info.plist carries
 * NSMicrophoneUsageDescription. macOS then shows its normal prompt.
 *
 * HOW IT FINDS PYTHON
 * The installer writes Contents/Resources/inkwell_runtime.txt with three lines:
 *     lib=<path of the Python shared library or framework binary>
 *     home=<sys.base_prefix of that Python>
 *     python=<path of that python3 executable>
 *
 * ARGUMENTS
 * Launched from Finder (no arguments), it runs Resources/inkwell_app.py.
 * Launched with arguments, it behaves exactly like the python3 executable.
 * That is how inkwell_app.py starts its companion server: it re-runs
 * sys.executable (this file) with the server's arguments.
 *
 * IF ANYTHING IS MISSING
 * It falls back to running the recorded python3 (or /usr/bin/python3) the old
 * way, so Inkwell always opens. Only the microphone needs the native path.
 * Every decision is written to ~/Library/Application Support/Inkwell/launcher.log.
 */

#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
extern int _NSGetExecutablePath(char *buf, uint32_t *bufsize);
#endif

typedef int (*py_bytes_main_fn)(int argc, char **argv);

static char g_log_path[PATH_MAX];

static void log_line(const char *fmt, ...) {
    if (!g_log_path[0]) return;
    FILE *f = fopen(g_log_path, "a");
    if (!f) return;
    time_t now = time(NULL);
    struct tm tmv;
    char stamp[32];
    localtime_r(&now, &tmv);
    strftime(stamp, sizeof stamp, "%Y-%m-%d %H:%M:%S", &tmv);
    fprintf(f, "%s [pid %d] ", stamp, (int)getpid());
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

static void mkdir_p(const char *path) {
    char tmp[PATH_MAX];
    size_t n = strlen(path);
    if (n == 0 || n >= sizeof tmp) return;
    memcpy(tmp, path, n + 1);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0755);
            *p = '/';
        }
    }
    mkdir(tmp, 0755);
}

static void init_log(void) {
    const char *home = getenv("HOME");
    if (!home || !home[0]) return;
    char dir[PATH_MAX];
    if (snprintf(dir, sizeof dir, "%s/Library/Application Support/Inkwell", home) >= (int)sizeof dir) return;
    mkdir_p(dir);
    if (snprintf(g_log_path, sizeof g_log_path, "%s/launcher.log", dir) >= (int)sizeof g_log_path)
        g_log_path[0] = '\0';
}

static int file_exists(const char *p) {
    struct stat st;
    return p && p[0] && stat(p, &st) == 0 && S_ISREG(st.st_mode);
}

static int executable_path(char *out, size_t n) {
    char raw[PATH_MAX];
#ifdef __APPLE__
    uint32_t size = (uint32_t)sizeof raw;
    if (_NSGetExecutablePath(raw, &size) != 0) return -1;
#else
    ssize_t k = readlink("/proc/self/exe", raw, sizeof raw - 1);
    if (k <= 0) return -1;
    raw[k] = '\0';
#endif
    if (!realpath(raw, out)) {
        if (strlen(raw) >= n) return -1;
        strcpy(out, raw);
    }
    return 0;
}

/* Strip trailing whitespace and line endings in place. */
static void rstrip(char *s) {
    size_t n = strlen(s);
    while (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r' || s[n - 1] == ' ' || s[n - 1] == '\t'))
        s[--n] = '\0';
}

/* Read key=value lines from the runtime file. Unknown keys are ignored. */
static void read_runtime(const char *path, char *lib, char *home, char *python, size_t n) {
    lib[0] = home[0] = python[0] = '\0';
    FILE *f = fopen(path, "r");
    if (!f) return;
    char line[PATH_MAX + 32];
    while (fgets(line, sizeof line, f)) {
        rstrip(line);
        char *eq = strchr(line, '=');
        if (!eq) continue;
        *eq = '\0';
        const char *val = eq + 1;
        char *dst = NULL;
        if (strcmp(line, "lib") == 0) dst = lib;
        else if (strcmp(line, "home") == 0) dst = home;
        else if (strcmp(line, "python") == 0) dst = python;
        if (dst && strlen(val) < n) strcpy(dst, val);
    }
    fclose(f);
}

/* The old road: run python3 as its own process. Inkwell opens, but macOS
 * attributes the microphone to Python, so Scriba cannot record. */
static int fallback_exec(const char *python, char **args, int nargs) {
    const char *cands[3] = { python, "/usr/bin/python3", NULL };
    unsetenv("PYTHONHOME");
    unsetenv("INKWELL_NATIVE_HOST");
    for (int c = 0; c < 2; c++) {
        const char *py = cands[c];
        if (!file_exists(py)) continue;
        char **argv = calloc((size_t)nargs + 2, sizeof(char *));
        if (!argv) return 1;
        argv[0] = (char *)py;
        for (int i = 0; i < nargs; i++) argv[i + 1] = args[i];
        argv[nargs + 1] = NULL;
        log_line("fallback: exec %s (the microphone will not be available in this mode)", py);
        execv(py, argv);
        log_line("fallback: exec %s failed: %s", py, strerror(errno));
        free(argv);
    }
    log_line("fallback: no python3 could be started");
    return 127;
}

int main(int argc, char **argv) {
    init_log();

    char exe[PATH_MAX];
    if (executable_path(exe, sizeof exe) != 0) {
        log_line("cannot determine own path");
        return 1;
    }

    /* Contents/MacOS/Inkwell -> Contents/Resources */
    char res[PATH_MAX];
    {
        char tmp[PATH_MAX];
        strcpy(tmp, exe);
        char *slash = strrchr(tmp, '/');
        if (!slash) return 1;
        *slash = '\0';
        if (snprintf(res, sizeof res, "%s/../Resources", tmp) >= (int)sizeof res) return 1;
        char resolved[PATH_MAX];
        if (realpath(res, resolved)) strcpy(res, resolved);
    }

    char script[PATH_MAX], runtime[PATH_MAX];
    if (snprintf(script, sizeof script, "%s/inkwell_app.py", res) >= (int)sizeof script) return 1;
    if (snprintf(runtime, sizeof runtime, "%s/inkwell_runtime.txt", res) >= (int)sizeof runtime) return 1;

    /* Arguments other than the obsolete Finder process serial number. */
    char **pass = calloc((size_t)argc + 1, sizeof(char *));
    if (!pass) return 1;
    int npass = 0;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "-psn_", 5) == 0) continue;
        pass[npass++] = argv[i];
    }
    int from_finder = (npass == 0);

    /* The argument list Python will see. */
    char **pyargv = calloc((size_t)npass + 3, sizeof(char *));
    if (!pyargv) return 1;
    int pyargc = 0;
    pyargv[pyargc++] = exe;
    if (from_finder) {
        pyargv[pyargc++] = script;
        if (chdir(res) != 0) log_line("chdir %s failed: %s", res, strerror(errno));
    } else {
        for (int i = 0; i < npass; i++) pyargv[pyargc++] = pass[i];
    }
    pyargv[pyargc] = NULL;

    char lib[PATH_MAX], home[PATH_MAX], python[PATH_MAX];
    read_runtime(runtime, lib, home, python, sizeof lib);

    char **fbargs = pyargv + 1;
    int nfb = pyargc - 1;

    if (!file_exists(lib)) {
        log_line("no Python library recorded or found (%s); run the installer again",
                 lib[0] ? lib : "inkwell_runtime.txt missing or empty");
        return fallback_exec(python, fbargs, nfb);
    }

    void *h = dlopen(lib, RTLD_NOW | RTLD_GLOBAL);
    if (!h) {
        log_line("dlopen %s failed: %s", lib, dlerror());
        return fallback_exec(python, fbargs, nfb);
    }
    py_bytes_main_fn py_main = (py_bytes_main_fn)dlsym(h, "Py_BytesMain");
    if (!py_main) {
        log_line("Py_BytesMain not found in %s (Python 3.8 or newer is required)", lib);
        return fallback_exec(python, fbargs, nfb);
    }

    if (home[0]) setenv("PYTHONHOME", home, 1);
    setenv("INKWELL_NATIVE_HOST", "1", 1);
    log_line("native host: %s with %s (%s)", from_finder ? "app launch" : "child run", lib,
             from_finder ? script : (npass > 0 ? pass[0] : ""));
    int rc = py_main(pyargc, pyargv);
    log_line("python exited with status %d", rc);
    return rc;
}
