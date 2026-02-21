-- ============================================================
-- SaadiyatWOD – Supabase schema
-- Run this in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/vsnjzwhkhjqatqapjgmi/sql
-- Safe to re-run (all statements are idempotent).
-- ============================================================


-- ── Extensions ───────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";


-- ── profiles ─────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  avatar_path   text,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: authenticated read" on public.profiles;
create policy "profiles: authenticated read"
  on public.profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);


-- ── wods ─────────────────────────────────────────────────────────────────────

create table if not exists public.wods (
  wod_date   date primary key,
  wod_text   text not null,
  created_at timestamptz not null default now()
);

alter table public.wods enable row level security;

drop policy if exists "wods: authenticated read" on public.wods;
create policy "wods: authenticated read"
  on public.wods for select
  using (auth.role() = 'authenticated');

drop policy if exists "wods: authenticated insert" on public.wods;
create policy "wods: authenticated insert"
  on public.wods for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "wods: authenticated update" on public.wods;
create policy "wods: authenticated update"
  on public.wods for update
  using (auth.role() = 'authenticated');


-- ── scores ───────────────────────────────────────────────────────────────────

create table if not exists public.scores (
  id           uuid primary key default uuid_generate_v4(),
  wod_date     date not null references public.wods (wod_date) on delete cascade,
  athlete_id   uuid not null references public.profiles (id) on delete cascade,
  entered_by   uuid not null references public.profiles (id) on delete cascade,
  time_input   text,
  amrap_input  text,
  is_rx        boolean not null default true,
  is_team      boolean not null default false,
  created_at   timestamptz not null default now(),

  unique (wod_date, athlete_id)
);

alter table public.scores enable row level security;

drop policy if exists "scores: authenticated read" on public.scores;
create policy "scores: authenticated read"
  on public.scores for select
  using (auth.role() = 'authenticated');

drop policy if exists "scores: authenticated insert" on public.scores;
create policy "scores: authenticated insert"
  on public.scores for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "scores: own update" on public.scores;
create policy "scores: own update"
  on public.scores for update
  using (auth.role() = 'authenticated');


-- ── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists scores_wod_date_idx  on public.scores (wod_date);
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

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
