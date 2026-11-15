#!/usr/bin/env python3
"""Cloud collector (GitHub Actions, every 15 min): Email Coach + Notion -> habit_logs.

Actions logs are public: print counts and habit ids only, never names or page content.
Any source raising -> ERROR status written, then the job exits non-zero.
A source that returns an error (e.g. some Notion pages unreachable) is a partial failure:
ERROR message, but last_success_at still advances.
"""
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import common

EMAIL_REPO = os.environ.get("EMAIL_COACH_REPO") or "felixy-111/daily-english-email"
EMAIL_STATE_PATH = "email_coach/state.json"
EMAIL_WINDOW_DAYS = 14
# Prompt goes out ~07:xx and grading runs hourly, so a grade before 08:00 belongs
# to the previous day's prompt (spike S8).
EMAIL_ISSUE_SHIFT = timedelta(hours=8)

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"
TASKS_DATA_SOURCE = "1e48744e-b435-815b-9c89-000b5f1672dc"
VALUE_FALLBACK_SLACK = timedelta(minutes=5)


# ---------- Email Coach ----------

def fetch_email_state():
    headers = {"Accept": "application/vnd.github.raw+json", "User-Agent": "habit-collector",
               "X-GitHub-Api-Version": "2022-11-28"}
    if os.environ.get("GH_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    return common.http("GET", f"https://api.github.com/repos/{EMAIL_REPO}/contents/{EMAIL_STATE_PATH}",
                       headers)


def issue_date(completed_at):
    dt = datetime.fromisoformat(completed_at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=common.TPE)
    return (dt.astimezone(common.TPE) - EMAIL_ISSUE_SHIFT).date()


def collect_email(db, now, state=None):
    state = state if state is not None else fetch_email_state()
    window = set(common.window_days(now, EMAIL_WINDOW_DAYS))
    days = sorted({issue_date(d["completed_at"]) for d in state.get("completed_days") or []
                   if d.get("completed_at")} & window)
    rows = [common.log_row(d, "email", "email_coach", True, 1) for d in days]
    db.upsert_logs(rows)
    return rows, {}, None


# ---------- Notion ----------

def notion(method, path, body=None):
    return common.http(method, NOTION_API + path, {
        "Authorization": "Bearer " + os.environ.get("NOTION_TOKEN", ""),
        "Notion-Version": NOTION_VERSION, "Content-Type": "application/json"}, body)


def norm(page_id):
    return (page_id or "").replace("-", "").lower()


def prop(page, name, kind):
    return (page.get("properties", {}).get(name) or {}).get(kind)


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def completed_day(page):
    start = (prop(page, "Completed", "date") or {}).get("start")
    if not start:
        return None
    if "T" not in start:
        return datetime.fromisoformat(start).date()
    return common.logical_day(parse_ts(start))


