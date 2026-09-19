alter table public.model_training_examples
 add column source_hash text,
 add column trust_source text,
 add column trust_score double precision,
 add column curation_status text not null default 'proposed',
 add column contains_sensitive_data boolean not null default false,
 add column difficulty_score double precision not null default 0,
 add column disagreement_score double precision not null default 0,
 add column correction_count integer not null default 0,
 add column error_category text,
 add column approved boolean generated always as (quality='approved') stored;

update public.model_training_examples set
 source_hash=pg_catalog.md5(user_id::text||':'||source_type||':'||source_id||':'||task_type),
 trust_source=case correction_source
  when 'USER_CORRECTION' then 'USER_CORRECTION'
  when 'DETERMINISTIC_VALIDATION' then 'DETERMINISTIC_VERIFIED'
  when 'SYSTEM_VERIFIED' then 'DETERMINISTIC_VERIFIED'
  when 'GEMINI_VERIFIED' then 'STRONG_MODEL_REVIEWED'
  when 'GEMINI_PSEUDO_LABEL' then 'STRONG_MODEL_PSEUDO_LABEL'
  else 'LOCAL_MODEL_PREDICTION' end,
 trust_score=case correction_source
  when 'USER_CORRECTION' then 1.0 when 'DETERMINISTIC_VALIDATION' then 1.0 when 'SYSTEM_VERIFIED' then 1.0
  when 'GEMINI_VERIFIED' then 0.95 when 'GEMINI_PSEUDO_LABEL' then 0.80 else 0.20 end,
 curation_status=case quality when 'approved' then 'eligible' when 'rejected' then 'rejected' else 'proposed' end;

alter table public.model_training_examples
 alter column source_hash set not null,
 alter column trust_source set not null,
 alter column trust_score set not null,
 add constraint model_training_examples_trust_source_check check(trust_source in ('USER_CORRECTION','DETERMINISTIC_VERIFIED','STRONG_MODEL_REVIEWED','STRONG_MODEL_PSEUDO_LABEL','LOCAL_MODEL_REVIEWED','LOCAL_MODEL_PREDICTION')),
 add constraint model_training_examples_trust_score_check check(trust_score between 0 and 1),
 add constraint model_training_examples_curation_status_check check(curation_status in ('proposed','critic_approved','eligible','rejected','conflict','superseded')),
 add constraint model_training_examples_difficulty_check check(difficulty_score between 0 and 1 and disagreement_score between 0 and 1),
 add constraint model_training_examples_correction_count_check check(correction_count>=0);
create index model_training_examples_eligible_idx on public.model_training_examples(user_id,task_type,trust_score desc,created_at) where active and quality='approved' and curation_status='eligible';
create index model_training_examples_source_hash_idx on public.model_training_examples(user_id,source_hash);

create or replace function public.collect_model_training_correction(p_user_id uuid,p_source_type text,p_source_id text,p_task_type text,p_input_text text,p_context_json jsonb,p_model_prediction jsonb,p_model_confidence double precision,p_final_label jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare pref public.model_training_preferences%rowtype; current public.model_training_examples%rowtype; result_id uuid; stable_hash text;
begin
 select * into pref from public.model_training_preferences where user_id=p_user_id for update;
 if not found or not pref.enabled then raise exception 'Training collection consent is disabled' using errcode='42501'; end if;
 stable_hash:=pg_catalog.md5(p_user_id::text||':'||p_source_type||':'||p_source_id||':'||p_task_type);
 select * into current from public.model_training_examples where user_id=p_user_id and source_type=p_source_type and source_id=p_source_id and task_type=p_task_type and active for update;
 if found then
  if current.final_label is distinct from p_final_label or current.model_prediction is distinct from p_model_prediction then
   insert into public.model_training_example_revisions(example_id,user_id,previous_label,previous_prediction) values(current.id,p_user_id,current.final_label,current.model_prediction);
  end if;
  update public.model_training_examples set input_text=left(p_input_text,50000),context_json=coalesce(p_context_json,'{}'),model_prediction=p_model_prediction,
   model_confidence=p_model_confidence,final_label=p_final_label,correction_source='USER_CORRECTION',quality='needs_review',source_hash=stable_hash,
   trust_source='USER_CORRECTION',trust_score=1.0,curation_status='proposed',correction_count=correction_count+1,updated_at=now()
  where id=current.id returning id into result_id;
 else
  insert into public.model_training_examples(user_id,source_type,source_id,source_key,source_hash,task_type,input_text,context_json,model_prediction,model_confidence,final_label,correction_source,trust_source,trust_score,curation_status,correction_count)
  values(p_user_id,p_source_type,p_source_id,stable_hash,stable_hash,p_task_type,left(p_input_text,50000),coalesce(p_context_json,'{}'),p_model_prediction,p_model_confidence,p_final_label,'USER_CORRECTION','USER_CORRECTION',1.0,'proposed',1) returning id into result_id;
 end if;
 return result_id;
end $$;

create table public.model_dataset_versions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 name text not null,version integer not null check(version>0),content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 trust_threshold double precision not null check(trust_threshold between 0 and 1),example_count integer not null check(example_count>=0),
 train_count integer not null check(train_count>=0),validation_count integer not null check(validation_count>=0),test_count integer not null check(test_count>=0),
 manifest jsonb not null,created_at timestamptz not null default now(),sealed_at timestamptz not null default now(),invalidated_at timestamptz,invalidation_reason text,
 unique(user_id,name,version),unique(user_id,content_hash)
);
create table public.model_dataset_examples (
 dataset_id uuid not null references public.model_dataset_versions(id) on delete cascade,
 example_id uuid not null references public.model_training_examples(id) on delete cascade,
 split text not null check(split in ('train','validation','test')),source_hash text not null,
 primary key(dataset_id,example_id)
);
create index model_dataset_examples_example_idx on public.model_dataset_examples(example_id);
create index model_dataset_examples_split_idx on public.model_dataset_examples(dataset_id,split);

