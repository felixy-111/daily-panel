// GENERATED single-file bundle of index.ts + lib.ts for the Supabase dashboard editor.
// Regenerate after editing either file (see DEPLOY.md). Do not edit by hand.
// inbox-capture: one line of text from the panel becomes one page in the Notion Tasks inbox.
// Never log the Notion token or the text; logs carry status codes only.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const NOTION = Deno.env.get("NOTION_API_BASE") ?? "https://api.notion.com/v1"; // override only for local mock tests

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method not allowed" });

  // --- auth: valid user session + listed in habit_owner (same as notion-writeback)
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
  const v = validateCapture(body);
  if (!v.ok) return reply(400, { error: v.error });

  // Resolved per request: in the single-file bundle lib.ts sits below this code, so its
  // constants are not initialised yet while the module is still loading.
  const dataSource = dataSourceId(Deno.env.get("NOTION_INBOX_DATA_SOURCE_ID"));
  if (!dataSource) {
    console.error("inbox-capture: NOTION_INBOX_DATA_SOURCE_ID is not a valid id");
    return reply(500, { error: "data source misconfigured" });
  }

  // --- one Notion page, title only. The response body is discarded unread.
  let status = 0;
  try {
    const res = await fetch(NOTION + "/pages", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + NOTION_TOKEN,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(notionPage(v.text, dataSource)),
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    await res.body?.cancel();
  } catch (_e) {
    console.error("inbox-capture: notion unreachable"); // no error detail: it could quote the request
    return reply(502, { error: "notion unreachable" });
  }
  if (status < 200 || status >= 300) {
    console.error("inbox-capture: notion -> " + status);
    return reply(502, { error: "notion -> " + status });
  }
  return reply(200, { ok: true });
});

// ---- lib.ts ----
// Pure helpers for inbox-capture (no I/O) — tested by lib_test.ts.

export const MAX_CHARS = 500; // characters (code points); logic.js DUMP_MAX is the same limit
const MAX_RAW_UNITS = 4000; // refuse oversized input before doing any work on it

export type Validation = { ok: true; text: string } | { ok: false; error: string };

// Body must be { text: string }. The text becomes one line: control characters and runs of
// whitespace collapse to a single space. Error messages never echo the text.
export function validateCapture(body: unknown): Validation {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  const raw = (body as Record<string, unknown>).text;
  if (typeof raw !== "string") return { ok: false, error: "text must be a string" };
  if (raw.length > MAX_RAW_UNITS) return { ok: false, error: "text too long" };
  // deno-lint-ignore no-control-regex
  const text = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  const length = [...text].length;
  if (length === 0) return { ok: false, error: "text is empty" };
  if (length > MAX_CHARS) return { ok: false, error: "text too long" };
  return { ok: true, text };
}

const DEFAULT_DATA_SOURCE = "1e48744e-b435-815b-9c89-000b5f1672dc"; // Notion Tasks

// The data source id goes into the request we send to Notion. Unset -> default;
// set but not a UUID -> null (misconfigured, the function refuses to run).
export function dataSourceId(env: string | undefined): string | null {
  if (env === undefined || env === "") return DEFAULT_DATA_SOURCE;
  return /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(env)
    ? env.toLowerCase()
    : null;
}

// One page, title only. In this workspace a task with just a title is "To Do" with no Due,
// Project or Smart List, which is what the inbox view shows (checked 2026-11-16, see README).
export function notionPage(text: string, dataSource: string) {
  return {
    parent: { type: "data_source_id", data_source_id: dataSource },
    properties: { Name: { title: [{ text: { content: text } }] } },
  };
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
