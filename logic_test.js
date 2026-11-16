import {
  addDays,
  applyQueue,
  canEdit,
  dayEnd,
  dumpDrop,
  dumpPut,
  dumpText,
  fmtHM,
  heatmapCells,
  indexLogs,
  isLongPress,
  isoWeekStart,
  logicalDay,
  mergeDay,
  notionError,
  queueDrop,
  queuePut,
  safeOpenUrl,
  unsyncedSummary,
  valueEdit,
  weeklyProgress,
} from "./logic.js";

function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  actual   ${a}`);
}

const DEF = {
  shadowing: { habit_id: "shadowing", category: "english", min_value: 1, sort: 1 },
  anki: { habit_id: "anki", category: "english", min_value: 1, sort: 2 },
  meeting: { habit_id: "meeting", category: "english", min_value: 1, weekly_target: 2, sort: 3 },
  email: { habit_id: "email", category: "english", min_value: 1, sort: 4 },
  m1: { habit_id: "m1", category: "mind", target: 1, sort: 5 },
  m2: { habit_id: "m2", category: "mind", target: 108, sort: 6 },
  b1: { habit_id: "b1", category: "body", weekly_target: 3, sort: 7 },
  b2: { habit_id: "b2", category: "body", weekly_target: 2, sort: 8 },
  b3: { habit_id: "b3", category: "body", sort: 9 },
};
const row = (source, done, value = null, extra = {}) => ({ source, done, value, ...extra });

// --- logical day (Asia/Taipei, 04:00 boundary) ---
Deno.test("01:30 Taipei on 11/21 belongs to 11/20", () => {
  eq(logicalDay(new Date("2026-11-21T01:30:00+08:00")), "2026-11-20");
});
Deno.test("04:01 Taipei starts the new day", () => {
  eq(logicalDay(new Date("2026-11-21T04:01:00+08:00")), "2026-11-21");
  eq(logicalDay(new Date("2026-11-21T03:59:00+08:00")), "2026-11-20");
});
Deno.test("logical day ignores the host time zone (UTC input)", () => {
  eq(logicalDay(new Date("2026-11-20T18:10:00Z")), "2026-11-20"); // 02:10 Taipei 11/21
  eq(logicalDay(new Date("2026-11-20T20:00:00Z")), "2026-11-21"); // 04:00 Taipei 11/21
});
Deno.test("date helpers", () => {
  eq(addDays("2026-03-01", -1), "2026-02-28");
  eq(addDays("2026-12-31", 1), "2027-01-01");
  eq(isoWeekStart("2026-11-16"), "2026-11-16"); // Monday
  eq(isoWeekStart("2026-11-22"), "2026-11-16"); // Sunday
  eq(dayEnd("2026-11-20").toISOString(), "2026-11-20T20:00:00.000Z");
  eq(fmtHM("2026-11-20T18:05:00Z"), "02:05");
});
Deno.test("backfill only today or yesterday", () => {
  eq(canEdit("2026-11-21", "2026-11-21"), true);
  eq(canEdit("2026-11-20", "2026-11-21"), true);
  eq(canEdit("2026-11-19", "2026-11-21"), false);
  eq(canEdit("2026-11-22", "2026-11-21"), false);
});

// --- merge ---
Deno.test("no rows → none", () => {
  eq(mergeDay([], DEF.m1).state, "none");
});
Deno.test("panel toggle done / cancelled", () => {
  eq(mergeDay([row("panel", true)], DEF.m1).state, "done");
  eq(mergeDay([row("panel", false)], DEF.m1).state, "none");
});
Deno.test("m2 panel 54 → partial 54; 108 → done", () => {
  const p = mergeDay([row("panel", true, 54)], DEF.m2);
  eq([p.state, p.value], ["partial", 54]);
  eq(mergeDay([row("panel", true, 108)], DEF.m2).state, "done");
});
Deno.test("notion done with empty value → value = target", () => {
  const r = mergeDay([row("notion", true)], DEF.m2);
  eq([r.state, r.value, r.notionDone, r.sources], ["done", 108, true, ["notion"]]);
});
Deno.test("panel 54 + notion done → done, keeps 54", () => {
  const r = mergeDay([row("panel", true, 54), row("notion", true)], DEF.m2);
  eq([r.state, r.value], ["done", 54]);
});
Deno.test("panel 20 + notion done → done 20 (one cell)", () => {
  const r = mergeDay([row("panel", true, 20), row("notion", true, 15)], DEF.b3);
  eq([r.state, r.value], ["done", 20]);
});
Deno.test("panel cancelled but notion done → still done, flags notionDone", () => {
  const r = mergeDay([row("panel", false), row("notion", true)], DEF.m1);
  eq([r.state, r.notionDone, r.panelDone, r.hasPanelRow], ["done", true, false, true]);
});
Deno.test("cancelled panel value is ignored in favour of notion value", () => {
  eq(mergeDay([row("panel", false, 3), row("notion", true, 5)], DEF.b2).value, 5);
});
Deno.test("notion value used when no panel value", () => {
  eq(mergeDay([row("notion", true, 5)], DEF.b2).value, 5);
});
Deno.test("auto source needs value >= min_value", () => {
  eq(mergeDay([row("anki", true, 0)], DEF.anki).state, "none");
  eq(mergeDay([row("anki", true, null)], DEF.anki).state, "none");
  const r = mergeDay([row("anki", true, 12)], DEF.anki);
  eq([r.state, r.value, r.sources], ["done", 12, ["anki"]]);
});
Deno.test("panel value beats auto value", () => {
  eq(mergeDay([row("panel", true, 3), row("shadowing", true, 9)], DEF.shadowing).value, 3);
  eq(mergeDay([row("panel", true), row("shadowing", true, 9)], DEF.shadowing).value, 9);
});

// --- unknown (stale sources) ---
const NOW = new Date("2026-11-21T12:00:00+08:00");
const TODAY = "2026-11-21";
const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
const ctx = (status) => ({ status, now: NOW, date: TODAY });

Deno.test("anki stale > 90 min and nothing done → unknown with last update", () => {
  const st = { anki: { source: "anki", last_success_at: ago(91) } };
  const r = mergeDay([], DEF.anki, ctx(st));
  eq([r.state, r.lastSuccess], ["unknown", ago(91)]);
});
Deno.test("anki fresh → none, not unknown", () => {
  eq(mergeDay([], DEF.anki, ctx({ anki: { last_success_at: ago(89) } })).state, "none");
});
Deno.test("stale but a done row exists → done", () => {
  eq(mergeDay([row("panel", true)], DEF.anki, ctx({ anki: { last_success_at: ago(500) } })).state, "done");
});
Deno.test("email_coach threshold is 3 h", () => {
  eq(mergeDay([], DEF.email, ctx({ email_coach: { last_success_at: ago(179) } })).state, "none");
  eq(mergeDay([], DEF.email, ctx({ email_coach: { last_success_at: ago(181) } })).state, "unknown");
});
Deno.test("meeting uses meeting_coach status", () => {
  eq(mergeDay([], DEF.meeting, ctx({ meeting_coach: { last_success_at: ago(91) } })).state, "unknown");
});
Deno.test("missing status row → unknown", () => {
  eq(mergeDay([], DEF.shadowing, ctx({})).state, "unknown");
});
Deno.test("notion stale > 60 min affects mind/body only without a panel row", () => {
  const st = { notion: { last_success_at: ago(61) } };
  eq(mergeDay([], DEF.b1, ctx(st)).state, "unknown");
  eq(mergeDay([row("panel", false)], DEF.b1, ctx(st)).state, "none");
  eq(mergeDay([], DEF.b1, ctx({ notion: { last_success_at: ago(59) } })).state, "none");
});
Deno.test("past day fully covered by a later successful run is none, not unknown", () => {
  const st = { anki: { last_success_at: ago(600) } }; // 02:00 today, after 11/19 ended
  eq(mergeDay([], DEF.anki, { status: st, now: NOW, date: "2026-11-19" }).state, "none");
});

// --- weekly progress ---
Deno.test("weekly progress counts done days in the ISO week", () => {
  const logs = [
    { log_date: "2026-11-15", habit_id: "b1", source: "panel", done: true }, // previous Sunday
    { log_date: "2026-11-16", habit_id: "b1", source: "panel", done: true },
    { log_date: "2026-11-17", habit_id: "b1", source: "notion", done: true },
    { log_date: "2026-11-17", habit_id: "b1", source: "panel", done: true }, // same day, two sources
    { log_date: "2026-11-18", habit_id: "b1", source: "panel", done: false },
  ];
  eq(weeklyProgress(logs, DEF.b1, "2026-11-19"), { done: 2, target: 3, label: "本週 2/3" });
  eq(weeklyProgress(logs, DEF.b3, "2026-11-19"), null);
});

// --- heatmap ---
Deno.test("heatmap: 12 Mon–Sun columns per habit, future cells null, states merged", () => {
  const logs = [
    { log_date: "2026-11-18", habit_id: "b3", source: "panel", done: true, value: 20 },
    { log_date: "2026-11-18", habit_id: "b3", source: "notion", done: true },
    { log_date: "2026-11-17", habit_id: "m2", source: "panel", done: true, value: 54 },
  ];
  const rows = heatmapCells(logs, [DEF.b3, DEF.m2, DEF.m1], "2026-11-18");
  eq(rows.map((r) => r.habit_id), ["m1", "m2", "b3"]);
  const b3 = rows[2];
  eq(b3.weeks.length, 12);
  eq(b3.weeks[0][0].date, "2026-08-31");
  const last = b3.weeks[11];
  eq(last.map((c) => c && c.state), ["none", "none", "done", null, null, null, null]);
  eq(rows[1].weeks[11][1].state, "partial");
});
Deno.test("heatmap marks unknown from stale status", () => {
  const rows = heatmapCells([], [DEF.anki], TODAY, 12, { status: { anki: { last_success_at: ago(200) } }, now: NOW });
  const cells = rows[0].weeks.flat().filter(Boolean);
  eq(cells.at(-1).state, "unknown"); // today
  eq(cells.at(-3).state, "none"); // two days ago: covered by the last run
});
Deno.test("indexLogs groups by date+habit", () => {
  const m = indexLogs([{ log_date: "a", habit_id: "m1" }, { log_date: "a", habit_id: "m1" }]);
  eq(m.get("a|m1").length, 2);
});

// --- value input ---
Deno.test("valueEdit", () => {
  eq(valueEdit("5"), { done: true, value: 5 });
  eq(valueEdit(" 2.5 "), { done: true, value: 2.5 });
  eq(valueEdit(""), { done: false, value: null });
  eq(valueEdit("0"), { done: false, value: null });
  eq(valueEdit("-1"), null);
  eq(valueEdit("abc"), null);
});

// --- offline queue ---
Deno.test("queue keeps one item per day+habit, later wins; drop only matching write", () => {
  let q = [];
  q = queuePut(q, { log_date: "d", habit_id: "m1", done: true, updated_at: "t1" });
  q = queuePut(q, { log_date: "d", habit_id: "m2", done: true, value: 54, updated_at: "t1" });
  q = queuePut(q, { log_date: "d", habit_id: "m1", done: false, updated_at: "t2" });
  eq(q.map((i) => [i.habit_id, i.done]), [["m2", true], ["m1", false]]);
  eq(queueDrop(q, { log_date: "d", habit_id: "m1", updated_at: "t1" }).length, 2); // newer write survives
  eq(queueDrop(q, { log_date: "d", habit_id: "m1", updated_at: "t2" }).length, 1);
});
Deno.test("applyQueue overlays pending panel rows", () => {
  const logs = [
    { log_date: "d", habit_id: "m1", source: "panel", done: true },
    { log_date: "d", habit_id: "m1", source: "notion", done: true },
  ];
  const out = applyQueue(logs, [{ log_date: "d", habit_id: "m1", done: false }]);
  eq(out.filter((r) => r.source === "panel").map((r) => r.done), [false]);
  eq(out.length, 2);
});

// --- banner ---
Deno.test("notion error banner only when message starts with ERROR", () => {
  eq(notionError([{ source: "notion", message: "ERROR: b2 archived" }]), "ERROR: b2 archived");
  eq(notionError([{ source: "notion", message: "ok 3 rows" }]), null);
  eq(notionError([{ source: "anki", message: "ERROR x" }]), null);
  eq(notionError(null), null);
});

Deno.test("habit listed in notion extra.unreachable → unknown even if notion ran recently", () => {
  const st = { notion: { last_success_at: ago(5), message: "ERROR: b2,m1 unreachable", extra: { unreachable: ["b2", "m1"] } } };
  eq(mergeDay([], DEF.b2, ctx(st)).state, "unknown");
  eq(mergeDay([], DEF.b1, ctx(st)).state, "none");
  eq(mergeDay([row("panel", true)], DEF.m1, ctx(st)).state, "done");
});
Deno.test("fresh explicit done=false auto row → none", () => {
  eq(mergeDay([row("anki", false, 0)], DEF.anki, ctx({ anki: { last_success_at: ago(10) } })).state, "none");
});
Deno.test("one unreachable notion page: only that habit unknown, others normal", () => {
  const st = { notion: { last_success_at: ago(5), message: "ERROR: b1 unreachable", extra: { unreachable: ["b1"] } } };
  eq(mergeDay([], DEF.b1, ctx(st)).state, "unknown");
  for (const h of ["b2", "b3", "m1", "m2"]) eq(mergeDay([], DEF[h], ctx(st)).state, "none", h);
  eq(mergeDay([row("notion", true)], DEF.b2, ctx(st)).state, "done");
  // still fresh 2 hours later as long as runs keep succeeding (staleness = last_success_at only)
  const later = { notion: { ...st.notion, last_success_at: ago(10) } };
  eq(mergeDay([], DEF.m1, { status: later, now: NOW, date: TODAY }).state, "none");
});
Deno.test("heatmap: unreachable habit hatched only today/yesterday, other notion habits never", () => {
  const st = { notion: { last_success_at: ago(5), message: "ERROR: b1 unreachable", extra: { unreachable: ["b1"] } } };
  const rows = heatmapCells([], [DEF.b1, DEF.b2], TODAY, 12, { status: st, now: NOW });
  const b1 = rows[0].weeks.flat().filter(Boolean);
  eq(b1.filter((c) => c.state === "unknown").map((c) => c.date), ["2026-11-20", "2026-11-21"]);
  eq(rows[1].weeks.flat().filter((c) => c && c.state === "unknown").length, 0);
});
Deno.test("unreachable + collector down 3 days: older days unknown like reachable habits", () => {
  const st = { notion: { last_success_at: ago(3 * 1440), message: "ERROR: b1 unreachable", extra: { unreachable: ["b1"] } } };
  const rows = heatmapCells([], [DEF.b1, DEF.b2], TODAY, 12, { status: st, now: NOW });
  const unknownDays = (r) => r.weeks.flat().filter((c) => c && c.state === "unknown").map((c) => c.date);
  eq(unknownDays(rows[0]), ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
  eq(unknownDays(rows[0]), unknownDays(rows[1]));
});

// --- inbox drop slot ---
Deno.test("dump text: trimmed, blank is not sent", () => {
  eq(dumpText("  買牛奶  "), { ok: true, text: "買牛奶" });
  eq(dumpText(""), { ok: false, reason: "empty", length: 0 });
  eq(dumpText("   \n\t "), { ok: false, reason: "empty", length: 0 });
  eq(dumpText(null), { ok: false, reason: "empty", length: 0 });
});
Deno.test("dump text: always one line, control characters removed", () => {
  eq(dumpText("a\nb\r\n\tc"), { ok: true, text: "a b c" });
  eq(dumpText("a\u0000b\u0007c\u007Fd"), { ok: true, text: "a b c d" });
  eq(dumpText("a   b"), { ok: true, text: "a b" });
});
Deno.test("dump text: 500 characters allowed, 501 blocked (counted as characters, not UTF-16 units)", () => {
  eq(dumpText("字".repeat(500)).ok, true);
  eq(dumpText("字".repeat(501)), { ok: false, reason: "too_long", length: 501 });
  eq(dumpText("😀".repeat(500)).ok, true);
  eq(dumpText("😀".repeat(501)).reason, "too_long");
  eq(dumpText(" " + "a".repeat(500) + " ").ok, true); // limit applies after trimming
});
Deno.test("dump queue: keeps every item in order, drop removes only that item", () => {
  const t1 = new Date("2026-11-16T01:00:00Z"), t2 = new Date("2026-11-16T01:00:05Z");
  let q = dumpPut([], "a", t1);
  q = dumpPut(q, "a", t2); // same text twice is two items
  q = dumpPut(q, "b", t2);
  eq(q, [
    { text: "a", at: "2026-11-16T01:00:00.000Z" },
    { text: "a", at: "2026-11-16T01:00:05.000Z" },
    { text: "b", at: "2026-11-16T01:00:05.000Z" },
  ]);
  eq(dumpDrop(q, q[1]).map((x) => x.text + x.at.slice(17, 19)), ["a00", "b05"]);
  eq(dumpDrop(q, { text: "zzz", at: q[0].at }).length, 3);
  const before = [...q];
  dumpPut(q, "c");
  eq(q, before, "input queue not mutated");
});
Deno.test("logout warning: counts everything that would be lost", () => {
  eq(unsyncedSummary([], [], []), null);
  eq(unsyncedSummary([1], [], []), { total: 1, label: "打卡 1" });
  eq(unsyncedSummary([1, 2], [1], [1, 2, 3]), { total: 6, label: "打卡 2、Notion 寫回 1、收件匣 3" });
  eq(unsyncedSummary([], [], [1]), { total: 1, label: "收件匣 1" });
});

// --- long-press opens a habit's tool ---
Deno.test("long-press: 500ms hold without drifting", () => {
  eq(isLongPress(1000, 1499), false);
  eq(isLongPress(1000, 1500), true);
  eq(isLongPress(1000, 3000, 10), true);
  eq(isLongPress(1000, 3000, 11), false); // finger moved: a scroll, not a press
});
Deno.test("open url: https and app links only", () => {
  eq(safeOpenUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  eq(safeOpenUrl("  https://example.com  "), "https://example.com/");
  eq(safeOpenUrl("anki://"), "anki://");
  eq(safeOpenUrl("notion://www.notion.so/abc"), "notion://www.notion.so/abc");
  eq(safeOpenUrl("x-safari-https://example.com/"), "x-safari-https://example.com/");
});
Deno.test("open url: script and other schemes are refused", () => {
  for (const bad of [
    "javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>1</script>",
    "vbscript:x", "file:///etc/passwd", "blob:https://example.com/x", "http://example.com", "//example.com",
    "/relative", "example.com", "", "   ", null, undefined, 5, {},
  ]) eq(safeOpenUrl(bad), null, String(bad));
});
