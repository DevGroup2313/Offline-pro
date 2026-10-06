#!/usr/bin/env python3
"""
server.py; Inkwell companion server (v2.13)
===========================================

Serves the local AI endpoints Inkwell.html expects at http://127.0.0.1:8317:

    GET  /api/health      -> {"ok": true, "ai": <true|false>, "model": name}
    POST /api/correct     {text, rules, style}      -> {"edits": [{start,end,orig,fix,why,cat}]}
    POST /api/rewrite     {text, mode, style}       -> {"text": "..."}
    POST /api/rewrite_preset {text, preset, context} -> {"ok": true, "text": "..."}
    POST /api/rewrite_custom {text, instruction}     -> {"ok": true, "text": "..."}
    POST /api/presets     {}                          -> {"ok": true, "presets": [...], "modes": [...]}
    POST /api/compose     {instruction, style}      -> {"text": "..."}
    POST /api/tone        {text}                    -> {"label": "...", "tips": [...]}
    POST /api/similarity  {text, library:[{title,text}]} -> {"matches": [{"title","overlap"}]}
    POST /api/socrat      {stage, answer}           -> {"question": "..."}
    POST /api/review      {text, style}             -> {"items": ["objection", ...]}
    POST /api/sync_push   {docs, notes}              -> {"ok": true, "saved_at": ...}
    POST /api/sync_pull   {}                          -> {"ok": true, "docs": [...], "notes": [...]}
    POST /api/transcribe  {audio: base64 WAV, language} -> {"ok": true, "text": "..."}
    POST /api/stt_status  {}                          -> {"ok": true, "stt_loaded": bool, ...}
    POST /api/stt_warm    {}                          -> {"ok": true, "stt_loading": bool}

Writable data (models, settings, the sync copy, logs) lives in the user's
own data folder, never beside this file, so replacing the app never deletes it:
    macOS    ~/Library/Application Support/Inkwell
    Windows  %LOCALAPPDATA%\\Inkwell
    Linux    $XDG_DATA_HOME/Inkwell (or ~/.local/share/Inkwell)

Zero required dependencies; runs on vanilla Python 3.9+ with a heuristic
fallback engine. For real AI quality, install transformers:

    pip install transformers torch
    python server.py

Optional env vars:
    INKWELL_HOST      bind address        (default 127.0.0.1)
    INKWELL_PORT      port                (default 8317)
    INKWELL_MODEL     instruct model      (default Qwen/Qwen2.5-3B-Instruct)
    INKWELL_GEC_MODEL grammar model       (default vennify/t5-base-grammar-correction)
    INKWELL_STT_MODEL speech-to-text model (default openai/whisper-tiny, multilingual)
    INKWELL_DATA_DIR  writable data folder (default: the per-user folder above)
    INKWELL_DEVICE    cpu | cuda | mps    (default: auto)
"""

import difflib
import json
import os
import re
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("INKWELL_HOST", "127.0.0.1")
PORT = int(os.environ.get("INKWELL_PORT", "8317"))
INSTRUCT_MODEL = os.environ.get("INKWELL_MODEL", "Qwen/Qwen2.5-3B-Instruct")
GEC_MODEL = os.environ.get("INKWELL_GEC_MODEL", "vennify/t5-base-grammar-correction")
# Models known to use the causal LM (text-generation) pipeline rather than seq2seq.
# When the instruct model is one of these, the server uses chat-template formatting.
_CAUSAL_LM_PREFIXES = (
    "Qwen/Qwen", "microsoft/Phi-", "mistralai/", "ministral/", "meta-llama/Meta-Llama",
    "google/gemma-", "HuggingFaceTB/SmolLM", "EleutherAI/", "allenai/OLMo",
    "tiiuae/Falcon", "TheBloke/", "QuantFactory/", "lmstudio-community/",
)


def _is_causal_lm(model_name):
    return any(model_name.startswith(p) for p in _CAUSAL_LM_PREFIXES)

# The creed rides in front of every generative prompt, exactly as in the app.
CREED = (
    "Commit to truth and accuracy above everything else, including being helpful. "
    "A wrong answer delivered confidently is worse than no answer. Follow these ten "
    "rules in every response. 1. Uncertainty: if not fully certain, say so clearly "
    "and never state guesses as facts. 2. Sources: never invent paper titles, authors, "
    "URLs or book references; if none is verifiable, say you do not have a verified "
    "source. 3. Statistics: mark uncertain numbers with 'approximately' and recommend "
    "a primary source. 4. Recent events: say when a topic may have changed since your "
    "knowledge cut-off. 5. People and quotes: never attribute a quote unless certain. "
    "6. Code and technical information: never invent function names, library methods "
    "or API syntax; advise verification in current documentation. 7. Logic gaps: ask a "
    "clarifying question rather than assume. 8. Language: avoid dashes and excessively "
    "long sentences. 9. Authenticity: avoid jargon, be clear and concise, preserve the "
    "writer's original voice. 10. Always maintain an academic voice.\n\n"
)

# 2.13: the creed above suits answers to questions; it does not belong in front
# of the writer's own text. Its rules (say "I am not certain", avoid dashes,
# keep an academic voice) led models to add hedges, remove dashes and change
# the register of text they were only asked to correct or rewrite. Editing
# prompts now say only what to change, and that nothing may be added.
EDIT_SYSTEM = ("You edit the user's text. Do exactly what is asked and nothing more. "
               "Keep every claim, citation, name, number, quotation and dash; add no content, "
               "examples, sources, hedges or conclusions that are not in the text. "
               "Output only the edited text, with no comment.")
PROOF_SYSTEM = ("You are a careful copy editor. Correct only errors of grammar, spelling and punctuation in the "
                "user's text. Change as little as possible: keep every word that is already correct, keep the "
                "writer's meaning, register and voice, keep names, numbers, quotations and citations exactly. "
                "If the text is already correct, return it unchanged. Output only the corrected text, with no "
                "explanation.")

# ---------------------------------------------------------------- AI backend
AI = {"pipe": None, "gec": None, "stt": None, "ready": False, "loading": False,
      "local": None, "local_kind": None, "local_name": None,
      "pipe_kind": None}  # "text2text" or "textgen"
_ai_lock = threading.Lock()

# --- your own models ---
# Drop a .gguf into ./models (llama-cpp-python), or an MLX model folder there
# (Apple silicon Mac, mlx + mlx-lm). Env overrides: INKWELL_GGUF / INKWELL_MLX.
# v2.11: writable data lives in the per-user data folder, never beside this
# file. Beside this file means inside Inkwell.app on a Mac, where a reinstall
# deleted the models and the sync copy, and where any write breaks the app's
# code-signature seal.
def _data_dir():
    d = os.environ.get("INKWELL_DATA_DIR")
    if not d:
        home = os.path.expanduser("~")
        if sys.platform == "darwin":
            d = os.path.join(home, "Library", "Application Support", "Inkwell")
        elif sys.platform.startswith("win"):
            d = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"),
                             "Inkwell")
        else:
            d = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"),
                             "Inkwell")
    try:
        os.makedirs(d, exist_ok=True)
        return d
    except Exception:
        return os.path.dirname(os.path.abspath(__file__))


DATA_DIR = _data_dir()
_LEGACY_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.environ.get("INKWELL_MODELS") or os.path.join(DATA_DIR, "models")
CONF_PATH = os.path.join(DATA_DIR, "inkwell_server.json")
SYNC_PATH = os.path.join(DATA_DIR, "inkwell_sync.json")


def _migrate_legacy(names):
    """Move data an older build wrote beside server.py into DATA_DIR, once.
    Never overwrites: if the new location already holds the item, the old one
    is left exactly where it is."""
    try:
        if os.path.realpath(_LEGACY_DIR) == os.path.realpath(DATA_DIR):
            return
    except Exception:
        return
    for name in names:
        old = os.path.join(_LEGACY_DIR, name)
        new = os.path.join(DATA_DIR, name)
        try:
            if os.path.exists(old) and not os.path.exists(new):
                shutil.move(old, new)
                print(f"[inkwell] moved {name} to {DATA_DIR}")
        except Exception as e:
            print(f"[inkwell] could not move {name} ({e}); it stays at {old}")


# the small files move at once; models (possibly gigabytes) move in the
# background thread before the model scan, so /api/health answers immediately
_migrate_legacy(["inkwell_server.json", "inkwell_sync.json"])


