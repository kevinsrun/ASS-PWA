create or replace function public.promote_model_candidate(
  p_user_id uuid,
  p_candidate_id uuid,
  p_approved_by uuid,
  p_notes text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate public.model_candidates%rowtype;
  v_previous public.model_deployments%rowtype;
  v_deployment_id uuid;
begin
  select * into v_candidate
  from public.model_candidates
  where id=p_candidate_id and user_id=p_user_id
  for update;
  if not found then raise exception 'Candidate not found'; end if;
  if v_candidate.status not in ('candidate','evaluating','approved') then
    raise exception 'Candidate status % is not promotable',v_candidate.status;
  end if;
  if v_candidate.ollama_model_name is null or btrim(v_candidate.ollama_model_name)='' then
    raise exception 'Candidate has no packaged Ollama model';
  end if;
  if not exists(
    select 1 from public.model_eval_runs
    where candidate_id=p_candidate_id and user_id=p_user_id and status='completed' and gates_passed=true
  ) then raise exception 'Candidate has no completed passing evaluation'; end if;

  select * into v_previous
  from public.model_deployments
  where user_id=p_user_id and status='active'
  for update;
  if found then
    update public.model_deployments set status='rolled_back',ended_at=now() where id=v_previous.id;
    update public.model_candidates set status='retired',retired_at=now()
      where id=v_previous.candidate_id and id<>p_candidate_id;
  end if;

  update public.model_candidates
  set status='production',approved_at=coalesce(approved_at,now()),promoted_at=now(),retired_at=null
  where id=p_candidate_id;
  insert into public.model_deployments(user_id,candidate_id,ollama_model_name,status,previous_deployment_id,approved_by,notes)
  values(p_user_id,p_candidate_id,v_candidate.ollama_model_name,'active',v_previous.id,p_approved_by,p_notes)
  returning id into v_deployment_id;
  insert into public.model_pipeline_audit(user_id,stage,action,object_type,object_id,status,details)
  values(p_user_id,'promotion','activate','model_deployment',v_deployment_id::text,'active',jsonb_build_object('candidate_id',p_candidate_id,'previous_deployment_id',v_previous.id));
  return v_deployment_id;
end $$;

create or replace function public.rollback_model_deployment(
  p_user_id uuid,
  p_target_deployment_id uuid,
  p_approved_by uuid,
  p_notes text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active public.model_deployments%rowtype;
  v_target public.model_deployments%rowtype;
begin
  select * into v_target
  from public.model_deployments
  where id=p_target_deployment_id and user_id=p_user_id
  for update;
  if not found then raise exception 'Rollback target not found'; end if;
  if v_target.status not in ('rolled_back','shadow') then
    raise exception 'Deployment status % is not a rollback target',v_target.status;
  end if;

  select * into v_active
  from public.model_deployments
  where user_id=p_user_id and status='active'
  for update;
  if not found then raise exception 'No active deployment to replace'; end if;
  if v_active.id=v_target.id then raise exception 'Rollback target is already active'; end if;

  update public.model_deployments set status='rolled_back',ended_at=now() where id=v_active.id;
  update public.model_candidates set status='retired',retired_at=now() where id=v_active.candidate_id;
  update public.model_deployments set status='active',ended_at=null,approved_by=p_approved_by,notes=coalesce(p_notes,notes) where id=v_target.id;
  update public.model_candidates set status='production',retired_at=null,promoted_at=now() where id=v_target.candidate_id;
  insert into public.model_pipeline_audit(user_id,stage,action,object_type,object_id,status,details)
  values(p_user_id,'rollback','activate_previous','model_deployment',v_target.id::text,'active',jsonb_build_object('replaced_deployment_id',v_active.id));
  return v_target.id;
end $$;

revoke all on function public.promote_model_candidate(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.rollback_model_deployment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.promote_model_candidate(uuid,uuid,uuid,text) to service_role;
grant execute on function public.rollback_model_deployment(uuid,uuid,uuid,text) to service_role;
