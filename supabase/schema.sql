-- ============================================================
-- SaadiyatWOD – Supabase schema
-- Run this in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/vsnjzwhkhjqatqapjgmi/sql
-- Safe to re-run (all statements are idempotent).
-- ============================================================


-- ── Extensions ───────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";


-- ── profiles ─────────────────────────────────────────────────────────────────
-- One row per auth.users entry.  Created automatically on sign-up (see trigger).

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  avatar_path   text,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone who is authenticated can read all profiles (needed for leaderboard).
create policy if not exists "profiles: authenticated read"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Users can update only their own profile.
create policy if not exists "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);

-- The trigger function (below) inserts profiles – it runs as SECURITY DEFINER
-- so we don't need an insert policy for normal users.


-- ── wods ─────────────────────────────────────────────────────────────────────
-- One row per calendar day.  wod_text is the raw text pasted by the coach.

create table if not exists public.wods (
  wod_date  date primary key,
  wod_text  text not null,
  created_at timestamptz not null default now()
);

alter table public.wods enable row level security;

-- All authenticated users can read WODs.
create policy if not exists "wods: authenticated read"
  on public.wods for select
  using (auth.role() = 'authenticated');

-- Only authenticated users can insert/update WODs.
-- Tighten this to a specific role/uid once you add a coach role.
create policy if not exists "wods: authenticated insert"
  on public.wods for insert
  with check (auth.role() = 'authenticated');

create policy if not exists "wods: authenticated update"
  on public.wods for update
  using (auth.role() = 'authenticated');


-- ── scores ───────────────────────────────────────────────────────────────────
-- One row per athlete per WOD day.
-- athlete_id  = who did the workout
-- entered_by  = who typed the score (coach can enter on behalf of athlete)

create table if not exists public.scores (
  id           uuid primary key default uuid_generate_v4(),
  wod_date     date not null references public.wods (wod_date) on delete cascade,
  athlete_id   uuid not null references public.profiles (id) on delete cascade,
  entered_by   uuid not null references public.profiles (id) on delete cascade,
  time_input   text,    -- "MM:SS" for time-based WODs
  amrap_input  text,    -- "rounds+reps" or plain reps for AMRAP WODs
  is_rx        boolean not null default true,
  is_team      boolean not null default false,
  created_at   timestamptz not null default now(),

  -- Prevent duplicate scores for the same athlete on the same day
  unique (wod_date, athlete_id)
);

alter table public.scores enable row level security;

-- All authenticated users can read scores (leaderboard is public within the gym).
create policy if not exists "scores: authenticated read"
  on public.scores for select
  using (auth.role() = 'authenticated');

-- Any authenticated user can insert a score.
-- The application sets entered_by = auth.uid() so we can always trace who entered it.
create policy if not exists "scores: authenticated insert"
  on public.scores for insert
  with check (auth.role() = 'authenticated');

-- Athletes can update their own score; coaches can update any (relax once roles exist).
create policy if not exists "scores: own update"
  on public.scores for update
  using (auth.role() = 'authenticated');


-- ── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists scores_wod_date_idx on public.scores (wod_date);
create index if not exists scores_athlete_id_idx on public.scores (athlete_id);


-- ── Auto-create profile on sign-up ───────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Drop and recreate the trigger so this script is idempotent.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
