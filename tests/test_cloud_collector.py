import unittest
from datetime import date, datetime, timezone
from unittest import mock

from fake_http import FakeHttp, common, db, fixture

import cloud_collector as cc

TPE = common.TPE
NOW = datetime(2026, 11, 21, 10, 0, tzinfo=TPE)  # logical today 11/21, yesterday 11/20
DEFS = fixture("habit_defs.json")
ORIG = {d["habit_id"]: d["notion_page_id"] for d in DEFS}


def original(hid, value=None, last_edited="2026-11-21T01:00:00.000Z", trashed=False):
    return {"object": "page", "id": ORIG[hid], "in_trash": trashed, "archived": False,
            "created_time": "2026-01-01T00:00:00.000Z", "last_edited_time": last_edited,
            "properties": {"Value": {"type": "number", "number": value},
                           "Occurrences": {"type": "relation", "relation": []}}}


def history(pid, links, completed, value=None, created="2026-11-21T01:00:00.000Z"):
    return {"object": "page", "id": pid, "in_trash": False, "archived": False,
            "created_time": created, "last_edited_time": created,
            "properties": {"Status": {"type": "status", "status": {"name": "Done"}},
                           "Completed": {"type": "date", "date": {"start": completed}},
                           "Value": {"type": "number", "number": value},
                           "Occurrences": {"type": "relation", "relation": [{"id": i} for i in links]}}}


def hid_id(n):
    return f"99999999-0000-0000-0000-{n:012d}"


class NotionWorld:
    """Fake Notion + Supabase state for one collector run."""

    def __init__(self, pages, originals=None, panel_refs=(), existing=(), unreachable=()):
        self.originals = {d["habit_id"]: original(d["habit_id"]) for d in DEFS}
        self.originals.update(originals or {})
        self.unreachable = set(unreachable)
        by_id = {common_norm(p["id"]): p for p in self.originals.values()}

        def get_page(body, url):
            pid = url.rsplit("/", 1)[1]
            for hid, p in self.originals.items():
                if common_norm(p["id"]) == common_norm(pid):
                    if hid in self.unreachable:
                        raise common.HttpError(404)
                    return p
            raise common.HttpError(404)

        def patch_page(body, url):
            return by_id.get(common_norm(url.rsplit("/", 1)[1]), {})

        self.fake = FakeHttp([
            ("GET", "/rest/v1/habit_defs", DEFS),
            ("GET", "/rest/v1/habit_logs?select=source_ref", [{"source_ref": r} for r in panel_refs]),
            ("GET", "/rest/v1/habit_logs?select=log_date", list(existing)),
            ("POST", "/data_sources/", {"results": pages, "has_more": False}),
            ("GET", "api.notion.com/v1/pages/", get_page),
            ("PATCH", "api.notion.com/v1/pages/", patch_page),
        ])

    def run(self):
        with mock.patch.object(common, "http", self.fake), mock.patch("builtins.print"):
            failures = cc.run(db(), NOW, [("notion", cc.collect_notion)])
        return failures, self.fake.posted("habit_logs"), self.fake.status("notion")

    def patches(self):
        return [(url.rsplit("/", 1)[1], body) for m, url, body in self.fake.calls if m == "PATCH"]


def common_norm(i):
    return cc.norm(i)


