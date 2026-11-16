# MVP progress (resume point)

Plan: ~/.claude/plans/fable-dashboard-shadowing-anki-meeting-lucky-engelbart.md
Spike results + guardrails: README.md
Repo: felixy-111/daily-panel (public, GitHub Pages). Never commit .env, *.local.sql, private habit names.

Constraints decided 2026-11-16 02:35:
- No new installs (no pytest/pytest-bdd/playwright/supabase CLI). Python tests = stdlib unittest; JS pure logic tests = `deno test` (deno already installed). Feature files are spec docs.
- Habit ids: shadowing, anki, meeting, email, m1, m2, b1, b2, b3. Names only in Supabase habit_defs.
- Supabase project ref ewynrebniwbptsnpnjyd (shared with tutoring/scheduler; anon key is in tutoring/scheduler/index.html CONFIG).

## Steps
- [x] P0 spike (see README)
- [x] 1. features/*.feature (Gherkin from plan table)
- [x] 2. logic.js (pure: logical day w/ 04:00 boundary, merge, weekly progress, heatmap cells) + logic_test.js (deno test)
- [x] 3. index.html PWA (login, today grid, tap/value, offline queue, freshness banner, history heatmap) + sw.js + manifest.webmanifest
- [x] 4. collector/common.py (Supabase REST upsert w/ service_role, logical day) + collector/mac_collector.py (shadowing, meeting, anki) + tests
- [x] 5. collector/cloud_collector.py (email coach via GitHub raw/api, Notion read + Value fallback) + tests
- [x] 6. supabase/functions/notion-writeback/index.ts (+ deno test of pure parts)
- [x] 7. .github/workflows/collect.yml (every 15 min) + collector/com.felix.habit-collector.plist (NOT loaded)
- [x] 8. privacy check (grep private words in tracked files), create repo, push, enable Pages
- [x] 9. verifier pass; dev log 開發紀錄/habits/

## Needs Taiyi (awake)
（太一指示 2026-11-16：遇到需要他提供的東西就先略過、記在這裡，繼續做其他步驟，不要停下來等。）
- Supabase service_role key → `.env` (SUPABASE_SERVICE_KEY) + GitHub secret
- [done 11-16 12:11, real write-back OK] Deploy Edge Function via Supabase dashboard (paste supabase/functions/notion-writeback/index.single.ts, see DEPLOY.md) + set NOTION_TOKEN secret
- GitHub secrets: NOTION_TOKEN, SUPABASE_SERVICE_KEY, GH_TOKEN (fine-grained PAT, Contents:read on private felixy-111/daily-english-email)
- launchctl bootstrap the plist
- Install PWA on phone, login test
- [new 11-16] Deploy Edge Function `inbox-capture` via Supabase dashboard: paste supabase/functions/inbox-capture/index.single.ts (steps in notion-writeback/DEPLOY.md, lower half). NOTION_TOKEN secret is project-wide and already set — just confirm it is listed; Verify JWT on. Until deployed, drops stay on the device as 「待送 N」 and send themselves afterwards.
- [new 11-16] After deploying: drop one test line from the panel and confirm it shows up in the Ultimate Brain Inbox in Notion (API check says Smart List formula = Inbox, but the view's own filter can't be read by API), then delete it.
- [new 11-16] Supabase → SQL Editor → paste and run `seed_open_url.local.sql` (local only; it contains the `alter table habit_defs add column if not exists open_url text;` plus the 9 URLs). Until then long-press does nothing; everything else works. Edit the URLs in that file first if any is wrong (meeting currently = the shadowing site, anki = `anki://`).
- [new 11-16] On the phone: check long-press really opens the tools (anki:// needs AnkiMobile; Notion links may open in the in-app browser instead of the Notion app) and that Enter on the Chinese keyboard sends a drop.
- After secrets are set: `gh workflow enable collect.yml -R felixy-111/daily-panel` (disabled to avoid failure emails every 15 min)

## Log
- 2026-11-16 step 1: 6 feature files (today/checkin/notion/collectors/privacy/heatmap), ids only, trend chart tagged @later.
- 2026-11-16 step 4: common.py + mac_collector.py (--dry-run) + 9 unittest tests pass; dry-run vs real files OK (0 rows: logical day 11/15 < LAUNCH_DATE; anki due read OK).
- 2026-11-16 step 2: logic.js + logic_test.js, `deno test logic_test.js` 32 passed. Unknown = stale source AND last_success before that day ended (so past days a later run covered show none).
- 2026-11-16 step 5: cloud_collector.py (email issue-date rule, Notion read/health/value fallback/write-back skip/untick) + 16 tests; read-only smoke vs real GitHub+Notion OK (0 records yet).
- 2026-11-16 step 7: collect.yml (*/15, py3.12, secrets SUPABASE_SERVICE_KEY/NOTION_TOKEN/GH_TOKEN) + plist (plutil OK, NOT loaded).
- 2026-11-16 step 6: notion-writeback index.ts+lib.ts (+index.single.ts bundle, DEPLOY.md zh-TW); `deno test lib_test.ts` 7 passed, deno check OK; full flow (done/re-check/backfill/undo/re-done/timeout 502/401/400) run against local mock Supabase+Notion OK. Not deployed; real Notion untested. Occurrences read via paginated property endpoint (page object truncates relations at 25).
- 2026-11-16 step 3: index.html + sw.js (daily-panel-v1, only deletes daily-panel-* caches) + manifest + 3 PNG icons. Verified in Playwright @360x640: clean load → login only, no JS errors; with mocked Supabase: 9 cells fit without scroll, toggle/value/cancel/offline queue/write-back 404 → 「Notion 未同步」/banner names unreachable habits/history heatmap/logout clears cache. Real login untested.
- 2026-11-16 step 8: privacy grep clean (only DEPLOY.md mentions `ntn_` prefix as instructions); repo felixy-111/daily-panel public, Pages live https://felixy-111.github.io/daily-panel/ (200, no private words); collect workflow disabled until secrets exist.
- 2026-11-16 step 9 (verifier #1): REFUTED — must-fix A (duplicate Notion history/Due push), B (source_ref path traversal), C (write-back overwrites undo), D (one unreachable page → all notion cells unknown). Fix agents running (A/B/C security-executor, D executor); hit usage limit 03:5x, resumed 04:1x. Next: re-verify → commit/push → dev log.
- 2026-11-16 step 9: fixes A–D + adopt-not-stored + unreachable OR-stale + 403 drop; verifier #2 CONFIRMED A–D; suites: logic 37, lib 14, unittest 26, deno check OK; real-Notion check: Occurrences property endpoint works after single-encoding fix, order consistent across endpoints. Pushed (sw v2). Dev log written.
- 2026-11-16 09:20 scheduled round: nothing new from Taiyi (no service key, no GitHub secrets, workflow still disabled, plist not loaded). No build work left; waiting on Needs Taiyi.
- 2026-11-16 12:1x: Taiyi deployed notion-writeback; real panel tap on m2 → Notion history page Completed 12:11 Value 108 (single page), original back to To Do, Due 11-17, Value cleared. Supabase source_ref not yet checked (needs service key).
- 2026-11-16 12:40: service key in .env; GitHub secrets SUPABASE_SERVICE_KEY/NOTION_TOKEN/GH_TOKEN set (GH_TOKEN verified read 200, write 403); collect.yml enabled, manual run 43805515685 green (email 0, notion 0 — m2 skipped as panel source_ref, unreachable=[]). Supabase m2 row has source_ref 41a8744e. Remaining: launchd plist, phone PWA install.
- 2026-11-16 12:54: launchd com.felix.habit-collector bootstrapped (every 30 min + RunAtLoad); first real run exit 0, shadowing/meeting/anki OK (anki due 1619). Remaining: phone PWA install; post-launch tests; day-14 review ~2026-11-30.
- 2026-11-16 14:5x next phase (Taiyi: build now, don't wait for 11-30): (1) inbox drop slot — top-bar 「＋收件匣」 → one-line field → Enter; local queue `dp.dump`, 「待送 N」, never lists content; new Edge Function `inbox-capture` (auth copied from notion-writeback; one title-only page in Tasks; logs status codes only). T1 title prop = `Name`; T2 title-only page → Status To Do, no Due/Project/Smart List, `Smart List (Formula)` = Inbox, no extra property needed; T3 no automation fired within 40 s (test page `zz-habit-sync-test-inbox` created and trashed, 0 left). (2) logout warns in-page when dp.queue/dp.wb/dp.dump non-empty. (3) long-press ≥0.5 s opens `habit_defs.open_url` on release (https/anki/notion schemes only, no toggle); `open_url` column added to schema.sql, URLs in seed_open_url.local.sql; panel falls back when the column is missing (42703). Trend chart moved to not-doing; day-14 scoring + SQL in README. Suites: logic 45, inbox lib 10, writeback lib 14, unittest 26, deno check OK (both index.single.ts). Function run locally against mock Supabase+Notion: 401/401/403/400/400/400/405/502/502/200, log has no text. Found+fixed: bundle read a lib const before init (data source now resolved per request). Playwright @360x640 with mocks: 9 cells no scroll (slot closed and open), send/blank/too-long/offline queue/auto-resend/502 keeps text/reload keeps queue/logout warning+cancel+confirm/long-press open (https, anki://), javascript: URL ignored, null URL nothing, tap + keyboard still toggle, missing-column fallback. sw v3. NOT deployed, no DDL run. Not verified: real phone touch long-press, IME Enter, real inbox view.

- 2026-11-16 16:2x: Taiyi deployed inbox-capture (401 unauth OK) and ran seed_open_url (9 open_url set). Mac launchd runs every 30 min OK. GitHub schedule still 0 runs after enable + cron change (af21a6c, pushed 14:42); manual dispatch 43830560568 OK. If still 0 scheduled runs by 11-17 morning → fallback: Mac launchd triggers `gh workflow run` or Supabase pg_cron.
