#!/usr/bin/env python3
"""Mac collector (launchd, every 30 min): shadowing, Meeting Coach, Anki -> habit_logs.

Recomputes the last 14 logical days each run (idempotent upsert). Each source is
independent; a failing source writes an ERROR status and no rows.
Usage: mac_collector.py [--dry-run]
"""
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import common

SHADOWING_DIR = Path("/Users/billyyang/projects/felix_agent/english/shadowing/data")
PRONOUNCE_LOG = SHADOWING_DIR / "pronounce_log.json"
MEETING_STATE = SHADOWING_DIR / "meeting_coach_state.json"
ANKICONNECT = "http://127.0.0.1:8765"
WINDOW_DAYS = 14
GH = "/opt/homebrew/bin/gh"
CLOUD_REPO = "felixy-111/daily-panel"
EXCLUDED_SOURCE_IDS = {"test_zoo"}


def count_rows(counts, days, habit_id, source):
    """One row per day in the window: value = count, done = count >= 1."""
    return [common.log_row(d, habit_id, source, counts.get(d.isoformat(), 0) >= 1,
                           counts.get(d.isoformat(), 0)) for d in days]


def collect_shadowing(now, path=PRONOUNCE_LOG):
    entries = json.loads(Path(path).read_text())
    counts = Counter(e["date"] for e in entries
                     if e.get("source_id") not in EXCLUDED_SOURCE_IDS and e.get("date"))
    return count_rows(counts, common.window_days(now, WINDOW_DAYS), "shadowing", "shadowing"), {}


def collect_meeting(now, path=MEETING_STATE):
    sessions = json.loads(Path(path).read_text()).get("sessions") or []
    counts = Counter(s["date"] for s in sessions if s.get("date"))
    return count_rows(counts, common.window_days(now, WINDOW_DAYS), "meeting", "meeting_coach"), {}


class AnkiDown(Exception):
    pass


def anki(action, **params):
    try:
        res = common.http("POST", ANKICONNECT, {"Content-Type": "application/json"},
                          {"action": action, "version": 6, "params": params}, timeout=10)
    except OSError as e:
        raise AnkiDown("anki not running") from e
    if res.get("error"):
        raise RuntimeError("ankiconnect " + action + " failed")
    return res["result"]


def collect_anki(now):
    by_day = {d: n for d, n in anki("getNumCardsReviewedByDay")}
    due = len(anki("findCards", query="is:due"))
    return count_rows(by_day, common.window_days(now, WINDOW_DAYS), "anki", "anki"), {"due": due}


SOURCES = [
    ("shadowing", collect_shadowing),
    ("meeting_coach", collect_meeting),
    ("anki", collect_anki),
]


def run(db, now=None, sources=SOURCES):
    """Returns the number of sources whose Supabase write failed."""
    now = now or datetime.now(timezone.utc)
    write_failures = 0
    for name, fn in sources:
        try:
            rows, extra = fn(now)
            error = None
        except AnkiDown as e:
            rows, extra, error = [], {}, str(e)
        except Exception as e:
            rows, extra, error = [], {}, common.error_text(e)
        try:
            db.upsert_logs(rows)
            db.upsert_status(name, now, error, extra)
        except Exception as e:
            write_failures += 1
            print(f"{name}: supabase write failed ({common.error_text(e)})")
            continue
        done = sum(r["done"] for r in rows)
        print(f"{name}: {len(rows)} rows, {done} done" + (f", ERROR: {error}" if error else "")
              + (f", extra={json.dumps(extra)}" if extra else ""))
    return write_failures


def trigger_cloud():
    """GitHub's */15 schedule never fired for this repo, so nudge the cloud collector
    (Email Coach + Notion) from here. Best effort: a failure only logs."""
    try:
        r = subprocess.run([GH, "workflow", "run", "collect.yml", "-R", CLOUD_REPO],
                           capture_output=True, text=True, timeout=60)
        print("cloud trigger:", "OK" if r.returncode == 0 else f"FAILED rc={r.returncode}")
    except Exception as e:  # noqa: BLE001
        print("cloud trigger: FAILED", type(e).__name__)


def main():
    dry_run = "--dry-run" in sys.argv[1:]
    common.load_env()
    db = common.supabase_from_env(dry_run=dry_run)
    print(f"habit mac collector {datetime.now(common.TPE).isoformat(timespec='seconds')}"
          + (" (dry-run)" if dry_run else ""))
    failed = run(db)
    if not dry_run:
        trigger_cloud()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