@mock.patch.dict("os.environ", {"LAUNCH_DATE": "2026-11-16", "NOTION_TOKEN": "t"})
class NotionTest(unittest.TestCase):
    def test_batch_five_pages_one_minute_one_row_today(self):
        pages = [history(hid_id(i), [ORIG["b1"]], "2026-11-21T09:30:00.000+08:00",
                         created=f"2026-11-21T01:30:{i:02d}.000Z") for i in range(5)]
        failures, rows, status = NotionWorld(pages).run()
        self.assertEqual(failures, 0)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["log_date"], rows[0]["habit_id"], rows[0]["done"], rows[0]["source"]),
                         ("2026-11-21", "b1", True, "notion"))
        self.assertEqual(rows[0]["source_ref"], hid_id(0))
        self.assertEqual(status["message"], "OK")

    def test_completed_four_days_ago_ignored(self):
        pages = [history(hid_id(1), [ORIG["b2"]], "2026-11-17T09:00:00.000+08:00")]
        _, rows, status = NotionWorld(pages).run()
        self.assertEqual(rows, [])
        self.assertEqual(status["extra"]["ignored_old"], 1)

    def test_completed_0210_is_previous_logical_day(self):
        pages = [history(hid_id(1), [ORIG["b3"]], "2026-11-21T02:10:00.000+08:00")]
        _, rows, _ = NotionWorld(pages).run()
        self.assertEqual([(r["log_date"], r["habit_id"]) for r in rows], [("2026-11-20", "b3")])

    def test_writeback_pages_skipped(self):
        pages = [history(hid_id(1), [ORIG["m1"]], "2026-11-21T09:00:00.000+08:00")]
        _, rows, _ = NotionWorld(pages, panel_refs=[hid_id(1).replace("-", "")]).run()
        self.assertEqual(rows, [])

    def test_value_fallback_moves_value(self):
        pages = [history(hid_id(1), [ORIG["m2"]], "2026-11-21T09:00:00.000+08:00",
                         created="2026-11-21T01:00:00.000Z"),
                 history(hid_id(2), [ORIG["m2"]], "2026-11-21T09:00:00.000+08:00",
                         created="2026-11-21T01:00:30.000Z")]
        world = NotionWorld(pages, {"m2": original("m2", 54, last_edited="2026-11-21T01:01:00.000Z")})
        _, rows, _ = world.run()
        self.assertEqual(rows[0]["value"], 54)
        self.assertEqual(world.patches(), [
            (hid_id(1), {"properties": {"Value": {"number": 54}}}),
            (ORIG["m2"], {"properties": {"Value": {"number": None}}})])

    def test_stale_original_value_not_moved(self):
        pages = [history(hid_id(1), [ORIG["m2"]], "2026-11-21T09:00:00.000+08:00",
                         created="2026-11-21T01:00:00.000Z")]
        world = NotionWorld(pages, {"m2": original("m2", 54, last_edited="2026-11-21T02:00:00.000Z")})
        _, rows, _ = world.run()
        self.assertIsNone(rows[0]["value"])
        self.assertEqual(world.patches(), [])

    def test_history_value_used_and_max_taken(self):
        pages = [history(hid_id(1), [ORIG["b3"]], "2026-11-21T09:00:00.000+08:00", value=20),
                 history(hid_id(2), [ORIG["b3"]], "2026-11-21T09:05:00.000+08:00", value=35)]
        _, rows, _ = NotionWorld(pages).run()
        self.assertEqual(rows[0]["value"], 35)

    def test_unrelated_tasks_ignored(self):
        pages = [history(hid_id(1), ["77777777-7777-7777-7777-777777777777"], "2026-11-21T09:00:00.000+08:00"),
                 history(hid_id(2), [], "2026-11-21T09:00:00.000+08:00")]
        _, rows, status = NotionWorld(pages).run()
        self.assertEqual(rows, [])
        self.assertEqual(status["extra"]["ignored_old"], 0)

    def test_unreachable_page_error_status_others_continue(self):
        pages = [history(hid_id(1), [ORIG["b1"]], "2026-11-21T09:00:00.000+08:00")]
        world = NotionWorld(pages, {"b2": original("b2", trashed=True)}, unreachable=["m1"])
        failures, rows, status = world.run()
        self.assertEqual(status["message"], "ERROR: b2,m1 unreachable")
        self.assertEqual(status["extra"]["unreachable"], ["b2", "m1"])
        self.assertEqual([r["habit_id"] for r in rows], ["b1"])
        self.assertEqual(failures, 0)

    def test_trashed_history_marks_existing_row_not_done(self):
        existing = [{"log_date": "2026-11-20", "habit_id": "b1", "source_ref": hid_id(8), "done": True},
                    {"log_date": "2026-11-21", "habit_id": "b3", "source_ref": hid_id(9), "done": True}]
        pages = [history(hid_id(9), [ORIG["b3"]], "2026-11-21T09:00:00.000+08:00")]
        _, rows, _ = NotionWorld(pages, existing=existing).run()
        by = {(r["log_date"], r["habit_id"]): r for r in rows}
        self.assertFalse(by[("2026-11-20", "b1")]["done"])
        self.assertEqual(by[("2026-11-20", "b1")]["source_ref"], hid_id(8))
        self.assertTrue(by[("2026-11-21", "b3")]["done"])

    def test_before_launch_not_imported(self):
        pages = [history(hid_id(1), [ORIG["b1"]], "2026-11-20T09:00:00.000+08:00")]
        with mock.patch.dict("os.environ", {"LAUNCH_DATE": "2026-11-21"}):
            _, rows, status = NotionWorld(pages).run()
        self.assertEqual(rows, [])
        self.assertEqual(status["extra"]["ignored_old"], 1)

    def test_token_revoked_fails_job(self):
        world = NotionWorld([])
        world.fake.routes.insert(0, ("POST", "/data_sources/", lambda b, u: (_ for _ in ()).throw(common.HttpError(401))))
        world.unreachable = set(ORIG)
        failures, rows, status = world.run()
        self.assertEqual(failures, 1)
        self.assertEqual(status["message"], "ERROR: HTTP 401")

    def test_rerun_idempotent(self):
        pages = [history(hid_id(1), [ORIG["b1"]], "2026-11-21T09:00:00.000+08:00", value=3)]
        a = NotionWorld(pages).run()[1]
        b = NotionWorld(pages).run()[1]
        self.assertEqual(a, b)


