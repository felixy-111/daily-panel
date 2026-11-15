"""Shared helpers for the habit collectors: env, logical day, HTTP, Supabase REST.

Logs must only contain counts and ids — never habit names or Notion content.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

TPE = timezone(timedelta(hours=8))
DAY_BOUNDARY_HOURS = 4
DEFAULT_SUPABASE_URL = "https://ewynrebniwbptsnpnjyd.supabase.co"
DEFAULT_LAUNCH_DATE = "2026-11-16"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class HttpError(Exception):
    def __init__(self, status, body=""):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


def load_env(path=ENV_FILE):
    """Simple KEY=VALUE parser; existing environment wins."""
    path = Path(path)
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def logical_day(dt):
    """Asia/Taipei date with a 04:00 boundary (02:10 on 11/21 -> 11/20)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TPE)
    return (dt.astimezone(TPE) - timedelta(hours=DAY_BOUNDARY_HOURS)).date()


def launch_date():
    return date.fromisoformat(os.environ.get("LAUNCH_DATE") or DEFAULT_LAUNCH_DATE)


def window_days(now, n):
    """Last n logical days ending today, oldest first, not before LAUNCH_DATE."""
    today = logical_day(now)
    start = max(today - timedelta(days=n - 1), launch_date())
    return [start + timedelta(days=i) for i in range((today - start).days + 1)]


def error_text(e):
    """Short error for status/logs: no response bodies or content."""
    return str(e) if isinstance(e, HttpError) else type(e).__name__


def utc_iso(now):
    return now.astimezone(timezone.utc).isoformat(timespec="seconds")


def http(method, url, headers=None, body=None, timeout=20):
    """JSON over HTTP. Returns parsed body (None if empty). Raises HttpError on 4xx/5xx,
    OSError (URLError) when the host is unreachable. Tests patch this function."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read()[:300].decode("utf-8", "replace")) from None
    if not raw:
        return None
    return json.loads(raw)


class Supabase:
    def __init__(self, url, key, dry_run=False):
        self.url = url.rstrip("/")
        self.key = key
        self.dry_run = dry_run

    def _headers(self, prefer=None):
        h = {"apikey": self.key, "Authorization": "Bearer " + self.key,
             "Content-Type": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        return h

    def select(self, table, query):
        return http("GET", f"{self.url}/rest/v1/{table}?{query}", self._headers()) or []

    def upsert(self, table, rows, on_conflict):
        if not rows:
            return
        if self.dry_run:
            for r in rows:
                print(f"[dry-run] {table}: " + json.dumps(r, ensure_ascii=True, sort_keys=True))
            return
        http("POST", f"{self.url}/rest/v1/{table}?on_conflict={on_conflict}",
                    self._headers("resolution=merge-duplicates,return=minimal"), rows)

    def upsert_logs(self, rows):
        self.upsert("habit_logs", rows, "log_date,habit_id,source")

    def upsert_status(self, source, now, error=None, extra=None, success=None):
        """success defaults to error is None; pass True for a partial failure (run worked,
        some items unreachable) so freshness still advances."""
        row = {"source": source, "last_attempt_at": utc_iso(now),
               "message": "OK" if error is None else "ERROR: " + error,
               "extra": extra or {}}
        if (error is None) if success is None else success:
            row["last_success_at"] = utc_iso(now)
        self.upsert("habit_source_status", [row], "source")


def log_row(log_date, habit_id, source, done, value=None, source_ref=None):
    return {"log_date": log_date.isoformat(), "habit_id": habit_id, "source": source,
            "done": bool(done), "value": value, "source_ref": source_ref}


def supabase_from_env(dry_run=False):
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key and not dry_run:
        sys.exit("SUPABASE_SERVICE_KEY is not set (put it in habits/dashboard/.env or the env).")
    return Supabase(os.environ.get("SUPABASE_URL") or DEFAULT_SUPABASE_URL, key or "", dry_run)