create function public.invalidate_datasets_for_deleted_training_example()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.model_dataset_versions d set invalidated_at=coalesce(d.invalidated_at,now()),invalidation_reason=coalesce(d.invalidation_reason,'Source training data deleted')
 where exists(select 1 from public.model_dataset_examples x where x.dataset_id=d.id and x.example_id=old.id);
 return old;
end $$;
create trigger model_training_example_dataset_invalidation before delete on public.model_training_examples for each row execute function public.invalidate_datasets_for_deleted_training_example();
revoke all on function public.invalidate_datasets_for_deleted_training_example() from public,anon,authenticated;
grant execute on function public.invalidate_datasets_for_deleted_training_example() to service_role;

create table public.model_benchmark_versions (
 id uuid primary key default gen_random_uuid(),name text not null,version integer not null check(version>0),content_hash text not null unique check(content_hash~'^[a-f0-9]{64}$'),
 example_count integer not null check(example_count>0),permanent boolean not null default true,created_at timestamptz not null default now(),unique(name,version)
);
create table public.model_baselines (
 id uuid primary key default gen_random_uuid(),benchmark_id uuid not null references public.model_benchmark_versions(id) on delete restrict,
 model_name text not null,correct integer not null,total integer not null,accuracy double precision not null check(accuracy between 0 and 1),
 notes text,measured_at timestamptz not null default now(),unique(benchmark_id,model_name)
);
create index model_baselines_benchmark_idx on public.model_baselines(benchmark_id);

create table public.model_training_runs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,dataset_id uuid not null references public.model_dataset_versions(id) on delete restrict,
 base_model text not null,method text not null check(method in ('lora','qlora')),status text not null check(status in ('planned','running','completed','failed','cancelled')),
 config jsonb not null,hardware jsonb not null default '{}',git_commit text,artifact_uri text,log_uri text,error text,
 started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now()
);
create index model_training_runs_owner_idx on public.model_training_runs(user_id,created_at desc);
create index model_training_runs_dataset_idx on public.model_training_runs(dataset_id);

create table public.model_candidates (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,training_run_id uuid references public.model_training_runs(id) on delete restrict,
 dataset_id uuid not null references public.model_dataset_versions(id) on delete restrict,name text not null,version integer not null check(version>0),
 base_model text not null,ollama_model_name text,status text not null check(status in ('training','candidate','evaluating','rejected','approved','production','retired')),
 eval_score double precision,weighted_eval_score double precision,created_at timestamptz not null default now(),approved_at timestamptz,promoted_at timestamptz,retired_at timestamptz,
 unique(user_id,name,version),unique(user_id,ollama_model_name)
);
create index model_candidates_owner_status_idx on public.model_candidates(user_id,status,created_at desc);
create index model_candidates_training_idx on public.model_candidates(training_run_id);
create index model_candidates_dataset_idx on public.model_candidates(dataset_id);

create table public.model_eval_runs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,candidate_id uuid references public.model_candidates(id) on delete cascade,
 benchmark_id uuid not null references public.model_benchmark_versions(id) on delete restrict,comparison_model text not null,status text not null check(status in ('running','completed','failed')),
 metrics jsonb not null default '{}',gates jsonb not null default '{}',gates_passed boolean not null default false,error text,started_at timestamptz not null default now(),completed_at timestamptz
);
create index model_eval_runs_owner_idx on public.model_eval_runs(user_id,started_at desc);
create index model_eval_runs_candidate_idx on public.model_eval_runs(candidate_id,started_at desc);
create index model_eval_runs_benchmark_idx on public.model_eval_runs(benchmark_id);

