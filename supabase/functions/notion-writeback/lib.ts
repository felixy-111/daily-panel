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
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    return { ok: false, error: "value must be a number or null" };
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
