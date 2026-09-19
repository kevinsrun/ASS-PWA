alter table public.gmail_processing_queue drop constraint if exists gmail_processing_queue_status_check;
update public.gmail_processing_queue set status='queued' where status='pending';
alter table public.gmail_processing_queue
 add column if not exists message_id text,
 add column if not exists thread_id text,
 add column if not exists started_at timestamptz,
 add column if not exists locked_at timestamptz,
 add column if not exists locked_by uuid,
 add column if not exists last_provider_status integer,
 add column if not exists attempt_history jsonb not null default '[]'::jsonb,
 add constraint gmail_processing_queue_status_check check(status in ('queued','processing','retry_wait','completed','failed','dead_letter'));
drop index if exists public.gmail_queue_due_idx;
create index gmail_queue_due_idx on public.gmail_processing_queue(next_attempt_at,created_at) where status in ('queued','retry_wait');
create index gmail_queue_health_idx on public.gmail_processing_queue(user_id,status,created_at);

create table public.ai_provider_cooldowns (
 provider text primary key,
 cooldown_until timestamptz not null,
 reason text not null,
 last_429 timestamptz,
 last_503 timestamptz,
 consecutive_failures integer not null default 1 check(consecutive_failures > 0),
 updated_at timestamptz not null default now()
);
alter table public.ai_provider_cooldowns enable row level security;
revoke all on public.ai_provider_cooldowns from anon,authenticated;
grant all on public.ai_provider_cooldowns to service_role;

create function public.claim_gmail_processing_jobs(p_limit integer,p_worker_id uuid)
returns setof public.gmail_processing_queue language plpgsql security invoker set search_path='' as $$
begin
 update public.gmail_processing_queue set status='retry_wait',locked_at=null,locked_by=null,
  next_attempt_at=now(),last_error=coalesce(last_error,'Worker lock expired')
 where status='processing' and locked_at<now()-interval '10 minutes';
 return query
 with due as (
  select q.id from public.gmail_processing_queue q
  where q.status in ('queued','retry_wait') and q.next_attempt_at<=now()
   and not exists(select 1 from public.gmail_processing_queue older where older.google_account_id=q.google_account_id and older.status in ('queued','retry_wait','processing') and (older.created_at,older.id)<(q.created_at,q.id))
  order by q.created_at,q.id for update skip locked limit greatest(1,least(p_limit,20))
 )
 update public.gmail_processing_queue q set status='processing',locked_at=now(),locked_by=p_worker_id,
  started_at=coalesce(q.started_at,now()),attempts=q.attempts+1
 from due where q.id=due.id returning q.*;
end $$;

create function public.finish_gmail_job_batch(p_user_id uuid,p_account_id uuid,p_worker_id uuid,p_status text,p_error text,p_provider_status integer,p_next_attempt_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_status not in ('retry_wait','failed','dead_letter') then raise exception 'Invalid terminal status'; end if;
 update public.gmail_processing_queue set status=p_status,last_error=left(p_error,2000),last_provider_status=p_provider_status,
  next_attempt_at=coalesce(p_next_attempt_at,next_attempt_at),locked_at=null,locked_by=null,
  completed_at=case when p_status in ('failed','dead_letter') then now() else null end,
  attempt_history=attempt_history||jsonb_build_array(jsonb_build_object('at',now(),'status',p_status,'provider_status',p_provider_status,'reason',left(p_error,500)))
 where user_id=p_user_id and google_account_id=p_account_id and status='processing' and locked_by=p_worker_id;
 get diagnostics n=row_count; return n;
end $$;

create or replace function public.complete_gmail_pushes(p_user_id uuid,p_account_id uuid)
returns void language sql security invoker set search_path='' as $$
update public.gmail_processing_queue q set status='completed',completed_at=now(),last_error=null,locked_at=null,locked_by=null
from public.google_tokens t where t.id=p_account_id and t.user_id=p_user_id and q.google_account_id=t.id and q.user_id=t.user_id
and t.gmail_history_id ~ '^[0-9]+$' and q.history_id<=t.gmail_history_id::numeric and q.status in ('queued','retry_wait','processing');
$$;

revoke all on function public.claim_gmail_processing_jobs(integer,uuid),public.finish_gmail_job_batch(uuid,uuid,uuid,text,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_gmail_processing_jobs(integer,uuid),public.finish_gmail_job_batch(uuid,uuid,uuid,text,text,integer,timestamptz) to service_role;