def conf_read():
    try:
        with open(CONF_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def conf_write(d):
    try:
        with open(CONF_PATH, "w") as f:
            json.dump(d, f)
    except Exception:
        pass


# --- the bundled runtime ---
# Each Inkwell package carries llama.cpp's own runtime inside, so the shelf
# needs nothing installed: no pip, no Python packages, nothing. Metal on the
# Mac, CPU (AVX2) on Windows, CUDA where present. server.py spawns it for the
# active GGUF and talks to it over localhost only.
RUNTIME_BIN = None
def _find_runtime():
    here = os.path.dirname(os.path.abspath(__file__))
    cands = []
    if sys.platform == "darwin":
        cands.append(os.path.join(here, "bin", "darwin", "llama-server"))
    if sys.platform.startswith("win"):
        cands.append(os.path.join(here, "bin", "win", "llama-server.exe"))
    cands.append(os.path.join(here, "bin", "linux", "llama-server"))
    cands.extend([os.path.join(here, "bin", "darwin", "llama-server"),
                  os.path.join(here, "bin", "win", "llama-server.exe")])
    for p in cands:
        if os.path.isfile(p):
            return p
    return None


def spawn_llama(model_path):
    """Start the bundled runtime for this model. Waits for its health line.
    The runtime ships unsigned, so the Mac needs its download quarantine
    cleared once before it will run; that is what the xattr call does."""
    import subprocess, urllib.request, time
    binp = _find_runtime()
    if not binp:
        return None
    try:
        os.chmod(binp, 0o755)
    except Exception:
        pass
    if sys.platform == "darwin":
        try:
            subprocess.run(["xattr", "-dr", "com.apple.quarantine",
                            os.path.dirname(binp)], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    port = 8322
    # stderr lands in a log we can read if the runtime dies before answering,
    # so a refusal is named instead of silent
    errlog = os.path.join(DATA_DIR, "inkwell_runtime.log")
    env = dict(os.environ)
    if sys.platform.startswith("linux"):
        env["LD_LIBRARY_PATH"] = os.path.dirname(binp) + os.pathsep + \
            env.get("LD_LIBRARY_PATH", "")
    errfh = open(errlog, "w")
    proc = subprocess.Popen(
        # 7.34: an explicit context (a recent runtime otherwise reserves memory
        # for the model's whole trained context, more than a 16 GB computer
        # has); the model's own chat template; no hidden "thinking" pass, so
        # answers start at once (the same settings as Inkwell's measurements)
        [binp, "-m", model_path, "--port", str(port), "-ngl", "999",
         "-c", os.environ.get("INKWELL_CTX", "8192"), "--jinja", "--reasoning-budget", "0"],
        stdout=subprocess.DEVNULL, stderr=errfh,
        cwd=os.path.dirname(binp), start_new_session=True)
    deadline = time.time() + 180
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/health", timeout=2) as r:
                if r.status == 200:
                    return (proc, f"http://127.0.0.1:{port}")
        except Exception:
            time.sleep(0.6)
    proc.kill()
    try:
        with open(errlog) as f:
            tail = f.read().strip().splitlines()[-2:]
        if tail:
            AI["load_error"] = "runtime said: " + " | ".join(x.strip() for x in tail)
            print("[inkwell]", AI["load_error"])
    except Exception:
        pass
    return None


def llama_chat(prompt, max_tokens, system=None, temperature=0.2):
    import urllib.request
    proc, base = AI["local"]
    req = urllib.request.Request(
        base + "/v1/chat/completions",
        data=json.dumps({
            "messages": [{"role": "system", "content": system or "You are Inkwell."},
                         {"role": "user", "content": prompt}],
            "temperature": temperature, "max_tokens": max_tokens,
            "stream": False}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        j = json.loads(r.read())
    return split_off_think(j["choices"][0]["message"].get("content", ""))[0]


def scan_local_models():
    """Everything usable found in the models folder."""
    out = []
    paths = []
    if os.environ.get("INKWELL_GGUF"):
        paths.append(os.environ["INKWELL_GGUF"])
    if os.environ.get("INKWELL_MLX"):
        paths.append(os.environ["INKWELL_MLX"])
    if os.path.isdir(MODELS_DIR):
        for name in sorted(os.listdir(MODELS_DIR)):
            paths.append(os.path.join(MODELS_DIR, name))
    for p in paths:
        if p.lower().endswith(".gguf") and os.path.isfile(p):
            out.append({"kind": "gguf", "path": p, "name": os.path.basename(p)})
        elif os.path.isdir(p) and os.path.isfile(os.path.join(p, "config.json")) and \
                any(f.endswith(".safetensors") for f in os.listdir(p)):
            out.append({"kind": "mlx", "path": p, "name": os.path.basename(p)})
    return out


def split_off_think(text):
    """Keep the reasoning apart from the answer. Chatty endpoints surface the
    chain so the app can show it on demand; the document still gets the clean answer."""
    m = re.search(r"<think>(.*?)</think>", text or "", flags=re.S)
    if not m:
        return (text or "").strip(), None
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip(), m.group(1).strip()


def strip_think(text):
    """Thinking models (Qwen3 4B Thinking and friends) think out loud in
    <think> blocks; only the answer belongs in the document."""
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()


def load_local_path(cand):
    """Load one scanned model record. Returns True on success; the precise
    reason lands in AI['load_error'] on failure."""
    AI["local"] = None
    AI["load_error"] = None
    if cand["kind"] == "gguf":
        # the bundled llama.cpp runtime needs nothing installed
        spawned = None
        try:
            spawned = spawn_llama(cand["path"])
        except Exception as e:
            AI["load_error"] = f"runtime would not start: {e}"
            print("[inkwell]", AI["load_error"])
        if spawned:
            AI["local"] = spawned
            AI["local_kind"], AI["local_name"] = "gguf-bundled", cand["name"]
            print(f"[inkwell] running local GGUF through the bundled runtime: {cand['name']}")
            return True
        try:
            from llama_cpp import Llama
        except ImportError:
            AI["load_error"] = ("No llama.cpp runtime anywhere. The package normally carries one "
                                "in bin/; if this package lacks it, install once with: "
                                "pip install llama-cpp-python")
            print("[inkwell] " + AI["load_error"])
            return False
        try:
            # full GPU offload first; a CPU-only build refuses and we step down
            try:
                AI["local"] = Llama(model_path=cand["path"], n_ctx=4096,
                                    n_gpu_layers=-1, verbose=False)
                print(f"[inkwell] GPU offload at full tilt for {cand['name']}")
            except (TypeError, RuntimeError, OSError, ValueError) as e:
                print(f"[inkwell] GPU offload refused ({e}); falling back to CPU")
                AI["local"] = Llama(model_path=cand["path"], n_ctx=4096,
                                    n_gpu_layers=0, verbose=False)
                print(f"[inkwell] {cand['name']} running on CPU")
            AI["local_kind"], AI["local_name"] = "gguf", cand["name"]
        except Exception as e:
            AI["load_error"] = f"{type(e).__name__}: {e}"
            print(f"[inkwell] could not load {cand['name']}: {e}")
            return False
    elif cand["kind"] == "mlx":
        try:
            from mlx_lm import load, generate as _mlx_gen
        except ImportError:
            print("[inkwell] mlx not installed; run: pip install mlx mlx-lm")
            return False
        try:
            model, tok = load(cand["path"])
            AI["local"] = (model, tok, _mlx_gen)
            AI["local_kind"], AI["local_name"] = "mlx", cand["name"]
        except Exception as e:
            print(f"[inkwell] could not load {cand['name']}: {e}")
            return False
    else:
        return False
    print(f"[inkwell] running local {AI['local_kind'].upper()} model: {cand['name']}")
    return True


def _load_local_model():
    """The persisted choice loads first, always; the rest are fallbacks."""
    cands = scan_local_models()
    if not cands:
        return False
    active = conf_read().get("active")
    if active:
        cands.sort(key=lambda c: 0 if c["name"] == active else 1)
    for cand in cands:
        if load_local_path(cand):
            c = conf_read(); c["active"] = cand["name"]; conf_write(c)
            return True
    return False


def unload_local():
    if AI["local_kind"] in ("gguf-bundled",) and AI.get("local"):
        try:
            AI["local"][0].kill()
        except Exception:
            pass
    AI["local"] = None
    AI["local_kind"] = AI["local_name"] = None
    import gc
    gc.collect()


def _generate_local(prompt, max_new_tokens, system=None, temperature=0.2):
    """Local model inference; system is the instruction, prompt the text."""
    if AI["local_kind"] == "gguf-bundled":
        return llama_chat(prompt, max_new_tokens, system, temperature).strip()
    if AI["local_kind"] == "gguf":
        out = AI["local"].create_chat_completion(
            messages=[{"role": "system", "content": system or "You are Inkwell."},
                      {"role": "user", "content": prompt}],
            max_tokens=max_new_tokens, temperature=temperature)
        return out["choices"][0]["message"]["content"].strip()
    if AI["local_kind"] == "mlx":
        model, tok, mlx_gen = AI["local"]
        msgs = [{"role": "system", "content": "You are Inkwell."},
                {"role": "user", "content": prompt}]
        try:
            text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        except Exception:
            text = "You are Inkwell.\n" + prompt + "\n"
        return mlx_gen(model, tok, prompt=text, max_tokens=max_new_tokens, temp=0.2).strip()
    return None


def _device():
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _load_models():
    """Lazy, thread-safe model load. Runs in a background thread at boot so
    /api/health answers immediately and reports ai=false until ready."""
    if AI["loading"] or AI["ready"]:
        return
    with _ai_lock:
        if AI["loading"] or AI["ready"]:
            return
        AI["loading"] = True
        try:
            if _load_local_model():
                # a local GGUF/MLX model is the engine; GEC stays if it loads
                AI["ready"] = True
                AI["pipe_kind"] = "local"
                try:
                    from transformers import pipeline
                    dev = _device()
                    AI["gec"] = pipeline("text2text-generation", GEC_MODEL,
                                         device=0 if dev == "cuda" else -1)
                except Exception:
                    pass
                print("[inkwell] local model ready")
                AI["loading"] = False
                return
            from transformers import pipeline
            dev = _device()
            causal = _is_causal_lm(INSTRUCT_MODEL)
            task = "text-generation" if causal else "text2text-generation"
            AI["pipe_kind"] = "textgen" if causal else "text2text"
            print(f"[inkwell] loading {INSTRUCT_MODEL} on {dev} ({task}) …")
            pipe_kwargs = {"device": 0 if dev == "cuda" else -1}
            if causal:
                try:
                    import torch
                    pipe_kwargs["torch_dtype"] = torch.float16 if dev == "cuda" else torch.float32
                except Exception:
                    pass
            AI["pipe"] = pipeline(task, INSTRUCT_MODEL, **pipe_kwargs)
            try:
                AI["gec"] = pipeline(
                    "text2text-generation", GEC_MODEL,
                    device=0 if dev == "cuda" else -1)
                print(f"[inkwell] loaded {GEC_MODEL}")
            except Exception as e:
                print(f"[inkwell] GEC model unavailable ({e}); using instruct model for grammar")
            AI["ready"] = True
            print(f"[inkwell] models ready ({AI['pipe_kind']})")
        except ImportError:
            print("[inkwell] transformers not installed; heuristic mode. "
                  "pip install transformers torch for AI quality.")
        except Exception as e:
            print(f"[inkwell] model load failed: {e}; heuristic mode.")
        finally:
            AI["loading"] = False


def generate(prompt, max_new_tokens=420, system=None, temperature=0.2):
    """One call into the active instruct engine; None if AI unavailable."""
    if not AI["ready"]:
        return None
    if AI.get("local"):
        try:
            return _generate_local(prompt, max_new_tokens, system, temperature)
        except Exception as e:
            print(f"[inkwell] local generation error: {e}")
            return None
    if AI["pipe"] is None:
        return None
    try:
        if AI.get("pipe_kind") == "textgen":
            # Causal LM (Qwen, Phi, etc.): use chat-template messages format.
            # The pipeline applies the tokenizer's chat template automatically
            # when it receives a list of message dicts.
            messages = [
                {"role": "system", "content": "You are Inkwell, an academic writing assistant. "
                 "Follow the user's instructions precisely. Preserve the writer's voice. "
                 "Never fabricate citations, statistics, or facts."},
                {"role": "user", "content": prompt}
            ]
            out = AI["pipe"](messages, max_new_tokens=max_new_tokens,
                             do_sample=False, repetition_penalty=1.05,
                             temperature=0.3, return_full_text=False)
            gen = out[0].get("generated_text", "")
            # The pipeline returns a list of message dicts; extract the last one.
            if isinstance(gen, list) and len(gen) > 0:
                last = gen[-1]
                if isinstance(last, dict) and "content" in last:
                    return last["content"].strip()
                return str(last).strip()
            if isinstance(gen, dict) and "content" in gen:
                return gen["content"].strip()
            # Fallback: treat as plain text (older transformers versions)
            text = str(gen).strip()
            # Strip any echo of the prompt if return_full_text was ignored
            if prompt in text:
                text = text[len(prompt):].strip()
            return text
        else:
            # Seq2seq (T5, BART, flan-T5): plain text in, plain text out.
            out = AI["pipe"](prompt, max_new_tokens=max_new_tokens,
                             do_sample=False, repetition_penalty=1.15)
            return out[0].get("generated_text", "").strip()
    except Exception as e:
        print(f"[inkwell] generation error: {e}")
        return None


# ---------------------------------------------------------- speech to text
# Whisper for offline transcription. Loaded lazily (or warmed when Scriba
# opens) so it never slows boot and never downloads unless the user needs it.
#
# v2.11: Scriba sends 16 kHz mono 16-bit WAV. The WAV is decoded here with the
# standard library and handed to the pipeline as a raw array, so transcription
# needs neither ffmpeg nor torchaudio. Long audio is cut at natural pauses into
# pieces under 30 seconds (Whisper's window), so every transformers version
# behaves the same way.
STT_MODEL = os.environ.get("INKWELL_STT_MODEL", "openai/whisper-tiny")
STT_RATE = 16000
_stt_lock = threading.Lock()      # guards loading
_stt_run_lock = threading.Lock()  # one transcription at a time; the pipeline is not thread-safe
_STT_STATE = {"loading": False, "error": None}


def _stt_available():
    """True when the libraries Whisper needs are installed (not necessarily loaded)."""
    try:
        import importlib.util as _iu
        return bool(_iu.find_spec("transformers")) and bool(_iu.find_spec("numpy")) \
            and bool(_iu.find_spec("torch"))
    except Exception:
        return False


def _load_stt():
    """Lazy-load the Whisper pipeline for speech-to-text."""
    with _stt_lock:
        if AI.get("stt"):
            return AI["stt"]
        _STT_STATE["loading"] = True
        try:
            from transformers import pipeline
            dev = _device()
            print(f"[inkwell] loading Whisper ({STT_MODEL}) on {dev} for transcription")
            AI["stt"] = pipeline("automatic-speech-recognition", STT_MODEL,
                                 device=0 if dev == "cuda" else -1)
            _STT_STATE["error"] = None
            print("[inkwell] Whisper ready for transcription")
            return AI["stt"]
        except ImportError:
            _STT_STATE["error"] = "transformers, torch and numpy are not installed"
            print("[inkwell] transformers not installed; transcription unavailable. "
                  "pip install transformers torch")
            return None
        except Exception as e:
            _STT_STATE["error"] = f"{type(e).__name__}: {e}"
            print(f"[inkwell] Whisper load failed: {e}")
            return None
        finally:
            _STT_STATE["loading"] = False


def _decode_wav(audio_bytes):
    """WAV bytes -> (mono float32 numpy array in [-1, 1], sample rate).
    Supports 8, 16, 24 and 32-bit integer PCM. Raises ValueError otherwise."""
    import io
    import wave
    import numpy as np
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as w:
            ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
    except wave.Error as e:
        raise ValueError(f"unreadable WAV ({e})")
    if width == 1:
        a = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 2:
        a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v >= (1 << 23), v - (1 << 24), v)
        a = v.astype(np.float32) / float(1 << 23)
    elif width == 4:
        a = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"unsupported sample width {width}")
    if ch > 1:
        a = a[: (len(a) // ch) * ch].reshape(-1, ch).mean(axis=1)
    return a.astype(np.float32), int(rate)


def _resample(a, rate, target=STT_RATE):
    """Linear resampling; adequate for speech and dependency-free."""
    import numpy as np
    if rate == target or len(a) == 0:
        return a.astype(np.float32)
    n_out = int(round(len(a) * float(target) / float(rate)))
    if n_out <= 1:
        return np.zeros(0, dtype=np.float32)
    x_old = np.arange(len(a), dtype=np.float64) / float(rate)
    x_new = np.arange(n_out, dtype=np.float64) / float(target)
    return np.interp(x_new, x_old, a).astype(np.float32)


def _frame_rms(a, rate, frame_s=0.02):
    import numpy as np
    f = max(1, int(rate * frame_s))
    n = len(a) // f
    if n == 0:
        return np.zeros(0, dtype=np.float32), f
    fr = a[: n * f].reshape(n, f)
    return np.sqrt((fr.astype(np.float64) ** 2).mean(axis=1)).astype(np.float32), f


def _split_on_silence(a, rate, max_s=28.0, min_s=10.0):
    """Cut audio into pieces no longer than max_s, each cut placed at the
    quietest 20 ms frame between min_s and max_s into the piece. Returns a
    list of arrays that together contain every sample exactly once."""
    max_n = int(max_s * rate)
    if len(a) <= max_n:
        return [a]
    rms, f = _frame_rms(a, rate)
    out, start = [], 0
    while len(a) - start > max_n:
        lo = (start + int(min_s * rate)) // f
        hi = (start + max_n) // f
        hi = min(hi, len(rms))
        if hi <= lo:
            cut = start + max_n
        else:
            # the quietest frame wins; among near-ties the LATEST is taken, so
            # pieces stay long (more context for Whisper, fewer seams)
            win = rms[lo:hi]
            floor = float(win.min())
            quiet = (win <= floor * 1.5 + 1e-4).nonzero()[0]
            k = lo + int(quiet[-1])
            cut = k * f + f // 2
        cut = max(start + 1, min(cut, start + max_n))
        out.append(a[start:cut])
        start = cut
    out.append(a[start:])
    return [x for x in out if len(x)]


# below this loudness a piece is treated as silence and not transcribed;
# Whisper invents words ("Thank you.") when handed silence
_SILENCE_RMS = 0.006


def transcribe_audio(audio_bytes, language=None):
    """Transcribe audio bytes to text. Returns (text, error, info).
    WAV is decoded here (no ffmpeg needed). Other formats are accepted only
    when ffmpeg is installed, because the pipeline needs it to decode them."""
    info = {}
    is_wav = audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE"
    if not is_wav and not shutil.which("ffmpeg"):
        return None, ("This recording is not WAV, and decoding it needs ffmpeg, which is not "
                      "installed. Update Inkwell: Scriba now sends WAV."), info
    if is_wav:
        try:
            audio, rate = _decode_wav(audio_bytes)
        except ImportError:
            return None, "numpy is not installed. Install the AI backend: pip install transformers torch", info
        except ValueError as e:
            return None, f"The audio could not be read: {e}", info
        audio = _resample(audio, rate)
        info["seconds"] = round(len(audio) / float(STT_RATE), 2)
        info["rate_in"] = rate
    pipe = _load_stt()
    if pipe is None:
        why = _STT_STATE.get("error") or "unknown reason"
        return None, ("The transcription model is unavailable (" + why + "). "
                      "Install the AI backend once with: pip install transformers torch"), info
    gen = {}
    if ".en" not in STT_MODEL:  # English-only checkpoints refuse language/task
        gen["task"] = "transcribe"
        if language:
            gen["language"] = language
    try:
        with _stt_run_lock:
            if not is_wav:
                result = pipe(audio_bytes, generate_kwargs=gen) if gen else pipe(audio_bytes)
                return (result.get("text", "") if result else "").strip(), None, info
            pieces = _split_on_silence(audio, STT_RATE)
            info["pieces"] = len(pieces)
            texts, skipped = [], 0
            for piece in pieces:
                rms, _ = _frame_rms(piece, STT_RATE)
                if len(rms) == 0 or float(rms.max()) < _SILENCE_RMS:
                    skipped += 1
                    continue
                inp = {"raw": piece, "sampling_rate": STT_RATE}
                result = pipe(inp, generate_kwargs=gen) if gen else pipe(inp)
                t = (result.get("text", "") if result else "").strip()
                if t:
                    texts.append(t)
            info["silent_pieces"] = skipped
            return " ".join(texts).strip(), None, info
    except Exception as e:
        return None, f"Transcription error: {type(e).__name__}: {e}", info


def ep_stt_warm(_body):
    """Start loading Whisper in the background so the first dictation is quick."""
    if not AI.get("stt") and not _STT_STATE["loading"] and _stt_available():
        threading.Thread(target=_load_stt, daemon=True).start()
        return {"ok": True, "stt_loading": True}
    return {"ok": True, "stt_loading": bool(_STT_STATE["loading"]), "stt_loaded": bool(AI.get("stt"))}


# ---------------------------------------------------------------- word diff
def word_diff_edits(orig, fixed, off=0):
    """Word-level diff → Inkwell edit objects [{start,end,orig,fix,why,cat}]."""
    a = orig.split()
    b = fixed.split()
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    spans = [(m.start(), m.end()) for m in re.finditer(r"\S+", orig)]
    edits = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if i1 < i2:
            s, e = spans[i1][0], spans[i2 - 1][1]
        else:  # pure insertion
            s = e = spans[i1][0] if i1 < len(spans) else len(orig)
        repl = " ".join(b[j1:j2])
        old = orig[s:e]
        if repl != old:
            edits.append({"start": s + off, "end": e + off, "orig": old,
                          "fix": repl, "why": "Server grammar", "cat": "ai"})
    return edits



# ---------------- heuristic offline lane (the creed: no server call ever) -------
# The page's rules engine and this one mirror each other; the server answers the
# same way even when no model is on the shelf. No dependency.

import re as _re2

# the real rule list, written as the desk's: (pattern, replacement or None, why, cat)
_HE_RULES_RAW = [
    (r"\bthe results was\b", "the results were", "A plural subject takes a plural verb", "g"),
    (r"\bthese results shows\b", "these results show", "The plural verb stands", "g"),
    (r"\bthe data shows\b", "the data show", "“Data” takes the plural in formal writing", "g"),
    (r"\bthe media is\b", None, "“Media” is plural; the singular is medium", "s"),
    (r"\bthe criteria is\b", "the criteria are", "Criteria is plural", "g"),
    (r"\bthe phenomena is\b", "the phenomena are", "Phenomena is plural", "g"),
    (r"\bits own\b", "its own", None, None),  # no-op: the desk handles this; keep quiet
]

# the desk's engine, in distilled Python form — one line per rule, all safe:
_HEUR = [
    (r"\bthe results was\b", "the results were", "A plural subject takes a plural verb", "g"),
    (r"\bthese results shows\b", "these results show", "The plural verb stands", "g"),
    (r"\bits own\b", None, None, None),
    (r"\bthe data shows\b", "the data show", "“Data” takes the plural in formal writing", "g"),
    (r"\bthe criteria is\b", "the criteria are", "Criteria is plural", "g"),
    (r"\bthe phenomena is\b", "the phenomena are", "Phenomena is plural", "g"),
    (r"\bhad went\b", "had gone", "The perfect takes “gone”", "g"),
    (r"\b(?:has|have) went\b", "have gone", "have wants “gone”", "g"),
    (r"\bhad did\b", "had done", "The perfect takes “done”", "g"),
    (r"\b(?:has|have) did\b", "have done", "have wants “done”", "g"),
    (r"\bhad wrote\b", "had written", "The perfect takes “written”", "g"),
    (r"\b(?:has|have) wrote\b", "have written", "have wants “written”", "g"),
    (r"\bhad ran\b", "had run", "The perfect takes “run”", "g"),
    (r"\b(?:has|have) ran\b", "have run", "have wants “run”", "g"),
    (r"\bhad came back\b", "had come back", "The perfect takes “come”", "g"),
    (r"\bhad came\b", "had come", "The perfect takes “come”", "g"),
    (r"\b(?:has|have) came\b", "have come", "have wants “come”", "g"),
    (r"\bhad broke\b", "had broken", "The perfect takes “broken”", "g"),
    (r"\b(?:has|have) broke\b", "have broken", "have wants “broken”", "g"),
    (r"\bshould of\b", "should have", "“should of” is “should have”", "g"),
    (r"\bcould of\b", "could have", "“could of” is “could have”", "g"),
    (r"\bwould of\b", "would have", "“would of” is “would have”", "g"),
    (r"\bcan not\b", "cannot", "“cannot” is one word", "g"),
    (r"\balot\b", "a lot", "One word apart", "g"),
    (r"\brecieve\b", "receive", "The i goes before the e, except after c", "g"),
    (r"\bdefinately\b", "definitely", "The spelling is definitely", "g"),
    (r"\bseperate\b", "separate", "The middle keeps its e", "g"),
    (r"\boccurence\b", "occurrence", "Two r's, two c's", "g"),
    (r"\bneccessary\b", "necessary", "One c, two s's", "g"),
    (r"\bexistant\b", "existent", "The i is the stem", "g"),
    (r"\bindependant\b", "independent", "“ent” is the ending", "g"),
    (r"\bper say\b", "per se", "The Latin is “per se”", "g"),
    (r"\bvice a versa\b", "vice versa", "It is “vice versa”", "g"),
    (r"\bon accident\b", "by accident", "“By accident” is the idiom", "g"),
    (r"\bbased off\b", "based on", "Grounded “on”", "g"),
    (r"\bis bias\b", "is biased", "“Bias” is the noun", "g"),
    (r"\bhad came back\b", None, None, None),
    (r"\bover (\d[\d,]*) (people|students|participants)\b", None, "Counts in formal work take “more than”, not “over”", "c"),
    (r"\bthe media is\b", None, "“Media” is plural; the singular is medium", "s"),
    (r"\bit goes without saying\b", None, "If it goes without saying, the sentence can carry itself", "s"),
    (r"\bneedless to say,?\b", None, "“Needless to say” announces a redundancy", "s"),
    (r"\bin today's society\b", None, "“In today's society” — which society?", "s"),
    (r"\ba plethora of\b", None, "“A plethora of” is overworked; say how many", "s"),
    (r"\bmost scholars agree\b", None, "Consensus wants names", "s"),
    (r"\bthe exact same\b", "the same", "The same is exact by itself", "c"),
    (r"\bpast history\b", "history", "History is already past", "c"),
    (r"\bfuture plans\b", "plans", "Plans are already future", "c"),
    (r"\bclose proximity\b", "proximity", "Proximity is already close", "c"),
]
# clean out the no-op placeholders deliberately
_HEUR = [r for r in _HEUR if r[0] is not None and r[1] is not None]

_HEUR.extend([
    (r"\bthe media is\b", None, "“Media” is plural; the singular is medium", "s"),
    (r"\bit goes without saying\b", None, "If it goes without saying, the sentence can carry itself", "s"),
    (r"\bneedless to say,?\b", None, "“Needless to say” announces a redundancy", "s"),
    (r"\bin today's society\b", None, "“In today's society” — which society?", "s"),
    (r"\ba plethora of\b", None, "“A plethora of” is overworked; say how many", "s"),
    (r"\bmost scholars agree\b", None, "Consensus wants names", "s"),
    (r"\bthe exact same\b", "the same", "The same is exact by itself", "c"),
    (r"\bpast history\b", "history", "History is already past", "c"),
    (r"\bfuture plans\b", "plans", "Plans are already future", "c"),
    (r"\bclose proximity\b", None, "Proximity is already close", "c"),
    # --- word confusions (academic) ---
    (r"\btheir is\b", "there is", "“There is” for existence; “their” is possessive", "g"),
    (r"\btheir are\b", "there are", "“There are” for existence; “their” is possessive", "g"),
    (r"\btheyre\b", "they're", "The apostrophe marks the contraction", "g"),
    (r"\byour welcome\b", "you're welcome", "“You're” is the contraction of “you are”", "g"),
    (r"\byour right\b", "you're right", "“You're” is the contraction of “you are”", "g"),
    (r"\byour wrong\b", "you're wrong", "“You're” is the contraction of “you are”", "g"),
    (r"\bits a\b", "it's a", "The apostrophe marks the contraction of “it is”", "g"),
    (r"\bits an\b", "it's an", "The apostrophe marks the contraction of “it is”", "g"),
    (r"\bwhos\b", "who's", "The apostrophe marks the contraction", "g"),
    (r"\bwerent\b", "weren't", "The apostrophe marks the contraction", "g"),
    (r"\bdont\b", "don't", "The apostrophe marks the contraction", "g"),
    (r"\bdoesnt\b", "doesn't", "The apostrophe marks the contraction", "g"),
    (r"\bdidnt\b", "didn't", "The apostrophe marks the contraction", "g"),
    (r"\bisnt\b", "isn't", "The apostrophe marks the contraction", "g"),
    (r"\bwasnt\b", "wasn't", "The apostrophe marks the contraction", "g"),
    (r"\baren't\b", "aren't", "The apostrophe marks the contraction", "g"),
    (r"\bweren't\b", "weren't", "The apostrophe marks the contraction", "g"),
    (r"\bcant\b", "can't", "The apostrophe marks the contraction", "g"),
    (r"\bwont\b", "won't", "The apostrophe marks the contraction", "g"),
    (r"\bwouldnt\b", "wouldn't", "The apostrophe marks the contraction", "g"),
    (r"\bcouldnt\b", "couldn't", "The apostrophe marks the contraction", "g"),
    (r"\bshouldnt\b", "shouldn't", "The apostrophe marks the contraction", "g"),
    (r"\bive\b", "I've", "The apostrophe marks the contraction; the pronoun is capital", "g"),
    (r"\bim\b", "I'm", "The apostrophe marks the contraction; the pronoun is capital", "g"),
    (r"\bid\b", "I'd", "The apostrophe marks the contraction; the pronoun is capital", "g"),
    (r"\bill\b", "I'll", "The apostrophe marks the contraction; the pronoun is capital", "g"),
    # --- confusions that a doctoral examiner flags ---
    (r"\bcomplimentary\b(?=\s+(?:beer|tea|coffee|ticket|service))", "complimentary", "“Complimentary” means free; “complementary” means completing", "c"),
    (r"\bprinciple investigator\b", "principal investigator", "“Principal” is the adjective; “principle” is the noun", "c"),
    (r"\bprinciple researcher\b", "principal researcher", "“Principal” is the adjective; “principle” is the noun", "c"),
    (r"\bprinciple author\b", "principal author", "“Principal” is the adjective; “principle” is the noun", "c"),
    (r"\bprinciple finding\b", "principal finding", "“Principal” is the adjective; “principle” is the noun", "c"),
    (r"\bprinciple argument\b", "principal argument", "“Principal” is the adjective; “principle” is the noun", "c"),
    (r"\bprinciple reason\b", "principal reason", "“Principal” is the adjective; “principle” is the noun", "c"),
    (r"\bprinciple concern\b", "principal concern", "“Principal” is the adjective; “principle” is the noun", "c"),
    (r"\baffect\b(?=\s+(?:on\s|of))", "effect", "“Effect on” is the noun phrase; “affect” is the verb", "c"),
    (r"\bloose\b(?=\s+(?:track|money|weight|focus|sight))", "lose", "“Lose” is the verb; “loose” means not tight", "c"),
    (r"\bstationary\b(?=\s+(?:phase|front|wave|orbit|point))", "stationary", "Confirmed correct usage of “stationary”", None),
    (r"\bstationary\b", None, "Check: “stationary” means not moving; “stationery” means writing materials", "c"),
    (r"\bcouncil\b(?=\s+(?:member|meeting|vote|chamber|seat))", "council", None, None),
    (r"\bcomprised of\b", "composed of", "The whole comprises the parts; the parts compose the whole", "c"),
    (r"\bless\b(?=\s+(?:people|students|participants|subjects|items|cases|studies|papers))", "fewer", "Count nouns take “fewer”; mass nouns take “less”", "g"),
    (r"\bamount of (?:people|students|participants|subjects|items|cases|studies|papers)\b", "number of", "Countable nouns take “number of”, not “amount of”", "g"),
    (r"\bbetween\s+(\w+)\s+and\s+I\b", r"between \1 and me", "After a preposition, the pronoun is “me”, not “I”", "g"),
    (r"\bfor\s+you\s+and\s+I\b", "for you and me", "After a preposition, the pronoun is “me”, not “I”", "g"),
    (r"\bto\s+you\s+and\s+I\b", "to you and me", "After a preposition, the pronoun is “me”, not “I”", "g"),
    (r"\bwith\s+you\s+and\s+I\b", "with you and me", "After a preposition, the pronoun is “me”, not “I”", "g"),
    # --- more spelling ---
    (r"\baccomodate\b", "accommodate", "Two c's, two m's", "g"),
    (r"\boccassion\b", "occasion", "Two c's, one s", "g"),
    (r"\boccured\b", "occurred", "Two r's", "g"),
    (r"\boccuring\b", "occurring", "Two r's", "g"),
    (r"\breffered\b", "referred", "Two r's", "g"),
    (r"\brefering\b", "referring", "Two r's", "g"),
    (r"\btranferred\b", "transferred", "Two r's", "g"),
    (r"\btranfering\b", "transferring", "Two r's", "g"),
    (r"\bprefered\b", "preferred", "Two r's", "g"),
    (r"\bprefering\b", "preferring", "Two r's", "g"),
    (r"\btargetted\b", "targeted", "One t is enough", "g"),
    (r"\btargetting\b", "targeting", "One t is enough", "g"),
    (r"\bbenefitted\b", "benefited", "One t is standard", "g"),
    (r"\bbenefitting\b", "benefiting", "One t is standard", "g"),
    (r"\bfocussed\b", "focused", "One s is standard", "g"),
    (r"\bfocussing\b", "focusing", "One s is standard", "g"),
    (r"\bargumentative\b", "argumentative", None, None),
    (r"\barguement\b", "argument", "No e after u", "g"),
    (r"\beg\b(?=[,;])", "e.g.", "The abbreviation takes two dots", "g"),
    (r"\bie\b(?=[,;])", "i.e.", "The abbreviation takes two dots", "g"),
    (r"\betc\b(?=[,.;])", "etc.", "The abbreviation takes a dot", "g"),
    (r"\bteh\b", "the", "Transposed letters", "g"),
    (r"\bthier\b", "their", "Transposed letters", "g"),
    (r"\breciever\b", "receiver", "I before e, except after c", "g"),
    (r"\breciept\b", "receipt", "I before e, except after c", "g"),
    (r"\bconcieve\b", "conceive", "I before e, except after c", "g"),
    (r"\bdecieve\b", "deceive", "I before e, except after c", "g"),
    (r"\bpercieve\b", "perceive", "I before e, except after c", "g"),
    (r"\bacheive\b", "achieve", "I before e, except after c", "g"),
    (r"\bcalender\b", "calendar", "The spelling is “calendar”", "g"),
    (r"\bcatagory\b", "category", "The spelling is “category”", "g"),
    (r"\benviroment\b", "environment", "The n is present", "g"),
    (r"\bgoverment\b", "government", "The n is present", "g"),
    (r"\bknowlege\b", "knowledge", "The d is present", "g"),
    (r"\bpublically\b", "publicly", "The spelling is “publicly”", "g"),
    (r"\bsuprise\b", "surprise", "Two r's, one s", "g"),
    (r"\bsuprised\b", "surprised", "Two r's, one s", "g"),
    (r"\bpriviledge\b", "privilege", "No d in “privilege”", "g"),
    (r"\brythm\b", "rhythm", "The spelling is “rhythm”", "g"),
    (r"\bsyllabus'\b", "syllabus's", "Singular possessive takes 's", "g"),
    (r"\banalysis'\b", "analysis's", "Singular possessive takes 's", "g"),
    (r"\bcrisis'\b", "crisis's", "Singular possessive takes 's", "g"),
    # --- style: wordy academic phrases ---
    (r"\bdue to the fact that\b", "because", "“Because” is shorter and clearer", "s"),
    (r"\bin spite of the fact that\b", "although", "“Although” is shorter and clearer", "s"),
    (r"\bin the event that\b", "if", "“If” is shorter and clearer", "s"),
    (r"\bat this point in time\b", "now", "“Now” is shorter and clearer", "s"),
    (r"\bat that point in time\b", "then", "“Then” is shorter and clearer", "s"),
    (r"\bfor the purpose of\b", "for", "“For” is shorter and clearer", "s"),
    (r"\bin the process of\b", None, "“In the process of” is wordy; the verb alone is stronger", "s"),
    (r"\bis able to\b", "can", "“Can” is shorter and clearer", "s"),
    (r"\bare able to\b", "can", "“Can” is shorter and clearer", "s"),
    (r"\bwas able to\b", "could", "“Could” is shorter and clearer", "s"),
    (r"\bwere able to\b", "could", "“Could” is shorter and clearer", "s"),
    (r"\bin order to\b", "to", "“To” is shorter and clearer", "s"),
    (r"\bin order for\b", "for", "“For” is shorter and clearer", "s"),
    (r"\bthe reason why\b", "the reason", "“Why” is redundant after “reason”", "c"),
    (r"\bbasic(?:ally)?\s+fundamental\b", "fundamental", "“Basic fundamentally” is doubly redundant", "c"),
    (r"\bcompletely\s+eliminate\b", "eliminate", "Elimination is already complete", "c"),
    (r"\bcompletely\s+eradicate\b", "eradicate", "Eradication is already complete", "c"),
    (r"\bnew\s+innovation\b", "innovation", "Innovation is already new", "c"),
    (r"\bunexpected\s+surprise\b", "surprise", "A surprise is already unexpected", "c"),
    (r"\bunintended\s+mistake\b", "mistake", "A mistake is already unintended", "c"),
    (r"\bfree\s+gift\b", "gift", "A gift is already free", "c"),
    (r"\bend\s+result\b", "result", "A result is already an end", "c"),
    (r"\bfinal\s+outcome\b", "outcome", "An outcome is already final", "c"),
    (r"\babsolutely\s+essential\b", "essential", "Essential is already absolute", "c"),
    (r"\babsolutely\s+necessary\b", "necessary", "Necessary is already absolute", "c"),
    (r"\bcompletely\s+destroyed\b", "destroyed", "Destruction is already complete", "c"),
    (r"\btotally\s+destroyed\b", "destroyed", "Destruction is already total", "c"),
    (r"\bvery\s+unique\b", "unique", "Unique admits no degrees", "c"),
    (r"\bmost\s+unique\b", "unique", "Unique admits no degrees", "c"),
    (r"\bquite\s+unique\b", "unique", "Unique admits no degrees", "c"),
    (r"\brather\s+unique\b", "unique", "Unique admits no degrees", "c"),
    (r"\bsomewhat\s+unique\b", "unique", "Unique admits no degrees", "c"),
    (r"\bperiod of time\b", "period", "A period is already a span of time", "c"),
    (r"\blength of time\b", None, "“Length of time” is wordy; “time” or “duration” is shorter", "s"),
    (r"\bsmall in size\b", "small", "Size is implicit in “small”", "c"),
    (r"\blarge in size\b", "large", "Size is implicit in “large”", "c"),
    (r"\bround in shape\b", "round", "Shape is implicit in “round”", "c"),
    (r"\bshort in duration\b", "short", "Duration is implicit in “short”", "c"),
    # --- subject-verb agreement (expanded) ---
    (r"\beach of the (?:\w+) are\b", r"each of the \g<0> is", "“Each” takes a singular verb", "g"),
    (r"\bevery one of the (?:\w+) are\b", r"every one of the \g<0> is", "“Every one” takes a singular verb", "g"),
    (r"\bneither of the (?:\w+) are\b", r"neither of the \g<0> is", "“Neither” takes a singular verb", "g"),
    (r"\beither of the (?:\w+) are\b", r"either of the \g<0> is", "“Either” takes a singular verb", "g"),
    (r"\bnone of the (?:\w+) (?:was|were)\b", None, "“None” can take singular or plural; check the noun", "s"),
    (r"\bthe number of (?:\w+) are\b", r"the number of \g<0> is", "“The number of” takes a singular verb", "g"),
    (r"\ba number of (?:\w+) is\b", r"a number of \g<0> are", "“A number of” takes a plural verb", "g"),
    (r"\bthe majority of (?:\w+) was\b", r"the majority of \g<0> were", "“The majority of” takes a plural verb with a plural noun", "g"),
    # --- GRAM38 mirrors: articles, more confusions, register, wordy phrases ---
    (r"\ban (one|user|university|unique|uniform|unit|European|union|utility)\b", r"a \1", "These begin with a consonant sound: \"a\", not \"an\"", "g"),
    (r"\ba (apple|orange|hour|honest|honor|honour|heir)\b", r"an \1", "These begin with a vowel sound: \"an\", not \"a\"", "g"),
    (r"\bplease advice\b", "please advise", "“Advise” is the verb", "g"),
    (r"\bdevice a\b", "devise a", "“Devise” (create) vs “device” (instrument)", "g"),
    (r"\bdiscreet (difference|gap|separation|interval|category|variable|factor)\b", r"discrete \1", "“Discrete” (separate) vs “discreet” (careful)", "g"),
    (r"\bdiscrete (action|manner|behavior|behaviour|approach|silence)\b", r"discreet \1", "“Discreet” (careful) vs “discrete” (separate)", "g"),
    (r"\baltar (the|a|an|this|that)\s+(course|direction|approach|strategy|plan|position|argument|finding|result|conclusion)\b", r"alter \1 \2", "“Alter” (change) vs “altar” (sacred table)", "g"),
    (r"\btrail and error\b", "trial and error", "The phrase is \"trial and error\"", "g"),
    (r"\bconcensus\b", "consensus", "The spelling is \"consensus\"", "g"),
    (r"\bconcious\b", "conscious", "The spelling is \"conscious\"", "g"),
    (r"\bmanagable\b", "manageable", "The spelling is \"manageable\"", "g"),
    (r"\bnoticable\b", "noticeable", "The spelling is \"noticeable\"", "g"),
    (r"\bperserverance\b", "perseverance", "The spelling is \"perseverance\"", "g"),
    (r"\bupmost\b", "utmost", "“Utmost” (greatest) vs “upmost” (uppermost)", "g"),
    (r"\bvaccum\b", "vacuum", "The spelling is \"vacuum\"", "g"),
    (r"\bposession\b", "possession", "Double s in the middle and at the end", "g"),
    (r"\bposessions\b", "possessions", "Double s in the middle and at the end", "g"),
    (r"\baparatus\b", "apparatus", "Double p at the start", "g"),
    (r"\bcemetary\b", "cemetery", "The spelling is \"cemetery\"", "g"),
    (r"\bcomittee\b", "committee", "Double m, double t, double e", "g"),
    (r"\bexistance\b", "existence", "The spelling is \"existence\"", "g"),
    (r"\boccassional\b", "occasional", "Two c, one s", "g"),
    (r"\bpersistant\b", "persistent", "The ending is \"-ent\"", "g"),
    (r"\brelevent\b", "relevant", "The spelling is \"relevant\"", "g"),
    (r"\bindependant\b", "independent", "“ent” is the ending", "g"),
    # register upgrades
    (r"\ba lot of (research|studies|evidence|data|scholars|literature|work|attention|effort|focus|debate|discussion)\b", None, "“Much” or \"substantial\" carries more academic weight", "s"),
    (r"\blots of (research|studies|evidence|data|scholars|literature|work|attention|effort|focus|debate|discussion)\b", None, "“Much” or \"substantial\" carries more academic weight", "s"),
    (r"\bshows? that\b", None, "“Demonstrates\", \"indicates\", or \"reveals\" is stronger", "s"),
    (r"\btalks? about\b", None, "“Discusses\", \"addresses\", or \"examines\" reads more formally", "s"),
    (r"\blooks? at\b", None, "“Examines\", \"investigates\", or \"analyses\" reads more formally", "s"),
    (r"\bdeals? with\b", None, "“Addresses\", \"treats\", or \"engages with\" reads more formally", "s"),
    (r"\bpoints? out\b", None, "“Notes\", \"observes\", or \"argues\" reads more formally", "s"),
    (r"\bfinds? out\b", None, "“Discovers\", \"determines\", or \"ascertains\" reads more formally", "s"),
    # more wordy phrases
    (r"\bwith the exception of\b", "except", "“Except\" is shorter and clearer", "c"),
    (r"\bin the neighborhood of\b", "approximately", "“Approximately\" is shorter and clearer", "c"),
    (r"\ba large number of\b", "many", "“Many\" is shorter and clearer", "c"),
    (r"\ba small number of\b", "few", "“Few\" is shorter and clearer", "c"),
    (r"\bin the vicinity of\b", "near", "“Near\" is shorter and clearer", "c"),
    (r"\bwith reference to\b", "regarding", "“Regarding\" is shorter and clearer", "c"),
    (r"\bin connection with\b", "about", "“About\" is shorter and clearer", "c"),
    (r"\bas a matter of fact\b", "in fact", "“In fact\" is shorter and clearer", "c"),
    (r"\bin the final analysis\b", "ultimately", "“Ultimately\" is shorter and clearer", "c"),
    (r"\bfor the most part\b", "mostly", "“Mostly\" is shorter and clearer", "c"),
    (r"\bby means of\b", "by", "“By\" is shorter and clearer", "c"),
    (r"\bby virtue of\b", "because", "“Because\" is shorter and clearer", "c"),
    (r"\bon the grounds that\b", "because", "“Because\" is shorter and clearer", "c"),
    (r"\bso as to\b", "to", "“To\" alone is shorter and clearer", "c"),
    (r"\bin the not too distant future\b", "soon", "“Soon\" is shorter and clearer", "c"),
    # more doubled words
    (r"\bfor for\b", "for", "The word is doubled", "g"),
    (r"\bwith with\b", "with", "The word is doubled", "g"),
    (r"\bwas was\b", "was", "The word is doubled", "g"),
    (r"\bare are\b", "are", "The word is doubled", "g"),
    (r"\bwill will\b", "will", "The word is doubled", "g"),
    (r"\bhave have\b", "have", "The word is doubled", "g"),
    # compound modifier hyphenation
    (r"\bwell (known|documented|established|founded|argued|defined|developed|researched|supported|informed|intentioned)\b(?=\s+[a-z])", r"well-\1", "Hyphenate a compound modifier before a noun", "g"),
    (r"\bhigh (quality|risk|level|speed|density|frequency|resolution|performance)\b(?=\s+[a-z])", r"high-\1", "Hyphenate a compound modifier before a noun", "g"),
    (r"\blong (term|standing|running|held|established)\b(?=\s+[a-z])", r"long-\1", "Hyphenate a compound modifier before a noun", "g"),
    (r"\bcross (section|cultural|disciplinary|national|border|reference)\b(?=\s+[a-z])", r"cross-\1", "Hyphenate a compound modifier before a noun", "g"),
])

_HE_COMPILED = [(_re2.compile(p, _re2.I), rep, why, cat)
                for p, rep, why, cat in _HEUR if p is not None]

_DOUBLED = _re2.compile(r"\b([A-Za-z]+)\s+\1\b", _re2.I)
_DOUBLED_OK = {"had", "that", "no", "is", "be"}

def _heuristic_correct(text):
    """The offline lane: real edits without a model, mirroring the page's rules."""
    edits = []
    for rx, rep, why, cat in _HE_COMPILED:
        for m in rx.finditer(text):
            o = m.group(0)
            f = None
            if rep is not None:
                f = m.expand(rep)
                if m.group(0)[:1].isupper():
                    f = f[:1].upper() + f[1:]
            edits.append({"start": m.start(), "end": m.end(), "orig": o,
                          "fix": f, "why": why or "", "cat": cat or "g"})
    for m in _DOUBLED.finditer(text):
        w = m.group(1)
        if w.lower() in _DOUBLED_OK:
            continue
        edits.append({"start": m.start(1), "end": m.end(1) + len(w) + 1,
                      "orig": m.group(0), "fix": w,
                      "why": "The doubled word", "cat": "g"})
    # the pair: a before vowels takes an
    for m in _re2.finditer(r"\b(a)\s+([A-Za-z]{3,})\b", text):
        w = m.group(2)
        low = w.lower()
        if low[:1] in "aeiou" and not low.startswith(("uni", "one", "once", "eu", "usu")):
            edits.append({"start": m.start(), "end": m.end(), "orig": m.group(0),
                          "fix": "an " + w, "why": "“a” before a vowel sound wants “an”",
                          "cat": "g"})
    for m in _re2.finditer(r"\b(An|an)\s+([bcdfghjklmnpqrstvwxyz][a-z]{2,})\b", text):
        w = m.group(2)
        low = w.lower()
        if not low.startswith(("hou", "hei", "hone", "hono", "suv", "mvp", "sql", "her")):
            edits.append({"start": m.start(), "end": m.end(), "orig": m.group(0),
                          "fix": ("A " if m.group(1) == "An" else "a ") + w,
                          "why": "“an” belongs before vowel sounds only", "cat": "g"})
    edits.sort(key=lambda x: x["start"])
    out = []
    seen = set()
    for e in edits:
        k = (e["start"], e["end"])
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out

def heuristic_rewrite(text, mode):
    """The offline lane for rewrite: honest tightening only, no invention."""
    t = text or ""
    if mode == "concise" or mode == "shorten":
        t = TIGHTEN_PAT.sub(lambda m: "", t)
        t = _re2.sub(r"  +", " ", t)
        t = TIGHTEN_PAT2.sub(lambda m: "", t)
        t = _re2.sub(r"  +", " ", t)
    if mode == "confident":
        t = _re2.sub(r"\b(could possibly|I think that|I feel that|I believe that)\b\s*", "", t, flags=_re2.I)
        t = _re2.sub(r"\b(maybe|perhaps|possibly)\b\s*", "", t, flags=_re2.I)
        t = _re2.sub(r"\s{2,}", " ", t).strip()
        if t:
            t = t[0].upper() + t[1:]
    return t

_TIGHTEN_WORDS = ["very", "really", "just", "quite", "actually", "basically", "literally",
                  "generally", "pretty much", "a bit", "a little", "sort of", "kind of"]
TIGHTEN_PAT = _re2.compile(r"\s+\b(?:" + "|".join(_re2.escape(w) for w in _TIGHTEN_WORDS) + r")\b", _re2.I)
TIGHTEN_PAT2 = _re2.compile(r"\b(?:" + "|".join(_re2.escape(w) for w in _TIGHTEN_WORDS) + r")\b\s+", _re2.I)
CONF_PAT = _re2.compile(r"\b(maybe|perhaps|might|could possibly|I think that|I feel that|I believe that)\b[^.!?]*", _re2.I)

# ---------------------------------------------------------------- endpoints
_CORRECT_CACHE = {}
_CORRECT_CACHE_MAX = 500


def ep_correct(body):
    text = body.get("text", "")
    if not text.strip():
        return {"edits": []}
    if AI["ready"]:
        engine = AI["gec"] or AI["pipe"]
        prefix = ("Fix the grammar, spelling and punctuation of this sentence. "
                  "Preserve meaning, numbers and citations. Output ONLY the corrected sentence: "
                  if AI["gec"] else
                  "Correct the grammar, spelling, punctuation and word choice of this sentence "
                  "for formal academic English. Preserve meaning, numbers and citations exactly. "
                  "Output ONLY the corrected sentence: ")
        edits = []
        sents = [(m.group().strip(), m.start()) for m in re.finditer(r"[^.!?\n]+[.!?]?\s*", text)]
        dialect = body.get("dialect", "off")
        dcl = "Use American spelling. " if dialect == "us" else ("Use British spelling. " if dialect == "uk" else "")
        for sent, off in sents:
            if len(sent.split()) < 3:
                continue
            # sentence-level cache: unchanged sentences skip inference entirely
            cache_key = hash(sent + "|" + dcl + "|" + (AI.get("local_name") or INSTRUCT_MODEL))
            if cache_key in _CORRECT_CACHE:
                cached = _CORRECT_CACHE[cache_key]
                if cached is not None and cached.lower() != sent.lower():
                    edits += word_diff_edits(sent, cached, off)
                continue
            if AI.get("local"):
                try:
                    fixed = strip_think(_generate_local(sent, max_new_tokens=min(256, len(sent.split()) * 2 + 20),
                                                        system=PROOF_SYSTEM + (" " + dcl if dcl else ""),
                                                        temperature=0.0) or "")
                    fixed = fixed.strip() if fixed else ""
                    if len(_CORRECT_CACHE) < _CORRECT_CACHE_MAX:
                        _CORRECT_CACHE[cache_key] = fixed or None
                    if fixed and fixed.lower() != sent.lower():
                        edits += word_diff_edits(sent, fixed, off)
                except Exception:
                    pass
                continue
            try:
                out = engine(prefix + sent,
                             max_new_tokens=min(256, int(len(sent.split()) * 2) + 20),
                             do_sample=False, repetition_penalty=1.2)
                fixed = out[0].get("generated_text", "").strip()
                if len(_CORRECT_CACHE) < _CORRECT_CACHE_MAX:
                    _CORRECT_CACHE[cache_key] = fixed or None
                if fixed and fixed.lower() != sent.lower():
                    edits += word_diff_edits(sent, fixed, off)
            except Exception:
                continue
        return {"edits": edits}
    return {"edits": _heuristic_correct(text)}  # the offline lane answers for real


REWRITE_PROMPTS = {
    "professional": "Rewrite the following in polished professional English. Use precise verbs, active voice where natural, varied sentence structure. Keep every fact, number, citation and the original meaning intact.",
    "casual": "Rewrite the following in relaxed, warm, conversational English. Allow contractions, shorter sentences, everyday words. Keep every fact and the original meaning.",
    "scholarly": "Rewrite the following in formal scholarly English suitable for a doctoral thesis. Use precise academic diction, third person, no contractions, hedged speculative claims with appropriate epistemic markers, varied sentence structure with subordinate clauses where they aid argument. Preserve every citation, number, proper noun and the original meaning exactly.",
    "concise": "Rewrite the following as concisely as possible. Remove every redundant word, tighten clauses, merge sentences where the logic permits. Lose no meaning, no fact, no citation.",
    "confident": "Rewrite the following to sound confident and well-supported. Remove unnecessary hedging from factual statements, keep hedging only on genuinely speculative claims. Use strong precise verbs. Preserve all citations and meaning.",
    "shorten": "Shorten the following significantly. Keep all key points, citations and numbers but cut every word that does not carry meaning.",
    "expand": "Expand the following with richer detail, fuller explanation, smoother transitions between sentences and paragraphs. Add no fabricated facts, citations or statistics. Keep the original meaning and expand only what is already implied or stated.",
    "summarize": "Summarize the following into a tight single paragraph that captures the central argument and all key findings. Preserve every citation reference that appears in the original.",
    "paraphrase": "Paraphrase the following: same meaning, entirely new wording and different sentence structures. Keep all citations, numbers, proper nouns and the register exactly. Do not add or remove any claim.",
    "humanize": "Make the following sound natural and genuinely human. Vary sentence length, prefer plain words over jargon, allow contractions where the register permits, read aloud smoothly. Keep every fact, citation and the original meaning.",
    "creative": "Rewrite the following with vivid, imaginative prose. Use fresh metaphors, sensory detail, and varied rhythm. Keep every fact and citation intact. Elevate the language without fabricating content.",
    "analytical": "Rewrite the following in precise analytical English. Prioritise logical connectives, explicit warrants between claims and evidence, and careful qualification of scope. Preserve all citations, numbers and meaning.",
}

# Grammarly-style rewrite presets: specific paragraph-level goals the user
# can apply to a selected passage. Each preset carries a detailed instruction
# that guides the model toward a specific quality, not just a register.
REWRITE_PRESETS = {
    "formal": "Rewrite this passage in formal academic English. Eliminate colloquialisms, contractions, and casual phrasing. Use precise diction, complete sentences, and measured tone. Preserve every fact, citation, and number exactly.",
    "informal": "Rewrite this passage in clear, approachable English. Use contractions, shorter sentences, and everyday vocabulary. Keep it warm and readable without losing precision. Preserve every fact and citation.",
    "concise": "Rewrite this passage to be as concise as possible without losing meaning. Cut every redundant word, merge clauses, tighten phrasing. Preserve all citations, numbers, and key claims.",
    "engaging": "Rewrite this passage to be more engaging. Use varied sentence structure, strong verbs, and active voice. Draw the reader in with clear momentum from sentence to sentence. Preserve every fact and citation.",
    "persuasive": "Rewrite this passage to be more persuasive. Strengthen the logical connection between evidence and claims. Use confident, precise language. Address potential counterarguments implicitly through stronger warrants. Preserve all citations.",
    "authoritative": "Rewrite this passage to sound more authoritative. Use decisive language, remove unnecessary hedging from established facts, and present evidence with confidence. Keep hedging only on genuinely speculative claims. Preserve all citations.",
    "diplomatic": "Rewrite this passage to be more diplomatic. Soften assertions that overclaim, acknowledge complexity, and present contested claims with appropriate qualification. Preserve all citations and facts.",
    "descriptive": "Rewrite this passage to be more descriptive and vivid. Add specific detail, concrete examples, and sensory language where appropriate. Do not fabricate facts or citations. Enrich what is already stated.",
    "narrative": "Rewrite this passage with a stronger narrative thread. Connect sentences with clear transitions, build momentum, and guide the reader through the argument step by step. Preserve all citations and facts.",
    "simplify": "Rewrite this passage in simpler English. Use shorter sentences, common vocabulary, and straightforward structure. Keep the meaning exact. Preserve all citations and numbers.",
    "improve-flow": "Rewrite this passage to improve its flow. Vary sentence length, place the most important information at the beginning or end of sentences, and ensure each sentence follows logically from the one before. Preserve all citations and facts.",
    "stronger-verbs": "Rewrite this passage replacing weak verbs (is, was, has, make, get) with strong specific verbs. Keep the meaning exact. Preserve all citations and numbers.",
    "passive-to-active": "Rewrite this passage converting passive constructions to active voice where the actor is known or can be named. Keep passive only where the actor is genuinely unknown or irrelevant. Preserve all citations and facts.",
    "tone-neutral": "Rewrite this passage in a neutral, objective tone. Remove emotional language, subjective qualifiers, and rhetorical flourishes. Present the content plainly. Preserve all citations and facts.",
    "tone-confident": "Rewrite this passage to sound more confident. Remove hedging from factual statements, use precise claims, and let evidence carry the emphasis. Preserve all citations and facts.",
    "tone-cautious": "Rewrite this passage with more cautious epistemic marking. Distinguish established findings from speculation, and qualify claims that extend beyond the evidence. Preserve all citations and facts.",
    "transition-fix": "Rewrite this passage adding or improving transitional words and phrases between sentences and ideas. Ensure the logical relationship between each sentence is explicit. Preserve all citations and facts.",
    "parallel-fix": "Rewrite this passage fixing any faulty parallel structure. Ensure items in a series, comparisons, and coordinated elements use the same grammatical form. Preserve all citations and facts.",
    "academic-upgrade": "Rewrite this passage elevating the register to doctoral academic standard. Use precise disciplinary vocabulary, complex sentence structures where they aid argument, third person, no contractions, and careful epistemic hedging. Preserve every citation, number, and proper noun exactly. Do not add claims not supported by the text.",
    "tighten-argument": "Rewrite this passage tightening the argument. Remove tangents, ensure each sentence advances the central claim, and make the logical progression from evidence to conclusion explicit. Preserve all citations and facts.",
}


def ep_reader(body):
    """Stage 4: the reader's likely response, calmer than the hostile examiner.
    Persona comes from the app's Goals (audience). Heuristic fallback mirrors the browser."""
    text = body.get("text", "")[:9000]
    aud = body.get("aud", "Academic readers")
    if AI["ready"]:
        out = generate(
            CREED + f"You are a careful first reader standing in for {aud}. Report the 4 moments where this text "
            "loses that reader: where attention slips, where trust thins, where a beat is missing, where the "
            "logic jumps without a bridge. One moment per line, at most 24 words each, gentle and specific. "
            f"Output ONLY the list.\n\n{text}", 380)
        if out:
            raw_items = [re.sub(r"^\s*[-*\d]+[).\s]*", "", l).strip() for l in out.splitlines()]
            think = None
            if raw_items:
                _, think = split_off_think(raw_items[0])
            items = [l for l in raw_items if len(l) > 12][:5]
            if items:
                return {"items": items, "think": think}
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    words = len(text.split()) or 1
    items = []
    for i, p in enumerate(paras):
        pw = len(p.split())
        if pw > 160:
            items.append(f"Paragraph {i+1} is {pw} words; a reader's attention thins around 150. One breath, one idea.")
    hedge = len(HEDGE.findall(text)) / max(1, words / 200)
    if hedge > 1.5:
        items.append(f"Hedged about {round(hedge,1)} times per 200 words; an unsure writer makes an unsure reader.")
    signs = len(re.findall(r"\b(however|moreover|therefore|thus|hence|meanwhile|by contrast|in contrast|firstly|finally)\b", text, re.I))
    if len(paras) > 2 and signs < (len(paras) + 1) // 2:
        items.append("Long stretches carry no signpost (however, therefore, meanwhile); a reader loses the thread and re-reads.")
    over = re.findall(r"\b(obviously|clearly|undeniably|proves?|proven|everyone knows)\b", text, re.I)
    if over:
        items.append(f'"{over[0].lower()}" tells the reader the point needs no support; that is where a careful reader pushes back.')
    passive = len(re.findall(r"\b(?:was|were|is being|has been|had been)\s+\w+(?:ed|en)\b", text, re.I))
    if passive > 2:
        items.append(f"{passive} passives: the actor keeps vanishing; a reader asks who did this.")
    if not items:
        items = ["The page holds together. A calm reader finds little to trip on here."]
    return {"items": items[:5]}


def ep_rewrite(body):
    text = body.get("text", "")
    mode = body.get("mode", "concise")
    style = body.get("style", "")
    instr = REWRITE_PROMPTS.get(mode, REWRITE_PROMPTS["concise"])
    raw = generate(text, max_new_tokens=min(1200, len(text.split()) * 3 + 150),
                   system=f"{instr} {style} {EDIT_SYSTEM}".strip(), temperature=0.2)
    ans, thk = split_off_think(raw) if raw else (None, None)
    if ans:
        return {"text": ans, "think": thk}
    return {"text": heuristic_rewrite(text, mode), "think": None}


def ep_rewrite_preset(body):
    """Grammarly-style preset rewrite: applies a named rewriting goal
    (formal, concise, engaging, etc.) to the given text."""
    text = body.get("text", "")
    preset = body.get("preset", "")
    context = body.get("context", "")  # optional surrounding text for context
    instr = REWRITE_PRESETS.get(preset)
    if not instr:
        return {"ok": False, "error": f"unknown preset: {preset}"}
    if not text.strip():
        return {"ok": False, "error": "no text to rewrite"}
    ctx = ""
    if context.strip():
        ctx = f"\n\nContext (the surrounding passage, for reference only; do not rewrite it):\n{context[:2000]}"
    prompt = f"Passage to rewrite:\n{text}{ctx}"
    raw = generate(prompt, max_new_tokens=min(1500, len(text.split()) * 3 + 200),
                   system=f"{instr} {EDIT_SYSTEM}", temperature=0.2)
    ans, thk = split_off_think(raw) if raw else (None, None)
    if ans:
        return {"ok": True, "text": ans, "think": thk, "preset": preset}
    # heuristic fallback: apply what we can without a model
    return {"ok": True, "text": heuristic_rewrite(text, "concise" if "concise" in preset else ""),
            "think": None, "preset": preset, "fallback": True}


def ep_rewrite_custom(body):
    """Custom rewrite: the user provides their own instruction for how
    the text should be rewritten, like Grammarly's custom rewrite feature."""
    text = body.get("text", "")
    instruction = body.get("instruction", "")
    if not text.strip():
        return {"ok": False, "error": "no text to rewrite"}
    if not instruction.strip():
        return {"ok": False, "error": "no instruction provided"}
    raw = generate(text, max_new_tokens=min(1500, len(text.split()) * 3 + 200),
                   system=f"Rewrite the user's passage with this goal: {instruction}. {EDIT_SYSTEM}",
                   temperature=0.2)
    ans, thk = split_off_think(raw) if raw else (None, None)
    if ans:
        return {"ok": True, "text": ans, "think": thk}
    return {"ok": False, "error": "AI model unavailable. Install transformers: pip install transformers torch",
            "text": text, "think": None}


def ep_presets(body):
    """Return the available rewrite presets and modes so the app can
    build its UI dynamically."""
    return {
        "ok": True,
        "presets": list(REWRITE_PRESETS.keys()),
        "modes": list(REWRITE_PROMPTS.keys()),
    }


def ep_compose(body):
    instr = body.get("instruction", "")
    style = body.get("style", "")
    raw = generate(CREED + f"Write exactly what is asked in clear, well-structured prose. "
                   f"Use precise diction, varied sentence structure, and smooth transitions. "
                   f"Do not fabricate citations, statistics or facts. {style}\n\n{instr}", 800)
    ans, thk = split_off_think(raw) if raw else (None, None)
    return {"text": ans or "", "think": thk}


HEDGE = re.compile(r"\b(might|maybe|perhaps|sort of|kind of|I think|possibly|I guess|suggests?|appears?)\b", re.I)
STRONG = re.compile(r"\b(will|must|clearly|definitely|certainly|proven|always|never)\b", re.I)


def ep_tone(body):
    text = body.get("text", "")
    if AI["ready"]:
        out = generate(CREED + "Give a 2-3 word tone label for this text, then ' | ', then one short tip.\n\n" + text[:1200], 60)
        out = split_off_think(out)[0] if out else out
        if out and "|" in out:
            label, tip = (p.strip() for p in out.split("|", 1))
            return {"label": label, "tips": [tip]}
    hedges = len(HEDGE.findall(text))
    strong = len(STRONG.findall(text))
    excl = text.count("!")
    score = 0.5 + 0.12 * strong - 0.12 * hedges + 0.03 * excl
    label = ("Confident / assertive" if score > 0.7
             else "Hesitant / tentative" if score < 0.35 else "Neutral")
    tips = []
    if hedges > 2:
        tips.append("several hedges; keep them on claims, cut them from facts")
    if excl:
        tips.append("exclamation marks read as emotional; let evidence carry emphasis")
    return {"label": label, "tips": tips}


def shingles(text, n=6):
    w = re.findall(r"[a-z']+", text.lower())
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def ep_similarity(body):
    a = shingles(body.get("text", ""))
    matches = []
    for d in body.get("library", []):
        b = shingles(d.get("text", ""))
        if not a or not b:
            continue
        ov = len(a & b) / min(len(a), len(b))
        if ov > 0.06:
            matches.append({"title": d.get("title", "Untitled"), "overlap": round(ov, 3)})
    matches.sort(key=lambda m: -m["overlap"])
    return {"matches": matches[:5]}


FOLLOWUPS = [
    "Why do you believe that holds?",
    "What concrete example would settle it?",
    "What follows from that; and what follows if it were false?",
    "Who disagrees, and what is their strongest point?",
    "What evidence would change your mind?",
]


def ep_socrat(body):
    stage = body.get("stage", "Question")
    answer = body.get("answer", "")
    if AI["ready"]:
        out = generate(
            CREED + "You are Socrates supervising a doctoral writer. Given their answer, ask exactly ONE "
            "short question (max 22 words) that probes a weak assumption, exposes a hidden premise, or "
            f"pushes toward precision. Output ONLY the question.\n\nStage: {stage}\nTheir answer: {answer}", 80)
        if out:
            ans, thk = split_off_think(out)
            return {"question": ans.strip("\"'`"), "think": thk}
    import random
    return {"question": random.choice(FOLLOWUPS)}


def ep_review(body):
    text = body.get("text", "")[:9000]
    if AI["ready"]:
        out = generate(
            CREED + "You are a rigorous but fair doctoral examiner at a leading research university. "
            "Identify the 4 strongest objections to the argument in this text. Look for: unsupported "
            "empirical claims, overclaims beyond the evidence, missing warrants connecting data to "
            "conclusions, unaddressed counter-evidence, circular reasoning, definitional slippage, "
            "and methodological gaps. Each objection must be specific to the text, not generic. "
            "Output ONLY a numbered list, one objection per line, at most 28 words each.\n\n"
            f"{text}", 400)
        if out:
            items = [re.sub(r"^\s*[-*\d]+[).\s]*", "", l).strip()
                     for l in out.splitlines()]
            think = None
            raw_items = items
            if raw_items:
                _, think = split_off_think(raw_items[0]) if raw_items else (None, None)
            items = [l for l in raw_items if len(l) > 12][:5]
            if items:
                return {"items": items, "think": think}
    # heuristic fallback (mirrors the browser's rules-based pass)
    items = []
    over = re.findall(r"\b(prove[sd]?|proven|obviously|clearly|undeniably|everyone knows|it is well known)\b", text, re.I)
    if over:
        items.append(f'Overclaim: "{over[0].lower()}" asserts what an examiner expects you to argue; where is the demonstration?')
    cites = re.findall(r"\((?:19|20)\d\d", text) + re.findall(r"\[[\d,\s\-–]+\]", text)
    if len(text.split()) > 80 and not cites:
        items.append("No citations detected. Which claims would a skeptic accept without a source; and which not?")
    if len(text.split()) > 120 and not re.search(r"\b(however|but|objection|nevertheless|in contrast|admittedly)\b", text, re.I):
        items.append("No counter-move detected: the draft never voices the opposing view. Steelman it, or the examiner will.")
    if not items:
        items = ["Is the central claim falsifiable; what evidence would force you to qualify or abandon it?",
                 "What is the strongest competing explanation for the same observations?"]
    return {"items": items[:5]}


def ep_select_model(body):
    name = body.get("name", "")
    cand = next((c for c in scan_local_models() if c["name"] == name), None)
    if not cand:
        return {"ok": False, "error": "not found"}
    c = conf_read(); c["active"] = name; conf_write(c)
    with _ai_lock:
        # hot swap: out with the old, in with the new, right now
        unload_local()
        ok = load_local_path(cand)
    return {"ok": ok, "active": AI.get("local_name"),
            "kind": AI.get("local_kind") if ok else None,
            "error": None if ok else AI.get("load_error")}


def ep_remove_model(body):
    import shutil
    name = body.get("name", "")
    cand = next((c for c in scan_local_models() if c["name"] == name), None)
    if not cand:
        return {"ok": False, "error": "not found"}
    if AI.get("local_name") == name:
        with _ai_lock:
            unload_local()
        c = conf_read(); c.pop("active", None); conf_write(c)
    try:
        if os.path.isdir(cand["path"]):
            shutil.rmtree(cand["path"])
        else:
            os.remove(cand["path"])
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# --- library sync between your devices ---
# The laptop is the hub: any device pushes its whole library here, any device
# pulls it back. One shared copy beside the server, newest push wins. The app
# merges on pull, adding only what it does not already have. Nothing leaves
# the network you are on.
def ep_sync_push(body):
    docs = body.get("docs", [])
    notes = body.get("notes", [])
    if not isinstance(docs, list) or not isinstance(notes, list):
        return {"ok": False, "error": "docs and notes must be lists"}
    payload = {"saved_at": time.strftime("%Y-%m-%d %H:%M"),
               "docs": docs, "notes": notes}
    try:
        tmp = SYNC_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f)
        os.replace(tmp, SYNC_PATH)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "saved_at": payload["saved_at"],
            "docs": len(docs), "notes": len(notes)}


def ep_sync_pull(_body):
    try:
        with open(SYNC_PATH) as f:
            data = json.load(f)
    except Exception:
        return {"ok": False, "error": "nothing has been pushed yet"}
    return {"ok": True, "saved_at": data.get("saved_at"),
            "docs": data.get("docs", []), "notes": data.get("notes", [])}


def ep_transcribe(body):
    """Scriba's record-then-transcribe endpoint. Accepts base64 audio,
    returns transcribed text using Whisper. Works fully offline.
    Optional 'language' field (e.g. 'en', 'fr') for multilingual Whisper."""
    import base64 as _b64
    audio_b64 = body.get("audio", "")
    if not audio_b64:
        return {"ok": False, "error": "no audio data"}
    lang = str(body.get("language") or body.get("lang") or "").strip().lower()
    if lang in ("", "auto", "detect"):
        lang = None
    elif len(lang) > 2:
        lang = lang.split("-")[0].split("_")[0][:3]
    try:
        # Strip data URL prefix if present
        if "," in audio_b64 and audio_b64.startswith("data:"):
            audio_b64 = audio_b64.split(",", 1)[1]
        audio_bytes = _b64.b64decode(audio_b64)
    except Exception as e:
        return {"ok": False, "error": f"bad audio data: {e}"}
    if len(audio_bytes) < 100:
        return {"ok": False, "error": "audio too short"}
    text, err, info = transcribe_audio(audio_bytes, language=lang)
    if err:
        return {"ok": False, "error": err, "info": info}
    return {"ok": True, "text": text or "", "info": info}


_NET = {"at": 0.0, "online": False}


def _online(max_age=60.0):
    """Is the internet reachable? Cached for a minute so the check never slows Scriba."""
    now = time.time()
    if now - _NET["at"] < max_age:
        return _NET["online"]
    ok = False
    try:
        import urllib.request as _ur
        req = _ur.Request("https://api.crossref.org/", method="HEAD")
        _ur.urlopen(req, timeout=3)
        ok = True
    except Exception as e:
        # an HTTP error status still proves the network is up
        ok = hasattr(e, "code")
    _NET["at"], _NET["online"] = now, ok
    return ok


def _stt_report():
    return {
        "stt_available": _stt_available(),
        "stt_loaded": bool(AI.get("stt")),
        "stt_loading": bool(_STT_STATE["loading"]),
        "stt_error": _STT_STATE.get("error"),
        "stt_model": STT_MODEL,
        "stt_multilingual": ".en" not in STT_MODEL,
        "ffmpeg": bool(shutil.which("ffmpeg")),
    }


def ep_net_status(_body):
    """Internet reachability and the transcription engine's state."""
    out = {"ok": True, "online": _online(), "server": True}
    out.update(_stt_report())
    return out


def ep_stt_status(_body):
    """The transcription engine's state, without loading anything."""
    out = {"ok": True}
    out.update(_stt_report())
    return out


# ---------------------------------------------------------------- 2.13: the writing model
# One measured model, installed with one press from the laptop's Engine panel:
# downloaded once into the models folder, then run by the bundled llama.cpp
# runtime (bin/), offline. The choice and its measurements are in
# INKWELL_HANDOFF_v7p34.txt.
WRITING_MODELS = [
    # measured 6 October 2026 (JFLEG learner sentences and correct Wikipedia
    # sentences, behind Inkwell's safety filter): 40% improved, 9% made worse,
    # 6% of correct sentences changed; every citation kept in 24 rewrites.
    {"id": "qwen3-4b-2507", "label": "Qwen3 4B Instruct (2507)", "repo": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
     "file": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "bytes": 2497281120, "min_ram_gb": 8,
     "licence": "Apache 2.0", "note": "the measured choice for 8 GB computers and up"},
]
INSTALL = {"state": "idle", "id": None, "done": 0, "total": 0, "error": None}


def _ram_gb():
    """This computer's memory in GB (0 when it cannot be read)."""
    try:
        if sys.platform == "darwin":
            import subprocess
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip()) / 2 ** 30
        if sys.platform.startswith("win"):
            import ctypes
            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS(); m.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.ullTotalPhys / 2 ** 30
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) / 2 ** 20
    except Exception:
        pass
    return 0


