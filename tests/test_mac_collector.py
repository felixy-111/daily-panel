import unittest
from datetime import date, datetime, timezone
from unittest import mock

from fake_http import FIXTURES, FakeHttp, common, db

import mac_collector as mc

# 2026-11-21 02:10 Taipei -> logical day 2026-11-20
NOW = datetime(2026, 11, 20, 18, 10, tzinfo=timezone.utc)


def shadowing(now):
    return mc.collect_shadowing(now, FIXTURES / "pronounce_log.json")


def meeting(now):
    return mc.collect_meeting(now, FIXTURES / "meeting_coach_state.json")


def anki_routes(by_day=None, due=None, down=False):
    def handler(body, url):
        if down:
            raise ConnectionRefusedError("refused")
        if body["action"] == "getNumCardsReviewedByDay":
            return {"result": by_day, "error": None}
        return {"result": list(range(due)), "error": None}
    return [("POST", "127.0.0.1:8765", handler)]


SOURCES = [("shadowing", shadowing), ("meeting_coach", meeting), ("anki", mc.collect_anki)]


class LogicalDayTest(unittest.TestCase):
    def test_boundary(self):
        tpe = common.TPE
        self.assertEqual(common.logical_day(datetime(2026, 11, 21, 2, 10, tzinfo=tpe)), date(2026, 11, 20))
        self.assertEqual(common.logical_day(datetime(2026, 11, 21, 3, 59, tzinfo=tpe)), date(2026, 11, 20))
        self.assertEqual(common.logical_day(datetime(2026, 11, 21, 4, 0, tzinfo=tpe)), date(2026, 11, 21))
        # UTC input is converted to Taipei first
        self.assertEqual(common.logical_day(datetime(2026, 11, 20, 20, 1, tzinfo=timezone.utc)), date(2026, 11, 21))


@mock.patch.dict("os.environ", {"LAUNCH_DATE": "2026-11-16"})
class MacCollectorTest(unittest.TestCase):
    def run_once(self, fake):
        with mock.patch.object(common, "http", fake):
            return mc.run(db(), NOW, SOURCES)

    def test_shadowing_excludes_test_zoo_and_launch_date(self):
        rows, _ = shadowing(NOW)
        by_date = {r["log_date"]: r for r in rows}
        self.assertEqual(min(by_date), "2026-11-16")  # nothing before LAUNCH_DATE
        self.assertEqual(max(by_date), "2026-11-20")
        self.assertEqual(by_date["2026-11-20"]["value"], 2)  # test_zoo not counted
        self.assertFalse(by_date["2026-11-19"]["done"])  # only test_zoo that day
        self.assertTrue(by_date["2026-11-18"]["done"])
        self.assertTrue(all(r["habit_id"] == "shadowing" and r["source"] == "shadowing" for r in rows))

    def test_meeting_counts_sessions_ignores_streak(self):
        rows, _ = meeting(NOW)
        by_date = {r["log_date"]: r for r in rows}
        self.assertEqual(by_date["2026-11-20"]["value"], 2)
        self.assertEqual(by_date["2026-11-17"]["value"], 1)
        self.assertEqual(sum(r["done"] for r in rows), 2)
        self.assertTrue(all(r["source"] == "meeting_coach" and r["habit_id"] == "meeting" for r in rows))

    def test_anki_rows_and_due(self):
        fake = FakeHttp(anki_routes([["2026-11-20", 30], ["2026-11-01", 5]], due=7))
        self.assertEqual(self.run_once(fake), 0)
        rows = [r for r in fake.posted("habit_logs") if r["source"] == "anki"]
        self.assertEqual({r["log_date"]: r["value"] for r in rows if r["done"]}, {"2026-11-20": 30})
        st = fake.status("anki")
        self.assertEqual((st["message"], st["extra"]), ("OK", {"due": 7}))
        self.assertIn("last_success_at", st)

    def test_anki_down_writes_error_and_no_rows(self):
        fake = FakeHttp(anki_routes(down=True))
        self.assertEqual(self.run_once(fake), 0)
        self.assertEqual([r for r in fake.posted("habit_logs") if r["source"] == "anki"], [])
        st = fake.status("anki")
        self.assertEqual(st["message"], "ERROR: anki not running")
        self.assertNotIn("last_success_at", st)
        # other sources unaffected
        self.assertEqual(fake.status("shadowing")["message"], "OK")
        self.assertTrue(fake.posted("habit_logs"))

    def test_one_source_failing_does_not_stop_others(self):
        def broken(now):
            raise ValueError("bad json")
        fake = FakeHttp(anki_routes([], due=0))
        with mock.patch.object(common, "http", fake):
            mc.run(db(), NOW, [("shadowing", broken), ("meeting_coach", meeting)])
        self.assertTrue(fake.status("shadowing")["message"].startswith("ERROR"))
        self.assertEqual(fake.status("meeting_coach")["message"], "OK")

    def test_rerun_is_idempotent(self):
        payloads = []
        for _ in range(2):
            fake = FakeHttp(anki_routes([["2026-11-19", 3]], due=2))
            self.run_once(fake)
            payloads.append([c for c in fake.calls if "/rest/v1/" in c[1]])
        self.assertEqual(payloads[0], payloads[1])

    def test_upsert_uses_merge_duplicates(self):
        seen = []
        fake = FakeHttp(anki_routes([], due=0))
        orig = fake.__call__

        def spy(method, url, headers=None, body=None, timeout=20):
            seen.append((url, headers))
            return orig(method, url, headers, body, timeout)
        with mock.patch.object(common, "http", spy):
            mc.run(db(), NOW, SOURCES)
        log_posts = [(u, h) for u, h in seen if "/rest/v1/habit_logs" in u]
        self.assertTrue(log_posts)
        for url, h in log_posts:
            self.assertIn("on_conflict=log_date,habit_id,source", url)
            self.assertIn("resolution=merge-duplicates", h["Prefer"])

    def test_dry_run_does_not_write(self):
        fake = FakeHttp(anki_routes([], due=0))
        with mock.patch.object(common, "http", fake), mock.patch("builtins.print"):
            mc.run(common.Supabase("https://x", "", dry_run=True), NOW, SOURCES)
        self.assertEqual([c for c in fake.calls if "/rest/v1/" in c[1]], [])


if __name__ == "__main__":
    unittest.main()
