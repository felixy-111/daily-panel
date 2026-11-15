import { assertEquals } from "jsr:@std/assert@1";
import {
  addDays, corsHeaders, isAllowedOrigin, logicalDay, pickNewOccurrence, validateRequest,
} from "./lib.ts";

// 2026-11-21 02:10 Taipei = 2026-11-20 18:10Z
const at = (iso: string) => new Date(iso);

Deno.test("logicalDay: before 04:00 Taipei belongs to previous day", () => {
  assertEquals(logicalDay(at("2026-11-20T18:10:00Z")), "2026-11-20");
  assertEquals(logicalDay(at("2026-11-20T19:59:59Z")), "2026-11-20"); // 03:59:59
  assertEquals(logicalDay(at("2026-11-20T20:00:00Z")), "2026-11-21"); // 04:00
  assertEquals(logicalDay(at("2026-12-31T21:00:00Z")), "2027-01-01");
});

Deno.test("addDays crosses month/year", () => {
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
  assertEquals(addDays("2027-01-01", -1), "2026-12-31");
});

const now = at("2026-11-21T02:00:00Z"); // 10:00 Taipei -> logical 11/21
const ok = { habit_id: "m1", log_date: "2026-11-21", done: true, value: 108 };

Deno.test("validateRequest accepts today and yesterday", () => {
  assertEquals(validateRequest(ok, now).ok, true);
  assertEquals(validateRequest({ ...ok, log_date: "2026-11-20" }, now).ok, true);
  const r = validateRequest({ ...ok, value: undefined }, now);
  assertEquals(r.ok && r.req.value, null);
});

Deno.test("validateRequest rejects out-of-window dates", () => {
  assertEquals(validateRequest({ ...ok, log_date: "2026-11-19" }, now).ok, false);
  assertEquals(validateRequest({ ...ok, log_date: "2026-11-22" }, now).ok, false);
  // 02:00 Taipei on 11/22 is still logical 11/21, so 11/20 is still allowed
  assertEquals(validateRequest({ ...ok, log_date: "2026-11-20" }, at("2026-11-21T18:00:00Z")).ok, true);
});

Deno.test("validateRequest rejects bad shapes", () => {
  for (const bad of [
    null, "x", { ...ok, habit_id: "" }, { ...ok, habit_id: "A B" }, { ...ok, log_date: "2026-02-30" },
    { ...ok, log_date: "21/11/2026" }, { ...ok, done: "true" }, { ...ok, value: "5" },
    { ...ok, value: Infinity },
  ]) assertEquals(validateRequest(bad, now).ok, false, JSON.stringify(bad));
});

Deno.test("pickNewOccurrence finds the added id, dash/case-insensitive", () => {
  const before = ["aaaa-1111", "bbbb-2222"];
  assertEquals(pickNewOccurrence(before, before), null);
  assertEquals(pickNewOccurrence(before, ["AAAA1111", "bbbb-2222", "cccc-3333"]), "cccc-3333");
  assertEquals(pickNewOccurrence([], ["x1", "x2"]), "x2");
});

Deno.test("CORS origin allow-list", () => {
  assertEquals(isAllowedOrigin("https://felixy-111.github.io"), true);
  assertEquals(isAllowedOrigin("http://localhost:8080"), true);
  assertEquals(isAllowedOrigin("http://localhost"), true);
  assertEquals(isAllowedOrigin("https://evil.github.io"), false);
  assertEquals(isAllowedOrigin("http://localhost.evil.com"), false);
  assertEquals(isAllowedOrigin(null), false);
  assertEquals(corsHeaders("https://evil.com")["Access-Control-Allow-Origin"], undefined);
});