def _recommended(ram):
    """The strongest measured model this computer's memory holds comfortably."""
    # memory unknown: the smallest measured model, never the largest
    fit = [m for m in WRITING_MODELS if ram and m.get("min_ram_gb", 8) <= ram + 0.5]
    return (fit[0] if fit else WRITING_MODELS[-1])["id"] if WRITING_MODELS else None


def _runtime_ok():
    if _find_runtime():
        return True
    try:
        import importlib.util
        return importlib.util.find_spec("llama_cpp") is not None
    except Exception:
        return False


def ep_model_catalog(body):
    ram = _ram_gb()
    return {"ok": True, "models": WRITING_MODELS, "runtime": _runtime_ok(),
            "ram_gb": round(ram, 1), "recommended": _recommended(ram),
            "installed": [c["name"] for c in scan_local_models()],
            "active": AI.get("local_name"), "ready": AI["ready"], "loading": AI["loading"],
            "install": dict(INSTALL), "load_error": AI.get("load_error")}


def _fetch(url, dest):
    """Download url to dest (via dest.part), counting bytes into INSTALL.
    curl first on a Mac (the system's certificates); Python otherwise."""
    import subprocess, urllib.request
    part = dest + ".part"
    if sys.platform == "darwin" and shutil.which("curl"):
        proc = subprocess.Popen(["curl", "-fsSL", "-o", part, url])
        while proc.poll() is None:
            try:
                INSTALL["done"] = os.path.getsize(part)
            except OSError:
                pass
            time.sleep(1)
        if proc.returncode != 0:
            raise RuntimeError(f"download failed (curl exit {proc.returncode})")
    else:
        with urllib.request.urlopen(url, timeout=60) as r, open(part, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                INSTALL["done"] += len(chunk)
    if INSTALL["total"] and os.path.getsize(part) != INSTALL["total"]:
        raise RuntimeError(f"download incomplete ({os.path.getsize(part)} of {INSTALL['total']} bytes)")
    os.replace(part, dest)


def _install_worker(m):
    try:
        os.makedirs(MODELS_DIR, exist_ok=True)
        dest = os.path.join(MODELS_DIR, m["file"])
        if not (os.path.isfile(dest) and os.path.getsize(dest) == m["bytes"]):
            _fetch(f"https://huggingface.co/{m['repo']}/resolve/main/{m['file']}", dest)
        INSTALL["state"] = "loading"
        unload_local()
        cand = {"kind": "gguf", "path": dest, "name": m["file"]}
        if not load_local_path(cand):
            raise RuntimeError(AI.get("load_error") or "the model would not start")
        c = conf_read(); c["active"] = m["file"]; conf_write(c)
        AI["ready"] = True
        AI["pipe_kind"] = "local"
        _CORRECT_CACHE.clear()
        INSTALL["state"] = "done"
    except Exception as e:
        INSTALL["state"] = "error"
        INSTALL["error"] = f"{type(e).__name__}: {e}"
        print("[inkwell] model install:", INSTALL["error"])


def ep_model_install(body):
    m = next((x for x in WRITING_MODELS if x["id"] == body.get("id")), None)
    if not m:
        return {"ok": False, "error": "unknown model"}
    if INSTALL["state"] in ("downloading", "loading"):
        return {"ok": False, "error": "an install is already running"}
    if not _runtime_ok():
        return {"ok": False, "error": "the llama.cpp runtime (bin/) is missing from this installation"}
    INSTALL.update({"state": "downloading", "id": m["id"], "done": 0, "total": m["bytes"], "error": None})
    threading.Thread(target=_install_worker, args=(m,), daemon=True).start()
    return {"ok": True}


ROUTES = {
    "correct": ep_correct, "rewrite": ep_rewrite, "rewrite_preset": ep_rewrite_preset,
    "rewrite_custom": ep_rewrite_custom, "presets": ep_presets,
    "compose": ep_compose,
    "tone": ep_tone, "similarity": ep_similarity, "socrat": ep_socrat,
    "review": ep_review, "reader": ep_reader, "select_model": ep_select_model, "remove_model": ep_remove_model,
    "sync_push": ep_sync_push, "sync_pull": ep_sync_pull,
    "transcribe": ep_transcribe, "stt_status": ep_stt_status, "net_status": ep_net_status,
    "stt_warm": ep_stt_warm,
    "model_catalog": ep_model_catalog, "model_install": ep_model_install,
}
# endpoints that only this computer may call, never a tablet on the network
LOCAL_ONLY = ("lan_status", "lan_enable", "model_catalog", "model_install")


# ---------------------------------------------------------------- HTTP layer
class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path == "/api/health":
            model = AI.get("local_name") or (INSTRUCT_MODEL if AI["ready"] else None)
            self._send(200, {"ok": True, "ai": AI["ready"], "model": model,
                             "engine": AI.get("local_kind") or ("transformers" if AI["ready"] else None)})
        elif self.path == "/api/models":
            self._send(200, {"dir": MODELS_DIR, "found": scan_local_models(),
                             "active": AI.get("local_name")})
        elif self.path.split("?")[0] in ("/api/net_status", "/api/stt_status", "/api/presets"):
            # read-only endpoints answer GET as well as POST (Scriba asks with GET)
            name = self.path.split("?")[0][len("/api/"):]
            try:
                self._send(200, ROUTES[name]({}))
            except Exception as e:
                self._send(500, {"error": str(e)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        if parsed.path == "/api/upload_model":
            return self._upload_model(parse_qs(parsed.query))
        m = re.match(r"^/api/([a-z_]+)$", parsed.path)
        if m and m.group(1) in LOCAL_ONLY and self.client_address[0] not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return self._send(403, {"error": "only from this computer"})
        if m and m.group(1) in ("lan_status", "lan_enable"):
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or b"{}"))
            except Exception:
                body = {}
            return self._send(200, (ep_lan_status if m.group(1) == "lan_status" else ep_lan_enable)(body))
        if not m or m.group(1) not in ROUTES:
            return self._send(404, {"error": "unknown endpoint"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or b"{}"))
        except Exception:
            return self._send(400, {"error": "bad json"})
        try:
            self._send(200, ROUTES[m.group(1)](body))
        except Exception as e:
            print(f"[inkwell] endpoint error: {e}")
            self._send(500, {"error": str(e)})

    def _upload_model(self, qs):
        """Streams a model file from disk onto the shelf. Query params:
        name = file name; dir = MLX folder name (keeps its inner files)."""
        raw_name = (qs.get("name", [""])[0] or "").strip()
        sub_dir = (qs.get("dir", [""])[0] or "").strip()
        if not raw_name:
            return self._send(400, {"error": "no name"})
        for bad in ("..", "/", "\\", os.sep):
            if bad in raw_name or (sub_dir and bad in sub_dir):
                return self._send(400, {"error": "bad path"})
        os.makedirs(MODELS_DIR, exist_ok=True)
        dest = os.path.join(MODELS_DIR, sub_dir, raw_name) if sub_dir \
            else os.path.join(MODELS_DIR, raw_name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            total = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            total = 0
        written = 0
        try:
            with open(dest, "wb") as out:
                remaining = total if total > 0 else None
                while True:
                    want = 1 << 20 if remaining is None else min(1 << 20, remaining)
                    if want <= 0:
                        break
                    chunk = self.rfile.read(want)
                    if not chunk:
                        break
                    out.write(chunk)
                    written += len(chunk)
                    if remaining is not None:
                        remaining -= len(chunk)
                        if remaining <= 0:
                            break
        except Exception as e:
            return self._send(500, {"error": str(e)})
        print(f"[inkwell] model arrived: {raw_name} ({written:,} bytes)")
        # a fresh GGUF becomes active when nothing else is chosen yet
        if raw_name.lower().endswith(".gguf") and not conf_read().get("active"):
            c = conf_read(); c["active"] = raw_name; conf_write(c)
        return self._send(200, {"ok": True, "name": raw_name, "bytes": written})

    def log_message(self, fmt, *args):
        pass  # quiet



# ---------------------------------------------------------------- home network (v2.12)
# The laptop's model for the tablets on the same Wi-Fi. Off until switched on
# from the laptop itself. A second listener on LAN_PORT serves only the writing
# and voice endpoints, and only to a device that sends the 6-digit pairing code
# in X-Inkwell-Key. Models, the shelf and the synced library are never served
# to the network. The code and the on/off choice live in inkwell_lan.json.
import hmac
import secrets
import socket

LAN_PORT = int(os.environ.get("INKWELL_LAN_PORT", "8318"))
LAN_PATH = os.path.join(DATA_DIR, "inkwell_lan.json")
LAN_ROUTES = {"correct", "rewrite", "rewrite_preset", "rewrite_custom", "presets", "compose",
              "tone", "similarity", "socrat", "review", "reader", "transcribe", "stt_status",
              "stt_warm", "net_status"}
LAN = {"server": None}


def lan_conf():
    try:
        with open(LAN_PATH, encoding="utf-8") as f:
            c = json.load(f)
    except Exception:
        c = {}
    if not (isinstance(c.get("code"), str) and len(c["code"]) == 6 and c["code"].isdigit()):
        c["code"] = "%06d" % secrets.randbelow(1000000)
        c.setdefault("enabled", False)
        lan_conf_write(c)
    return c


def lan_conf_write(c):
    tmp = LAN_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f)
    os.replace(tmp, LAN_PATH)


def lan_addresses():
    """This computer's address on the home network, as other devices see it."""
    found = []
    try:
        s2 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s2.connect(("192.0.2.1", 9))  # no packet is sent; this only picks the outgoing interface
        found.append(s2.getsockname()[0])
        s2.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in found and not ip.startswith("127."):
                found.append(ip)
    except Exception:
        pass
    return [ip for ip in found if not ip.startswith("127.")]


def lan_status():
    c = lan_conf()
    return {"ok": True, "enabled": bool(c.get("enabled")), "running": LAN["server"] is not None,
            "code": c["code"], "port": LAN_PORT,
            "addresses": ["%s:%d" % (ip, LAN_PORT) for ip in lan_addresses()]}


def lan_start():
    if LAN["server"] is not None:
        return True
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", LAN_PORT), LanHandler)
    except OSError as e:
        print(f"[inkwell] home network: port {LAN_PORT} unavailable ({e})")
        return False
    LAN["server"] = srv
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"[inkwell] home network: tablets can connect at {', '.join(lan_status()['addresses']) or 'this computer'}")
    return True


