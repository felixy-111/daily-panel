import { assertEquals } from "jsr:@std/assert@1";
import {
  adoptCandidates, adoptedRefToStore, addDays, canonicalPageId, completedDay, corsHeaders, isAllowedOrigin, logicalDay,
  pickExistingForDay, pickNewOccurrence, trustedRef, validateRequest,
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
    { ...ok, value: Infinity }, { ...ok, value: -Infinity }, { ...ok, value: NaN }, { ...ok, value: -1 },
    { ...ok, value: -0.5 },
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

Deno.test("validateRequest accepts zero value", () => {
  assertEquals(validateRequest({ ...ok, value: 0 }, now).ok, true);
});

const U = "0123456789abcdef0123456789abcdef";
const UD = "01234567-89AB-CDEF-0123-456789ABCDEF";

Deno.test("canonicalPageId: only bare or dashed 32-hex, normalised", () => {
  assertEquals(canonicalPageId(U), U);
  assertEquals(canonicalPageId(UD), U);
  for (const bad of [
    "../databases/" + U, U + "/../x", U + "?filter=1", U + "#", "%2e%2e/" + U, U.slice(1), U + "0",
    "0123456789abcdef0123456789abcdeg", "01234567-89ab-cdef-0123-456789abcdef-", "0123-4567-89ab-cdef-0123456789abcdef",
    " " + U, U + "\n", "", null, undefined, 42, {}, [U],
  ]) assertEquals(canonicalPageId(bad), null, JSON.stringify(bad));
});

Deno.test("trustedRef: canonical AND a member of the original's Occurrences", () => {
  const occ = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", U];
  assertEquals(trustedRef(UD, occ), U);
  assertEquals(trustedRef("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", occ), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assertEquals(trustedRef("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", occ), null); // valid id, other page
  assertEquals(trustedRef("../databases/" + U, occ), null); // traversal even though it embeds a member
  assertEquals(trustedRef(null, occ), null);
  assertEquals(trustedRef(U, []), null);
});

Deno.test("completedDay uses the 04:00 Taipei boundary", () => {
  assertEquals(completedDay("2026-11-21T03:59:00.000+08:00"), "2026-11-20");
  assertEquals(completedDay("2026-11-21T04:00:00.000+08:00"), "2026-11-21");
  assertEquals(completedDay("2026-11-20T20:30:00.000Z"), "2026-11-21");
  assertEquals(completedDay("2026-11-21"), "2026-11-21");
  assertEquals(completedDay(null), null);
  assertEquals(completedDay("garbage"), null);
});

Deno.test("pickExistingForDay: live page on the logical day, prefers stored ref, else latest", () => {
  const pages = [
    { id: "p_old", completed: "2026-11-20T21:00:00.000+08:00", live: true },
    { id: "p_trash", completed: "2026-11-21T09:00:00.000+08:00", live: false },
    { id: "p_a", completed: "2026-11-21T08:00:00.000+08:00", live: true },
    { id: "p_b", completed: "2026-11-21T10:00:00.000+08:00", live: true },
    { id: "p_late_night", completed: "2026-11-22T02:00:00.000+08:00", live: true }, // logical 11/21
    { id: "p_nodate", completed: null, live: true },
  ];
  assertEquals(pickExistingForDay(pages, "2026-11-21"), "p_late_night");
  assertEquals(pickExistingForDay(pages, "2026-11-21", "p_a"), "p_a");
  assertEquals(pickExistingForDay(pages, "2026-11-21", "p_trash"), "p_late_night"); // trashed ref ignored
  assertEquals(pickExistingForDay(pages, "2026-11-20"), "p_old");
  assertEquals(pickExistingForDay(pages, "2026-11-19"), null);
  assertEquals(pickExistingForDay([], "2026-11-21"), null);
  assertEquals(pickExistingForDay([pages[1]], "2026-11-21", "p_trash"), null);
});

Deno.test("adoptCandidates: stored ref first, newest occurrences, no original, no dupes", () => {
  const occ = ["o1", "o2", "o3", "o4", "o5", "o6", "o7"];
  assertEquals(adoptCandidates(occ, "orig", null), ["o7", "o6", "o5", "o4", "o3"]);
  assertEquals(adoptCandidates(occ, "orig", "o2"), ["o2", "o7", "o6", "o5", "o4", "o3"]);
  assertEquals(adoptCandidates(occ, "orig", "o7", 2), ["o7", "o6"]);
  assertEquals(adoptCandidates(["orig", "o1"], "orig", null), ["o1"]);
});

Deno.test("adoptedRefToStore: only the already-trusted stored ref is kept", () => {
  const ref = "11111111-1111-1111-1111-111111111111";
  assertEquals(adoptedRefToStore(ref, ref), ref);
  assertEquals(adoptedRefToStore("11111111111111111111111111111111", ref), ref); // dash-insensitive
  assertEquals(adoptedRefToStore("22222222-2222-2222-2222-222222222222", ref), null); // Notion tick / late page
  assertEquals(adoptedRefToStore(ref, null), null);
});
