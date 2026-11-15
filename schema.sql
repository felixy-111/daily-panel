-- ============================================================
-- Habit dashboard — Supabase tables (shares the scheduler project)
-- Usage: Supabase → SQL Editor → paste whole file → Run
-- Safe to re-run. All tables prefixed habit_ to avoid touching scheduler tables.
-- RLS: only the user listed in habit_owner can read/write.
-- Collectors use the service_role key, which bypasses RLS.
-- ============================================================

-- Who owns this dashboard (filled by seed.local.sql, not committed)
create table if not exists habit_owner (
  user_id uuid primary key
);

create table if not exists habit_defs (
  habit_id       text primary key,
  name           text not null,
  category       text not null,              -- english / mind / body
  unit           text,                       -- display unit for value
  target         numeric,                    -- daily target value (e.g. 108)
  weekly_target  integer,                    -- null = daily habit
  min_value      numeric,                    -- threshold to count as done for auto sources
  sort           integer not null default 0,
  notion_page_id text,                       -- recurring task page id; null for auto sources
  updated_at     timestamptz not null default now()
);

create table if not exists habit_logs (
  log_date   date not null,                  -- logical day (Asia/Taipei, 04:00 boundary)
  habit_id   text not null references habit_defs(habit_id),
  source     text not null check (source in ('panel','notion','shadowing','anki','meeting_coach','email_coach')),
  done       boolean not null default true,
  value      numeric,
  source_ref text,                           -- notion history page id, etc.
  updated_at timestamptz not null default now(),
  primary key (log_date, habit_id, source)
);

create table if not exists habit_source_status (
  source          text primary key,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  message         text,
  extra           jsonb not null default '{}'::jsonb
);

alter table habit_owner         enable row level security;
alter table habit_defs          enable row level security;
alter table habit_logs          enable row level security;
alter table habit_source_status enable row level security;

drop policy if exists "owner_self" on habit_owner;
create policy "owner_self" on habit_owner
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "owner_read_defs" on habit_defs;
create policy "owner_read_defs" on habit_defs
  for select to authenticated
  using (auth.uid() in (select user_id from habit_owner));

drop policy if exists "owner_all_logs" on habit_logs;
create policy "owner_all_logs" on habit_logs
  for all to authenticated
  using (auth.uid() in (select user_id from habit_owner))
  with check (auth.uid() in (select user_id from habit_owner));

drop policy if exists "owner_read_status" on habit_source_status;
create policy "owner_read_status" on habit_source_status
  for select to authenticated
  using (auth.uid() in (select user_id from habit_owner));
