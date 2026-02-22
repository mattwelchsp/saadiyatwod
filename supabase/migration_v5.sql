-- ── Migration v5: fix profiles update policy + ensure column grants ───────────
-- Run this in Supabase SQL Editor.
-- Fixes "column display_name can only be updated to DEFAULT" error.

-- The UPDATE policy was missing a WITH CHECK clause, which PostgreSQL/Supabase
-- requires to validate the new row values after an update.
drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Ensure authenticated users can update their own profile columns
grant update (display_name, avatar_url) on public.profiles to authenticated;