create table public.model_deployments (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,candidate_id uuid not null references public.model_candidates(id) on delete restrict,
 ollama_model_name text not null,status text not null check(status in ('shadow','active','rolled_back','failed')),
 previous_deployment_id uuid references public.model_deployments(id) on delete set null,approved_by uuid references auth.users(id) on delete set null,
 deployed_at timestamptz not null default now(),ended_at timestamptz,notes text
);
create unique index model_deployments_one_active on public.model_deployments(user_id) where status='active';
create index model_deployments_candidate_idx on public.model_deployments(candidate_id,deployed_at desc);

create table public.local_model_task_permissions (
 user_id uuid not null references auth.users(id) on delete cascade,task_type text not null,enabled boolean not null default false,
 min_accuracy double precision not null default 0.95 check(min_accuracy between 0 and 1),min_confidence double precision not null default 0.97 check(min_confidence between 0 and 1),
 updated_at timestamptz not null default now(),primary key(user_id,task_type)
);
create table public.model_shadow_predictions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,candidate_id uuid not null references public.model_candidates(id) on delete cascade,
 task_type text not null,source_hash text not null,production_output jsonb,candidate_output jsonb,candidate_confidence double precision check(candidate_confidence between 0 and 1),
 agreed boolean,latency_ms integer check(latency_ms>=0),created_at timestamptz not null default now()
);
create index model_shadow_predictions_owner_idx on public.model_shadow_predictions(user_id,created_at desc);
create index model_shadow_predictions_candidate_idx on public.model_shadow_predictions(candidate_id,created_at desc);

create table public.model_hard_examples (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,training_example_id uuid references public.model_training_examples(id) on delete cascade,
 source_type text not null,source_id text not null,task_type text not null,reason text not null,error_category text,difficulty_score double precision not null check(difficulty_score between 0 and 1),
 disagreement_score double precision not null check(disagreement_score between 0 and 1),status text not null default 'queued' check(status in ('queued','resolved','excluded')),
 created_at timestamptz not null default now(),resolved_at timestamptz,unique(user_id,source_type,source_id,task_type,reason)
);
create index model_hard_examples_owner_idx on public.model_hard_examples(user_id,status,difficulty_score desc,created_at);
create index model_hard_examples_training_idx on public.model_hard_examples(training_example_id);

create table public.model_pipeline_audit (
 id bigint generated always as identity primary key,user_id uuid references auth.users(id) on delete set null,stage text not null,action text not null,
 object_type text not null,object_id text,status text not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create index model_pipeline_audit_owner_idx on public.model_pipeline_audit(user_id,created_at desc);

insert into public.model_benchmark_versions(name,version,content_hash,example_count,permanent)
values('ass-golden-eval',1,'4cf67a916d0a74ae4ef3e557a6e053918d1f968cd2e468a1cd71a2b1c1364bd3',12,true)
on conflict(name,version) do nothing;
insert into public.model_baselines(benchmark_id,model_name,correct,total,accuracy,notes)
select id,'gemma-4b',6,12,0.5,'Preserved historical ASS baseline; local automatic triage remained disabled.' from public.model_benchmark_versions where name='ass-golden-eval' and version=1
on conflict(benchmark_id,model_name) do nothing;

alter table public.model_dataset_versions enable row level security;
alter table public.model_dataset_examples enable row level security;
alter table public.model_benchmark_versions enable row level security;
alter table public.model_baselines enable row level security;
alter table public.model_training_runs enable row level security;
alter table public.model_candidates enable row level security;
alter table public.model_eval_runs enable row level security;
alter table public.model_deployments enable row level security;
alter table public.local_model_task_permissions enable row level security;
alter table public.model_shadow_predictions enable row level security;
alter table public.model_hard_examples enable row level security;
alter table public.model_pipeline_audit enable row level security;
revoke all on public.model_dataset_versions,public.model_dataset_examples,public.model_benchmark_versions,public.model_baselines,public.model_training_runs,public.model_candidates,public.model_eval_runs,public.model_deployments,public.local_model_task_permissions,public.model_shadow_predictions,public.model_hard_examples,public.model_pipeline_audit from anon,authenticated;
grant all on public.model_dataset_versions,public.model_dataset_examples,public.model_benchmark_versions,public.model_baselines,public.model_training_runs,public.model_candidates,public.model_eval_runs,public.model_deployments,public.local_model_task_permissions,public.model_shadow_predictions,public.model_hard_examples,public.model_pipeline_audit to service_role;
grant usage,select on sequence public.model_pipeline_audit_id_seq to service_role;
