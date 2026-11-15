import {
  addDays,
  applyQueue,
  canEdit,
  dayEnd,
  fmtHM,
  heatmapCells,
  indexLogs,
  isoWeekStart,
  logicalDay,
  mergeDay,
  notionError,
  queueDrop,
  queuePut,
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
