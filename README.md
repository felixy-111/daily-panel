# Habit dashboard

## Guardrails (read first)
- Time cap: Phase 0 spike ≤ half a session; MVP ≤ 4 sessions. Over budget → cut scope, don't extend.
- Day-14 review after launch: used < 10 of 14 days → freeze, no new features. Scoring: see "Day-14 review" below.
- One in, one out. Max two screens (Today, History). No settings page.
  - In (2026-11-16): inbox drop slot. Out: trend chart (was the one reserved extension slot).
- The inbox drop slot is a mail slot, not a mailbox: one line of text goes straight to the Notion Tasks inbox. The panel does not store, list or organise it.
- Not doing: push reminders, notes field, backfill beyond yesterday, multi-user, custom-habit UI, export.
- Not doing (added 2026-11-16): trend chart; a to-do list inside the panel (lists, check-off, categories, due dates, priority); a separate table for dumped text; showing what was sent or counting it; a "tidy the inbox" habit cell; open-tracking for the day-14 score; voice input; AI auto-categorising.
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

## Day-14 review (2026-11-30)
Decided 2026-11-16. Launch day = 2026-11-16, so the 14 days are 2026-11-16 … 2026-11-29.

- **Days used** = number of distinct logical days in that window with at least one panel check-in row (`source = 'panel'`). Auto sources (shadowing, anki, …) and Notion ticks do not count: they prove the habit happened, not that the panel was used. A check-in that was later undone still counts (the row stays, `done = false`): the panel was opened and used that day.
- Inbox drops are not part of the score.
- No open-tracking is added for this; the check-in rows are the only evidence.

Run in Supabase → SQL Editor:

```sql
select count(distinct log_date) as days_used
from habit_logs
where source = 'panel'
  and log_date between '2026-11-16' and '2026-11-29';
```

| Result | Action |
|---|---|
| `days_used` ≥ 10 | pass; next feature may be considered (one per 14 days) |
| `days_used` < 10 | freeze: no new features, review again 2026-12-14 |

Also at the review: Notion tick entry used 0 times → remove the Notion read; inbox drop slot used < 5 times in its first two weeks → remove it (check 2026-12-14; count the tasks created by the `habit-sync` integration in Notion, the panel keeps no count).

## Inbox drop slot (2026-11-16)
Panel → Edge Function `inbox-capture` → one page in the Notion Tasks data source, title only. Offline or failing sends wait in `localStorage` (`dp.dump`) and retry on the next sync; the panel only shows 「待送 N」. An occasional duplicate after a timeout is accepted. Deploy: `supabase/functions/notion-writeback/DEPLOY.md`.

Pre-checks against real Notion (test page `zz-habit-sync-test-inbox`, trashed afterwards):

| # | Question | Result |
|---|---|---|
| T1 | Title property name | `Name` |
| T2 | Does a title-only task land in the inbox? | A page created with only `Name` gets Status `To Do`, Priority `Medium` (defaults), no Due / Project / Smart List / Snooze, and the template's `Smart List (Formula)` evaluates to `Inbox`. No extra property is needed. The Inbox view's own filter is not readable through the API, so one look in Notion after the first real drop is still needed. |
| T3 | Does creating a page trigger an automation? | No change to any property 40 s after creation, no extra pages (the recurring-task automation only reacts to Status = Done). |

## Long-press opens a tool (2026-11-16)
Hold a cell ≥ 0.5 s and release → opens `habit_defs.open_url` instead of checking in. URLs are private and live only in Supabase (`seed_open_url.local.sql`, not committed). The panel only opens `https:` links and the app links `anki:` / `notion:`; anything else is ignored. A cell without a URL does nothing on long-press. The panel still works when the `open_url` column has not been added yet.

