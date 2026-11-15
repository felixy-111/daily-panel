// Pure helpers for notion-writeback (no I/O) — tested by lib_test.ts.

const TPE_OFFSET_H = 8;
const DAY_BOUNDARY_H = 4; // a logical day runs 04:00 -> 04:00 Taipei time

export function logicalDay(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + (TPE_OFFSET_H - DAY_BOUNDARY_H) * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface WritebackRequest {
  habit_id: string;
  log_date: string;
  done: boolean;
  value: number | null;
}

export type Validation = { ok: true; req: WritebackRequest } | { ok: false; error: string };

// Shape + date-window check. Whitelisting habit_id against habit_defs happens in index.ts.
export function validateRequest(body: unknown, now: Date = new Date()): Validation {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.habit_id !== "string" || !/^[a-z0-9_]{1,32}$/.test(b.habit_id)) {
    return { ok: false, error: "invalid habit_id" };
  }
  if (typeof b.log_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.log_date) ||
      isNaN(Date.parse(b.log_date + "T00:00:00Z")) ||
      new Date(b.log_date + "T00:00:00Z").toISOString().slice(0, 10) !== b.log_date) {
    return { ok: false, error: "invalid log_date" };
  }
  if (typeof b.done !== "boolean") return { ok: false, error: "done must be boolean" };
  const value = b.value === undefined ? null : b.value;
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    return { ok: false, error: "value must be a non-negative number or null" };
  }
  const today = logicalDay(now);
  if (b.log_date !== today && b.log_date !== addDays(today, -1)) {
    return { ok: false, error: "log_date must be today or yesterday" };
  }
  return { ok: true, req: { habit_id: b.habit_id, log_date: b.log_date, done: b.done, value } };
}

export function normId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

// A Notion page id we are willing to put into a URL: 32 hex digits, either bare or in
// 8-4-4-4-12 form. Returns the bare lowercase form, or null for anything else
// (path traversal, query strings, other separators, wrong length).
export function canonicalPageId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!/^[0-9a-fA-F]{32}$/.test(raw) &&
      !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw)) {
    return null;
  }
  return normId(raw);
}

// habit_logs.source_ref is owner-writable, so it is only trusted when it is a canonical id
// AND one of the whitelisted original task's Occurrences (fetched from Notion server-side).
export function trustedRef(raw: unknown, occurrences: string[]): string | null {
  const id = canonicalPageId(raw);
  if (!id) return null;
  return occurrences.some((o) => canonicalPageId(o) === id) ? id : null;
}

// Logical day of a Notion `Completed` date (ISO datetime with offset, or a bare date).
export function completedDay(start: string | null | undefined): string | null {
  if (!start) return null;
  if (!start.includes("T")) return /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null;
  const t = Date.parse(start);
  return isNaN(t) ? null : logicalDay(new Date(t));
}

export interface HistorySummary {
  id: string;
  completed: string | null; // Completed.date.start
  live: boolean; // false when in_trash / archived / 404
}

// The history page that already records `logDate`, if any: live and completed on that
// logical day. Prefers `preferId` (the stored source_ref), else the latest Completed.
export function pickExistingForDay(
  pages: HistorySummary[], logDate: string, preferId: string | null = null,
): string | null {
  const hits = pages.filter((p) => p.live && completedDay(p.completed) === logDate);
  if (!hits.length) return null;
  if (preferId) {
    const pref = hits.find((p) => normId(p.id) === normId(preferId));
    if (pref) return pref.id;
  }
  hits.sort((a, b) => Date.parse(a.completed!) - Date.parse(b.completed!));
  return hits[hits.length - 1].id;
}

// Occurrences the adopt check looks at: the newest few (Notion appends new relations at
// the end — the same assumption pickNewOccurrence makes), plus the stored ref, minus the
// original itself. Ids are already canonical.
export function adoptCandidates(occurrences: string[], originalId: string, ref: string | null, n = 5): string[] {
  const orig = normId(originalId);
  const out: string[] = [];
  for (const id of [...(ref ? [ref] : []), ...occurrences.slice(-n).reverse()]) {
    if (normId(id) !== orig && !out.some((o) => normId(o) === normId(id))) out.push(id);
  }
  return out;
}

// Which page an adopted (pre-existing) history page lets the panel row remember.
// Only the already-trusted stored ref survives; any other pre-existing page may be one
// the user ticked in Notion, and panel undo must never trash that.
export function adoptedRefToStore(existing: string, ref: string | null): string | null {
  return ref && normId(existing) === normId(ref) ? ref : null;
}

// The history page Notion created = an id in `after` that wasn't in `before`.
// If several appeared (shouldn't happen), take the last one listed.
export function pickNewOccurrence(before: string[], after: string[]): string | null {
  const seen = new Set(before.map(normId));
  const fresh = after.filter((id) => !seen.has(normId(id)));
  return fresh.length ? fresh[fresh.length - 1] : null;
}

const ALLOWED_ORIGIN = "https://felixy-111.github.io";

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return origin === ALLOWED_ORIGIN || /^http:\/\/localhost(:\d{1,5})?$/.test(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
  if (isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin!;
  return h;
}
