alter table public.model_training_preferences add column retention_days integer not null default 90 check(retention_days in (30,90,180,365) or retention_days=-1);
alter table public.model_training_examples
 add column source_type text,
 add column source_id text,
 add column active boolean not null default true,
 add column updated_at timestamptz not null default now();
update public.model_training_examples set source_type=coalesce(context_json->>'source_type','legacy'),source_id=source_key;
alter table public.model_training_examples alter column source_type set not null,alter column source_id set not null;
alter table public.model_training_examples drop constraint if exists model_training_examples_user_id_source_key_key;
create unique index model_training_examples_active_identity on public.model_training_examples(user_id,source_type,source_id,task_type) where active;

create table public.model_training_example_revisions (
 id uuid primary key default gen_random_uuid(),example_id uuid not null references public.model_training_examples(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,previous_label jsonb,previous_prediction jsonb,
 changed_at timestamptz not null default now()
);
create index model_training_revisions_owner_idx on public.model_training_example_revisions(user_id,changed_at);
alter table public.model_training_example_revisions enable row level security;
revoke all on public.model_training_example_revisions from anon,authenticated;
grant all on public.model_training_example_revisions to service_role;

create table public.model_training_purge_runs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 retention_days integer not null,rows_deleted integer not null,run_timestamp timestamptz not null default now()
);
alter table public.model_training_purge_runs enable row level security;
revoke all on public.model_training_purge_runs from anon,authenticated;
grant all on public.model_training_purge_runs to service_role;

create function public.collect_model_training_correction(p_user_id uuid,p_source_type text,p_source_id text,p_task_type text,p_input_text text,p_context_json jsonb,p_model_prediction jsonb,p_model_confidence double precision,p_final_label jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare pref public.model_training_preferences%rowtype; current public.model_training_examples%rowtype; result_id uuid;
begin
 select * into pref from public.model_training_preferences where user_id=p_user_id for update;
 if not found or not pref.enabled then raise exception 'Training collection consent is disabled' using errcode='42501'; end if;
 select * into current from public.model_training_examples where user_id=p_user_id and source_type=p_source_type and source_id=p_source_id and task_type=p_task_type and active for update;
 if found then
  if current.final_label is distinct from p_final_label or current.model_prediction is distinct from p_model_prediction then
   insert into public.model_training_example_revisions(example_id,user_id,previous_label,previous_prediction) values(current.id,p_user_id,current.final_label,current.model_prediction);
  end if;
  update public.model_training_examples set input_text=left(p_input_text,50000),context_json=coalesce(p_context_json,'{}'),model_prediction=p_model_prediction,
   model_confidence=p_model_confidence,final_label=p_final_label,correction_source='USER_CORRECTION',quality='needs_review',updated_at=now()
  where id=current.id returning id into result_id;
 else
  insert into public.model_training_examples(user_id,source_type,source_id,source_key,task_type,input_text,context_json,model_prediction,model_confidence,final_label,correction_source)
  values(p_user_id,p_source_type,p_source_id,pg_catalog.md5(p_user_id::text||':'||p_source_type||':'||p_source_id||':'||p_task_type),p_task_type,left(p_input_text,50000),coalesce(p_context_json,'{}'),p_model_prediction,p_model_confidence,p_final_label,'USER_CORRECTION') returning id into result_id;
 end if;
 return result_id;
end $$;

create function public.purge_expired_model_training_examples(p_user_id uuid default null)
returns table(owner_id uuid,policy_days integer,deleted_count bigint) language plpgsql security invoker set search_path='' as $$
begin
 return query with targets as (select p.user_id,p.retention_days from public.model_training_preferences p where (p_user_id is null or p.user_id=p_user_id) and p.retention_days<>-1 and not exists(select 1 from public.model_training_purge_runs r where r.user_id=p.user_id and r.run_timestamp>now()-interval '23 hours')),
 deleted as (delete from public.model_training_examples e using targets t where e.user_id=t.user_id and e.created_at<now()-make_interval(days=>t.retention_days) returning e.user_id),
 totals as (select t.user_id,t.retention_days,count(d.user_id)::bigint rows_deleted from targets t left join deleted d on d.user_id=t.user_id group by t.user_id,t.retention_days),
 logged as (insert into public.model_training_purge_runs(user_id,retention_days,rows_deleted) select totals.user_id,totals.retention_days,totals.rows_deleted::integer from totals returning user_id,retention_days,rows_deleted)
 select logged.user_id,logged.retention_days,logged.rows_deleted::bigint from logged;
end $$;
revoke all on function public.collect_model_training_correction(uuid,text,text,text,text,jsonb,jsonb,double precision,jsonb),public.purge_expired_model_training_examples(uuid) from public,anon,authenticated;
grant execute on function public.collect_model_training_correction(uuid,text,text,text,text,jsonb,jsonb,double precision,jsonb),public.purge_expired_model_training_examples(uuid) to service_role;
