-- ── Migration v4: guest partner names on team scores ─────────────────────────
-- Run this in Supabase SQL Editor.
-- Stores unregistered partner names alongside each registered member's score row.

alter table public.scores
  add column if not exists guest_names text[] not null default '{}';