@mock.patch.dict("os.environ", {"LAUNCH_DATE": "2026-11-16"})
class EmailTest(unittest.TestCase):
    def test_issue_date_rule(self):
        self.assertEqual(cc.issue_date("2026-11-20T00:40+08:00"), date(2026, 11, 19))
        self.assertEqual(cc.issue_date("2026-11-20T08:20+08:00"), date(2026, 11, 20))
        self.assertEqual(cc.issue_date("2026-11-20T07:59:00"), date(2026, 11, 19))  # naive = Taipei

    def test_rows_from_state(self):
        fake = FakeHttp([("GET", "api.github.com/repos/", fixture("email_state.json"))])
        with mock.patch.object(common, "http", fake), mock.patch("builtins.print"):
            failures = cc.run(db(), NOW, [("email_coach", cc.collect_email)])
        self.assertEqual(failures, 0)
        rows = fake.posted("habit_logs")
        # 11/20 00:40 and 11/21 07:59 -> 11/19 and 11/20; 08:20 -> 11/20 (dedup); 11/12 before launch
        self.assertEqual([r["log_date"] for r in rows], ["2026-11-19", "2026-11-20"])
        self.assertTrue(all(r["habit_id"] == "email" and r["source"] == "email_coach"
                            and r["done"] and r["value"] == 1 for r in rows))
        self.assertEqual(fake.status("email_coach")["message"], "OK")

    def test_github_error_fails_job(self):
        def boom(b, u):
            raise common.HttpError(404)
        fake = FakeHttp([("GET", "api.github.com/repos/", boom)])
        with mock.patch.object(common, "http", fake), mock.patch("builtins.print"):
            failures = cc.run(db(), NOW, [("email_coach", cc.collect_email)])
        self.assertEqual(failures, 1)
        self.assertEqual(fake.status("email_coach")["message"], "ERROR: HTTP 404")


if __name__ == "__main__":
    unittest.main()
