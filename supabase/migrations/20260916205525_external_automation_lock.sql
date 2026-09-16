-- Atomic lease and persistent hourly idempotency; only server service_role may use it.
create table public.sync_locks (
  job_name text primary key,
  locked_at timestamptz not null,
  expires_at timestamptz not null,
  run_id uuid not null,
  last_slot text
);
alter table public.sync_locks enable row level security;
revoke all on public.sync_locks from public, anon, authenticated;
grant select, insert, update on public.sync_locks to service_role;

create function public.acquire_intelligence_lock(p_run_id uuid, p_slot text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.sync_locks(job_name, locked_at, expires_at, run_id, last_slot)
  values ('intelligence_sync', now(), now() + interval '15 minutes', p_run_id, p_slot)
  on conflict (job_name) do update
    set locked_at = excluded.locked_at, expires_at = excluded.expires_at,
        run_id = excluded.run_id, last_slot = excluded.last_slot
    where public.sync_locks.expires_at <= now()
      and (p_slot is null or public.sync_locks.last_slot is distinct from p_slot
        or not exists (select 1 from public.intelligence_sync_runs r
          where r.id = public.sync_locks.run_id and r.status in ('completed','partial')));
  return found;
end; $$;

create function public.release_intelligence_lock(p_run_id uuid, p_retryable boolean default false)
returns void language sql security invoker set search_path = '' as $$
  update public.sync_locks set expires_at = now(),
    last_slot = case when p_retryable then null else last_slot end
  where job_name = 'intelligence_sync' and run_id = p_run_id;
$$;
revoke all on function public.acquire_intelligence_lock(uuid,text) from public, anon, authenticated;
revoke all on function public.release_intelligence_lock(uuid,boolean) from public, anon, authenticated;
grant execute on function public.acquire_intelligence_lock(uuid,text) to service_role;
grant execute on function public.release_intelligence_lock(uuid,boolean) to service_role;
