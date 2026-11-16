// inbox-capture: one line of text from the panel becomes one page in the Notion Tasks inbox.
// Never log the Notion token or the text; logs carry status codes only.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  corsHeaders, dataSourceId, notionPage, validateCapture,
} from "./lib.ts";

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