def query_done_since(since):
    pages, cursor = [], None
    while True:
        body = {"filter": {"and": [
            {"property": "Status", "status": {"equals": "Done"}},
            {"property": "Completed", "date": {"on_or_after": since.isoformat()}}]},
            "page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        res = notion("POST", f"/data_sources/{TASKS_DATA_SOURCE}/query", body)
        pages.extend(res.get("results") or [])
        if not res.get("has_more"):
            return pages
        cursor = res.get("next_cursor")


def move_value(hist, orig):
    """Spike S10: automation doesn't copy Value to the history page. Move it from the
    original when the original was last edited around the history page's creation."""
    if orig is None:
        return None
    value = prop(orig, "Value", "number")
    if value is None:
        return None
    if parse_ts(orig["last_edited_time"]) > parse_ts(hist["created_time"]) + VALUE_FALLBACK_SLACK:
        return None
    notion("PATCH", f"/pages/{hist['id']}", {"properties": {"Value": {"number": value}}})
    notion("PATCH", f"/pages/{orig['id']}", {"properties": {"Value": {"number": None}}})
    orig["properties"]["Value"]["number"] = None  # later pages in this run see it cleared
    return value


def collect_notion(db, now):
    defs = db.select("habit_defs", "select=habit_id,notion_page_id&notion_page_id=not.is.null")
    habit_of = {norm(d["notion_page_id"]): d["habit_id"] for d in defs if d.get("notion_page_id")}

    originals, unreachable = {}, []
    for pid, hid in sorted(habit_of.items(), key=lambda x: x[1]):
        try:
            page = notion("GET", f"/pages/{pid}")
        except common.HttpError:
            page = None
        if not page or page.get("in_trash") or page.get("archived"):
            unreachable.append(hid)
        else:
            originals[pid] = page

    today = common.logical_day(now)
    accept = {d for d in (today, today - timedelta(days=1)) if d >= common.launch_date()}
    panel_refs = {norm(r["source_ref"]) for r in db.select(
        "habit_logs", f"select=source_ref&source=eq.panel&source_ref=not.is.null"
                      f"&log_date=gte.{(today - timedelta(days=3)).isoformat()}")}

    groups, ignored_old = defaultdict(list), 0
    pages = query_done_since(today - timedelta(days=2))
    for page in sorted(pages, key=lambda p: (p.get("created_time", ""), p["id"])):
        pid = norm(page["id"])
        if pid in habit_of or page.get("in_trash") or page.get("archived"):
            continue
        orig_id = next((o for o in (norm(r["id"]) for r in prop(page, "Occurrences", "relation") or [])
                        if o in habit_of), None)
        if orig_id is None or pid in panel_refs:
            continue  # unrelated task, or created by the panel's write-back
        day = completed_day(page)
        if day is None:
            continue
        if day not in accept:
            ignored_old += 1
            continue
        value = prop(page, "Value", "number")
        if value is None:
            value = move_value(page, originals.get(orig_id))
        groups[(day, habit_of[orig_id])].append((page["id"], value))

    rows = []
    for (day, hid), items in sorted(groups.items()):
        values = [v for _, v in items if v is not None]
        rows.append(common.log_row(day, hid, "notion", True, max(values) if values else None, items[0][0]))

    if accept:
        existing = db.select("habit_logs", "select=log_date,habit_id,source_ref,done&source=eq.notion"
                                           f"&done=is.true&log_date=gte.{min(accept).isoformat()}")
        for r in existing:
            day = datetime.fromisoformat(r["log_date"]).date()
            if day in accept and (day, r["habit_id"]) not in groups:
                rows.append(common.log_row(day, r["habit_id"], "notion", False, None, r.get("source_ref")))

    db.upsert_logs(rows)
    error = f"{','.join(unreachable)} unreachable" if unreachable else None
    return rows, {"ignored_old": ignored_old, "unreachable": unreachable}, error


SOURCES = [("email_coach", collect_email), ("notion", collect_notion)]


def run(db, now=None, sources=SOURCES):
    """Returns the number of sources that raised (job should fail)."""
    now = now or datetime.now(timezone.utc)
    failures = 0
    for name, fn in sources:
        try:
            rows, extra, error = fn(db, now)
            ran = True
        except Exception as e:
            failures += 1
            rows, extra, error, ran = [], {}, common.error_text(e), False
        try:
            db.upsert_status(name, now, error, extra, success=ran)
        except Exception as e:
            failures += 1
            print(f"{name}: status write failed ({common.error_text(e)})")
        done = sum(r["done"] for r in rows)
        print(f"{name}: {len(rows)} rows, {done} done" + (f", ERROR: {error}" if error else "")
              + "".join(f", {k}={v}" for k, v in extra.items()))
    return failures


def main():
    common.load_env()
    db = common.supabase_from_env()
    if not os.environ.get("NOTION_TOKEN"):
        sys.exit("NOTION_TOKEN is not set.")
    sys.exit(1 if run(db) else 0)


if __name__ == "__main__":
    main()
