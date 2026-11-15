"""Records HTTP calls and answers them from a route table (no real network)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "collector"))

import common  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


class FakeHttp:
    """routes: list of (method, url_substring, handler) where handler(body, url) returns
    a response or raises. First match wins."""

    def __init__(self, routes=()):
        self.routes = list(routes)
        self.calls = []

    def __call__(self, method, url, headers=None, body=None, timeout=20):
        self.calls.append((method, url, json.loads(json.dumps(body))))
        for m, frag, handler in self.routes:
            if m == method and frag in url:
                return handler(body, url) if callable(handler) else handler
        if "/rest/v1/" in url and method == "POST":
            return None
        raise AssertionError(f"unexpected request {method} {url}")

    def posted(self, table):
        rows = []
        for m, url, body in self.calls:
            if m == "POST" and f"/rest/v1/{table}?" in url:
                rows.extend(body)
        return rows

    def status(self, source):
        rows = [r for r in self.posted("habit_source_status") if r["source"] == source]
        assert rows, f"no status for {source}"
        return rows[-1]


def db():
    return common.Supabase("https://example.supabase.co", "service-key")
