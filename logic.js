// Pure logic for the daily panel. No DOM, no network — tested by logic_test.js (deno test).
// Habits are referred to by id only; display names come from habit_defs after login.

const HOUR = 3600 * 1000;
const TAIPEI_OFFSET = 8 * HOUR;
const DAY_BOUNDARY_HOURS = 4; // a logical day runs 04:00 → 04:00 Taipei time

export const AUTO_SOURCE = {
  shadowing: "shadowing",
  anki: "anki",
  meeting: "meeting_coach",
  email: "email_coach",
};
export const VALUE_HABITS = ["m2", "b1", "b2", "b3"];
// minutes after last_success_at before a source counts as stale
export const STALE_MINUTES = {
  shadowing: 90,
  anki: 90,
  meeting_coach: 90,
  email_coach: 180,
  notion: 60,
};

const pad = (n) => String(n).padStart(2, "0");
const ymdUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function logicalDay(date = new Date()) {
  return ymdUTC(new Date(date.getTime() + TAIPEI_OFFSET - DAY_BOUNDARY_HOURS * HOUR));
}

export function addDays(ymd, n) {
  return ymdUTC(new Date(parseYmd(ymd) + n * 24 * HOUR));
}

// Monday of the ISO week containing ymd
export function isoWeekStart(ymd) {
  const dow = new Date(parseYmd(ymd)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

// The instant a logical day ends (next day 04:00 Taipei)
export function dayEnd(ymd) {
  return new Date(parseYmd(ymd) + 24 * HOUR + DAY_BOUNDARY_HOURS * HOUR - TAIPEI_OFFSET);
}

export function fmtHM(iso) {
  if (!iso) return "--:--";
  const d = new Date(new Date(iso).getTime() + TAIPEI_OFFSET);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function canEdit(ymd, today) {
  return ymd === today || ymd === addDays(today, -1);
}

export function needsValue(habitId) {
  return VALUE_HABITS.includes(habitId);
}

export function sourceFor(def) {
  return AUTO_SOURCE[def.habit_id] || "notion";
}

export function isStale(statusRow, source, now) {
  if (!statusRow || !statusRow.last_success_at) return true;
  return now.getTime() - new Date(statusRow.last_success_at).getTime() > STALE_MINUTES[source] * 60 * 1000;
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function rowDone(row, def) {
  if (!row.done) return false;
  if (row.source === "panel" || row.source === "notion") return true;
  if (def.min_value === null || def.min_value === undefined) return true;
  const v = num(row.value);
  return v !== null && v >= Number(def.min_value);
}

// rows: all habit_logs rows for one habit on one logical day.
// ctx (optional): { status: {source: habit_source_status row}, now: Date, date: 'YYYY-MM-DD' }
export function mergeDay(rows, def, ctx = {}) {
  const panel = rows.find((r) => r.source === "panel");
  const notion = rows.find((r) => r.source === "notion");
  const autos = rows.filter((r) => r.source !== "panel" && r.source !== "notion");
  const doneRows = rows.filter((r) => rowDone(r, def));
  const sources = doneRows.map((r) => r.source);
  const notionDone = !!(notion && notion.done);
  const panelDone = !!(panel && panel.done);
  const doneByOther = doneRows.some((r) => r.source !== "panel");

  let value = null;
  if (panelDone && num(panel.value) !== null) value = num(panel.value);
  if (value === null) {
    const a = autos.find((r) => num(r.value) !== null);
    if (a) value = num(a.value);
  }
  if (value === null && notionDone && num(notion.value) !== null) value = num(notion.value);
  const target = num(def.target);
  if (value === null && notionDone && target !== null) value = target;

  let state = "none";
  if (doneRows.length) {
    state = target !== null && value !== null && value < target && !doneByOther ? "partial" : "done";
  }

  const src = sourceFor(def);
  const st = ctx.status ? ctx.status[src] : undefined;
  if (state === "none" && ctx.status && ctx.now && ctx.date) {
    const unreachable = !!(st && st.extra && Array.isArray(st.extra.unreachable) && st.extra.unreachable.includes(def.habit_id));
    const stale = unreachable || isStale(st, src, ctx.now);
    const lastOk = st && st.last_success_at ? new Date(st.last_success_at) : null;
    const dayUnchecked = !lastOk || lastOk < dayEnd(ctx.date);
    const eligible = src === "notion" ? !panel : true;
    if (stale && dayUnchecked && eligible) state = "unknown";
  }

  return {
    state,
    value,
    sources,
    notionDone,
    panelDone,
    hasPanelRow: !!panel,
    lastSuccess: st ? st.last_success_at || null : null,
  };
}

const key = (date, habitId) => `${date}|${habitId}`;

export function indexLogs(logs) {
  const m = new Map();
  for (const r of logs) {
    const k = key(r.log_date, r.habit_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export function dayState(index, def, date, ctx = {}) {
  return mergeDay(index.get(key(date, def.habit_id)) || [], def, { ...ctx, date });
}

export function weeklyProgress(logs, def, today) {
  if (!def.weekly_target) return null;
  const index = logs instanceof Map ? logs : indexLogs(logs);
  const start = isoWeekStart(today);
  let done = 0;
  for (let i = 0; i < 7; i++) {
    if (dayState(index, def, addDays(start, i)).state === "done") done++;
  }
  return { done, target: def.weekly_target, label: `本週 ${done}/${def.weekly_target}` };
}

// One row per habit; each row = `weeks` columns (Mon–Sun), cells after endDate are null.
export function heatmapCells(logs, defs, endDate, weeks = 12, ctx = {}) {
  const index = logs instanceof Map ? logs : indexLogs(logs);
  const start = addDays(isoWeekStart(endDate), -7 * (weeks - 1));
  const sorted = [...defs].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return sorted.map((def) => {
    const cols = [];
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, w * 7 + d);
        col.push(date > endDate ? null : { date, state: dayState(index, def, date, ctx).state });
      }
      cols.push(col);
    }
    return { habit_id: def.habit_id, weeks: cols };
  });
}

// Parse the inline number input → panel row fields
export function valueEdit(input) {
  const s = String(input ?? "").trim();
  if (s === "") return { done: false, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n === 0 ? { done: false, value: null } : { done: true, value: n };
}

// Offline queue: one pending item per (log_date, habit_id); the later write wins.
export function queuePut(queue, item) {
  return [...queue.filter((q) => key(q.log_date, q.habit_id) !== key(item.log_date, item.habit_id)), item];
}

export function queueDrop(queue, item) {
  return queue.filter(
    (q) => !(key(q.log_date, q.habit_id) === key(item.log_date, item.habit_id) && q.updated_at === item.updated_at),
  );
}

// Overlay pending panel writes on top of fetched logs (optimistic view)
export function applyQueue(logs, queue) {
  const pending = new Set(queue.map((q) => key(q.log_date, q.habit_id)));
  return [
    ...logs.filter((r) => !(r.source === "panel" && pending.has(key(r.log_date, r.habit_id)))),
    ...queue.map((q) => ({ ...q, source: "panel" })),
  ];
}

export function notionError(statusRows) {
  const n = (statusRows || []).find((s) => s.source === "notion");
  return n && typeof n.message === "string" && n.message.startsWith("ERROR") ? n.message : null;
}
