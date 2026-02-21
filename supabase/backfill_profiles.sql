-- ============================================================
-- SaadiyatWOD – one-time profile backfill
--
-- Run this in the Supabase SQL editor if you had users sign up
-- before the handle_new_user trigger was created.
-- Safe to re-run (ON CONFLICT DO NOTHING).
-- ============================================================

insert into public.profiles (id, display_name, created_at)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    split_part(u.email, '@', 1)
  ) as display_name,
  u.created_at
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;
