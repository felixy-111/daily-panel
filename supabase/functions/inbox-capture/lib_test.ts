import { assertEquals } from "jsr:@std/assert@1";
import {
  corsHeaders, dataSourceId, isAllowedOrigin, MAX_CHARS, notionPage, validateCapture,
} from "./lib.ts";
import { dumpText, DUMP_MAX } from "../../../logic.js";

Deno.test("validateCapture: accepts one line of text, trimmed", () => {
  assertEquals(validateCapture({ text: "  買牛奶  " }), { ok: true, text: "買牛奶" });
  assertEquals(validateCapture({ text: "a", extra: 1 }), { ok: true, text: "a" }); // extra fields ignored
});

Deno.test("validateCapture: newlines and control characters become one space", () => {
  assertEquals(validateCapture({ text: "a\nb\r\n\tc" }), { ok: true, text: "a b c" });
  assertEquals(validateCapture({ text: "a\u0000b\u0007c\u007Fd" }), { ok: true, text: "a b c d" });
});

Deno.test("validateCapture: blank is rejected", () => {
  for (const text of ["", "   ", "\n\t", "\u0000"]) {
    assertEquals(validateCapture({ text }), { ok: false, error: "text is empty" });
  }
});

Deno.test("validateCapture: 500 characters allowed, 501 rejected, huge input rejected early", () => {
  assertEquals(validateCapture({ text: "字".repeat(500) }).ok, true);
  assertEquals(validateCapture({ text: "😀".repeat(500) }).ok, true); // 1000 UTF-16 units, 500 characters
  assertEquals(validateCapture({ text: "字".repeat(501) }), { ok: false, error: "text too long" });
  assertEquals(validateCapture({ text: " ".repeat(4001) }), { ok: false, error: "text too long" });
  assertEquals(validateCapture({ text: "a".repeat(1_000_000) }), { ok: false, error: "text too long" });
});

Deno.test("validateCapture: wrong shapes are rejected", () => {
  for (const body of [null, undefined, "text", 5, [], {}, { text: 5 }, { text: null }, { text: ["a"] }, { text: { a: 1 } }]) {
    assertEquals(validateCapture(body).ok, false, JSON.stringify(body));
  }
});

Deno.test("validateCapture: error messages never echo the text", () => {
  const secret = "SECRET-" + "x".repeat(600);
  const r = validateCapture({ text: secret });
  assertEquals(r.ok, false);
  assertEquals(JSON.stringify(r).includes("SECRET"), false);
});

Deno.test("validateCapture agrees with the panel's dumpText", () => {
  assertEquals(MAX_CHARS, DUMP_MAX);
  for (const t of ["", "  ", "a", " a\nb ", "字".repeat(500), "字".repeat(501), "😀".repeat(500), "a\u0000b"]) {
    const panel = dumpText(t), fn = validateCapture({ text: t });
    assertEquals(fn.ok, panel.ok, JSON.stringify(t.slice(0, 10)));
    if (fn.ok && panel.ok) assertEquals(fn.text, panel.text);
  }
});

Deno.test("dataSourceId: default when unset, null when malformed", () => {
  assertEquals(dataSourceId(undefined), "1e48744e-b435-815b-9c89-000b5f1672dc");
  assertEquals(dataSourceId(""), "1e48744e-b435-815b-9c89-000b5f1672dc");
  assertEquals(dataSourceId("AAAAAAAA-1111-2222-3333-444444444444"), "aaaaaaaa-1111-2222-3333-444444444444");
  assertEquals(dataSourceId("aaaaaaaa111122223333444444444444"), "aaaaaaaa111122223333444444444444");
  for (const bad of ["abc", "../pages", "1e48744e-b435-815b-9c89-000b5f1672dc/x", " 1e48744e-b435-815b-9c89-000b5f1672dc"]) {
    assertEquals(dataSourceId(bad), null, bad);
  }
});

Deno.test("notionPage: title only, into the given data source", () => {
  assertEquals(notionPage("買牛奶", "ds-1"), {
    parent: { type: "data_source_id", data_source_id: "ds-1" },
    properties: { Name: { title: [{ text: { content: "買牛奶" } }] } },
  });
  assertEquals(Object.keys(notionPage("x", "ds-1").properties), ["Name"]);
});

Deno.test("CORS: only the panel origin and localhost", () => {
  assertEquals(isAllowedOrigin("https://felixy-111.github.io"), true);
  assertEquals(isAllowedOrigin("http://localhost:8123"), true);
  assertEquals(isAllowedOrigin("https://felixy-111.github.io.evil.com"), false);
  assertEquals(isAllowedOrigin("https://evil.com"), false);
  assertEquals(isAllowedOrigin(null), false);
  assertEquals(corsHeaders("https://evil.com")["Access-Control-Allow-Origin"], undefined);
  assertEquals(corsHeaders("https://felixy-111.github.io")["Access-Control-Allow-Origin"], "https://felixy-111.github.io");
});
