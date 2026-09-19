do $$
declare
  u uuid; d uuid; r1 uuid; r2 uuid; c1 uuid; c2 uuid; dep1 uuid; dep2 uuid; b uuid;
  h text := md5(random()::text || clock_timestamp()::text) || md5(random()::text);
begin
  select users.id into u from auth.users as users
  where not exists(select 1 from public.model_deployments as deployments where deployments.user_id=users.id and deployments.status='active')
  order by users.created_at limit 1;
  if u is null then raise notice 'Atomic registry self-test skipped: every user has an active deployment'; return; end if;
  select id into b from public.model_benchmark_versions where name='ass-golden-eval' and version=1;
  insert into public.model_dataset_versions(user_id,name,version,content_hash,trust_threshold,example_count,train_count,validation_count,test_count,manifest)
  values(u,'codex-promotion-self-test',2147483646,h,.8,0,0,0,0,'{}') returning id into d;
  insert into public.model_training_runs(user_id,dataset_id,base_model,method,status,config) values(u,d,'self-test','lora','completed','{}') returning id into r1;
  insert into public.model_training_runs(user_id,dataset_id,base_model,method,status,config) values(u,d,'self-test','lora','completed','{}') returning id into r2;
  insert into public.model_candidates(user_id,training_run_id,dataset_id,name,version,base_model,ollama_model_name,status)
  values(u,r1,d,'codex-self-test',1,'self-test','codex-self-test-v1','production') returning id into c1;
  insert into public.model_candidates(user_id,training_run_id,dataset_id,name,version,base_model,ollama_model_name,status)
  values(u,r2,d,'codex-self-test',2,'self-test','codex-self-test-v2','approved') returning id into c2;
  insert into public.model_eval_runs(user_id,candidate_id,benchmark_id,comparison_model,status,metrics,gates,gates_passed,completed_at)
  values(u,c2,b,'codex-self-test-v1','completed','{"accuracy":1}','{"overall":true}',true,now());
  insert into public.model_deployments(user_id,candidate_id,ollama_model_name,status,approved_by)
  values(u,c1,'codex-self-test-v1','active',u) returning id into dep1;
  dep2 := public.promote_model_candidate(u,c2,u,'migration self-test');
  if not exists(select 1 from public.model_deployments where id=dep2 and status='active') then raise exception 'Promotion self-test failed'; end if;
  perform public.rollback_model_deployment(u,dep1,u,'migration self-test');
  if not exists(select 1 from public.model_deployments where id=dep1 and status='active') then raise exception 'Rollback self-test failed'; end if;
  delete from public.model_pipeline_audit where user_id=u and object_id in (dep1::text,dep2::text);
  delete from public.model_deployments where id in (dep1,dep2);
  delete from public.model_eval_runs where candidate_id=c2;
  delete from public.model_candidates where id in (c1,c2);
  delete from public.model_training_runs where id in (r1,r2);
  delete from public.model_dataset_versions where id=d;
end $$;