def lan_stop():
    srv, LAN["server"] = LAN["server"], None
    if srv is not None:
        threading.Thread(target=lambda: (srv.shutdown(), srv.server_close()), daemon=True).start()


def ep_lan_status(body):
    return lan_status()


def ep_lan_enable(body):
    c = lan_conf()
    if body.get("new_code"):
        c["code"] = "%06d" % secrets.randbelow(1000000)
    c["enabled"] = bool(body.get("on", c.get("enabled")))
    lan_conf_write(c)
    if c["enabled"]:
        lan_start()
    else:
        lan_stop()
    return lan_status()


class LanHandler(Handler):
    """What a paired tablet may ask of the laptop: writing and voice, nothing else."""

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Inkwell-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        # browsers ask before a page reaches a device on the private network
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _paired(self):
        given = (self.headers.get("X-Inkwell-Key") or "").strip()
        return bool(given) and hmac.compare_digest(given, lan_conf()["code"])

    def do_GET(self):
        path = self.path.split("?")[0]
        if not self._paired():
            return self._send(401, {"error": "pairing code needed", "paired": False})
        if path in ("/api/health", "/api/net_status", "/api/stt_status", "/api/presets"):
            return Handler.do_GET(self)
        return self._send(404, {"error": "not offered to other devices"})

    def do_POST(self):
        m = re.match(r"^/api/([a-z_]+)$", self.path.split("?")[0])
        if not self._paired():
            return self._send(401, {"error": "pairing code needed", "paired": False})
        if not m or m.group(1) not in LAN_ROUTES:
            return self._send(404, {"error": "not offered to other devices"})
        return Handler.do_POST(self)

def _boot_background():
    _migrate_legacy(["models"])  # before the model scan, so a moved shelf is found
    _load_models()


if __name__ == "__main__":
    threading.Thread(target=_boot_background, daemon=True).start()
    try:
        if lan_conf().get("enabled"):
            lan_start()
    except Exception as e:
        print(f"[inkwell] home network not started: {e}")
    print(f"[inkwell] listening on http://{HOST}:{PORT}; keep this window open while you write")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
