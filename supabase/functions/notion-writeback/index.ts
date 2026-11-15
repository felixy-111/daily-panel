// notion-writeback: a PWA check-in also completes (or undoes) the Notion recurring task.
// Never log the Notion token or page content; errors carry ids only.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  adoptCandidates, adoptedRefToStore, canonicalPageId, corsHeaders, type HistorySummary, logicalDay,
  pickExistingForDay, pickNewOccurrence, trustedRef, validateRequest,
} from "./lib.ts";

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
