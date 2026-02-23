-- ── Migration v7: attendance tracking for streak counter ─────────────────────
-- Run in Supabase SQL Editor.
--
-- Creates an attendance table so users can log "I went" on NO_SCORE days
-- (EMOMs, strength, skill work) without needing a numeric score.
-- Score submissions automatically count as attendance (handled in app code).

create table if not exists public.attendance (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  wod_date   date not null,
  primary key (athlete_id, wod_date)
);

alter table public.attendance enable row level security;

-- Anyone can read attendance (for streak display)
create policy "attendance: public read"
  on public.attendance for select
  using (true);

-- Authenticated users can only insert their own attendance
create policy "attendance: own insert"
  on public.attendance for insert
  to authenticated
  with check (auth.uid() = athlete_id);

-- Allow deleting own attendance (in case of mis-click)
create policy "attendance: own delete"
  on public.attendance for delete
  to authenticated
  using (auth.uid() = athlete_id);

grant insert (athlete_id, wod_date) on public.attendance to authenticated;
grant delete on public.attendance to authenticated;
grant select on public.attendance to anon, authenticated;
