-- Generous friend rewards with durable delivery. Deploy the protocol-2 gated Edge Function first.
-- Apply this entire migration in one transaction (as Supabase migrations do).
-- Existing paid referrals stay paid. Existing unpaid coins keep their original value.
alter table public.referrals add column if not exists gems integer not null default 0 check (gems between 0 and 50);
alter table public.referrals alter column coins set default 1000;

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id bigint references public.referrals(id) on delete set null,
  kind text not null check (kind in ('inviter', 'welcome')),
  user_id uuid not null references auth.users(id) on delete cascade,
  coins integer not null check (coins between 0 and 1000),
  gems integer not null check (gems between 0 and 50),
  created_at timestamptz not null default now(),
  unique (referral_id, user_id)
);
create index if not exists referral_rewards_user_idx on public.referral_rewards(user_id);
comment on table public.referral_rewards is 'Blocky League: immutable reward receipts, replayable after dropped responses. Client stores receipt IDs atomically with its wallet; service role only.';
alter table public.referral_rewards enable row level security;
revoke all on public.referral_rewards from public, anon, authenticated;
grant all on public.referral_rewards to service_role;

-- Transfer legacy obligations atomically. A legacy collector either got its coins before this lock, or
-- sees consumed flags after it. Paid sides retain zero-value history so later account deletion cannot reset caps.
lock table public.referrals in access exclusive mode;
insert into public.referral_rewards (referral_id, user_id, kind, coins, gems)
select id, referrer, 'inviter', case when referrer_collected_at is null then coins else 0 end, gems
from public.referrals on conflict (referral_id, user_id) do nothing;
insert into public.referral_rewards (referral_id, user_id, kind, coins, gems)
select id, referee, 'welcome', case when referee_collected_at is null then coins else 0 end, gems
from public.referrals on conflict (referral_id, user_id) do nothing;
update public.referrals set referrer_collected_at = coalesce(referrer_collected_at, now()),
  referee_collected_at = coalesce(referee_collected_at, now());

-- Even a legacy claim already in flight during rollout gets a durable receipt; legacy collectors cannot consume it.
create or replace function public.issue_referral_rewards()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.referral_rewards(referral_id, user_id, kind, coins, gems)
  values (new.id, new.referrer, 'inviter', new.coins, new.gems), (new.id, new.referee, 'welcome', new.coins, new.gems);
  update public.referrals set referrer_collected_at = coalesce(referrer_collected_at, now()),
    referee_collected_at = coalesce(referee_collected_at, now()) where id = new.id;
  return new;
end;
$$;
revoke all on function public.issue_referral_rewards() from public, anon, authenticated;
drop trigger if exists issue_referral_rewards on public.referrals;
create trigger issue_referral_rewards after insert on public.referrals for each row execute function public.issue_referral_rewards();

-- Only the verified Edge Function may invoke this. p_user comes from auth.getUser(token), never a request body.
create or replace function public.claim_referral_reward(p_user uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  existing_owner uuid;
  created timestamptz;
  win_text text;
  friend_count integer;
begin
  if p_code !~ '^[A-HJ-NP-Z2-9]{7}$' then return jsonb_build_object('error', 'unknown_code'); end if;
  select user_id into owner_id from public.profiles where referral_code = p_code;
  if owner_id is null then return jsonb_build_object('error', 'unknown_code'); end if;
  if owner_id = p_user then return jsonb_build_object('error', 'own_code'); end if;

  -- A common owner is locked for all incoming referrals; both players are locked for reciprocal claims.
  -- Sorting the locks prevents A->B and B->A from deadlocking. Hash collisions only serialize extra work.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(p_user::text, owner_id::text), 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(p_user::text, owner_id::text), 0));
  select referrer into existing_owner from public.referrals where referee = p_user;
  if existing_owner is not null then
    if existing_owner = owner_id then return jsonb_build_object('ok', true, 'existing', true); end if;
    return jsonb_build_object('error', 'already_used');
  end if;
  if exists(select 1 from public.referral_rewards where user_id = p_user and kind = 'welcome') then
    return jsonb_build_object('error', 'already_used');
  end if;
  if exists(select 1 from public.referrals where referrer = p_user and referee = owner_id) then
    return jsonb_build_object('error', 'own_code');
  end if;
  select created_at into created from auth.users where id = p_user;
  if created is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if created < now() - interval '30 days' then return jsonb_build_object('error', 'too_late'); end if;
  select data #>> '{record,won}' into win_text from public.saves where user_id = p_user;
  if win_text is null or win_text !~ '^[0-9]+$' then return jsonb_build_object('error', 'win_first'); end if;
  if win_text::numeric < 1 then return jsonb_build_object('error', 'win_first'); end if;
  select count(*) into friend_count from public.referral_rewards where user_id = owner_id and kind = 'inviter';
  if friend_count >= 20 then return jsonb_build_object('error', 'friend_full'); end if;

  insert into public.referrals(referrer, referee, coins, gems)
  values(owner_id, p_user, 1000, 50);
  return jsonb_build_object('ok', true, 'coins', 1000, 'gems', 50);
end;
$$;
revoke all on function public.claim_referral_reward(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_referral_reward(uuid, text) to service_role;
