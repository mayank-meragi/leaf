"""A local helper for the Leaf app: ``python3 -m leaf_backend.serve``.

A web page can't call the holdings source directly (no CORS), so the app's "Sync fund holdings" button asks this
process to fetch on its behalf. It is deliberately small and local:

* it listens on 127.0.0.1 only, never on the network;
* it only answers browser requests from the origins you allow (the Leaf dev server by default);
* it holds no secrets and writes nothing. It returns the fetched documents and the app commits them to your data repo.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from .holdings import fetch_holdings

DEFAULT_PORT = 8787
DEFAULT_ORIGINS = ("http://localhost:5180", "http://127.0.0.1:5180")
MAX_SCHEMES = 100
MAX_BODY = 64 * 1024

Fetcher = Callable[[int, str], dict]


def environment_problem() -> str | None:
    """Why this Python can't do the job, or None. Checked at startup so a broken interpreter fails loudly, not per scheme."""
    if sys.version_info < (3, 9):
        return f"Python {sys.version.split()[0]} is too old; the helper needs 3.9 or newer."
    try:
        import ssl

        ssl.create_default_context()
    except Exception as e:  # ImportError when the interpreter was built without OpenSSL, among others
        return f"This Python can't make HTTPS requests ({type(e).__name__}: {str(e).splitlines()[0]})."
    return None


class Handler(BaseHTTPRequestHandler):
    # Set by `make_server`; class attributes so the stdlib handler stays constructor-compatible.
    origins: frozenset[str] = frozenset(DEFAULT_ORIGINS)
    fetcher: Fetcher = staticmethod(lambda code, name: fetch_holdings(code, name))  # type: ignore[assignment]
    delay: float = 0.5
    quiet: bool = False

    # ---- plumbing ----

    def log_message(self, fmt, *args):  # noqa: A003
        if not self.quiet:
            sys.stderr.write("[leaf-helper] " + fmt % args + "\n")

    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in self.origins  # no Origin means curl or a script, not a web page

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin in self.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ---- routes ----

    def do_OPTIONS(self):  # noqa: N802
        if not self._origin_ok():
            return self._json(403, {"error": "origin not allowed"})
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if not self._origin_ok():
            return self._json(403, {"error": "origin not allowed"})
        if self.path == "/health":
            return self._json(200, {"ok": True, "name": "leaf-helper", "version": 1, "python": sys.version.split()[0]})
        self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if not self._origin_ok():
            return self._json(403, {"error": "origin not allowed"})
        if self.path != "/holdings":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 < n <= MAX_BODY:
                raise ValueError("body missing or too large")
            schemes = json.loads(self.rfile.read(n))["schemes"]
            if not isinstance(schemes, list) or not 0 < len(schemes) <= MAX_SCHEMES:
                raise ValueError(f"send between 1 and {MAX_SCHEMES} schemes")
            todo = [(int(s["code"]), str(s["name"])[:200]) for s in schemes]
        except (ValueError, KeyError, TypeError) as e:
            return self._json(400, {"error": f"bad request: {e}"})

        # One JSON object per line, flushed as each scheme finishes, so the UI can show progress.
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            for i, (code, name) in enumerate(todo):
                if i:
                    time.sleep(self.delay)  # be polite to the source
                try:
                    line = {"code": code, "doc": self.fetcher(code, name)}
                except Exception as e:  # one bad scheme shouldn't stop the rest
                    line = {"code": code, "error": f"{type(e).__name__}: {e}"}
                self.wfile.write((json.dumps(line, ensure_ascii=False) + "\n").encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page was closed mid-sync


def make_server(port: int = DEFAULT_PORT, origins=DEFAULT_ORIGINS, fetcher: Fetcher | None = None, delay: float = 0.5, quiet: bool = False) -> ThreadingHTTPServer:
    attrs = {"origins": frozenset(origins), "delay": delay, "quiet": quiet}
    if fetcher:
        attrs["fetcher"] = staticmethod(fetcher)
    handler = type("BoundHandler", (Handler,), attrs)
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--origin", action="append", help="allow this web origin (repeatable); default: the Leaf dev server")
    p.add_argument("--delay", type=float, default=0.5, help="seconds between schemes")
    a = p.parse_args(argv)
    problem = environment_problem()
    if problem:
        print(f"{problem}\nStart the helper with `pnpm holdings-helper`, which picks a working Python, or set LEAF_PYTHON.", file=sys.stderr)
        return 2
    origins = tuple(a.origin) if a.origin else DEFAULT_ORIGINS
    server = make_server(a.port, origins, delay=a.delay)
    print(f"Leaf helper (Python {sys.version.split()[0]}) listening on http://127.0.0.1:{a.port} for {', '.join(origins)}\nPress Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
