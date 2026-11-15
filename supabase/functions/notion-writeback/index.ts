// notion-writeback: a PWA check-in also completes (or undoes) the Notion recurring task.
// Never log the Notion token or page content; errors carry ids only.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, pickNewOccurrence, validateRequest } from "./lib.ts";

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
// paginated property-item endpoint.
async function occurrences(pageId: string, propId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ page_size: "100" });
    if (cursor) q.set("start_cursor", cursor);
    const r = await notion("GET", `/pages/${pageId}/properties/${encodeURIComponent(propId)}?${q}`);
    for (const item of r.results ?? []) if (item.relation?.id) ids.push(item.relation.id);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return ids;
}

async function liveHistoryPage(id: string): Promise<boolean> {
  try {
    const p = await notion("GET", `/pages/${id}`);
    return !(p.in_trash || p.archived);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return false;
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
  const pageId: string = def.notion_page_id;

  const { data: row, error: rowErr } = await db.from("habit_logs").select("source_ref")
    .eq("log_date", log_date).eq("habit_id", habit_id).eq("source", "panel").maybeSingle();
  if (rowErr) return reply(500, { error: "log lookup failed" });
  const existingRef: string | null = row?.source_ref ?? null;

  const saveRow = async (sourceRef: string | null) => {
    const { error } = await db.from("habit_logs").upsert({
      log_date, habit_id, source: "panel", done, value, source_ref: sourceRef,
      updated_at: new Date().toISOString(),
    }, { onConflict: "log_date,habit_id,source" });
    if (error) throw new Error("log upsert failed");
  };

  try {
    if (!done) {
      if (existingRef) {
        try {
          await notion("PATCH", `/pages/${existingRef}`, { in_trash: true });
        } catch (e) {
          if ((e as { status?: number }).status !== 404) throw e; // already gone is fine
        }
      }
      await saveRow(null);
      return reply(200, { ok: true, history_id: null });
    }

    // Re-check / value edit: the history page for this day already exists.
    if (existingRef && await liveHistoryPage(existingRef)) {
      await setValue(existingRef, value);
      await saveRow(existingRef);
      return reply(200, { ok: true, history_id: existingRef });
    }

    const page = await notion("GET", `/pages/${pageId}`);
    const propId: string | undefined = page.properties?.Occurrences?.id;
    if (!propId) return reply(502, { error: `page ${pageId} has no Occurrences property` });
    const before = await occurrences(pageId, propId);

    await notion("PATCH", `/pages/${pageId}`, { properties: { Status: { status: { name: "Done" } } } });

    let historyId: string | null = null;
    for (let i = 0; i < POLL_MAX && !historyId; i++) {
      await sleep(POLL_MS);
      historyId = pickNewOccurrence(before, await occurrences(pageId, propId));
    }
    if (!historyId) {
      return reply(502, { error: `timeout waiting for Notion history page of ${pageId}` });
    }

    if (value !== null) await setValue(historyId, value);
    await setValue(pageId, null);
    await saveRow(historyId);
    return reply(200, { ok: true, history_id: historyId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("notion-writeback:", msg); // ids/status only
    return reply(e instanceof NotionError ? 502 : 500, { error: msg });
  }
});
