-- ── Migration v6: submit scores for others (registered users + one-time guests) ─
-- Run this in Supabase SQL Editor.
--
-- 1. Adds guest_athlete_name column so a logged-in user can log a score for a
--    one-time visitor whose name shows on the leaderboard that day only.
-- 2. Updates the scores INSERT policy so any authenticated user can insert a
--    score as long as they are the "entered_by" — not just their own athlete_id.
--    This also fixes team WOD submissions for teammates.

-- Add guest_athlete_name column
alter table public.scores
  add column if not exists guest_athlete_name text default null;

-- Drop any existing insert policies (try known names)
drop policy if exists "scores: own insert" on public.scores;
drop policy if exists "scores insert" on public.scores;
drop policy if exists "Allow authenticated insert" on public.scores;
drop policy if exists "authenticated insert" on public.scores;

-- New insert policy: the logged-in user must be the one entering the score
create policy "scores: insert by entered_by"
  on public.scores for insert
  to authenticated
  with check (auth.uid() = entered_by);

-- Ensure entered_by can be set by the authenticated user
grant insert (
  athlete_id, entered_by, submitted_by, wod_date,
  is_rx, is_team, team_id, time_seconds, time_input,
  amrap_rounds, amrap_reps, amrap_input,
  guest_names, guest_athlete_name
) on public.scores to authenticated;
