-- ── Migration v3: allow public (anon) read on wods, scores, profiles ─────────
-- Run this in Supabase SQL Editor.
-- This enables the leaderboard and monthly pages to load for logged-out users.

-- profiles: allow anon read
drop policy if exists "profiles: authenticated read" on public.profiles;
create policy "profiles: public read"
  on public.profiles for select
  using (true);

-- wods: allow anon read
drop policy if exists "wods: authenticated read" on public.wods;
create policy "wods: public read"
  on public.wods for select
  using (true);

-- scores: allow anon read
drop policy if exists "scores: authenticated read" on public.scores;
create policy "scores: public read"
  on public.scores for select
  using (true);
