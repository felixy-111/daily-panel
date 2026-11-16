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
