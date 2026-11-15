# Habit dashboard

## Guardrails (read first)
- Time cap: Phase 0 spike ≤ half a session; MVP ≤ 4 sessions. Over budget → cut scope, don't extend.
- Day-14 review after launch: opened < 10 of 14 days → freeze, no new features.
- One in, one out. Max two screens (Today, History). No settings page.
- Not doing: push reminders, notes field, backfill beyond yesterday, multi-user, custom-habit UI, export.
- Public repo: no private habit names in code, commits, screenshots or Actions logs. Names live in `habit_defs` only.

Full plan: `~/.claude/plans/fable-dashboard-shadowing-anki-meeting-lucky-engelbart.md`

## Phase 0 spike results (2026-11-16)
| # | Question | Result |
|---|---|---|
| S1 | Token can query Tasks data source | OK (Notion-Version 2025-09-03, `/data_sources/{id}/query`) |
| S2 | History page links back to original | Yes — `Occurrences` relation is two-way; history page's `Occurrences` = original task id |
| S3 | Completed format | ISO datetime with +08:00 offset, minute precision (e.g. `2026-11-16T02:30:00.000+08:00`) |
| S4 | Due after one completion | Due today → tomorrow (+1). Overdue tasks untested; irrelevant since we never use Due |
| S5 | Simple + Advanced both on? | No — Due moved by exactly 1 day, single history page |
| S6 | Paid plan? | Unknown; not needed (we don't edit automations) |
| S7 | API `Status=Done` triggers automation | **Yes** → write-back uses main path: set Value + Status=Done, Notion does the rest |
| S8 | Email Coach issue date | No issue date stored. One prompt/day sent at 07:xx; grading runs hourly at :20, so a grade before 08:00 belongs to the previous day's prompt. Rule: `issue_date = date(completed_at − 8h)` |
| S9 | Public sign-up on shared Supabase | Disabled (2026-11-16) |
| S10 | Value copied to history page | **No** — Value stays on the original task. Fallback: collector moves Value from original to the new history page, then clears the original |
| S11 | Edge Function | Supabase CLI not installed; deploy via dashboard editor (no install). Deno available locally for tests |

### Consequences
- Write-back (panel → Notion): PATCH original task `{Value, Status: Done}`, then poll original `Occurrences` for the newest history page → store as `source_ref`, write `Value` onto it, clear original `Value`.
- Notion read: query `Status=Done AND Completed on/after (today−2)`, keep pages whose `Occurrences` contains a whitelisted habit page id.
- Value fallback must run before the user's next check-in; a stale original Value is only moved onto a history page created after the Value was last edited.

## Setup done
- Supabase (shared scheduler project): `schema.sql` + `seed.local.sql` (local only) applied; owners=1, habits=9.
- Notion internal integration `habit-sync` (read/update/insert), Tasks shared, `Value` number property added.
