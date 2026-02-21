-- ============================================================
-- SaadiyatWOD – Migration v2
-- Run in Supabase SQL editor after schema.sql.
-- All statements are additive and idempotent.
-- ============================================================

-- ── profiles: add first_name, last_initial, avatar_url ───────────────────────

alter table public.profiles
  add column if not exists first_name   text,
  add column if not exists last_initial char(1),
  add column if not exists avatar_url   text;

-- ── wods: add type override, team fields ─────────────────────────────────────

alter table public.wods
  add column if not exists workout_type_override text
    check (workout_type_override in ('TIME', 'AMRAP', 'NO_SCORE')),
  add column if not exists is_team   boolean not null default false,
  add column if not exists team_size int     not null default 2;

-- ── scores: normalised storage + team_id + edit tracking ─────────────────────

-- TIME scores stored as integer seconds (e.g. 754 for 12:34)
alter table public.scores
  add column if not exists time_seconds int;

-- AMRAP scores stored as separate rounds + reps
alter table public.scores
  add column if not exists amrap_rounds int,
  add column if not exists amrap_reps   int;

-- Team grouping: members of the same team share a team_id
alter table public.scores
  add column if not exists team_id uuid;

-- Edit tracking: timestamp of last edit (null = never edited)
alter table public.scores
  add column if not exists last_edited_at timestamptz;

-- Rx is already there; ensure it exists just in case
alter table public.scores
  add column if not exists is_rx boolean not null default true;

-- ── RLS policy: allow authenticated users to update their own score ───────────

drop policy if exists "scores: own update" on public.scores;
create policy "scores: own update"
  on public.scores for update
  using (auth.uid() = athlete_id);

-- ── Storage: avatars bucket (run separately if bucket doesn't exist) ──────────
-- NOTE: Create the bucket manually in Supabase dashboard:
--   Storage → New bucket → name: "avatars" → toggle Public → Create
--
-- Then run these storage policies:

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars: authenticated upload" on storage.objects;
create policy "avatars: authenticated upload"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

drop policy if exists "avatars: own update" on storage.objects;
create policy "avatars: own update"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
