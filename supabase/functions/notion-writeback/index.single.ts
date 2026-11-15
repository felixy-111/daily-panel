// GENERATED single-file bundle of index.ts + lib.ts for the Supabase dashboard editor.
// Regenerate after editing either file (see DEPLOY.md). Do not edit by hand.
// notion-writeback: a PWA check-in also completes (or undoes) the Notion recurring task.
// Never log the Notion token or page content; errors carry ids only.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const NOTION = Deno.env.get("NOTION_API_BASE") ?? "https://api.notion.com/v1"; // override only for local mock tests
const POLL_MS = 2000;
const POLL_MAX = 10; // ~20s

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";

class NotionError extends Error {}

// deno-lint-ignore no-explicit-any
type Json = any;

async function notion(method: string, path: string, body?: unknown): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(NOTION + path, {
      method,
      headers: {
        "Authorization": "Bearer " + NOTION_TOKEN,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (_e) {
    throw new NotionError(`notion ${method} ${path.split("?")[0]} unreachable`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw Object.assign(new NotionError(`notion ${method} ${path.split("?")[0]} -> ${res.status}`), {
      status: res.status,
    });
  }
  return await res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The page object truncates relations at 25 items, so read Occurrences via the
// paginated property-item endpoint. Only canonical ids are returned (they end up in URLs).
async function occurrences(pageId: string, propId: string): Promise<string[]> {
  // Notion property ids come back already percent-encoded ("%3AUPp"); normalise so the
  // segment is encoded exactly once whatever form we got.
  let seg: string;
  try {
    seg = encodeURIComponent(decodeURIComponent(propId));
  } catch {
    seg = encodeURIComponent(propId);
  }
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ page_size: "100" });
    if (cursor) q.set("start_cursor", cursor);
    const r = await notion("GET", `/pages/${pageId}/properties/${seg}?${q}`);
    for (const item of r.results ?? []) {
      const id = canonicalPageId(item.relation?.id);
      if (id) ids.push(id);
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return ids;
}

// id must come from canonicalPageId().
async function historySummary(id: string): Promise<HistorySummary> {
  try {
    const p = await notion("GET", `/pages/${id}`);
    return {
      id,
      completed: p.properties?.Completed?.date?.start ?? null,
      live: !(p.in_trash || p.archived),
    };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return { id, completed: null, live: false };
    throw e;
  }
}

const setValue = (id: string, value: number | null) =>
  notion("PATCH", `/pages/${id}`, { properties: { Value: { number: value } } });

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method not allowed" });

  // --- auth: valid user session + listed in habit_owner
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "missing bearer token" });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return reply(401, { error: "invalid session" });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: owner, error: ownerErr } = await db.from("habit_owner").select("user_id")
    .eq("user_id", userData.user.id).maybeSingle();
  if (ownerErr) return reply(500, { error: "owner lookup failed" });
  if (!owner) return reply(403, { error: "not the owner" });

  // --- input
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "invalid JSON" });
  }
  const v = validateRequest(body);
  if (!v.ok) return reply(400, { error: v.error });
  const { habit_id, log_date, done, value } = v.req;

  const { data: def, error: defErr } = await db.from("habit_defs").select("notion_page_id")
    .eq("habit_id", habit_id).maybeSingle();
  if (defErr) return reply(500, { error: "habit lookup failed" });
  if (!def?.notion_page_id) return reply(400, { error: "habit has no Notion page" });
  const pageId = canonicalPageId(def.notion_page_id);
  if (!pageId) return reply(500, { error: `habit ${habit_id} has a malformed notion_page_id` });

  const { data: row, error: rowErr } = await db.from("habit_logs").select("source_ref")
    .eq("log_date", log_date).eq("habit_id", habit_id).eq("source", "panel").maybeSingle();
  if (rowErr) return reply(500, { error: "log lookup failed" });

  // The PWA owns done/value/updated_at of its row; this function only records which
  // Notion page belongs to it. No row -> nothing to record.
  const saveRef = async (sourceRef: string | null) => {
    const { error } = await db.from("habit_logs").update({ source_ref: sourceRef })
      .eq("log_date", log_date).eq("habit_id", habit_id).eq("source", "panel");
    if (error) throw new Error("log update failed");
  };

  try {
    const page = await notion("GET", `/pages/${pageId}`);
    const propId: string | undefined = page.properties?.Occurrences?.id;
    if (!propId) return reply(502, { error: `page ${pageId} has no Occurrences property` });
    const occ = await occurrences(pageId, propId);
    // Untrusted column: dropped unless it is one of this habit's own history pages.
    const ref = trustedRef(row?.source_ref, occ);

    const summaries = async (ids: string[]) => {
      const out: HistorySummary[] = [];
      for (const id of ids) out.push(await historySummary(id));
      return out;
    };

    if (!done) {
      const target = ref ? pickExistingForDay(await summaries([ref]), log_date, ref) : null;
      if (target) {
        try {
          await notion("PATCH", `/pages/${target}`, { in_trash: true });
        } catch (e) {
          if ((e as { status?: number }).status !== 404) throw e; // already gone is fine
        }
      }
      await saveRef(null);
      return reply(200, { ok: true, history_id: null });
    }

    // Already recorded for this day (stored ref, or ticked in Notion, or a late page from a
    // timed-out earlier attempt): adopt it instead of completing the task again.
    const existing = pickExistingForDay(await summaries(adoptCandidates(occ, pageId, ref)), log_date, ref);
    // Only a page this function itself created is stored as source_ref; an adopted one is
    // treated like a Notion tick, so panel undo leaves it alone (collector keeps it done).
    if (existing) {
      if (value !== null) await setValue(existing, value);
      const keep = adoptedRefToStore(existing, ref);
      await saveRef(keep);
      return reply(200, { ok: true, history_id: existing, adopted: !keep });
    }

    // Completing now would stamp Completed=today and push Due; the panel row alone records it.
    if (log_date !== logicalDay()) return reply(200, { ok: true, history_id: null, skipped: "backfill" });

    // Status still Done = the automation hasn't reset yet; completing again would duplicate.
    if (page.properties?.Status?.status?.name !== "Done") {
      await notion("PATCH", `/pages/${pageId}`, { properties: { Status: { status: { name: "Done" } } } });
    }

    let historyId: string | null = null;
    for (let i = 0; i < POLL_MAX && !historyId; i++) {
      await sleep(POLL_MS);
      historyId = pickNewOccurrence(occ, await occurrences(pageId, propId));
    }
    if (!historyId) {
      return reply(502, { error: `timeout waiting for Notion history page of ${pageId}` });
    }

    if (value !== null) await setValue(historyId, value);
    await setValue(pageId, null);
    await saveRef(historyId);
    return reply(200, { ok: true, history_id: historyId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("notion-writeback:", msg); // ids/status only
    return reply(e instanceof NotionError ? 502 : 500, { error: msg });
  }
});

// ---- lib.ts ----
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
