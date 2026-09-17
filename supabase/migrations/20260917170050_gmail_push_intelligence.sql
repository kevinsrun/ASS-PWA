-- Credentials stay in google_tokens; one watch and lease per connected identity.
create table public.gmail_watch_state (
  google_account_id uuid primary key references public.google_tokens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  watch_expiration timestamptz,
  watch_history_id text,
  last_watch_renewal timestamptz,
  last_successful_push timestamptz,
  last_successful_sync timestamptz,
  last_error text,
  last_metrics jsonb not null default '{}'::jsonb,
  worker_id uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create index gmail_watch_user_idx on public.gmail_watch_state(user_id);
create table public.gmail_processing_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_id uuid not null references public.google_tokens(id) on delete cascade,
  history_id numeric(30,0) not null check(history_id > 0),
  notification_id text not null,
  status text not null default 'pending' check(status in ('pending','completed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(google_account_id, history_id)
);
create index gmail_queue_due_idx on public.gmail_processing_queue(next_attempt_at,created_at) where status='pending';
create index gmail_queue_user_idx on public.gmail_processing_queue(user_id);
create index gmail_queue_account_idx on public.gmail_processing_queue(google_account_id);
alter table public.email_messages add column label_ids text[] not null default '{}', add column deleted_at timestamptz;
alter table public.email_suggestions add column response_confidence numeric, add column response_reason text, add column automation_labels text[] not null default '{}';
alter table public.gmail_watch_state enable row level security;
alter table public.gmail_processing_queue enable row level security;
create policy "watch owner read" on public.gmail_watch_state for select to authenticated using ((select auth.uid())=user_id);
create policy "queue owner read" on public.gmail_processing_queue for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.gmail_watch_state,public.gmail_processing_queue from anon,authenticated;
grant select on public.gmail_watch_state,public.gmail_processing_queue to authenticated;
grant all on public.gmail_watch_state,public.gmail_processing_queue to service_role;

-- Invoker only: RPCs are server-only and cannot be called by browser roles.
create function public.acquire_gmail_lease(p_user_id uuid,p_account_id uuid,p_worker_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.google_tokens where id=p_account_id and user_id=p_user_id and disconnected_at is null) then return false; end if;
  insert into public.gmail_watch_state(google_account_id,user_id,worker_id,lease_until)
  values(p_account_id,p_user_id,p_worker_id,now()+interval '10 minutes')
  on conflict(google_account_id) do update set worker_id=excluded.worker_id,lease_until=excluded.lease_until,updated_at=now()
  where public.gmail_watch_state.lease_until is null or public.gmail_watch_state.lease_until<now();
  return found;
end $$;
create function public.release_gmail_lease(p_user_id uuid,p_account_id uuid,p_worker_id uuid)
returns void language sql security invoker set search_path='' as $$
update public.gmail_watch_state set worker_id=null,lease_until=null,updated_at=now()
where google_account_id=p_account_id and user_id=p_user_id and worker_id=p_worker_id;
$$;
create function public.enqueue_gmail_push(p_email text,p_history_id text,p_notification_id text)
returns integer language plpgsql security invoker set search_path='' as $$
declare a record; n integer:=0;
begin
 if p_history_id !~ '^[0-9]{1,30}$' or p_history_id::numeric<=0 then raise exception 'Invalid history ID'; end if;
 for a in select id,user_id,gmail_history_id from public.google_tokens where lower(connected_email)=lower(p_email) and disconnected_at is null loop
   insert into public.gmail_watch_state(google_account_id,user_id,last_successful_push) values(a.id,a.user_id,now())
   on conflict(google_account_id) do update set last_successful_push=now(),updated_at=now();
   if a.gmail_history_id is null or a.gmail_history_id::numeric<p_history_id::numeric then
     insert into public.gmail_processing_queue(user_id,google_account_id,history_id,notification_id)
     values(a.user_id,a.id,p_history_id::numeric,p_notification_id) on conflict(google_account_id,history_id) do nothing;
   end if;
   n:=n+1;
 end loop;
 return n;
end $$;
create function public.complete_gmail_pushes(p_user_id uuid,p_account_id uuid)
returns void language sql security invoker set search_path='' as $$
update public.gmail_processing_queue q set status='completed',completed_at=now(),last_error=null
from public.google_tokens t where t.id=p_account_id and t.user_id=p_user_id and q.google_account_id=t.id and q.user_id=t.user_id
and t.gmail_history_id ~ '^[0-9]+$' and q.history_id<=t.gmail_history_id::numeric and q.status='pending';
$$;
revoke all on function public.acquire_gmail_lease(uuid,uuid,uuid),public.release_gmail_lease(uuid,uuid,uuid),public.enqueue_gmail_push(text,text,text),public.complete_gmail_pushes(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_gmail_lease(uuid,uuid,uuid),public.release_gmail_lease(uuid,uuid,uuid),public.enqueue_gmail_push(text,text,text),public.complete_gmail_pushes(uuid,uuid) to service_role;
