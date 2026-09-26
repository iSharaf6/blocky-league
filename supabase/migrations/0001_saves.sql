-- Blocky League cloud saves: one row per signed-in user holding the save JSON as-is.
-- Run once in the project's SQL editor (or `supabase db push`). Safe to re-run.

create table if not exists public.saves (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  data              jsonb not null,
  version           int not null default 1,
  -- The pushing client's save.updatedAt (what the game compares); updated_at is the server's own clock.
  client_updated_at timestamptz,
  updated_at        timestamptz not null default now(),
  -- A save is a few KB; 256 KB leaves room for growth and stops abuse.
  constraint saves_data_size check (pg_column_size(data) < 262144)
);

comment on table public.saves is 'Blocky League: one save per user (the localStorage blob, unchanged).';

-- Keep updated_at honest on every write (clients cannot set it).
create or replace function public.saves_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists saves_touch on public.saves;
create trigger saves_touch
  before insert or update on public.saves
  for each row execute function public.saves_touch();

-- Row level security: a user (including anonymous "guest" users) sees and writes only their own row.
alter table public.saves enable row level security;

drop policy if exists "saves: read own"   on public.saves;
drop policy if exists "saves: insert own" on public.saves;
drop policy if exists "saves: update own" on public.saves;
drop policy if exists "saves: delete own" on public.saves;

create policy "saves: read own"   on public.saves for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "saves: insert own" on public.saves for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "saves: update own" on public.saves for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saves: delete own" on public.saves for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.saves from anon;
grant select, insert, update, delete on public.saves to authenticated;
