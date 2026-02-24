-- Allow guest scores (no linked profile) by making athlete_id nullable.
-- guest_athlete_name (added in v6) stores the display name for these rows.

alter table public.scores alter column athlete_id drop not null;

-- The existing FK constraint is fine — it just now allows NULL, which
-- Postgres treats as "no reference required".
