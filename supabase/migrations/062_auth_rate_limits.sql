-- 062: Shared auth rate limiting (audit fix H2)
--
-- ⚠️  DEPLOYMENT ORDER — READ BEFORE MERGING
--   Apply THIS migration to the Supabase project BEFORE the rate-limiter
--   code ships. Vercel previews share the same Supabase project, so 062
--   must exist before a preview can be tested. The limiter is fail-closed
--   by design: if `check_rate_limit` is missing, sign-in /
--   forgot-password / MFA-verify return 503 → full authentication outage.
--
-- Design:
--   * one row per bucket (fixed window), key = `${window}:${scope}:${id}`
--   * check-and-increment is a SINGLE atomic upsert
--     (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`): the conflict
--     arbiter's row lock serializes concurrent bursts — no
--     select-then-insert race
--   * SECURITY DEFINER with pinned search_path (rule from 061): fully
--     qualified names only, `search_path = ''` (strictest pinning)
--   * RLS ON with ZERO policies + explicit REVOKEs: anon/authenticated can
--     never touch the table; access only via the RPC, which only
--     service_role may EXECUTE
--   * window expiry via expires_at + index; 1% of RPC calls opportunistically
--     purge expired rows so the table cannot grow unbounded

create table if not exists public.auth_rate_limits (
  bucket_key        text        primary key,
  hits              integer     not null default 0,
  window_started_at timestamptz not null default now(),
  expires_at        timestamptz not null
);

create index if not exists auth_rate_limits_expires_at_idx
  on public.auth_rate_limits (expires_at);

alter table public.auth_rate_limits enable row level security;

revoke all on table public.auth_rate_limits from public;
revoke all on table public.auth_rate_limits from anon;
revoke all on table public.auth_rate_limits from authenticated;

create or replace function public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := now();
  v_hits    integer;
  v_expires timestamptz;
begin
  -- Single atomic statement: increment + window rotation in one upsert.
  -- hits saturate at p_limit + 1 so over-limit hammering cannot inflate
  -- the counter without bound.
  insert into public.auth_rate_limits as r (bucket_key, hits, window_started_at, expires_at)
  values (
    p_key,
    1,
    v_now,
    v_now + make_interval(secs => p_window_seconds)
  )
  on conflict (bucket_key) do update
    set hits = case
          when r.expires_at <= v_now then 1
          else least(r.hits + 1, p_limit + 1)
        end,
        window_started_at = case
          when r.expires_at <= v_now then v_now
          else r.window_started_at
        end,
        expires_at = case
          when r.expires_at <= v_now then v_now + make_interval(secs => p_window_seconds)
          else r.expires_at
        end
  returning r.hits, r.expires_at
  into v_hits, v_expires;

  -- Opportunistic, index-backed purge of long-expired rows (1% of calls).
  if random() < 0.01 then
    delete from public.auth_rate_limits
    where expires_at < v_now - interval '1 hour';
  end if;

  return query
    select v_hits <= p_limit,
           greatest(p_limit - v_hits, 0),
           v_expires;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
revoke all on function public.check_rate_limit(text, integer, integer) from anon;
revoke all on function public.check_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
