-- Blocky League accounts: optimistic concurrency and sanity caps on saves, profiles, Game Center and device
-- links, referrals, and a small rate limiter for the edge functions (supabase/functions). Run after
-- 0001_saves.sql. Safe to re-run.
--
-- Who writes what:
--   saves, profiles     the signed-in player, through row level security (their own row only)
--   gc_links,
--   device_links,
--   referrals,
--   rate_limits         the edge functions only (service role); players can read their own links and referrals

-- ---------------------------------------------------------------- saves: revision, guard, sanity caps

alter table public.saves add column if not exists rev bigint not null default 1;

comment on column public.saves.rev is
  'Optimistic concurrency: a client sends the rev it last saw; a write from a stale copy is refused (PT409 stale_save).';

-- One trigger for every write: the save must be a JSON object, coins and gems (when present) stay inside sane
-- bounds, a stale revision is refused, and rev / updated_at are the server's own (clients cannot set them).
-- The document is otherwise opaque: the game owns its shape.
create or replace function public.saves_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(new.data) is distinct from 'object' then
    raise exception 'bad_save' using errcode = 'PT400', detail = 'The save must be a JSON object.';
  end if;
  foreach k in array array['coins', 'gems'] loop
    v := new.data -> k;
    if jsonb_typeof(v) = 'number' and ((v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1000000000) then
      raise exception 'bad_save' using errcode = 'PT400', detail = format('%s is out of range.', k);
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    -- An upsert that names no rev keeps the old one (it passes); one that names a stale rev is refused.
    if new.rev is distinct from old.rev then
      raise exception 'stale_save' using errcode = 'PT409',
        detail = 'The cloud save moved on. Fetch it and decide again.', hint = old.rev::text;
    end if;
    new.rev := old.rev + 1;
  else
    new.rev := greatest(coalesce(new.rev, 1), 1);
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.saves_guard() from public, anon, authenticated;

drop trigger if exists saves_touch on public.saves;
drop trigger if exists saves_guard on public.saves;
create trigger saves_guard
  before insert or update on public.saves
  for each row execute function public.saves_guard();
drop function if exists public.saves_touch();

-- ---------------------------------------------------------------- profiles

-- A friend code: 7 characters, no 0 / O / 1 / I look-alikes.
create or replace function public.new_referral_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 7)
$$;

revoke all on function public.new_referral_code() from public, anon;
grant execute on function public.new_referral_code() to authenticated, service_role;

create table if not exists public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  -- Player-chosen text only: no real name, no email, no Game Center alias.
  display_name  text not null default 'Player' check (char_length(display_name) between 1 and 24),
  club_name     text check (club_name is null or char_length(club_name) <= 32),
  referral_code text not null unique default public.new_referral_code() check (referral_code ~ '^[A-HJ-NP-Z2-9]{7}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'Blocky League: one row per player. A display name, the club name and the friend code.';

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;

create policy "profiles: read own"   on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "profiles: insert own" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "profiles: update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Column grants: a player sets only the two names. The friend code and the dates are the server's.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (user_id, display_name, club_name) on public.profiles to authenticated;
grant update (display_name, club_name, updated_at) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- The caller's profile, made on first use; `p_club` (when given) is stored as the club name. Runs as the
-- caller, so row level security applies.
create or replace function public.my_profile(p_club text default null)
returns public.profiles
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  club text := nullif(left(btrim(coalesce(p_club, '')), 32), '');
  prof public.profiles;
begin
  if uid is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  insert into public.profiles (user_id, club_name) values (uid, club) on conflict (user_id) do nothing;
  if club is not null then
    update public.profiles set club_name = club, updated_at = now()
      where user_id = uid and club_name is distinct from club;
  end if;
  select * into prof from public.profiles where user_id = uid;
  return prof;
end
$$;

revoke all on function public.my_profile(text) from public, anon;
grant execute on function public.my_profile(text) to authenticated;

-- ---------------------------------------------------------------- Game Center and device links

create table if not exists public.gc_links (
  -- GKLocalPlayer.teamPlayerID: an opaque id scoped to this developer team (not the player's name or alias).
  team_player_id text primary key check (char_length(team_player_id) between 1 and 128),
  user_id        uuid not null unique references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now()
);

comment on table public.gc_links is 'Blocky League: Game Center player to account. Written by the gc-login edge function.';

alter table public.gc_links enable row level security;
drop policy if exists "gc_links: read own" on public.gc_links;
create policy "gc_links: read own" on public.gc_links for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.gc_links from anon, authenticated;
grant select on public.gc_links to authenticated;
grant all on public.gc_links to service_role;

create table if not exists public.device_links (
  -- SHA-256 of the random secret a device keeps. The secret itself is never stored.
  secret_hash  text primary key check (secret_hash ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_links_user_id_idx on public.device_links (user_id);

comment on table public.device_links is 'Blocky League: device secret (hashed) to account. Written by the login edge functions.';

alter table public.device_links enable row level security;
drop policy if exists "device_links: no client access" on public.device_links;
create policy "device_links: no client access" on public.device_links for all to anon, authenticated
  using (false) with check (false);
revoke all on public.device_links from anon, authenticated;
grant all on public.device_links to service_role;

-- ---------------------------------------------------------------- referrals

create table if not exists public.referrals (
  id                    bigint generated always as identity primary key,
  referrer              uuid not null references auth.users (id) on delete cascade,
  -- One friend code per new player, ever.
  referee               uuid not null unique references auth.users (id) on delete cascade,
  coins                 integer not null default 100 check (coins between 0 and 1000),
  referrer_collected_at timestamptz,
  referee_collected_at  timestamptz,
  created_at            timestamptz not null default now(),
  constraint referrals_not_self check (referrer <> referee)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer);

comment on table public.referrals is 'Blocky League: a friend code used. Written by the referral edge function; both players collect once.';

alter table public.referrals enable row level security;
drop policy if exists "referrals: read own" on public.referrals;
create policy "referrals: read own" on public.referrals for select to authenticated
  using ((select auth.uid()) in (referrer, referee));
revoke all on public.referrals from anon, authenticated;
grant select on public.referrals to authenticated;
grant all on public.referrals to service_role;

-- ---------------------------------------------------------------- rate limiter (edge functions)

create table if not exists public.rate_limits (
  -- '<action>:<hash of the caller's address>': never a raw address.
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

alter table public.rate_limits enable row level security;
drop policy if exists "rate_limits: no client access" on public.rate_limits;
create policy "rate_limits: no client access" on public.rate_limits for all to anon, authenticated
  using (false) with check (false);
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Count one hit in `p_bucket`; false once the bucket holds more than `p_limit` hits inside the window.
create or replace function public.rate_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  h integer;
  edge timestamptz := now() - make_interval(secs => p_window_seconds);
begin
  insert into public.rate_limits as r (bucket, window_start, hits) values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case when r.window_start < edge then 1 else r.hits + 1 end,
    window_start = case when r.window_start < edge then now() else r.window_start end
  returning r.hits into h;
  -- Old buckets are swept now and then, so the table stays small.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return h <= p_limit;
end
$$;

revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------- saves: explicit grants (0001 set the policies)

grant all on public.saves to service_role;
