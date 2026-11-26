"""Diagnostics: a short report you can copy from Settings → Source status and paste into a chat when
something goes wrong. It keeps the last errors from the app and its window, and scrubs anything that
looks like a key, token, password, e-mail, Steam ID or personal folder before it's shown or saved."""
import json, os, platform, re, sys, threading, time, traceback

KEEP = 40
_lock = threading.Lock()
_path = None
_errors = []      # [{t, where, msg, n}]

_HOME = os.path.expanduser("~")
_SCRUB = [
    (re.compile(r"(?i)\bBearer\s+[\w.\-~+/=]+"), "Bearer …"),
    (re.compile(r"(?i)\b(key|api_?key|token|access_token|refresh_token|secret|client_secret|client_id|password|passwd|pass|auth|authorization|code|sig|signature|session|sessionid|cookie|steamLoginSecure)\b(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|[^\s&\"',;]+)"), r"\1\2…"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[e-mail]"),
    (re.compile(r"\b7656119\d{10}\b"), "[steam id]"),
    (re.compile(r"(?i)([A-Z]:\\Users\\)[^\\\s\"']+"), r"\1…"),
    (re.compile(r"(/home/|/Users/)[^/\s\"']+"), r"\1…"),
    (re.compile(r"\b[A-Za-z0-9_\-]{28,}\b"), "[long id]"),
]


def scrub(text):
    s = str(text or "")
    if _HOME and len(_HOME) > 3:
        s = s.replace(_HOME, "~")
    for rx, rep in _SCRUB:
        s = rx.sub(rep, s)
    return s


def _load():
    global _errors
    try:
        with open(_path, encoding="utf-8") as f:
            _errors = [e for e in json.load(f) if isinstance(e, dict)][-KEEP:]
    except Exception:
        _errors = []


def _save():
    if not _path:
        return
    try:
        tmp = _path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_errors[-KEEP:], f)
        os.replace(tmp, _path)
    except Exception:
        pass


def note(where, msg):
    """Remember one error (scrubbed). The same error again just counts up."""
    where, msg = scrub(where)[:120], scrub(msg)[:600]
    if not msg:
        return
    with _lock:
        for e in _errors[-10:]:
            if e.get("where") == where and e.get("msg") == msg:
                e["n"] = e.get("n", 1) + 1
                e["t"] = time.time()
                break
        else:
            _errors.append({"t": time.time(), "where": where, "msg": msg, "n": 1})
            del _errors[:-KEEP]
        _save()


def install(data_dir):
    """Keep errors that would otherwise only reach a console nobody sees."""
    global _path
    _path = os.path.join(data_dir, "diagnostics.json")
    _load()
    old = sys.excepthook

    def hook(t, v, tb):
        note("app", "".join(traceback.format_exception_only(t, v)).strip() + _where(tb))
        try:
            old(t, v, tb)
        except Exception:
            pass
    sys.excepthook = hook

    def thook(a):
        if a.exc_type is SystemExit:
            return
        note(f"thread {getattr(a.thread, 'name', '')}", "".join(traceback.format_exception_only(a.exc_type, a.exc_value)).strip() + _where(a.exc_traceback))
    threading.excepthook = thook


def _where(tb):
    try:
        f = traceback.extract_tb(tb)[-1]
        return f" ({os.path.basename(f.filename)}:{f.lineno})"
    except Exception:
        return ""


def errors():
    with _lock:
        return list(_errors)


def clear():
    with _lock:
        _errors.clear()
        _save()


_UI_KEYS = ("view", "window", "screen", "dpr", "scale", "engine", "pads", "games", "books", "big_picture", "online")


def report(version, info, settings, sources, ui=None):
    """The text to copy. Only settings that are on/off or numbers go in, never text you typed."""
    t = time.strftime("%Y-%m-%d %H:%M", time.localtime())
    frozen = "installed build" if getattr(sys, "frozen", False) else "from source"
    lines = [f"Masterlog {version} · {frozen} · {t}",
             f"System: {platform.system()} {platform.release()} ({platform.version()[:60]}) · {platform.machine()}"
             + (" · Steam Deck" if info.get("deck") else "") + (" · Game Mode" if info.get("game_mode") else "")
             + (" · AppImage" if info.get("appimage") else ""),
             f"Python {platform.python_version()}" + _webview()]
    if ui:
        ui = {k: ui[k] for k in _UI_KEYS if k in ui}
        lines.append("Window: " + ", ".join(f"{k} {scrub(json.dumps(v) if not isinstance(v, str) else v)[:120]}" for k, v in ui.items()))
    flags = {k: v for k, v in (settings or {}).items() if isinstance(v, (bool, int, float)) and not re.search(r"(?i)key|token|secret|pass|id$", k)}
    if flags:
        lines.append("Settings: " + ", ".join(f"{k}={v}" for k, v in sorted(flags.items())))
    srcs = (sources or {}).get("sources") or []
    if srcs:
        lines.append("")
        lines.append("Sources:")
        for s in srcs:
            st = s.get("status")
            when = ""
            if st != "ok" and s.get("since"):
                when = f" for {_ago(s['since'])}"
            elif s.get("ok_t"):
                when = f", worked {_ago(s['ok_t'])} ago"
            lines.append(f"  {'OK ' if st == 'ok' else 'BAD' if st == 'failing' else '?? '} {s.get('name')}{when}"
                         + (f": {scrub(s.get('err'))[:160]}" if s.get("err") else ""))
    errs = errors()
    lines.append("")
    lines.append(f"Recent errors ({len(errs)}):" if errs else "Recent errors: none")
    for e in errs[-25:][::-1]:
        times = f" ×{e['n']}" if e.get("n", 1) > 1 else ""
        lines.append(f"  {_ago(e['t'])} ago · {e['where']}{times} · {e['msg']}")
    return scrub("\n".join(lines))


def _webview():
    try:
        import webview
        return f" · pywebview {getattr(webview, '__version__', '?')}"
    except Exception:
        return ""


def _ago(ts):
    d = max(0, time.time() - (ts or 0))
    if d < 90:
        return f"{int(d)}s"
    if d < 5400:
        return f"{int(d / 60)}m"
    if d < 129600:
        return f"{int(d / 3600)}h"
    return f"{int(d / 86400)}d"
