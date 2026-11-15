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
- Deploy Edge Function via Supabase dashboard (paste supabase/functions/notion-writeback/index.single.ts, see DEPLOY.md) + set NOTION_TOKEN secret
- GitHub secrets: NOTION_TOKEN, SUPABASE_SERVICE_KEY, GH_TOKEN (fine-grained PAT, Contents:read on private felixy-111/daily-english-email)
- launchctl bootstrap the plist
- Install PWA on phone, login test
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
